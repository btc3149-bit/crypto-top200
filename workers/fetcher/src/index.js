// workers/fetcher/src/index.js — crypto-top200-fetcher（W2-01/W2-02/W2-03；W4-01/W4-10；P6 批3/5/7）
// 全球唯一抓取者：Cron */10 * * * * → 抓 CoinGecko（markets 每 run、global 30min 墙钟相位）
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
// PAPRIKA_ENABLED：备源启用除该开关外还须过 F7-02 门禁（mapped/identityValid/
// activeUsable/tickerHit 四项计数均 ≥94%），见 source-state.js 的
// evaluatePaprikaGate 与主流程 preflight 门禁段。

import {
KV_KEYS,
COVERAGE_RATIO,
buildBlob,
validateBlob,
emptyHealth,
healthStatusFor,
countValidPaprikaMappings,
toIso,
toMs,
} from "../../../shared/board-schema.js";
import * as cg from "./providers/coingecko.js";
import * as paprika from "./providers/coinpaprika.js";
import { emptySourceState, resolveProvider, applyOutcome, paprikaEnabled, evaluatePaprikaGate, paprikaGateThreshold } from "./source-state.js";
import { COINS, IDS} from "./coins-list.js";

export { buildBlob};
export const GLOBAL_INTERVAL_MS = 30 * 60 * 1000;
// F6-44 分段日速率（credits/天）：normal = markets 144（10min）+ global 48（30min）；
// saving = markets 72（*/10 网格上实际 20min 一抓，见 quotaSkipMarkets 注释）+ global 48；
// critical = markets 48（30min 一抓）+ global 0（停抓）。
const DAILY_CREDITS_BY_MODE = { normal: 192, saving: 120, critical: 48};
const DAILY_CREDITS_NORMAL = DAILY_CREDITS_BY_MODE.normal;
// F6-45：skip 路径（429/quota）中 prev global 已严重过期（>2h）时不再整 run 跳过，
// 否则 global 相位会被跳过永久平移、滞后无自愈对齐点。
const GLOBAL_STALE_BYPASS_MS = 2 * 60 * 60 * 1000;
// F6-49：/run 最小触发间隔（人工恢复通道的节流兜底）
const MANUAL_RUN_MIN_INTERVAL_MS = 60 * 1000;

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

// F6-47：区分「键缺失」（返回 null）与「读异常」（抛 KvReadError）。
// 旧实现 catch 全部返回 null，一次 KV 读抖动即可把 consecutiveFailures 清零重计、
// 丢失 sourceState 的额度锁定、误判 globalDue 且断掉 prev 归档链。
class KvReadError extends Error {
constructor(key) {
super(`kv read failed: ${key}`);
this.name = "KvReadError";
this.key = key;
}
}

async function kvGetJson(kv, key) {
try {
const v = await kv.get(key, { type: "json"});
return v || null;
} catch (e) {
throw new KvReadError(key);
}
}

// 额度估算（W2-01 §2；F6-44 分段投影）：creditsUsedEst 为自然月累计（含失败 run 的
// 真实消耗，F6-11）；attemptsTotal 为同月上游调用总次数（含 Paprika、不计 credits 的调用）。
// 投影 = 已用 +「当前 mode 的日速率」× 剩余天数（速率见 DAILY_CREDITS_BY_MODE），
// 不再恒用 normal 速率外推。mode 取 max(投影候选, 本月已达 mode)：月内只升不降，
// 消除临界抖动与进入 saving 后按旧速率整月粘滞；跨月随计数重置自然回 normal。
// 阈值：投影 >8500 → saving，>9500 → critical。
export function estimateQuotaMode(health, nowMs) {
const month = toIso(nowMs).slice(0, 7);
const sameMonth = health.quota && health.quota.month === month;
const q = sameMonth? health.quota: { month, creditsUsedEst: 0, attemptsTotal: 0, quotaMode: "normal"};
const creditsUsedEst = q.creditsUsedEst || 0;
const attemptsTotal = q.attemptsTotal || 0;
const storedMode = q.quotaMode && DAILY_CREDITS_BY_MODE[q.quotaMode]? q.quotaMode: "normal";
const d = new Date(nowMs);
const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
const remainingDays = Math.max(0, (monthEnd - nowMs) / 86400000);
const projected = creditsUsedEst + DAILY_CREDITS_BY_MODE[storedMode] * remainingDays;
let candidate = "normal";
if (projected > 9500) candidate = "critical";
else if (projected > 8500) candidate = "saving";
const rank = { normal: 0, saving: 1, critical: 2};
const mode = rank[candidate] >= rank[storedMode]? candidate: storedMode;
return { month, creditsUsedEst, attemptsTotal, quotaMode: mode, projected: Math.round(projected)};
}

