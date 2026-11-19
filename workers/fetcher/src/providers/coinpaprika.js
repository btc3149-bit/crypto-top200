// providers/coinpaprika.js — CoinPaprika 备源适配器（W2-03，默认关闭）
// 与 coingecko.js 同接口。免费层无 key；per-IP 额度，402/429 视为该源不可用信号
// （402 或带额度语义的 429 → quotaExhausted，由状态机锁定至次月/人工解除）。
// 本适配器只被 fetcher 在 PAPRIKA_ENABLED=true 且状态机/人工覆盖允许时调用；
// Function 与前端永不直连 Paprika（W2-03 §1）。
import { normalizePaprikaTickers, normalizePaprikaGlobal } from "../../../../shared/board-schema.js";
import { UpstreamError, UPSTREAM_TIMEOUT_MS } from "./coingecko.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchJson(url, stage) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch (_) {}
  }, UPSTREAM_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: controller.signal });
  } catch (e) {
    const isAbort = e && (e.name === "AbortError" || e.name === "TimeoutError");
    throw new UpstreamError(`coinpaprika ${stage} fetch failed`, {
      errorType: isAbort ? "timeout" : "network_error",
      stage,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const status = typeof res.status === "number" ? res.status : null;
    const quota = status === 402 || status === 429;
    throw new UpstreamError(`coinpaprika ${stage} http error`, {
      status,
      errorType: status === 429 ? "rate_limited" : status === 402 ? "quota_exceeded" : "http_error",
      stage,
      retryAfterSec: null,
      // 额度型错误标记：状态机据此锁定 Paprika（health.paprikaQuotaExhausted）
      quotaExhausted: quota,
    });
  }
  try {
    return await res.json();
  } catch (_) {
    throw new UpstreamError(`coinpaprika ${stage} parse failed`, { errorType: "parse_error", stage });
  }
}

// coins: [{id, paprikaId}]（与 fetcher COINS 同形，W5-01 统一；paprikaId 来自 coins.json，W2-11 落库后生效；
// 本期映射未落库时 paprikaId 全 null → 覆盖率必然不足 → 不写 blob，符合默认关闭语义）
export async function fetchMarkets(coins) {
  const tickers = await fetchJson("https://api.coinpaprika.com/v1/tickers?quotes=USD", "markets");
  if (!Array.isArray(tickers)) {
    throw new UpstreamError("coinpaprika tickers payload invalid", { errorType: "parse_error", stage: "markets" });
  }
  const { rows, coverage } = normalizePaprikaTickers(tickers, coins);
  return { rows, coverage, upstreamStatus: 200, attempts: 1 };
}

export async function fetchGlobal() {
  const raw = await fetchJson("https://api.coinpaprika.com/v1/global", "global");
  const global = normalizePaprikaGlobal(raw, 0);
  delete global.asOf;
  global._src = "coinpaprika";
  return { global, upstreamStatus: 200, attempts: 1 };
}
