// providers/coingecko.js — CoinGecko 适配器（与 coinpaprika.js 同接口）
// 接口：fetchMarkets(ids, env) → { rows, coverage, upstreamStatus, attempts }
//       fetchGlobal(env)     → { global(未加 asOf，由主流程盖戳), upstreamStatus, attempts }
// 失败一律抛 UpstreamError（带 status/errorType/retryAfterSec），由主流程分类计数。
// key 只从 env.COINGECKO_API_KEY 读；缺失由主流程在调用前拦截（配置错误，不匿名重试，
// 见 W2-20 §20.5 代码侧口径）。key 值绝不进日志/返回值。
import { normalizeCgMarkets, normalizeCgGlobal } from "../../../../shared/board-schema.js";

export class UpstreamError extends Error {
  constructor(message, { status = null, errorType = "upstream_error", retryAfterSec = null, stage = null } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.errorType = errorType;
    this.retryAfterSec = retryAfterSec;
    this.stage = stage;
    this.is429 = status === 429;
  }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
export const UPSTREAM_TIMEOUT_MS = 10000; // W2-03 §3：单端点超时 10s（run 级失败定义）

export function parseRetryAfter(res) {
  let raw = null;
  try {
    raw = res && res.headers && typeof res.headers.get === "function" ? res.headers.get("Retry-After") : null;
  } catch (_) {
    raw = null;
  }
  if (raw == null || raw === "") return 60;
  const asInt = Number.parseInt(String(raw).trim(), 10);
  if (Number.isFinite(asInt) && /^\d+$/.test(String(raw).trim())) return Math.max(0, asInt);
  const asDate = Date.parse(String(raw));
  if (Number.isFinite(asDate)) {
    const diff = Math.ceil((asDate - Date.now()) / 1000);
    return diff > 0 ? diff : 60;
  }
  return 60;
}

// F6-50：响应体解析（res.json()）必须与请求同受一个 AbortController/超时保护——
// 旧实现在 fetch 返回后即 clearTimeout，body drip（慢速滴漏）可让单 run 无上限悬挂。
// 返回 {res, json, cancel}：json() 与同一 timeoutPromise 竞速、读完自动清计时器；
// 不读 body 的路径（!res.ok）须调 cancel() 释放计时器。
async function fetchWithTimeout(url, headers, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  let rejectTimeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch (_) {}
    const err = new Error("upstream timeout");
    err.name = "AbortError";
    rejectTimeout(err);
  }, timeoutMs);
  let res;
  try {
    res = await Promise.race([fetch(url, { headers, signal: controller.signal }), timeoutPromise]);
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
  return {
    res,
    json: async () => {
      try {
        return await Promise.race([res.json(), timeoutPromise]);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel: () => clearTimeout(timer),
  };
}

function cgHeaders(env) {
  const headers = { accept: "application/json", "user-agent": UA };
  // 待协调者注入：fetcher 侧 COINGECKO_API_KEY 由协调者经 wrangler secret put 注入
  // （与 Pages Secret 为两处独立注入，值不经本仓库）。未注入时主流程走配置错误路径。
  if (env && env.COINGECKO_API_KEY) headers["x-cg-demo-api-key"] = env.COINGECKO_API_KEY;
  return headers;
}

// 单次调用形态（per_page=250 + ids），与现行 board.js 一致——定版节奏 10min/30min 的前提。
// F6-50：旧签名第三参 fetchImpl 是死参数（函数体从未使用、测试靠 stub 全局 fetch），已删除；
// 测试替身一律 stub 全局 fetch，不要再加回注入参数。
export async function fetchMarkets(ids, env) {
  const url =
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&price_change_percentage=24h&ids=" +
    encodeURIComponent(ids.join(","));
  let call;
  try {
    call = await fetchWithTimeout(url, cgHeaders(env));
  } catch (e) {
    const isAbort = e && (e.name === "AbortError" || e.name === "TimeoutError");
    throw new UpstreamError("coingecko markets fetch failed", {
      errorType: isAbort ? "timeout" : "network_error",
      stage: "markets",
    });
  }
  const res = call.res;
  if (!res.ok) {
    call.cancel();
    const status = typeof res.status === "number" ? res.status : null;
    if (status === 429) {
      throw new UpstreamError("coingecko markets rate limited", {
        status: 429,
        errorType: "rate_limited",
        retryAfterSec: parseRetryAfter(res),
        stage: "markets",
      });
    }
    throw new UpstreamError("coingecko markets http error", { status, errorType: "http_error", stage: "markets" });
  }
  let markets;
  try {
    markets = await call.json();
  } catch (_) {
    throw new UpstreamError("coingecko markets parse failed", { errorType: "parse_error", stage: "markets" });
  }
  if (!Array.isArray(markets)) {
    throw new UpstreamError("coingecko markets payload invalid", { errorType: "parse_error", stage: "markets" });
  }
  const { rows, coverage } = normalizeCgMarkets(markets, ids);
  return { rows, coverage, upstreamStatus: 200, attempts: 1 };
}

export async function fetchGlobal(env) {
  const url = "https://api.coingecko.com/api/v3/global";
  let call;
  try {
    call = await fetchWithTimeout(url, cgHeaders(env));
  } catch (e) {
    const isAbort = e && (e.name === "AbortError" || e.name === "TimeoutError");
    throw new UpstreamError("coingecko global fetch failed", {
      errorType: isAbort ? "timeout" : "network_error",
      stage: "global",
    });
  }
  const res = call.res;
  if (!res.ok) {
    call.cancel();
    const status = typeof res.status === "number" ? res.status : null;
    throw new UpstreamError("coingecko global http error", {
      status,
      errorType: status === 429 ? "rate_limited" : "http_error",
      retryAfterSec: status === 429 ? parseRetryAfter(res) : null,
      stage: "global",
    });
  }
  let payload;
  try {
    payload = await call.json();
  } catch (_) {
    throw new UpstreamError("coingecko global parse failed", { errorType: "parse_error", stage: "global" });
  }
  // asOf 由主流程以 run 时刻盖戳（normalize 时传 0 占位后覆盖）
  const global = normalizeCgGlobal(payload, 0);
  delete global.asOf;
  global._src = "coingecko";
  return { global, upstreamStatus: 200, attempts: 1 };
}
