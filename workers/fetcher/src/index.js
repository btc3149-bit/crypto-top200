// workers/fetcher/src/index.js — crypto-top200-fetcher（W2-01/W2-02/W2-03；W4-01/W4-10）
// 全球唯一抓取者：Cron */10 * * * * → 抓 CoinGecko（markets 每 run、global 30min）
// → 覆盖率 ≥94% 且结构校验通过才写 KV 单 blob；任一失败保留旧 blob、只更新 health。
// W4-10 KV 版本化：成功写 blob 前，先把上一版 blob 原样存入对应的 prev 键
// （current→currentPrev、shadow→shadowPrev），供回滚/比对；prev 写入失败不阻断主流程。
// 写量变化：每成功 run +1 次 KV 写（prev 归档）。
// 访客请求永不触发抓取；手动补抓仅 POST /run + MANUAL_RUN_TOKEN（Worker Secret）。
//
// COINGECKO_API_KEY（fetcher 侧 Secret）：
// 与 Pages Secret 是两处独立注入；由协调者经 wrangler secret put 注入本 Worker。
// 未注入时本 Worker 走「数据源未配置」配置错误路径（记 health、绝不匿名重试、
// 绝不覆写 blob）——W2-20 §20.5 代码侧口径。key 值绝不出现在日志/响应/health 中。
// PAPRIKA_ENABLED 一律 "false"（W2-03 备源只建能力，启用须 U8，不在本期）。

import {
KV_KEYS,
COVERAGE_RATIO,
buildBlob,
validateBlob,
emptyHealth,
healthStatusFor,
toIso,
toMs,
} from "../../../shared/board-schema.js";
import * as cg from "./providers/coingecko.js";
import * as paprika from "./providers/coinpaprika.js";
import { emptySourceState, resolveProvider, applyOutcome, paprikaEnabled} from "./source-state.js";
import { COINS, IDS} from "./coins-list.js";

export { buildBlob};
export const GLOBAL_INTERVAL_MS = 30 * 60 * 1000;
const DAILY_CREDITS_NORMAL = 192; // markets 144/天 + global 48/天（方案 F）

function logEvent(obj) {
try {
console.log(JSON.stringify({ service: "crypto-top200-fetcher",...obj}));
} catch (_) {}
}
function logError(obj) {
try {
console.error(JSON.stringify({ level: "error", service: "crypto-top200-fetcher",...obj}));
} catch (_) {}
}

