// /api/health — Cloudflare Pages Function（W2-13 新增，只读健康端点；W4-02/W4-06 升级）
// 服务端判定本站数据新鲜度与完整度，把「新鲜度」变成状态码语义，
// 供外部探针（UptimeRobot M4，见 ops/probe-config.md）以普通 HTTP 监控检查：
//   - 健康：HTTP 200 {"ok":true, ...}
//   - 不健康：HTTP 503 {"ok":false, ...}
//
// 判定口径（W4-06 统一：单一口径源 shared/health-thresholds.json，smoke/probe 同读此文件，
// 定版理由见 ops/health-thresholds.md）：
//   1. 新鲜度：now − board.updatedAt ≤ staleSec（900s）；quotaMode=critical 时 fetcher
//      抓取间隔升至 1800s（FETCH_INTERVAL_SEC.critical），阈值联动放宽为
//      quotaCriticalStaleSec（1800s），否则 G3 后 critical 期将常态误报。
//      quotaMode 读自 KV 的 fetcher health 记录（v1:meta:health.quota.quotaMode）；
//      读不到时按 normal/900s 处理（不放宽）。
//   2. 完整度：board.coverage.returned 必须等于 expected（passRatio=1.0 的等价口径）
//      且 expected == coverage.expectedCount（200）。
//   两条同时满足才 ok；board 不可达 / 非 200 / 非 JSON / 字段缺失一律 503。
//
// W4-02 quota 总账输出（响应 quota 字段，两路合计，任一响应形态都带）：
//   fetcherCreditsUsedEst（KV health.quota）+ legacyCredits（KV v1:meta:legacy-credits，
//   board.js legacy 回源计数）= totalUsed（本月已用合计）；totalProjected 为按本月
//   日均消耗投影的月末总量；projectedExhaustDate / daysToExhaust 为按同一日均投影的
//   10,000 credits 击穿日与剩余天数（日均=0 或已无法投影时为 null）。
//   读不到 legacy 计数键时 legacyCredits 按 0 计且 legacyCounted=false（降级可见）。
//
// 阈值注入方式（Pages Functions 运行时可行性）：health.js 以 ESM JSON import 直读
// shared/health-thresholds.json（带 type:"json" 属性）——部署时 Wrangler/esbuild 把
// JSON 内联进 Function bundle（构建时注入，运行时零 IO）；本地 Node 24 测试原生
// 支持同一语法。bash 侧 smoke.sh/probe.sh 以 python3 读同一 JSON 文件，三方同源。
//
// 安全与隐私：响应只含 mode / ageSec / coverage / quota 估算等非敏感字段，不透传
// coins 数据、不含任何密钥或上游信息；响应不缓存（Cache-Control: no-store）。
// 方法语义：onRequestGet 承载 GET；onRequestHead 承载 HEAD（与 GET 同状态同头、无 body，
// 供 UptimeRobot HTTP 监控的默认 HEAD 探测使用——2026-11-12 M4 实测 405 后补）；
// onRequest 兜底其余方法 405。

import HEALTH_THRESHOLDS from "../../shared/health-thresholds.json" with { type: "json" };
import { KV_KEYS } from "../../shared/board-schema.js";

const STALE_SEC =
  HEALTH_THRESHOLDS && typeof HEALTH_THRESHOLDS.staleSec === "number" ? HEALTH_THRESHOLDS.staleSec : 900;
const QUOTA_CRITICAL_STALE_SEC =
  HEALTH_THRESHOLDS && typeof HEALTH_THRESHOLDS.quotaCriticalStaleSec === "number"
    ? HEALTH_THRESHOLDS.quotaCriticalStaleSec
    : 1800;
const EXPECTED_COUNT =
  HEALTH_THRESHOLDS && HEALTH_THRESHOLDS.coverage && typeof HEALTH_THRESHOLDS.coverage.expectedCount === "number"
    ? HEALTH_THRESHOLDS.coverage.expectedCount
    : 200;