// saving 名义 15min 节奏在 */10 Cron 网格上的实际落点为 0/20/40 分钟，即 markets
// 实际 20 分钟一抓（F6-44：注释口径与实际对齐，调度行为不变）；critical 为 30min。
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

// F6-52（fetcher 消费侧）：新抓 global 关键字段全 null 视为抓取失败（上游 200 但 data 为空），
// 不盖新 asOf、沿用 prev global。检测先用字段直查实现；shared/board-schema.js validateBlob
// 若后续给 global 全 null 可识别标记，集成时以其为准（见 P6_NOTES）。
function globalAllNull(g) {
return !!g && g.totalMarketCapUsd == null && g.btcDominancePct == null && g.totalMcapChange24h == null;
}

// F6-48 在途合并：同一 isolate 内并发的 runFetch（cron 与 /run 撞车、人工连点）
// 复用同一在途 promise，避免 health/sourceState/quota 读-改-写竞态与旧 blob 后落盘覆盖新 blob。
let inFlightRun = null;
export function runFetch(env, opts = {}) {
if (inFlightRun) {
logEvent({ event: "fetch_run_coalesced", note: "concurrent runFetch reuses in-flight run (F6-48)"});
return inFlightRun;
}
const p = runFetchInner(env, opts);
inFlightRun = p;
const clear = () => {
if (inFlightRun === p) inFlightRun = null;
};
p.then(clear, clear);
return p;
}

