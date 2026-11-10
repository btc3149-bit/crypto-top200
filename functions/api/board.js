// /api/board — Cloudflare Pages Function
// 服务端代理 CoinGecko 实时行情：合并 /coins/markets（本站全部币种）与 /global，
// 用 Cache API 缓存 120 秒；上游失败时回退最近一次成功数据并标注 stale（硬上限 6 小时）。
//
// Secret 注入点：COINGECKO_API_KEY（CoinGecko Demo key）
//   - 通过 Cloudflare Pages Secret 环境变量 env.COINGECKO_API_KEY 注入，
//     以 x-cg-demo-api-key 头发送给 CoinGecko。
//   - 当前可为空：为空时走匿名公共接口。
//   - key 值绝不出现在日志或响应中（日志只记错误类型 / 上游状态 / 耗时）。
//
// 币种 id 列表不写死在本文件：从同站静态文件 /data/coins.json 读取
// （coins.json 是唯一数据源，id 字段为 coingeckoId）。
// 但读取顺序是「缓存优先」：缓存新鲜时不依赖 coins.json 可用。
//
// 方法语义（Pages Functions）：
//   - 导出 onRequestGet 承载 GET 逻辑。
//   - 同时导出 onRequest 兜底：非 GET 一律 405；若运行时优先调用
//     onRequest（通用处理器优先于方法处理器），它会把 GET 委托给同一
//     逻辑；若运行时优先调用 onRequestGet，GET 直接走 onRequestGet。
//     两种优先级语义下 GET 都不会误入 405 兜底。

const CACHE_TTL_SEC = 120; // 新鲜期：120 秒内直接用缓存
const CACHE_KEEP_SEC = 86400; // Cache API 条目保留上限（仅内部存储用）
const STALE_MAX_SEC = 21600; // stale 硬上限：6 小时，超限不得端出旧价格
const UPSTREAM_TIMEOUT_MS = 3500; // 上游单请求超时（AbortController）
const SNAPSHOT_DATE = "2026-11-08";
const COVERAGE_RATIO = 0.94; // 覆盖率门禁：returned < ceil(expected * 0.94) 判失败

const CACHE_CONTROL_VALUE =
  "public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400";

// 缓存键：固定 pathname / 固定内部主机，不包含请求主机名，
// 避免自定义域与 pages.dev 双域名各存一套缓存。
const CACHE_KEY_URL = "https://board-cache.internal/api/board";

let MEM = { at: 0, body: null }; // 内存回退（同 isolate 内有效，Cache API 不可用时也能工作）
let IDS = null; // 模块级缓存的 id 列表
let IDS_INFLIGHT = null; // getIds 的 in-flight 承诺合并
let UPSTREAM_INFLIGHT = null; // 上游抓取的 in-flight 承诺合并（冷启动并发去重）
let CIRCUIT_UNTIL = 0; // 429 熔断截止时间（ms epoch，Date.now() 口径）
let CIRCUIT_RETRY_AFTER_SEC = 60; // 熔断期对外 Retry-After（秒）

class UpstreamError extends Error {
  constructor(message, { status = null, errorType = "upstream_error", retryAfterSec = null } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.errorType = errorType;
    this.retryAfterSec = retryAfterSec;
    this.is429 = status === 429;
  }
}

function logUpstreamError(err, durationMs) {
  // 结构化日志：只记错误类型、上游状态、耗时；不记 key、不记上游原文。
  try {
    console.error(
      JSON.stringify({
        level: "error",
        event: "upstream_error",
        errorType: err && err.errorType ? err.errorType : (err && err.name) || "error",
        upstreamStatus: err && typeof err.status === "number" ? err.status : null,
        durationMs: typeof durationMs === "number" ? Math.round(durationMs) : null,
      })
    );
  } catch (_) {
    // 日志失败不得影响主流程
  }
}

function jsonResponse(body, { status = 200, extraHeaders = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": CACHE_CONTROL_VALUE,
      ...extraHeaders,
    },
  });
}

function methodNotAllowedResponse() {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: {
      "content-type": "application/json",
      "cache-control": CACHE_CONTROL_VALUE,
      allow: "GET",
    },
  });
}