const COVERAGE_PASS_RATIO =
  HEALTH_THRESHOLDS && HEALTH_THRESHOLDS.coverage && typeof HEALTH_THRESHOLDS.coverage.passRatio === "number"
    ? HEALTH_THRESHOLDS.coverage.passRatio
    : 1.0;
export const QUOTA_LIMIT_CREDITS = 10000; // CoinGecko Demo 月额度（F4-02 定版口径）

// quotaMode 联动阈值：critical → 1800s（与 fetcher critical 抓取间隔同值），其余 → 900s。
export function effectiveStaleThresholdSec(quotaMode) {
  return quotaMode === "critical" ? QUOTA_CRITICAL_STALE_SEC : STALE_SEC;
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function methodNotAllowedResponse() {
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
    status: 405,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      allow: "GET, HEAD",
    },
  });
}

// board.updatedAt 兼容两种形态：毫秒/秒级数值时间戳（现行 board.js 为 ms 数值）
// 与 ISO 字符串（probe.sh 同样双兼容，此处保持一致以防契约演进）。
function parseUpdatedAt(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e12 ? raw / 1000 : raw;
  }
  if (typeof raw === "string" && raw !== "") {
    const asNum = Number(raw);
    if (Number.isFinite(asNum)) return asNum > 1e12 ? asNum / 1000 : asNum;
    const asDate = Date.parse(raw);
    if (Number.isFinite(asDate)) return asDate / 1000;
  }
  return null;
}

// W4-02 总账计算（纯函数，可测）：fetcherHealth = KV v1:meta:health 对象（或 null），
// legacyCounter = KV v1:meta:legacy-credits 对象（或 null，读不到即 null）。
// 月份口径与 fetcher 一致：UTC 自然月（ISO 前 7 位）；跨月记录按本月 0 计。
export function computeQuotaInfo({ fetcherHealth = null, legacyCounter = null, nowMs = Date.now() } = {}) {
  const now = new Date(nowMs);
  const month = now.toISOString().slice(0, 7);
  const fq = fetcherHealth && fetcherHealth.quota && typeof fetcherHealth.quota === "object" ? fetcherHealth.quota : null;
  const fetcherCounted = !!(fq && fq.month === month && typeof fq.creditsUsedEst === "number");
  const fetcherCreditsUsedEst = fetcherCounted ? fq.creditsUsedEst : 0;
  const quotaMode = fq && fq.month === month && typeof fq.quotaMode === "string" ? fq.quotaMode : "normal";
  const legacyCounted = legacyCounter != null && typeof legacyCounter === "object";
  const legacyCredits =
    legacyCounted && legacyCounter.month === month && typeof legacyCounter.credits === "number"
      ? legacyCounter.credits
      : 0;
  const totalUsed = fetcherCreditsUsedEst + legacyCredits;
  // 本月日均：已用 / 本月已过日历天数（UTC 日期号，含当天；月初即 ≥1，无除零）。
  const elapsedDays = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const dailyRate = totalUsed / elapsedDays;
  const totalProjected = Math.round(dailyRate * daysInMonth);
  let projectedExhaustDate = null;
  let daysToExhaust = null;
  if (totalUsed >= QUOTA_LIMIT_CREDITS) {
    daysToExhaust = 0;
    projectedExhaustDate = now.toISOString().slice(0, 10);
  } else if (dailyRate > 0) {
    const daysExact = (QUOTA_LIMIT_CREDITS - totalUsed) / dailyRate;
    daysToExhaust = Math.ceil(daysExact);
    projectedExhaustDate = new Date(nowMs + daysExact * 86400000).toISOString().slice(0, 10);
  }
  return {
    month,
    quotaMode,
    fetcherCreditsUsedEst,
    fetcherCounted,
    legacyCredits,
    legacyCounted,
    totalUsed,
    totalProjected,
    dailyRate: Math.round(dailyRate * 100) / 100,
    limit: QUOTA_LIMIT_CREDITS,
    projectedExhaustDate,
    daysToExhaust,
  };
}

