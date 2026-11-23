// providers/coinpaprika.js — CoinPaprika 备源适配器（W2-03，默认关闭）
// 与 coingecko.js 同接口。免费层无 key；per-IP 额度，402/429 视为该源不可用信号
// （402 或带额度语义的 429 → quotaExhausted，由状态机锁定至次月/人工解除）。
// 本适配器只被 fetcher 在 PAPRIKA_ENABLED=true 且状态机/人工覆盖允许时调用；
// Function 与前端永不直连 Paprika（W2-03 §1）。
import { normalizePaprikaTickers, normalizePaprikaGlobal } from "../../../../shared/board-schema.js";
import { countPaprikaGateStats } from "../../../../shared/paprika-identity.js";
import { PAPRIKA_IDENTITY_REGISTRY } from "../paprika-registry.js";
import { UpstreamError, UPSTREAM_TIMEOUT_MS } from "./coingecko.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchJson(url, stage) {
  const controller = new AbortController();
  // F6-50：res.json() 与请求同受本超时保护——计时器在 body 读完后才清除，
  // 并让 json() 与 timeoutPromise 竞速（旧实现在 fetch 返回后即 clearTimeout，body 挂死无上限）。
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
  }, UPSTREAM_TIMEOUT_MS);
  let res;
  try {
    res = await Promise.race([
      fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: controller.signal }),
      timeoutPromise,
    ]);
  } catch (e) {
    clearTimeout(timer);
    const isAbort = e && (e.name === "AbortError" || e.name === "TimeoutError");
    throw new UpstreamError(`coinpaprika ${stage} fetch failed`, {
      errorType: isAbort ? "timeout" : "network_error",
      stage,
    });
  }
  if (!res.ok) {
    clearTimeout(timer);
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
    return await Promise.race([res.json(), timeoutPromise]);
  } catch (_) {
    throw new UpstreamError(`coinpaprika ${stage} parse failed`, { errorType: "parse_error", stage });
  } finally {
    clearTimeout(timer);
  }
}

// coins: [{id, paprikaId}]（与 fetcher COINS 同形，W5-01 统一；paprikaId 来自 coins.json，W2-11 落库后生效；
// 本期映射未落库时 paprikaId 全 null → 覆盖率必然不足 → 不写 blob，符合默认关闭语义）
// F6-53：tickers 端点默认返回上限经 2026-11-23 单次实测为恰好 2000 条（rank 1..2000），
// 无参数请求会静默截断尾部——显式带 limit=5000 覆盖映射数上限（若端点忽略该参数，
// 2000 条上限仍远超本项目 top200 映射的 rank 范围，不影响覆盖）。
// rank 口径注意：normalizePaprikaTickers 透传的 rank 是 Paprika 自家排名，与 CG 的
// market_cap_rank 语义不同——切源瞬间同一币的 rank 会跳变，属口径差异、非数据错误。
export async function fetchMarkets(coins) {
  const tickers = await fetchJson("https://api.coinpaprika.com/v1/tickers?quotes=USD&limit=5000", "markets");
  if (!Array.isArray(tickers)) {
    throw new UpstreamError("coinpaprika tickers payload invalid", { errorType: "parse_error", stage: "markets" });
  }
  const { rows, coverage, invalidFields } = normalizePaprikaTickers(tickers, coins);
  return { rows, coverage, invalidFields, upstreamStatus: 200, attempts: 1 };
}

// F7-02 candidate preflight：仅在 Paprika 成为候选 provider 的 run 调用（CG 正常
// 路径零额外调用、零风险）。拉 /v1/coins 目录 + /v1/tickers（limit=5000，与主抓
// 同口径），按 shared/paprika-identity.js 统一口径产出四项门禁计数
// {total, mapped, identityValid, activeUsable, tickerHit, failures}。
// F8-01：运行时 COINS 只有 {id, paprikaId}，身份判定以身份登记册
// （paprika-registry.js，verify-paprika-identity.mjs 经全名复核生成）中经复核的
// CG 侧 name/symbol 与实时目录做全名比对，不再走 symbol-prefix 自洽校验。
// F8-17：onAttempt 在每次 Paprika 调用发出时回调（而非成功后补记），供主流程
// 按实际发生记账——中途失败（如目录成功、tickers 500）已发生的调用不漏记。
export async function fetchGateStats(coins, onAttempt) {
  const call = (url, stage) => {
    if (typeof onAttempt === "function") onAttempt();
    return fetchJson(url, stage);
  };
  const [directory, tickers] = await Promise.all([
    call("https://api.coinpaprika.com/v1/coins", "coins"),
    call("https://api.coinpaprika.com/v1/tickers?quotes=USD&limit=5000", "markets"),
  ]);
  if (!Array.isArray(directory) || !Array.isArray(tickers)) {
    throw new UpstreamError("coinpaprika gate preflight payload invalid", { errorType: "parse_error", stage: "gate" });
  }
  return countPaprikaGateStats(coins, directory, tickers, { registry: PAPRIKA_IDENTITY_REGISTRY });
}

export async function fetchGlobal() {
  const raw = await fetchJson("https://api.coinpaprika.com/v1/global", "global");
  const global = normalizePaprikaGlobal(raw, 0);
  delete global.asOf;
  global._src = "coinpaprika";
  return { global, upstreamStatus: 200, attempts: 1 };
}