// 主流程。可注入 opts: { coins, ids, nowMs, trigger: "cron"|"manual"}
async function runFetchInner(env, opts = {}) {
const startedAt = Date.now();
const nowMs = typeof opts.nowMs === "number"? opts.nowMs: startedAt;
const runId = makeRunId(nowMs);
const kv = env.BOARD_KV;
if (!kv) {
return failResult({ runId, startedAt, stage: "kv-put", code: "KV_BINDING_MISSING", message: "BOARD_KV binding missing"});
}
const coins = opts.coins || COINS;
const ids = opts.ids || coins.map((c) => c.id);
const manualRun = opts.trigger === "manual";
// F6-10 映射计数：每 run 按本 run 币表计算，落 health.paprikaMappedCount 供监控读。
// F8-16：计数一律走 shared/board-schema.js 定版接口 countValidPaprikaMappings
// （内部经 isValidPaprikaId），禁止 truthy/非空字符串计数——畸形串不得灌水 mapped。
const paprikaMappedCount = countValidPaprikaMappings(coins);
// F7-02：Paprika 实际可用不再只看 mapped 计数——须在 resolveProvider 后对候选 run
// 做 preflight（身份/活跃/tickers 有效命中四项计数均 ≥94%，见下方门禁段），
// 结果落 health.paprikaGate（四项计数分开写，禁止以非空数冒充有效数）。
// F8-15：paprikaGate 未测态可区分——preflight 未执行/抛错时写
// {measured:false, reason, identityValid:null, activeUsable:null, tickerHit:null}，
// 不再零填充冒充实测 0；实测完成写 measured:true。非候选 run 仍为 null（不适用）。
// preflight 完成前 paprikaUsable=false；applyOutcome 的迁移许可共用此口径（F6-43）。
let paprikaGate = null;
let paprikaUsable = false;
// F8-14：本 run 字段清洗计数（分源汇总）——providers 返回的 invalidFields 在此
// 并入 runInvalidFields 后落 health.invalidFields 并在 total>0 时打结构化日志，
// 不再在运行路径丢弃。未发生抓取的源保持 null（未测 ≠ 实测 0）。
let runInvalidFields = null;
const noteInvalidFields = (source, fields) => {
if (!fields) return;
if (!runInvalidFields) runInvalidFields = { coingecko: null, coinpaprika: null};
const cur = runInvalidFields[source] || { price: 0, mcapUsd: 0, volume24h: 0, change24h: 0, rank: 0, total: 0};
for (const k of Object.keys(cur)) cur[k] += fields[k] || 0;
runInvalidFields[source] = cur;
if ((fields.total || 0) > 0) {
logEvent({ event: "invalid_fields_cleaned", runId, source, invalidFields: fields});
}
};

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

// F6-47：health/sourceState/prevBlob 任一读异常 → 本 run 以 stage=kv-get 失败收尾，
// 不覆写 health/sourceState（不重置失败计数、不丢额度锁定）。
let health, sourceState, prevBlob;
try {
health = (await kvGetJson(kv, KV_KEYS.health)) || emptyHealth(nowMs);
sourceState = (await kvGetJson(kv, KV_KEYS.sourceState)) || emptySourceState(nowMs);
prevBlob = targetKey? await kvGetJson(kv, targetKey): null;
} catch (e) {
logError({ event: "kv_read_failed", runId, key: e && e.key? e.key: null});
return failResult({
runId,
startedAt,
stage: "kv-get",
code: "kv_read_failed",
message: "KV read failed; run aborted without overwriting health/sourceState (F6-47)",
});
}

// F6-11 本 run 账本：每一次真实上游调用（探针/markets/global，成功或失败）都记 attempts；
// CoinGecko 调用另记 credits（Paprika 不烧 CG credits）。finishFail 与成功路径都并入后再估算 mode。
const runLedger = { credits: 0, attempts: 0};
const ledgerCall = (isCg, n = 1) => {
runLedger.attempts += n;
if (isCg) runLedger.credits += n;
};
// 把账本并入 health.quota 后再估算 mode（供 finishFail 与成功路径共用）
const quotaWithLedger = () => {
const month = toIso(nowMs).slice(0, 7);
const prevQ = health.quota && health.quota.month === month? health.quota: { creditsUsedEst: 0, attemptsTotal: 0, quotaMode: "normal"};
return estimateQuotaMode(
{
...health,
quota: {
month,
creditsUsedEst: (prevQ.creditsUsedEst || 0) + runLedger.credits,
attemptsTotal: (prevQ.attemptsTotal || 0) + runLedger.attempts,
quotaMode: prevQ.quotaMode || "normal",
},
},
nowMs
);
};

// F6-42：global 限流状态（从已存 health 继承，本 run 内更新后回写）：
// globalLast429At 最近一次 global 429 时刻；globalSkipUntil 在此之前 global 单独退避、markets 照常。
let globalLast429At = health.globalLast429At || null;
let globalSkipUntil = health.globalSkipUntil || null;
const prevLastManualRunAt = health.lastManualRunAt || null;
// 本 run 实际使用的 provider（resolveProvider+门禁后确定）；health.sourceState 快照以此为准（F6-43）。
let resolvedProvider = null;

const finishFail = async (failure, outcomeExtra = {}) => {
health = {
...health,
updatedAt: toIso(Date.now()),
lastRunId: runId,
lastRunAt: toIso(nowMs),
consecutiveFailures: (health.consecutiveFailures || 0) + 1,
lastError: { stage: failure.stage, code: failure.code, message: failure.message},
lastUpstreamStatus: failure.upstreamStatus,
quota: quotaWithLedger(),
sourceState: { state: sourceState.state, activeProvider: resolvedProvider || sourceState.activeProvider},
globalLast429At,
globalSkipUntil,
paprikaMappedCount,
paprikaGate,
invalidFields: runInvalidFields,
lastManualRunAt: manualRun? toIso(nowMs): prevLastManualRunAt,
};
Object.assign(health, healthStatusFor(health.consecutiveFailures));
await writeHealth(env, health);
if (outcomeExtra.provider) {
sourceState = applyOutcome(sourceState, { provider: outcomeExtra.provider, ok: false,...outcomeExtra}, nowMs, { paprikaEnabled: paprikaUsable});
try {
await kv.put(KV_KEYS.sourceState, JSON.stringify(sourceState));
} catch (_) {}
}
logError({ event: "fetch_run_failed", runId, stage: failure.stage, code: failure.code, upstreamStatus: failure.upstreamStatus});
return {...failure, runId, consecutiveFailures: health.consecutiveFailures};
};

// W5-02：目标键非法/缺失 → 配置错误路径，fail-closed 拒写任何 blob 键。
// finishFail 只落 health（非 blob 键）作错误留痕，并经 logError 产出结构化日志证据。
// F6-91：message 用固定文案——env 原值绝不进 health/响应，只在结构化日志记长度/类别。
if (!targetKey) {
logError({
event: "board_target_key_invalid",
runId,
valueKind: targetKeyRaw == null? "missing": typeof targetKeyRaw,
valueLength: typeof targetKeyRaw === "string"? targetKeyRaw.length: null,
});
return finishFail(
failResult({
runId,
startedAt,
stage: "config",
code: "BOARD_TARGET_KEY_INVALID",
message: "BOARD_TARGET_KEY 非法或缺失，fail-closed：拒绝写入任何 blob 键（收到值不回显，仅记长度/类别）",
})
);
}

// global 相位/过期判定提前（skip 路径的 F6-45 绕过判定需要）：
// prev global 已严重过期（>2h，或有 blob 但 global 段缺失）时，429/quota 跳过不再整 run 生效。
const prevGlobalAsOf = prevBlob && prevBlob.global? toMs(prevBlob.global.asOf): null;
const globalSeverelyStale =
prevBlob != null && (prevGlobalAsOf == null || nowMs - prevGlobalAsOf > GLOBAL_STALE_BYPASS_MS);

// F6-46：429 跳过改 retryUntil 时间戳判定（health.retryUntil），不再按轮数 ceil——
// Retry-After=60s 旧口径会放大成停抓约 20 分钟。旧 health 的 skipRunsRemaining 仍兼容 honor 并递减。
// 计数口径（与 docs/fetcher-runbook.md「429」一行及 W2-02 §3.3 定版对齐）：被跳过的 run 不计
// 连续失败；触发 429 的本 run 经 finishFail 计入 1 次（既有 board-fetcher 用例锁定此口径）。
const retryUntilMs = toMs(health.retryUntil);
const inRetryWindow = retryUntilMs != null && nowMs < retryUntilMs;
const legacySkip = (health.skipRunsRemaining || 0) > 0;
if ((inRetryWindow || legacySkip) && !globalSeverelyStale) {
health = {
...health,
skipRunsRemaining: legacySkip && !inRetryWindow? health.skipRunsRemaining - 1: 0,
updatedAt: toIso(Date.now()),
lastRunId: runId,
lastRunAt: toIso(nowMs),
};
await writeHealth(env, health);
logEvent({ event: "fetch_run_skipped_429", runId, retryUntil: health.retryUntil || null, skipRunsRemaining: health.skipRunsRemaining});
return { ok: false, skipped: true, runId, reason: "retry_after_skip"};
}
if ((inRetryWindow || legacySkip) && globalSeverelyStale) {
logEvent({ event: "fetch_run_skip_bypassed_global_stale", runId, note: "prev global severely stale (>2h); skip bypassed so global can refetch (F6-45)"});
}

const resolved = resolveProvider(env, sourceState, nowMs);
let { provider, probeCg} = resolved;
const warnings = [...resolved.warnings];
// F7-02 启用门禁（代 F6-10 单一计数门禁）：provider 候选为 Paprika 时才做
// candidate preflight——拉 Paprika 目录+tickers 算四项计数（mapped / identityValid /
// activeUsable / tickerHit），四项均须 ≥ 发布覆盖门禁 94%（200 币即 188）才放行；
// 任一不足或 preflight 失败 → 强制 CG（同 run fallback，不影响 CG 正常路径：
// CG 为 provider 的 run 不做任何额外 Paprika 调用）。生产 PAPRIKA_ENABLED="false"
// 时 provider 恒为 CG，本段不触发，Paprika 保持关闭。
if (provider === "coinpaprika") {
let gateStats = null;
let gateMeasured = false;
let gateReason = null;
// mapped 为本地可算计数：其本身已低于门槛时门禁必然不过，跳过 preflight
// （零 Paprika 调用，与 F6-10 旧门禁的拦截后零调用口径一致）。
const mappedBelowGate = paprikaMappedCount < paprikaGateThreshold(coins.length);
if (mappedBelowGate) {
gateReason = "preflight_skipped_mapped_below_gate";
} else {
// F8-17：按调用发生时记账——fetchGateStats 每发出一次 Paprika 调用即回调，
// 中途失败（如目录成功、tickers 500）已发生的 1–2 次调用也进 attemptsTotal，
// 不再等成功后补记固定 2 次。
let preflightAttempts = 0;
try {
gateStats = await paprika.fetchGateStats(coins, () => {
preflightAttempts += 1;
});
gateMeasured = true;
} catch (e) {
gateReason = "preflight_failed";
logError({ event: "paprika_gate_preflight_failed", runId, message: String(e && e.message).slice(0, 200) });
} finally {
if (preflightAttempts > 0) ledgerCall(false, preflightAttempts);
}
}
if (gateMeasured) {
const gate = evaluatePaprikaGate(gateStats, coins.length);
paprikaGate = { measured: true, reason: null, ...gate.counts, threshold: gate.threshold, total: gate.total, ok: gate.ok, checkedAt: toIso(nowMs) };
if (gate.ok) {
paprikaUsable = paprikaEnabled(env);
} else {
warnings.push(`paprika gate: ${gate.failures.join("; ")}; forcing coingecko (F7-02)`);
provider = "coingecko";
probeCg = false;
}
} else {
// F8-15：未测态——计数分项写 null + reason，不零填充冒充实测 0。
paprikaGate = {
measured: false,
reason: gateReason,
mapped: paprikaMappedCount,
identityValid: null,
activeUsable: null,
tickerHit: null,
threshold: paprikaGateThreshold(coins.length),
total: coins.length,
ok: false,
checkedAt: toIso(nowMs),
};
warnings.push(
`paprika gate: ${mappedBelowGate ? `mapped ${paprikaMappedCount}/${coins.length} below 94% gate; preflight skipped` : "preflight failed"}; forcing coingecko (F7-02/F8-15)`
);
provider = "coingecko";
probeCg = false;
}
}
resolvedProvider = provider;
for (const w of warnings) logError({ event: "source_config_warning", runId, message: w});

// 额度降频：saving/critical 时按距上次 markets 成功时长跳过本 run（不计失败）；
// F6-45：global 已严重过期时不跳过（同 429 路径），避免 global 被额度跳过长期饿死。
const quotaPre = estimateQuotaMode(health, nowMs);
if (quotaSkipMarkets(quotaPre.quotaMode, prevBlob? toMs(prevBlob.marketsUpdatedAt): null, nowMs)) {
if (!globalSeverelyStale) {
logEvent({ event: "fetch_run_skipped_quota", runId, quotaMode: quotaPre.quotaMode});
return { ok: false, skipped: true, runId, reason: "quota_skip", quotaMode: quotaPre.quotaMode};
}
logEvent({ event: "fetch_run_skip_bypassed_global_stale", runId, quotaMode: quotaPre.quotaMode, note: "quota skip bypassed: prev global severely stale (F6-45)"});
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
sourceState = applyOutcome(sourceState, { isProbe: true, ok: false}, nowMs, { paprikaEnabled: paprikaUsable});
}

// global 是否到期（F6-45 墙钟相位）：按 epoch 30 分钟窗口判定——now 与 prev asOf
// 不在同一窗口即到期，不再锚定 prevBlob.global.asOf + 30min（跳过/失败会永久平移相位）。
// 无故障下 global 最长滞后约 40 分钟（30min 窗口 + 10min tick），此为下限、故障期可更久。
// critical 模式 global 停抓（沿用旧段，最终可能因 >6h 在契约层置 null）。
// F6-42：global 退避期内（globalSkipUntil 未到）单独跳过 global，markets 照常。
// 退避无条件尊重上游 Retry-After（F6-45 的严重过期绕过只针对整 run 跳过路径，不架空本退避）。
const globalSkipUntilMs = toMs(globalSkipUntil);
const globalBackoffActive = globalSkipUntilMs != null && nowMs < globalSkipUntilMs;
const globalDue =
quotaPre.quotaMode!== "critical" &&
!globalBackoffActive &&
(prevGlobalAsOf == null || Math.floor(nowMs / GLOBAL_INTERVAL_MS)!== Math.floor(prevGlobalAsOf / GLOBAL_INTERVAL_MS));

const attempts = { markets: 0, global: 0};
const upstreamStatus = { markets: null, global: null};

// CG 探针（Paprika 态）：单端点 markets，不写 blob。探针调用无论成败都记账（F6-11）。
if (probeCg && env.COINGECKO_API_KEY) {
try {
const probe = await cg.fetchMarkets(ids, env);
noteInvalidFields("coingecko", probe.invalidFields);
upstreamStatus.markets = probe.upstreamStatus;
sourceState = applyOutcome(sourceState, { isProbe: true, ok: true, coverageRatio: probe.coverage.ratio}, nowMs, { paprikaEnabled: paprikaUsable});
} catch (e) {
sourceState = applyOutcome(sourceState, { isProbe: true, ok: false}, nowMs, { paprikaEnabled: paprikaUsable});
}
ledgerCall(true, 1);
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

// F6-11 记账：markets 与 global 的每一次真实调用（成功/失败/被丢弃）都并入账本。
attempts.markets = mSettled.status === "fulfilled"? mSettled.value.attempts || 1: 1;
ledgerCall(provider === "coingecko", attempts.markets);
if (globalDue) {
attempts.global = gSettled.status === "fulfilled" && gSettled.value? gSettled.value.attempts || 1: 1;
ledgerCall(provider === "coingecko", attempts.global);
}

let globalSegment = null;
if (gSettled.status === "fulfilled" && gSettled.value) {
upstreamStatus.global = gSettled.value.upstreamStatus;
if (globalAllNull(gSettled.value.global)) {
// F6-52：关键字段全 null → 视为抓取失败，不盖新戳，走下方 prev 沿用逻辑
logError({ event: "global_empty_payload", runId, provider, note: "global key fields all null; treated as fetch failure, prev global kept (F6-52)"});
} else {
globalSegment = {...gSettled.value.global, asOf: toIso(nowMs)};
globalSkipUntil = null; // global 抓取恢复，退避解除（F6-42）
}
}
if (!globalSegment) {
if (prevBlob && prevBlob.global && prevBlob.source === provider) {
// global 失败/未到期/全 null：沿用上一 blob 的同源 global 段及其原 asOf（跨源沿用 = 拼盘，禁止）
globalSegment = prevBlob.global;
}
if (gSettled.status === "rejected") {
const e = gSettled.reason || {};
upstreamStatus.global = e.status!= null? e.status: null;
// F6-42：global 端 429 单独退避——消费 UpstreamError.retryAfterSec，记 health 字段供监控读，
// 不连带跳过 markets（与 markets 429 的整 run retryUntil 区分）。
if (e.is429 || e.status === 429) {
const retryAfterSec = typeof e.retryAfterSec === "number"? e.retryAfterSec: 60;
globalLast429At = toIso(nowMs);
globalSkipUntil = toIso(nowMs + retryAfterSec * 1000);
logError({ event: "global_rate_limited", runId, retryAfterSec, globalSkipUntil});
}
}
}

if (mSettled.status!== "fulfilled") {
const e = mSettled.reason || {};
if (e.is429 || e.status === 429) {
const retryAfterSec = typeof e.retryAfterSec === "number"? e.retryAfterSec: 60;
// F6-46：写 retryUntil 时间戳（health.retryUntil），门禁按时间戳判定；
// skipRunsSet 仅作结果兼容字段（等价 10min 轮数），不再落 health 计数。
health = {...health, retryUntil: toIso(nowMs + retryAfterSec * 1000), skipRunsRemaining: 0};
const f = await finishFail(
failResult({ runId, startedAt, stage: "markets", code: e.errorType || "rate_limited", message: e.message, upstreamStatus: 429}),
{ provider, retryAfterSec, quotaMode: quotaPre.quotaMode}
);
return {...f, skipRunsSet: Math.max(0, Math.ceil(retryAfterSec / 600))};
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
noteInvalidFields(provider, mVal.invalidFields);
upstreamStatus.markets = mVal.upstreamStatus;

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
const quotaPost = quotaWithLedger();
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
quota: { month: quotaPost.month, creditsUsedEst: quotaPost.creditsUsedEst, attemptsTotal: quotaPost.attemptsTotal, quotaMode: quotaPost.quotaMode},
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

sourceState = applyOutcome(sourceState, { provider, ok: true}, nowMs, { paprikaEnabled: paprikaUsable});
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
retryUntil: null,
quota: { month: quotaPost.month, creditsUsedEst: quotaPost.creditsUsedEst, attemptsTotal: quotaPost.attemptsTotal, quotaMode: quotaPost.quotaMode},
sourceState: { state: sourceState.state, activeProvider: provider},
globalLast429At,
globalSkipUntil,
paprikaMappedCount,
paprikaGate,
invalidFields: runInvalidFields,
lastManualRunAt: manualRun? toIso(nowMs): prevLastManualRunAt,
};
await writeHealth(env, health);
logEvent({ event: "fetch_run_ok", runId, provider, coverage: blob.coverage, durationMs, targetKey});
return { ok: true, runId, provider, coverage: blob.coverage, durationMs, targetKey, blobBytes: JSON.stringify(blob).length};
}

// F6-49：token 常量时间比较——双侧 SHA-256 后逐字节 XOR 累积，避免普通字符串比较的时序侧信道。
async function tokenMatches(provided, expected) {
const enc = new TextEncoder();
const [a, b] = await Promise.all([
crypto.subtle.digest("SHA-256", enc.encode(String(provided))),
crypto.subtle.digest("SHA-256", enc.encode(String(expected))),
]);
const av = new Uint8Array(a);
const bv = new Uint8Array(b);
let diff = 0;
for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
return diff === 0;
}

// F6-84：BOARD_FETCH_DISABLED 改 fail-closed——除非显式为 "0"（或未设置/空串），
// 任何非空值都视为禁用；未知值另记 error 日志（误写 "ture" 等不得静默按启用处理）。
function fetchDisabled(env) {
const raw = env && env.BOARD_FETCH_DISABLED;
if (raw == null || raw === "" || String(raw) === "0") return false;
const known = ["1", "true", "yes", "on"];
if (!known.includes(String(raw).toLowerCase())) {
logError({
event: "board_fetch_disabled_unknown_value",
valueKind: typeof raw,
valueLength: String(raw).length,
note: "unknown BOARD_FETCH_DISABLED value treated as disabled (fail-closed, F6-84)",
});
}
return true;
}

export default {
async scheduled(event, env, ctx) {
if (fetchDisabled(env)) {
logEvent({ event: "scheduled_skipped_disabled", note: "BOARD_FETCH_DISABLED 非 \"0\" 即禁用（F6-84 fail-closed）；手动 /run 不受此开关影响（人工恢复通道，见 fetch 处理注释）"});
return;
}
const p = runFetch(env, { trigger: "cron"}).catch((e) => logError({ event: "scheduled_unhandled", message: String(e && e.message).slice(0, 200)}));
if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
return p;
},
async fetch(request, env) {
const url = new URL(request.url);
// 仅 POST /run + MANUAL_RUN_TOKEN 校验；其余一律 404（不泄露入口存在性差异）
// F6-49 决策：BOARD_FETCH_DISABLED 时 /run 维持可用——它是紧急停抓后的人工恢复/验证
// 通道，禁用它会让恢复只能改配置重部署；滥用面由 token（常量时间比较）+ 60s 最小间隔
// + F6-48 在途合并三重兜底。此决策与节流兜底一并记入 P6_NOTES。
if (request.method === "POST" && url.pathname === "/run") {
const token = env && env.MANUAL_RUN_TOKEN;
const provided = request.headers.get("x-manual-token");
if (!token || !provided || !(await tokenMatches(provided, token))) {
return new Response(JSON.stringify({ error: "not_found"}), { status: 404, headers: { "content-type": "application/json"}});
}
// F6-49 最小间隔 60s：上次触发时刻记 health.lastManualRunAt；间隔内拒绝并留痕
// （结构化日志 + health.lastManualRunRejectedAt），不触发抓取、不烧额度。
// F7-44（已 stub KV 复现确认）：节流读失败改 fail-closed——旧实现 catch 吞错后
// 直接 runFetch，KV 抖动窗口内节流整体失效；现读 health 抛错即 503
// manual_run_throttle_check_failed、不触发抓取（health 键缺失返回 null 不算失败，照常放行）。
// 拒绝回写竞态消除：不再以节流检查时读到的整对象回写 health；改先写专用节流键
// v1:meta:manual-run-throttle（单字段、无并发写方），再重读最新 health 仅合并
// lastManualRunRejectedAt 一个字段后回写，重读失败则跳过 health 回写——
// 并发 cron run 的 health 更新不会被旧快照覆盖。
if (env.BOARD_KV) {
let h = null;
try {
h = await env.BOARD_KV.get(KV_KEYS.health, { type: "json"});
} catch (_) {
logError({ event: "manual_run_throttle_check_failed"});
return new Response(JSON.stringify({ error: "throttle_check_failed"}), {
status: 503,
headers: { "content-type": "application/json"},
});
}
const lastMs = h? toMs(h.lastManualRunAt): null;
if (lastMs != null && Date.now() - lastMs < MANUAL_RUN_MIN_INTERVAL_MS) {
const retryAfterSec = Math.ceil((MANUAL_RUN_MIN_INTERVAL_MS - (Date.now() - lastMs)) / 1000);
logError({ event: "manual_run_rejected_interval", retryAfterSec});
const rejectedAt = toIso(Date.now());
try {
await env.BOARD_KV.put("v1:meta:manual-run-throttle", JSON.stringify({ lastManualRunRejectedAt: rejectedAt, retryAfterSec}));
} catch (_) {}
try {
const fresh = await env.BOARD_KV.get(KV_KEYS.health, { type: "json"});
if (fresh && typeof fresh === "object") {
await env.BOARD_KV.put(KV_KEYS.health, JSON.stringify({...fresh, lastManualRunRejectedAt: rejectedAt}));
}
} catch (_) {}
return new Response(JSON.stringify({ error: "rate_limited", retryAfterSec}), {
status: 429,
headers: { "content-type": "application/json"},
});
}
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