function parseRetryAfter(res) {
  let raw = null;
  try {
    raw = res && res.headers && typeof res.headers.get === "function" ? res.headers.get("Retry-After") : null;
  } catch (_) {
    raw = null;
  }
  if (raw == null || raw === "") return 60;
  const asInt = Number.parseInt(String(raw).trim(), 10);
  if (Number.isFinite(asInt) && String(asInt) === String(raw).trim()) return Math.max(0, asInt);
  if (Number.isFinite(asInt) && /^\d+$/.test(String(raw).trim())) return Math.max(0, asInt);
  const asDate = Date.parse(String(raw));
  if (Number.isFinite(asDate)) {
    const diff = Math.ceil((asDate - Date.now()) / 1000);
    return diff > 0 ? diff : 60;
  }
  return 60;
}

async function fetchWithTimeout(url, headers) {
  const controller = new AbortController();
  let timer = null;
  // AbortController 为主超时机制；Promise.race 兜底防止 fetch 实现
  // 不响应 abort 信号时请求无限挂起拖死整单。
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {}
      const err = new Error("upstream timeout");
      err.name = "AbortError";
      reject(err);
    }, UPSTREAM_TIMEOUT_MS);
  });
  try {
    return await Promise.race([fetch(url, { headers, signal: controller.signal }), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getIds(request) {
  if (IDS) return IDS;
  if (IDS_INFLIGHT) return IDS_INFLIGHT;
  IDS_INFLIGHT = (async () => {
    const url = new URL("/data/coins.json", request.url);
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new UpstreamError("coins.json fetch failed", {
        status: typeof res.status === "number" ? res.status : null,
        errorType: "ids_fetch_failed",
      });
    }
    const data = await res.json();
    const list = data && Array.isArray(data.coins) ? data.coins : null;
    if (!list) {
      throw new UpstreamError("coins.json parse failed", { errorType: "ids_parse_failed" });
    }
    const ids = list.map((c) => c && c.coingeckoId).filter(Boolean);
    if (!ids.length) {
      throw new UpstreamError("coins.json id list empty", { errorType: "ids_empty" });
    }
    IDS = ids;
    return IDS;
  })();
  try {
    return await IDS_INFLIGHT;
  } finally {
    IDS_INFLIGHT = null;
    // 若失败，IDS 仍为 null，下次可重试；成功则 IDS 已缓存。
  }
}

async function fetchUpstreamInternal(env, ids) {
  const startedAt = Date.now();
  const headers = { accept: "application/json" };
  if (env && env.COINGECKO_API_KEY) headers["x-cg-demo-api-key"] = env.COINGECKO_API_KEY;

  const mk =
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&price_change_percentage=24h&ids=" +
    encodeURIComponent(ids.join(","));
  const gl = "https://api.coingecko.com/api/v3/global";

  // markets 与 global 并发、各自独立超时、互不连带（allSettled）。
  const marketsPromise = fetchWithTimeout(mk, headers);
  const globalPromise = fetchWithTimeout(gl, headers);
  const [mSettled, gSettled] = await Promise.allSettled([marketsPromise, globalPromise]);

  // --- global：失败 / 超时 / 非 2xx 一律降级为 null，绝不连带整单 ---
  let global = null;
  if (gSettled.status === "fulfilled" && gSettled.value && gSettled.value.ok) {
    try {
      const g = (await gSettled.value.json()).data || {};
      global = {
        totalMcapUsd: g.total_market_cap ? g.total_market_cap.usd : null,
        btcDominance: g.market_cap_percentage ? g.market_cap_percentage.btc : null,
        totalMcapChange24h:
          g.market_cap_change_percentage_24h_usd != null ? g.market_cap_change_percentage_24h_usd : null,
      };
    } catch (_) {
      global = null;
    }
  }

  // --- markets：失败即整单上游失败 ---
  if (mSettled.status !== "fulfilled") {
    const reason = mSettled.reason;
    const isAbort = reason && (reason.name === "AbortError" || reason.name === "TimeoutError");
    throw new UpstreamError("coingecko markets fetch failed", {
      status: reason && typeof reason.status === "number" ? reason.status : null,
      errorType: isAbort ? "timeout" : "network_error",
    });
  }
  const mRes = mSettled.value;
  if (!mRes.ok) {
    const status = typeof mRes.status === "number" ? mRes.status : null;
    if (status === 429) {
      const retryAfterSec = parseRetryAfter(mRes);
      throw new UpstreamError("coingecko markets rate limited", {
        status: 429,
        errorType: "rate_limited",
        retryAfterSec,
      });
    }
    throw new UpstreamError("coingecko markets http error", {
      status,
      errorType: "http_error",
    });
  }

  let markets;
  try {
    markets = await mRes.json();
  } catch (_) {
    throw new UpstreamError("coingecko markets parse failed", { errorType: "parse_error" });
  }
  if (!Array.isArray(markets)) {
    throw new UpstreamError("coingecko markets payload invalid", { errorType: "parse_error" });
  }

  const coins = {};
  for (const m of markets) {
    if (!m || !m.id) continue;
    coins[m.id] = {
      price: m.current_price,
      mcapUsd: m.market_cap,
      rank: m.market_cap_rank,
      change24h:
        m.price_change_percentage_24h_in_currency != null
          ? m.price_change_percentage_24h_in_currency
          : m.price_change_percentage_24h,
    };
  }

  const expected = ids.length;
  const returnedIds = new Set(Object.keys(coins));
  const missingIds = ids.filter((id) => !returnedIds.has(id));
  const returned = ids.filter((id) => returnedIds.has(id)).length;
  // 若上游返回了列表外 id，returned 以期望列表内命中数计；coverage 仍以期望为分母。
  const coverage = { expected, returned, missingIds };

  if (returned < Math.ceil(expected * COVERAGE_RATIO)) {
    throw new UpstreamError("coingecko markets coverage insufficient", {
      errorType: "coverage_insufficient",
      // 把覆盖信息挂在错误上，供日志 / 回退路径参考（不对外透传上游原文）。
      status: null,
    });
  }

  const now = Date.now();
  void startedAt;
  return {
    source: "coingecko",
    mode: "live",
    updatedAt: now,
    servedAt: now,
    stale: false,
    staleAgeSec: 0,
    coverage,
    global,
    coins,
    count: Object.keys(coins).length,
    snapshotDate: SNAPSHOT_DATE,
  };
}

function fetchUpstream(env, ids) {
  if (UPSTREAM_INFLIGHT) return UPSTREAM_INFLIGHT;
  UPSTREAM_INFLIGHT = (async () => fetchUpstreamInternal(env, ids))();
  // 结算后清除 in-flight 引用（不吞掉原始结果 / 异常）。
  UPSTREAM_INFLIGHT.then(
    () => {
      UPSTREAM_INFLIGHT = null;
    },
    () => {
      UPSTREAM_INFLIGHT = null;
    }
  );
  return UPSTREAM_INFLIGHT;
}

function snapshotBody({ cached, ids, now }) {
  const updatedAt = cached && cached.updatedAt != null ? cached.updatedAt : null;
  const staleAgeSec = updatedAt != null ? Math.max(0, Math.floor((now - updatedAt) / 1000)) : 0;
  const expected = ids && ids.length ? ids.length : cached && cached.coverage && typeof cached.coverage.expected === "number" ? cached.coverage.expected : ids ? ids.length : 0;
  return {
    source: "coingecko",
    mode: "snapshot",
    stale: true,
    coins: {},
    global: null,
    updatedAt,
    servedAt: now,
    staleAgeSec,
    coverage: {
      expected,
      returned: 0,
      missingIds: ids && ids.length ? [...ids] : [],
    },
    count: 0,
    snapshotDate: SNAPSHOT_DATE,
  };
}

function staleBody({ cached, now }) {
  const ageSec = Math.max(0, Math.floor((now - cached.updatedAt) / 1000));
  const coins = cached.coins || {};
  return {
    source: "coingecko",
    mode: "stale",
    updatedAt: cached.updatedAt,
    servedAt: now,
    stale: true,
    staleAgeSec: ageSec,
    coverage:
      cached.coverage && typeof cached.coverage === "object"
        ? cached.coverage
        : {
            expected: Object.keys(coins).length,
            returned: Object.keys(coins).length,
            missingIds: [],
          },
    global: cached.global != null ? cached.global : null,
    coins,
    count: typeof cached.count === "number" ? cached.count : Object.keys(coins).length,
    snapshotDate: SNAPSHOT_DATE,
  };
}

// 回退路径：
// - 有缓存且年龄 <= STALE_MAX_SEC -> stale（200）
// - 有缓存但超龄 -> snapshot 信号（200，coins 为空）
// - 无缓存且处于 429 熔断 -> 503 {error:"upstream_unavailable"} + Retry-After
// - 无缓存且其他上游失败 -> snapshot 信号（200）
function fallbackResponse({ cached, ids, now, isRateLimited }) {
  if (cached && cached.updatedAt != null) {
    const ageSec = Math.floor((now - cached.updatedAt) / 1000);
    if (ageSec <= STALE_MAX_SEC) {
      return jsonResponse(staleBody({ cached, now }));
    }
    return jsonResponse(snapshotBody({ cached, ids, now }));
  }
  // 无任何缓存条目
  if (isRateLimited) {
    const remaining = Math.max(1, Math.ceil((CIRCUIT_UNTIL - now) / 1000) || CIRCUIT_RETRY_AFTER_SEC || 60);
    return jsonResponse(
      { error: "upstream_unavailable" },
      { status: 503, extraHeaders: { "Retry-After": String(remaining) } }
    );
  }
  return jsonResponse(snapshotBody({ cached: null, ids, now }));
}

async function handleGet(context) {
  const { request, env } = context;
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(CACHE_KEY_URL, { method: "GET" });

  async function readCache() {
    if (cache) {
      try {
        const hit = await cache.match(cacheKey);
        if (hit) return await hit.json();
      } catch (_) {
        /* ignore, fall through to memory */
      }
    }
    return MEM.body;
  }

  async function writeCache(body) {
    MEM = { at: Date.now(), body };
    if (cache) {
      try {
        await cache.put(
          cacheKey,
          new Response(JSON.stringify(body), {
            headers: {
              "content-type": "application/json",
              "cache-control": `max-age=${CACHE_KEEP_SEC}`,
            },
          })
        );
      } catch (_) {
        /* ignore */
      }
    }
  }

  const startedAt = Date.now();

  // 1) 先读缓存（缓存新鲜时不依赖 coins.json）
  let cached = null;
  try {
    cached = await readCache();
  } catch (_) {
    cached = MEM.body;
  }

  if (cached && cached.updatedAt != null && Date.now() - cached.updatedAt < CACHE_TTL_SEC * 1000) {
    const now = Date.now();
    return jsonResponse({
      source: "coingecko",
      mode: "live",
      updatedAt: cached.updatedAt,
      servedAt: now,
      stale: false,
      staleAgeSec: 0,
      coverage: cached.coverage || {
        expected: cached.count || Object.keys(cached.coins || {}).length,
        returned: cached.count || Object.keys(cached.coins || {}).length,
        missingIds: [],
      },
      global: cached.global != null ? cached.global : null,
      coins: cached.coins || {},
      count: typeof cached.count === "number" ? cached.count : Object.keys(cached.coins || {}).length,
      snapshotDate: SNAPSHOT_DATE,
    });
  }

  // 2) 熔断期内不再请求上游，直接走 stale / 快照 / 503 路径
  //    此路径需要 ids 仅为快照 coverage 服务；取不到 ids 时 missingIds 用 []。
  if (Date.now() < CIRCUIT_UNTIL) {
    let idsForSnapshot = IDS;
    if (!idsForSnapshot) {
      try {
        idsForSnapshot = await getIds(request);
      } catch (_) {
        idsForSnapshot = null;
      }
    }
    return fallbackResponse({
      cached,
      ids: idsForSnapshot,
      now: Date.now(),
      isRateLimited: true,
    });
  }

  // 3) 取 id 列表；为空 / 解析失败判失败走回退，不把空 ids 发给上游
  let ids;
  try {
    ids = await getIds(request);
    if (!ids || !ids.length) throw new UpstreamError("id list empty", { errorType: "ids_empty" });
  } catch (e) {
    logUpstreamError(e, Date.now() - startedAt);
    return fallbackResponse({ cached, ids: null, now: Date.now(), isRateLimited: false });
  }

  // 4) 抓上游（in-flight 合并）
  try {
    const fresh = await fetchUpstream(env, ids);
    await writeCache(fresh);
    return jsonResponse({ ...fresh, servedAt: Date.now() });
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    logUpstreamError(e, durationMs);
    const is429 = !!(e && (e.is429 || e.status === 429 || e.errorType === "rate_limited"));
    if (is429) {
      const retryAfterSec = e && typeof e.retryAfterSec === "number" ? e.retryAfterSec : 60;
      CIRCUIT_RETRY_AFTER_SEC = retryAfterSec;
      CIRCUIT_UNTIL = Date.now() + retryAfterSec * 1000;
    }
    return fallbackResponse({
      cached,
      ids,
      now: Date.now(),
      isRateLimited: is429,
    });
  }
}

export async function onRequestGet(context) {
  const method = context && context.request && context.request.method ? context.request.method : "GET";
  if (method !== "GET") return methodNotAllowedResponse();
  return handleGet(context);
}

export async function onRequest(context) {
  const method = context && context.request && context.request.method ? context.request.method : "GET";
  if (method !== "GET") return methodNotAllowedResponse();
  return handleGet(context);
}