function makeRunId(nowMs) {
const d = new Date(nowMs);
const p = (n) => String(n).padStart(2, "0");
const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`;
return `${stamp}-${Math.random().toString(16).slice(2, 6)}`;
}

async function kvGetJson(kv, key) {
try {
const v = await kv.get(key, { type: "json"});
return v || null;
} catch (_) {
return null;
}
}

// 额度估算（W2-01 §2）：本地估算 creditsUsedEst（成功调用 +1），自然月重置；
// 预估全月用量 >8500 → saving（markets 15min/global 60min），>9500 → critical（markets 30min/global 停抓）。
export function estimateQuotaMode(health, nowMs) {
const month = toIso(nowMs).slice(0, 7);
const q = health.quota && health.quota.month === month? health.quota: { month, creditsUsedEst: 0, quotaMode: "normal"};
const d = new Date(nowMs);
const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
const remainingDays = Math.max(0, (monthEnd - nowMs) / 86400000);
const projected = q.creditsUsedEst + DAILY_CREDITS_NORMAL * remainingDays;
let mode = "normal";
if (projected > 9500) mode = "critical";
else if (projected > 8500) mode = "saving";
return { month, creditsUsedEst: q.creditsUsedEst, quotaMode: mode, projected: Math.round(projected)};
}

function quotaSkipMarkets(quotaMode, lastSuccessMs, nowMs) {
if (lastSuccessMs == null) return false;
const ageMin = (nowMs - lastSuccessMs) / 60000;
if (quotaMode === "saving") return ageMin < 15;
if (quotaMode === "critical") return ageMin < 30;
return false;
}

async function writeHealth(env, health) {
try {
await env.BOARD_KV.put(KV_KEYS.health, JSON.stringify(health));
} catch (_) {
// health 写入失败不得反过来影响主流程（W2-02 §3.2）
logError({ event: "health_put_failed"});
}
}

function failResult({ runId, startedAt, stage, code, message, upstreamStatus = null}) {
return {
ok: false,
runId,
stage,
code,
message: String(message || "").slice(0, 200),
upstreamStatus,
durationMs: Date.now() - startedAt,
};
}

// 主流程。可注入 opts: { coins, ids, nowMs, trigger: "cron"|"manual"}
export async function runFetch(env, opts = {}) {
const startedAt = Date.now();
const nowMs = typeof opts.nowMs === "number"? opts.nowMs: startedAt;
const runId = makeRunId(nowMs);
const kv = env.BOARD_KV;
if (!kv) {
return failResult({ runId, startedAt, stage: "kv-put", code: "KV_BINDING_MISSING", message: "BOARD_KV binding missing"});
}
const coins = opts.coins || COINS;
const ids = opts.ids || coins.map((c) => c.id);

let health = (await kvGetJson(kv, KV_KEYS.health)) || emptyHealth(nowMs);
let sourceState = (await kvGetJson(kv, KV_KEYS.sourceState)) || emptySourceState(nowMs);
// W4-01：目标键在开头统一计算，prevBlob 必须读目标键本身——影子期写 shadow 时
// 若误读 current，global.asOf 永不刷新、globalDue 每 run 误判到期（每 10min 重抓）。
// W5-02（F5-02）白名单 fail-closed：BOARD_TARGET_KEY 只接受精确 "shadow"/"current"。
// 旧实现是「非 shadow 即 current」的 fail-open——拼写错误/空值会静默覆写生产键。
// 非法或缺失时 targetKey=null，校验在 finishFail 定义后、任何 blob 写入前执行：
// 只写 health 留痕（stage=config），绝不触碰 current/shadow/prev 任一 blob 键。
const targetKeyRaw = env && env.BOARD_TARGET_KEY;
const targetKey =
targetKeyRaw === "shadow"? KV_KEYS.shadow: targetKeyRaw === "current"? KV_KEYS.current: null;
const targetPrevKey = targetKey === KV_KEYS.shadow? KV_KEYS.shadowPrev: KV_KEYS.currentPrev;
const prevBlob = targetKey? await kvGetJson(kv, targetKey): null;

const finishFail = async (failure, outcomeExtra = {}) => {
health = {
...health,
updatedAt: toIso(Date.now()),
lastRunId: runId,
lastRunAt: toIso(nowMs),
consecutiveFailures: (health.consecutiveFailures || 0) + 1,
lastError: { stage: failure.stage, code: failure.code, message: failure.message},
lastUpstreamStatus: failure.upstreamStatus,
quota: estimateQuotaMode(health, nowMs),
sourceState: { state: sourceState.state, activeProvider: sourceState.activeProvider},
};
Object.assign(health, healthStatusFor(health.consecutiveFailures));
await writeHealth(env, health);
if (outcomeExtra.provider) {
sourceState = applyOutcome(sourceState, { provider: outcomeExtra.provider, ok: false,...outcomeExtra}, nowMs);
try {
await kv.put(KV_KEYS.sourceState, JSON.stringify(sourceState));
} catch (_) {}
}
logError({ event: "fetch_run_failed", runId, stage: failure.stage, code: failure.code, upstreamStatus: failure.upstreamStatus});
return {...failure, runId, consecutiveFailures: health.consecutiveFailures};
};

// W5-02：目标键非法/缺失 → 配置错误路径，fail-closed 拒写任何 blob 键。
// finishFail 只落 health（非 blob 键）作错误留痕，并经 logError 产出结构化日志证据。
if (!targetKey) {
return finishFail(
failResult({
runId,
startedAt,
stage: "config",
code: "BOARD_TARGET_KEY_INVALID",
message: `BOARD_TARGET_KEY 非法或缺失（收到 ${JSON.stringify(targetKeyRaw ?? null)}），fail-closed：拒绝写入任何 blob 键`,
})
);
}

// 429 跳过计数：跳过的 run 不计入连续失败 N（W2-02 §3.3）
if ((health.skipRunsRemaining || 0) > 0) {
health = {...health, skipRunsRemaining: health.skipRunsRemaining - 1, updatedAt: toIso(Date.now()), lastRunId: runId, lastRunAt: toIso(nowMs)};
await writeHealth(env, health);
logEvent({ event: "fetch_run_skipped_429", runId, skipRunsRemaining: health.skipRunsRemaining});
return { ok: false, skipped: true, runId, reason: "retry_after_skip"};
}

const { provider, probeCg, warnings} = resolveProvider(env, sourceState, nowMs);
for (const w of warnings) logError({ event: "source_config_warning", runId, message: w});

// 额度降频：saving/critical 时按距上次 markets 成功时长跳过本 run（不计失败）
const quotaPre = estimateQuotaMode(health, nowMs);
if (quotaSkipMarkets(quotaPre.quotaMode, prevBlob? toMs(prevBlob.marketsUpdatedAt): null, nowMs)) {
logEvent({ event: "fetch_run_skipped_quota", runId, quotaMode: quotaPre.quotaMode});
return { ok: false, skipped: true, runId, reason: "quota_skip", quotaMode: quotaPre.quotaMode};
}

// CG 配置门：无 key → 配置错误路径，绝不匿名重试（§20.5）。探针同理跳过。
const needsCg = provider === "coingecko" || probeCg;
if (needsCg &&!(env && env.COINGECKO_API_KEY)) {
if (provider === "coingecko") {
return finishFail(
failResult({
runId,
startedAt,
stage: "config",
code: "COINGECKO_API_KEY_MISSING",
message: "数据源未配置：fetcher 侧 COINGECKO_API_KEY 未注入（待协调者注入），不回退匿名模式",
}),
{ provider}
);
}
// 仅探针需要 CG 且无 key：探针记失败但不影响 Paprika 主抓
sourceState = applyOutcome(sourceState, { isProbe: true, ok: false}, nowMs);
}

// global 是否到期：距上次成功（blob.global.asOf）≥30min，或从未有 global。
// critical 模式 global 停抓（沿用旧段，最终可能因 >6h 在契约层置 null）。
const prevGlobalAsOf = prevBlob && prevBlob.global? toMs(prevBlob.global.asOf): null;
const globalDue = quotaPre.quotaMode!== "critical" && (prevGlobalAsOf == null || nowMs - prevGlobalAsOf >= GLOBAL_INTERVAL_MS);

const attempts = { markets: 0, global: 0};
const upstreamStatus = { markets: null, global: null};
let creditsUsed = 0;

// CG 探针（Paprika 态）：单端点 markets，不写 blob
if (probeCg && env.COINGECKO_API_KEY) {
try {
const probe = await cg.fetchMarkets(ids, env);
upstreamStatus.markets = probe.upstreamStatus;
sourceState = applyOutcome(sourceState, { isProbe: true, ok: true, coverageRatio: probe.coverage.ratio}, nowMs);
creditsUsed += 1;
} catch (e) {
sourceState = applyOutcome(sourceState, { isProbe: true, ok: false}, nowMs);
}
try {
await kv.put(KV_KEYS.sourceState, JSON.stringify(sourceState));
} catch (_) {}
}

// 主抓取（allSettled：markets 与 global 解耦）
const marketsPromise =
provider === "coingecko"? cg.fetchMarkets(ids, env): paprika.fetchMarkets(coins);
const globalPromise = globalDue
? provider === "coingecko"
? cg.fetchGlobal(env)
: paprika.fetchGlobal()
: Promise.resolve(null);
const [mSettled, gSettled] = await Promise.allSettled([marketsPromise, globalPromise]);

let globalSegment = null;
if (gSettled.status === "fulfilled" && gSettled.value) {
attempts.global = gSettled.value.attempts || 1;
upstreamStatus.global = gSettled.value.upstreamStatus;
creditsUsed += provider === "coingecko"? 1: 0; // Paprika 不计 CG credits
globalSegment = {...gSettled.value.global, asOf: toIso(nowMs)};
} else if (prevBlob && prevBlob.global && prevBlob.source === provider) {
// global 失败/未到期：沿用上一 blob 的同源 global 段及其原 asOf（跨源沿用 = 拼盘，禁止）
globalSegment = prevBlob.global;
if (gSettled.status === "rejected") {
upstreamStatus.global = gSettled.reason && gSettled.reason.status!= null? gSettled.reason.status: null;
}
} else if (gSettled.status === "rejected") {
upstreamStatus.global = gSettled.reason && gSettled.reason.status!= null? gSettled.reason.status: null;
}

if (mSettled.status!== "fulfilled") {
const e = mSettled.reason || {};
if (e.is429 || e.status === 429) {
const retryAfterSec = typeof e.retryAfterSec === "number"? e.retryAfterSec: 60;
const skip = Math.max(0, Math.ceil(retryAfterSec / 600));
health = {...health, skipRunsRemaining: skip};
const f = await finishFail(
failResult({ runId, startedAt, stage: "markets", code: e.errorType || "rate_limited", message: e.message, upstreamStatus: 429}),
{ provider, retryAfterSec, quotaMode: quotaPre.quotaMode}
);
return {...f, skipRunsSet: skip};
}
return finishFail(
failResult({
runId,
startedAt,
stage: "markets",
code: e.errorType || "upstream_error",
message: e.message || "markets failed",
upstreamStatus: e.status!= null? e.status: null,
}),
{ provider, quotaExhausted:!!e.quotaExhausted, quotaMode: quotaPre.quotaMode}
);
}

const mVal = mSettled.value;
attempts.markets = mVal.attempts || 1;
upstreamStatus.markets = mVal.upstreamStatus;
if (provider === "coingecko") creditsUsed += 1;

if (!mVal.coverage || mVal.coverage.ratio < COVERAGE_RATIO) {
return finishFail(
failResult({
runId,
startedAt,
stage: "validate",
code: "coverage_insufficient",
message: `coverage ${mVal.coverage? mVal.coverage.returned: 0}/${mVal.coverage? mVal.coverage.expected: ids.length} below 94% gate`,
upstreamStatus: mVal.upstreamStatus,
}),
{ provider, quotaMode: quotaPre.quotaMode}
);
}

// 成功：组装 blob（buildBlob 单入口 + _src 断言）→ 校验 → 写 KV
const durationMs = Date.now() - startedAt;
const quotaPost = estimateQuotaMode(
{...health, quota: {...(health.quota || {}), month: toIso(nowMs).slice(0, 7), creditsUsedEst: (health.quota && health.quota.month === toIso(nowMs).slice(0, 7)? health.quota.creditsUsedEst || 0: 0) + creditsUsed}},
nowMs
);
let blob;
try {
blob = buildBlob({
source: provider,
fetchRunId: runId,
fetchedAtMs: nowMs,
rows: mVal.rows,
coverage: mVal.coverage,
global: globalSegment,
fetchMeta: {
durationMs,
upstreamStatus,
attempts,
quota: { month: quotaPost.month, creditsUsedEst: quotaPost.creditsUsedEst, quotaMode: quotaPost.quotaMode},
},
healthSummary: { consecutiveFailures: 0, lastSuccessAt: toIso(nowMs)},
});
} catch (e) {
return finishFail(failResult({ runId, startedAt, stage: "validate", code: "build_blob_rejected", message: e.message}), { provider});
}
const validation = validateBlob(blob);
if (!validation.ok) {
return finishFail(
failResult({ runId, startedAt, stage: "validate", code: "blob_invalid", message: validation.errors.join(",")}),
{ provider}
);
}

// W4-10：覆写目标键前先归档上一版到 prev 键（prevBlob 已在内存，不再读 KV）；
// 归档失败只记日志、不阻断主 blob 写入（仿 writeHealth 风格）。每成功 run 因此 +1 次 KV 写。
if (prevBlob) {
try {
await kv.put(targetPrevKey, JSON.stringify(prevBlob));
} catch (_) {
logError({ event: "prev_put_failed", runId, targetPrevKey});
}
}
try {
await kv.put(targetKey, JSON.stringify(blob));
} catch (e) {
return finishFail(failResult({ runId, startedAt, stage: "kv-put", code: "kv_put_failed", message: e && e.message}), { provider});
}

sourceState = applyOutcome(sourceState, { provider, ok: true}, nowMs);
try {
await kv.put(KV_KEYS.sourceState, JSON.stringify(sourceState));
} catch (_) {}

health = {
...emptyHealth(nowMs),
updatedAt: toIso(Date.now()),
status: "ok",
alert: false,
lastRunId: runId,
lastRunAt: toIso(nowMs),
lastSuccessAt: toIso(nowMs),
consecutiveFailures: 0,
lastError: null,
lastUpstreamStatus: upstreamStatus.markets,
quota: { month: quotaPost.month, creditsUsedEst: quotaPost.creditsUsedEst, quotaMode: quotaPost.quotaMode},
sourceState: { state: sourceState.state, activeProvider: sourceState.activeProvider},
};
await writeHealth(env, health);
logEvent({ event: "fetch_run_ok", runId, provider, coverage: blob.coverage, durationMs, targetKey});
return { ok: true, runId, provider, coverage: blob.coverage, durationMs, targetKey, blobBytes: JSON.stringify(blob).length};
}

export default {
async scheduled(event, env, ctx) {
if (String(env && env.BOARD_FETCH_DISABLED) === "1") {
logEvent({ event: "scheduled_skipped_disabled", note: "BOARD_FETCH_DISABLED=1（G0 形态）；手动 /run 不受此开关影响"});
return;
}
const p = runFetch(env, { trigger: "cron"}).catch((e) => logError({ event: "scheduled_unhandled", message: String(e && e.message).slice(0, 200)}));
if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
return p;
},
async fetch(request, env) {
const url = new URL(request.url);
// 仅 POST /run + MANUAL_RUN_TOKEN 校验；其余一律 404（不泄露入口存在性差异）
if (request.method === "POST" && url.pathname === "/run") {
const token = env && env.MANUAL_RUN_TOKEN;
const provided = request.headers.get("x-manual-token");
if (!token ||!provided || provided!== token) {
return new Response(JSON.stringify({ error: "not_found"}), { status: 404, headers: { "content-type": "application/json"}});
}
const result = await runFetch(env, { trigger: "manual"});
return new Response(JSON.stringify(result), {
status: result.ok || result.skipped? 200: 502,
headers: { "content-type": "application/json"},
});
}
return new Response(JSON.stringify({ error: "not_found"}), { status: 404, headers: { "content-type": "application/json"}});
},
};