// 从 KV 读两路计数（只读）。无绑定 / 读失败一律降级为 null 输入（computeQuotaInfo
// 会给出 legacyCounted:false、fetcher 0 计），绝不因总账读取失败影响健康判定本体。
async function readQuotaInfo(env, nowMs) {
  let fetcherHealth = null;
  let legacyCounter = null;
  if (env && env.BOARD_KV && typeof env.BOARD_KV.get === "function") {
    try {
      const h = await env.BOARD_KV.get(KV_KEYS.health, { type: "json" });
      fetcherHealth = typeof h === "string" ? JSON.parse(h) : h;
    } catch (_) {
      fetcherHealth = null;
    }
    try {
      const l = await env.BOARD_KV.get(KV_KEYS.legacyCredits, { type: "json" });
      legacyCounter = typeof l === "string" ? JSON.parse(l) : l;
    } catch (_) {
      legacyCounter = null;
    }
  }
  return computeQuotaInfo({ fetcherHealth, legacyCounter, nowMs });
}

async function handleGet(context) {
  const { request, env } = context;
  const checkedAt = new Date().toISOString();
  const quota = await readQuotaInfo(env, Date.now());
  const freshnessThresholdSec = effectiveStaleThresholdSec(quota.quotaMode);

  let board;
  try {
    const boardUrl = new URL("/api/board", request.url);
    const res = await fetch(boardUrl.toString(), { headers: { accept: "application/json" } });
    if (!res.ok) {
      return jsonResponse(
        { ok: false, reason: "board_http_error", boardStatus: res.status, checkedAt, quota, freshnessThresholdSec },
        503
      );
    }
    board = await res.json();
  } catch (e) {
    return jsonResponse(
      { ok: false, reason: "board_unreachable_or_invalid", checkedAt, quota, freshnessThresholdSec },
      503
    );
  }

  try {
    const updatedAtSec = parseUpdatedAt(board && board.updatedAt);
    const coverage =
      board && board.coverage && typeof board.coverage === "object" ? board.coverage : null;
    const expected = coverage && typeof coverage.expected === "number" ? coverage.expected : null;
    const returned = coverage && typeof coverage.returned === "number" ? coverage.returned : null;

    if (updatedAtSec == null || expected == null || returned == null) {
      return jsonResponse(
        {
          ok: false,
          reason: "board_fields_missing",
          mode: board && typeof board.mode === "string" ? board.mode : null,
          coverage: { expected, returned },
          checkedAt,
          quota,
          freshnessThresholdSec,
        },
        503
      );
    }

    const ageSec = Math.floor(Date.now() / 1000 - updatedAtSec);
    const fresh = ageSec <= freshnessThresholdSec;
    // 统一口径：returned 必须达到 expected × passRatio（1.0 即相等）且 expected 本身为定版条数。
    const complete =
      expected === EXPECTED_COUNT && returned >= Math.ceil(expected * COVERAGE_PASS_RATIO);
    const ok = fresh && complete;

    return jsonResponse(
      {
        ok,
        mode: typeof board.mode === "string" ? board.mode : null,
        ageSec,
        freshnessThresholdSec,
        quotaMode: quota.quotaMode,
        coverage: { expected, returned },
        updatedAt: board.updatedAt,
        checkedAt,
        quota,
      },
      ok ? 200 : 503
    );
  } catch (e) {
    return jsonResponse(
      { ok: false, reason: "health_check_error", checkedAt, quota, freshnessThresholdSec },
      503
    );
  }
}

// HEAD 与 GET 同判定：复用 handleGet 的状态与响应头，body 置空（HTTP 语义）。
async function handleHead(context) {
  const res = await handleGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}

export async function onRequestGet(context) {
  const method = context && context.request && context.request.method ? context.request.method : "GET";
  if (method !== "GET") return methodNotAllowedResponse();
  return handleGet(context);
}

export async function onRequestHead(context) {
  return handleHead(context);
}

export async function onRequest(context) {
  const method = context && context.request && context.request.method ? context.request.method : "GET";
  if (method === "GET") return handleGet(context);
  if (method === "HEAD") return handleHead(context);
  return methodNotAllowedResponse();
}
