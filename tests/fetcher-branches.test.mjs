// tests/fetcher-branches.test.mjs — W4-16 fetcher 高风险分支补测（P1 / F4-17）
// 覆盖 7 组：① 额度降频跳过（saving/critical × 新/旧）② global due 两态（W4-01 回归，shadow+current）
// ③ partial 失败（markets 成功 / global 失败）④ CoinPaprika 真实解析 + PAPRIKA_ENABLED=false 回落
// ⑤ scheduled 与 /run 鉴权 ⑥ KV put 抛错 ⑦ W4-10 prev 归档
// 沿用 board-fetcher.test.mjs harness 风格：makeKv 内存 KV、mock globalThis.fetch、test() 收集器。
// 运行：node tests/fetcher-branches.test.mjs
import assert from "node:assert/strict";
import { KV_KEYS } from "../shared/board-schema.js";
import fetcher, { runFetch } from "../workers/fetcher/src/index.js";
import { emptySourceState, resolveProvider } from "../workers/fetcher/src/source-state.js";
import * as paprika from "../workers/fetcher/src/providers/coinpaprika.js";
import { COINS as REAL_COINS } from "../workers/fetcher/src/coins-list.js";

const originalFetch = globalThis.fetch;

const COINS = [
  { id: "bitcoin", paprikaId: "btc-bitcoin" },
  { id: "ethereum", paprikaId: "eth-ethereum" },
  { id: "solana", paprikaId: "sol-solana" },
  { id: "filecoin", paprikaId: "fil-filecoin" },
];
const IDS = COINS.map((c) => c.id);

function makeKv({ failPutKeys = new Set() } = {}) {
  const store = new Map();
  return {
    store,
    failPutKeys,
    async get(key, opts) {
      const v = store.get(key);
      if (v == null) return null;
      return opts && opts.type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) {
      if (failPutKeys.has(key)) throw new Error(`mock kv put failed: ${key}`);
      store.set(key, String(value));
    },
  };
}
function jsonRes(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
function marketsPayload(ids = IDS, base = 100) {
  return ids.map((id, i) => ({
    id,
    current_price: base + i,
    market_cap: 1000000 + i,
    market_cap_rank: i + 1,
    price_change_percentage_24h_in_currency: 1.5,
    price_change_percentage_24h: 1.2,
  }));
}
const GLOBAL_PAYLOAD = { data: { total_market_cap: { usd: 999 }, market_cap_percentage: { btc: 55 }, market_cap_change_percentage_24h_usd: 1 } };

// 通用 CG fetch mock：计数 markets/global；可定制两端行为
// 默认 markets 按 URL 的 ids 参数动态生成（/run 与 scheduled 走生产 200 币名单，必须全量返回才过覆盖率门禁）
function installCgFetch({ marketsImpl = null, globalImpl = null } = {}) {
  const counts = { total: 0, markets: 0, global: 0, paprika: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    counts.total += 1;
    if (u.includes("coinpaprika.com")) { counts.paprika += 1; throw new Error("unexpected paprika call in CG test: " + u); }
    if (u.includes("/coins/markets")) {
      counts.markets += 1;
      if (marketsImpl) return marketsImpl(counts, u);
      let requested = IDS;
      try { const p = new URL(u).searchParams.get("ids"); if (p) requested = p.split(","); } catch (_) {}
      return jsonRes(marketsPayload(requested));
    }
    if (u.includes("/global")) { counts.global += 1; if (globalImpl) return globalImpl(counts, u); return jsonRes(GLOBAL_PAYLOAD); }
    throw new Error("unexpected fetch: " + u);
  };
  return counts;
}

function makePrevBlob({ nowMs, marketsAgeMs = 0, globalAgeMs = 0, globalTotal = 111111 } = {}) {
  const marketsMs = nowMs - marketsAgeMs;
  const globalMs = nowMs - globalAgeMs;
  return {
    schemaVersion: 1,
    source: "coingecko",
    fetchRunId: "prev-run-id",
    fetchedAt: new Date(marketsMs).toISOString(),
    marketsUpdatedAt: new Date(marketsMs).toISOString(),
    coverage: { expected: IDS.length, returned: IDS.length, missingIds: [] },
    rows: IDS.map((id, i) => ({ id, price: 50 + i, mcapUsd: 5000 + i, rank: i + 1, change24h: 0.5 })),
    global: globalTotal == null ? null : { totalMarketCapUsd: globalTotal, btcDominancePct: 54.3, totalMcapChange24h: 0.9, asOf: new Date(globalMs).toISOString() },
    fetchMeta: null,
    healthSummary: { consecutiveFailures: 0, lastSuccessAt: new Date(marketsMs).toISOString() },
  };
}
function seedHealthCredits(kv, creditsUsedEst, month = "2026-11") {
  kv.store.set(KV_KEYS.health, JSON.stringify({
    consecutiveFailures: 0,
    skipRunsRemaining: 0,
    quota: { month, creditsUsedEst, quotaMode: "normal" },
  }));
}
function baseEnv(kv, extra = {}) {
  // W5-02 起 BOARD_TARGET_KEY 为白名单 fail-closed：测试默认显式声明 current（与生产 wrangler.toml 同口径）
  return { BOARD_KV: kv, COINGECKO_API_KEY: "test-key-not-real", PAPRIKA_ENABLED: "false", BOARD_SOURCE: "auto", BOARD_TARGET_KEY: "current", ...extra };
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([name, "PASS"]);
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push([name, "FAIL"]);
    console.error(`FAIL ${name}\n`, e);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ---------- 1. 额度降频跳过 ----------
// NOW_QUOTA = 2026-11-29T12:00Z，距月末 1.5 天 → projected = credits + 192*1.5 = credits + 288
// credits 8300 → projected 8588 → saving；credits 9300 → projected 9588 → critical
const NOW_QUOTA = Date.UTC(2026, 10, 29, 12, 0, 0);

await test("1a quota saving: markets 5min 前成功 → quota_skip 跳过且零上游调用", async () => {
  const kv = makeKv();
  seedHealthCredits(kv, 8300);
  kv.store.set(KV_KEYS.current, JSON.stringify(makePrevBlob({ nowMs: NOW_QUOTA, marketsAgeMs: 5 * 60 * 1000, globalAgeMs: 5 * 60 * 1000 })));
  const counts = installCgFetch();
  const r = await runFetch(baseEnv(kv), { coins: COINS, ids: IDS, nowMs: NOW_QUOTA });
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, "quota_skip");
  assert.equal(r.quotaMode, "saving");
  assert.equal(counts.total, 0, "跳过时不得打任何上游");
});

await test("1b quota saving: markets 20min 前成功（≥15min）→ 不跳过、正常抓取成功", async () => {
  const kv = makeKv();
  seedHealthCredits(kv, 8300);
  kv.store.set(KV_KEYS.current, JSON.stringify(makePrevBlob({ nowMs: NOW_QUOTA, marketsAgeMs: 20 * 60 * 1000, globalAgeMs: 20 * 60 * 1000 })));
  const counts = installCgFetch();
  const r = await runFetch(baseEnv(kv), { coins: COINS, ids: IDS, nowMs: NOW_QUOTA });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(counts.markets, 1);
});

await test("1c quota critical: markets 20min 前成功（<30min，saving 下不会跳）→ quota_skip 跳过", async () => {
  const kv = makeKv();
  seedHealthCredits(kv, 9300);
  kv.store.set(KV_KEYS.current, JSON.stringify(makePrevBlob({ nowMs: NOW_QUOTA, marketsAgeMs: 20 * 60 * 1000, globalAgeMs: 20 * 60 * 1000 })));
  const counts = installCgFetch();
  const r = await runFetch(baseEnv(kv), { coins: COINS, ids: IDS, nowMs: NOW_QUOTA });
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, "quota_skip");
  assert.equal(r.quotaMode, "critical");
  assert.equal(counts.total, 0);
});

await test("1d quota critical: markets 40min 前成功（≥30min）→ 不跳过、正常抓取成功（critical 下 global 停抓沿用旧段）", async () => {
  const kv = makeKv();
  seedHealthCredits(kv, 9300);
  kv.store.set(KV_KEYS.current, JSON.stringify(makePrevBlob({ nowMs: NOW_QUOTA, marketsAgeMs: 40 * 60 * 1000, globalAgeMs: 40 * 60 * 1000 })));
  const counts = installCgFetch();
  const r = await runFetch(baseEnv(kv), { coins: COINS, ids: IDS, nowMs: NOW_QUOTA });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(counts.markets, 1);
  assert.equal(counts.global, 0, "critical 模式 global 停抓");
  const blob = JSON.parse(kv.store.get(KV_KEYS.current));
  assert.equal(blob.global.totalMarketCapUsd, 111111, "global 沿用上一版");
});

// ---------- 2. global due 两态（W4-01 回归） ----------
const NOW_G = Date.UTC(2026, 10, 15, 12, 0, 0);

await test("2a global due [shadow]: global.asOf 距 now 10min → 不调 global、沿用 shadow 上一版 global 段", async () => {
  const kv = makeKv();
  const prev = makePrevBlob({ nowMs: NOW_G, marketsAgeMs: 10 * 60 * 1000, globalAgeMs: 10 * 60 * 1000 });
  kv.store.set(KV_KEYS.shadow, JSON.stringify(prev));
  // current 键故意不放（或放一份过期的）：W4-01 前误读 current 会误判 due；修复后只读 shadow
  const counts = installCgFetch();
  const r = await runFetch(baseEnv(kv, { BOARD_TARGET_KEY: "shadow" }), { coins: COINS, ids: IDS, nowMs: NOW_G });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.targetKey, KV_KEYS.shadow);
  assert.equal(counts.markets, 1);
  assert.equal(counts.global, 0, "global 未到期不得重抓");
  const blob = JSON.parse(kv.store.get(KV_KEYS.shadow));
  assert.equal(blob.global.totalMarketCapUsd, 111111);
  assert.equal(blob.global.asOf, prev.global.asOf, "沿用段保留原 asOf");
});

await test("2b global due [shadow]: global.asOf 距 now 40min → 调 global 一次、新段盖 now 戳", async () => {
  const kv = makeKv();
  kv.store.set(KV_KEYS.shadow, JSON.stringify(makePrevBlob({ nowMs: NOW_G, marketsAgeMs: 40 * 60 * 1000, globalAgeMs: 40 * 60 * 1000 })));
  const counts = installCgFetch();
  const r = await runFetch(baseEnv(kv, { BOARD_TARGET_KEY: "shadow" }), { coins: COINS, ids: IDS, nowMs: NOW_G });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(counts.global, 1);
  assert.equal(counts.markets, 1);
  const blob = JSON.parse(kv.store.get(KV_KEYS.shadow));
  assert.equal(blob.global.totalMarketCapUsd, 999);
  assert.equal(blob.global.asOf, new Date(NOW_G).toISOString());
});

await test("2c global due [current]: global.asOf 距 now 10min → 不调 global（current 形态行为不变）", async () => {
  const kv = makeKv();
  const prev = makePrevBlob({ nowMs: NOW_G, marketsAgeMs: 10 * 60 * 1000, globalAgeMs: 10 * 60 * 1000 });
  kv.store.set(KV_KEYS.current, JSON.stringify(prev));
  const counts = installCgFetch();
  const r = await runFetch(baseEnv(kv), { coins: COINS, ids: IDS, nowMs: NOW_G });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.targetKey, KV_KEYS.current);
  assert.equal(counts.global, 0);
  const blob = JSON.parse(kv.store.get(KV_KEYS.current));
  assert.equal(blob.global.totalMarketCapUsd, 111111);
  assert.equal(blob.global.asOf, prev.global.asOf);
});

// ---------- 3. partial 失败 ----------
await test("3a partial 口径: markets 成功 + global 失败(500) + 有同源 prev → 仍成功写 blob、global 沿用 prev、health 清零", async () => {
  const kv = makeKv();
  const prev = makePrevBlob({ nowMs: NOW_G, marketsAgeMs: 40 * 60 * 1000, globalAgeMs: 40 * 60 * 1000 });
  kv.store.set(KV_KEYS.current, JSON.stringify(prev));
  const counts = installCgFetch({ globalImpl: () => jsonRes({ error: "global down" }, { status: 500 }) });
  const r = await runFetch(baseEnv(kv), { coins: COINS, ids: IDS, nowMs: NOW_G });
  assert.equal(counts.markets, 1);
  assert.equal(counts.global, 1, "global 到期应被尝试");
  assert.equal(r.ok, true, `partial 下 markets 成功即整 run 成功: ${JSON.stringify(r)}`);
  const blob = JSON.parse(kv.store.get(KV_KEYS.current));
  assert.equal(blob.coverage.returned, 4);
  assert.deepEqual(blob.global, prev.global, "global 失败时沿用同源上一版段（含原 asOf）");
  const health = JSON.parse(kv.store.get(KV_KEYS.health));
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.status, "ok");
  assert.ok(health.lastSuccessAt, "health 应记录成功");
});

await test("3b partial 口径: markets 成功 + global 失败(500) + 无 prev → 仍成功写 blob、global=null、health 清零", async () => {
  const kv = makeKv();
  installCgFetch({ globalImpl: () => jsonRes({ error: "global down" }, { status: 500 }) });
  const r = await runFetch(baseEnv(kv), { coins: COINS, ids: IDS, nowMs: NOW_G });
  assert.equal(r.ok, true, JSON.stringify(r));
  const blob = JSON.parse(kv.store.get(KV_KEYS.current));
  assert.equal(blob.global, null, "无 prev 可沿用时 global 为 null（不阻断发布）");
  assert.equal(blob.coverage.returned, 4);
  const health = JSON.parse(kv.store.get(KV_KEYS.health));
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.status, "ok");
});

// ---------- 4. CoinPaprika 真实解析 ----------
// 真实形态 payload：字段按 CoinPaprika /v1/tickers 与 /v1/global 实际结构构造
// （id/name/symbol/rank/quotes.USD.{price,market_cap,percent_change_24h,...}）
const PAPRIKA_TICKERS = [
  { id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, circulating_supply: 19700000, total_supply: 19700000, max_supply: 21000000, beta_value: 1, first_data_at: "2010-07-17T00:00:00Z", last_updated: "2026-11-10T10:31:16Z", quotes: { USD: { price: 91234.5, volume_24h: 35000000000, volume_24h_change_24h: 2.1, market_cap: 1800000000000, market_cap_change_24h: -1.1, percent_change_1h: 0.12, percent_change_24h: -1.23, percent_change_7d: 3.4, percent_change_30d: 5.6, ath_price: 109000, ath_date: "2025-01-20T00:00:00Z", percent_from_price_ath: -16.3 } } },
  { id: "eth-ethereum", name: "Ethereum", symbol: "ETH", rank: 2, circulating_supply: 120000000, last_updated: "2026-11-10T10:31:16Z", quotes: { USD: { price: 3123.45, volume_24h: 18000000000, market_cap: 375000000000, percent_change_24h: 2.34, ath_price: 4891, ath_date: "2021-11-16T00:00:00Z" } } },
  { id: "sol-solana", name: "Solana", symbol: "SOL", rank: 5, last_updated: "2026-11-10T10:31:16Z", quotes: { USD: { price: 210.5, volume_24h: 4000000000, market_cap: 102000000000, percent_change_24h: -0.87 } } },
  { id: "fil-filecoin", name: "Filecoin", symbol: "FIL", rank: 38, last_updated: "2026-11-10T10:31:16Z", quotes: { USD: { price: 5.67, volume_24h: 120000000, market_cap: 3600000000, percent_change_24h: 4.56 } } },
  { id: "usdt-tether", name: "Tether", symbol: "USDT", rank: 3, quotes: { USD: { price: 1.0, market_cap: 130000000000, percent_change_24h: 0.01 } } },
];
// W5-01：元素形变已全链统一为 fetcher COINS 的 {id, paprikaId}（旧 fixture 曾用 {coingeckoId,...} 假形，正是 F5-01 漏检原因）
const PAPRIKA_COINS = [
  { id: "bitcoin", paprikaId: "btc-bitcoin" },
  { id: "ethereum", paprikaId: "eth-ethereum" },
  { id: "solana", paprikaId: "sol-solana" },
  { id: "filecoin", paprikaId: "fil-filecoin" },
  { id: "hash-2", paprikaId: null },
];
const PAPRIKA_GLOBAL = { market_cap_usd: 3123456789012, volume_24h_usd: 98765432100, bitcoin_dominance_percentage: 57.84, cryptocurrencies_number: 12000, market_cap_change_24h: -1.42, volume_24h_change_24h: 3.21, last_updated: 1760000000 };

await test("4a CoinPaprika 真实解析: tickers 真实形态 → 行数/覆盖率/字段映射（price/mcap/rank/change24h/_src）", async () => {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.coinpaprika.com/v1/tickers")) return jsonRes(PAPRIKA_TICKERS);
    throw new Error("unexpected " + u);
  };
  const { rows, coverage, upstreamStatus, attempts } = await paprika.fetchMarkets(PAPRIKA_COINS);
  assert.equal(upstreamStatus, 200);
  assert.equal(attempts, 1);
  assert.equal(rows.length, 4, "命中 4 币（列表外 usdt 不计、paprikaId=null 计 missing）");
  assert.equal(coverage.expected, 5);
  assert.equal(coverage.returned, 4);
  assert.deepEqual(coverage.missingIds, ["hash-2"]);
  const btc = rows.find((r) => r.id === "bitcoin");
  assert.deepEqual(
    { id: btc.id, price: btc.price, mcapUsd: btc.mcapUsd, rank: btc.rank, change24h: btc.change24h, volume24h: btc.volume24h, _src: btc._src },
    { id: "bitcoin", price: 91234.5, mcapUsd: 1800000000000, rank: 1, change24h: -1.23, volume24h: 35000000000, _src: "coinpaprika" }
  );
  const fil = rows.find((r) => r.id === "filecoin");
  assert.equal(fil.price, 5.67);
  assert.equal(fil.mcapUsd, 3600000000);
  assert.equal(fil.rank, 38);
  assert.equal(fil.change24h, 4.56);
  assert.ok(rows.every((r) => r._src === "coinpaprika"));
});

await test("4b CoinPaprika 真实解析: /v1/global 真实形态 → 归一化字段映射", async () => {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.coinpaprika.com/v1/global")) return jsonRes(PAPRIKA_GLOBAL);
    throw new Error("unexpected " + u);
  };
  const { global, upstreamStatus } = await paprika.fetchGlobal();
  assert.equal(upstreamStatus, 200);
  assert.equal(global.totalMarketCapUsd, 3123456789012);
  assert.equal(global.btcDominancePct, 57.84);
  assert.equal(global.totalMcapChange24h, -1.42);
  assert.equal(global._src, "coinpaprika");
  assert.equal(global.asOf, undefined, "provider 层不盖 asOf（由主流程盖戳）");
});

await test("4c PAPRIKA_ENABLED=false 时 provider 解析仍回落 coingecko（source-state 既有口径）", async () => {
  const s = emptySourceState(Date.now());
  const forced = resolveProvider({ PAPRIKA_ENABLED: "false", BOARD_SOURCE: "coinpaprika" }, s, Date.now());
  assert.equal(forced.provider, "coingecko");
  assert.equal(forced.probeCg, false);
  assert.equal(forced.warnings.length, 1);
  const auto = resolveProvider({ PAPRIKA_ENABLED: "false", BOARD_SOURCE: "auto" }, s, Date.now());
  assert.equal(auto.provider, "coingecko");
  assert.equal(auto.warnings.length, 0);
});

// ---------- 5. scheduled 与 /run 鉴权 ----------
function runRequest(token) {
  const headers = token == null ? {} : { "x-manual-token": token };
  return new Request("https://fetcher.example/run", { method: "POST", headers });
}

await test("5a /run 无 token → 404 且不触发抓取（fetch 零调用、无 blob）", async () => {
  const kv = makeKv();
  const counts = installCgFetch();
  const res = await fetcher.fetch(runRequest(null), baseEnv(kv, { MANUAL_RUN_TOKEN: "secret-token-test" }));
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not_found" });
  assert.equal(counts.total, 0);
  assert.equal(kv.store.has(KV_KEYS.current), false);
});

await test("5b /run 错 token → 404 且不触发抓取（fetch 零调用）", async () => {
  const kv = makeKv();
  const counts = installCgFetch();
  const res = await fetcher.fetch(runRequest("wrong-token"), baseEnv(kv, { MANUAL_RUN_TOKEN: "secret-token-test" }));
  assert.equal(res.status, 404);
  assert.equal(counts.total, 0);
  assert.equal(kv.store.has(KV_KEYS.current), false);
});

await test("5c /run 正确 token → 200 并触发一次 runFetch（markets+global 各一次、blob 落盘）", async () => {
  const kv = makeKv();
  const counts = installCgFetch();
  const res = await fetcher.fetch(runRequest("secret-token-test"), baseEnv(kv, { MANUAL_RUN_TOKEN: "secret-token-test" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(counts.markets, 1);
  assert.equal(counts.global, 1);
  assert.equal(kv.store.has(KV_KEYS.current), true);
});

await test("5d scheduled: BOARD_FETCH_DISABLED=1 → 跳过、零上游调用", async () => {
  const kv = makeKv();
  const counts = installCgFetch();
  let waited = null;
  const ctx = { waitUntil: (p) => { waited = p; } };
  const ret = await fetcher.scheduled({}, baseEnv(kv, { BOARD_FETCH_DISABLED: "1" }), ctx);
  assert.equal(ret, undefined);
  assert.equal(waited, null, "跳过时不得注册 waitUntil 抓取");
  assert.equal(counts.total, 0);
});

await test("5e scheduled: 未禁用 → 执行一次抓取并写 blob", async () => {
  const kv = makeKv();
  const counts = installCgFetch();
  const ctx = { waitUntil: () => {} };
  const r = await fetcher.scheduled({}, baseEnv(kv), ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(counts.markets >= 1);
  assert.equal(kv.store.has(KV_KEYS.current), true);
});

// ---------- 6. KV put 抛错 ----------
await test("6a KV put 抛错（目标 blob 键）→ kv_put_failed、health 落盘失败计数、旧 blob 不覆写", async () => {
  const kv = makeKv({ failPutKeys: new Set([KV_KEYS.current]) });
  const oldBlobStr = JSON.stringify(makePrevBlob({ nowMs: NOW_G, marketsAgeMs: 60 * 60 * 1000, globalAgeMs: 60 * 60 * 1000 }));
  kv.store.set(KV_KEYS.current, oldBlobStr);
  installCgFetch();
  const r = await runFetch(baseEnv(kv), { coins: COINS, ids: IDS, nowMs: NOW_G });
  assert.equal(r.ok, false);
  assert.equal(r.code, "kv_put_failed");
  assert.equal(r.stage, "kv-put");
  assert.equal(kv.store.get(KV_KEYS.current), oldBlobStr, "主 blob put 失败时旧 blob 必须原样保留");
  const health = JSON.parse(kv.store.get(KV_KEYS.health));
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(health.lastError.code, "kv_put_failed");
  assert.equal(health.lastError.stage, "kv-put");
});

await test("6b KV put 抛错（prev 归档键）→ 主流程仍成功、主 blob 正常覆写（W4-10 不阻断口径）", async () => {
  const kv = makeKv({ failPutKeys: new Set([KV_KEYS.currentPrev]) });
  kv.store.set(KV_KEYS.current, JSON.stringify(makePrevBlob({ nowMs: NOW_G, marketsAgeMs: 10 * 60 * 1000, globalAgeMs: 10 * 60 * 1000 })));
  installCgFetch();
  const r = await runFetch(baseEnv(kv), { coins: COINS, ids: IDS, nowMs: NOW_G });
  assert.equal(r.ok, true, JSON.stringify(r));
  const blob = JSON.parse(kv.store.get(KV_KEYS.current));
  assert.equal(blob.fetchRunId, r.runId, "主 blob 已覆写为本 run");
  assert.equal(kv.store.has(KV_KEYS.currentPrev), false, "归档失败不落 prev（且不报错阻断）");
});

// ---------- 7. W4-10 prev 归档 ----------
await test("7a W4-10 prev 归档 [shadow]: 连跑两次 → shadowPrev=第一次 blob、shadow=第二次 blob、current 侧无写入", async () => {
  const kv = makeKv();
  const env = baseEnv(kv, { BOARD_TARGET_KEY: "shadow" });
  // 第一次：base=100
  installCgFetch({ marketsImpl: () => jsonRes(marketsPayload(IDS, 100)) });
  const r1 = await runFetch(env, { coins: COINS, ids: IDS, nowMs: NOW_G });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const blob1 = JSON.parse(kv.store.get(KV_KEYS.shadow));
  assert.equal(blob1.fetchRunId, r1.runId);
  assert.equal(kv.store.has(KV_KEYS.shadowPrev), false, "第一次后尚无 prev");
  // 第二次：10min 后、价格换 base=200 以便区分
  installCgFetch({ marketsImpl: () => jsonRes(marketsPayload(IDS, 200)) });
  const r2 = await runFetch(env, { coins: COINS, ids: IDS, nowMs: NOW_G + 10 * 60 * 1000 });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const blob2 = JSON.parse(kv.store.get(KV_KEYS.shadow));
  const prev = JSON.parse(kv.store.get(KV_KEYS.shadowPrev));
  assert.deepEqual(prev, blob1, "shadowPrev 应等于第一次的 blob（完整上一版）");
  assert.equal(prev.fetchRunId, r1.runId);
  assert.equal(blob2.fetchRunId, r2.runId);
  assert.equal(blob2.rows[0].price, 200);
  assert.equal(prev.rows[0].price, 100);
  assert.equal(kv.store.has(KV_KEYS.current), false);
  assert.equal(kv.store.has(KV_KEYS.currentPrev), false);
});

await test("7b W4-10 prev 归档: 首次运行（无 prevBlob）→ 不写 prev 键且不报错、主 blob 正常落盘", async () => {
  const kv = makeKv();
  installCgFetch();
  const r = await runFetch(baseEnv(kv, { BOARD_TARGET_KEY: "shadow" }), { coins: COINS, ids: IDS, nowMs: NOW_G });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(kv.store.has(KV_KEYS.shadow), true);
  assert.equal(kv.store.has(KV_KEYS.shadowPrev), false);
});

// ---------- 8. W5-02（F5-02）BOARD_TARGET_KEY 白名单 fail-closed ----------
await test("8 W5-02 fail-closed: BOARD_TARGET_KEY 误写/空值/缺失 → 拒写任何 blob 键、零上游调用、health 留痕", async () => {
  for (const bad of ["shadoow", "CURRENT", "", undefined]) {
    const kv = makeKv();
    const counts = installCgFetch();
    const r = await runFetch(baseEnv(kv, { BOARD_TARGET_KEY: bad }), { coins: COINS, ids: IDS, nowMs: NOW_G });
    assert.equal(r.ok, false, `值 ${JSON.stringify(bad)} 应被拒`);
    assert.equal(r.code, "BOARD_TARGET_KEY_INVALID");
    assert.equal(r.stage, "config");
    assert.equal(counts.total, 0, "配置错误必须在抓取前拦截");
    for (const k of [KV_KEYS.current, KV_KEYS.shadow, KV_KEYS.currentPrev, KV_KEYS.shadowPrev]) {
      assert.equal(kv.store.has(k), false, `blob 键 ${k} 零触碰`);
    }
    const health = JSON.parse(kv.store.get(KV_KEYS.health));
    assert.equal(health.lastError.code, "BOARD_TARGET_KEY_INVALID", "health 留痕作日志证据");
    assert.equal(health.lastError.stage, "config");
  }
});

// ---------- 9. W5-01（F5-01）Paprika 真实 COINS 形状契约 ----------
await test("9a W5-01 契约: 真实 COINS 原样（paprikaId 全 null）喂 fetchMarkets → missingIds 为 200 个真实 id、绝无 undefined", async () => {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.coinpaprika.com/v1/tickers")) return jsonRes(PAPRIKA_TICKERS);
    throw new Error("unexpected " + u);
  };
  const { rows, coverage } = await paprika.fetchMarkets(REAL_COINS);
  assert.equal(coverage.expected, 200);
  assert.equal(coverage.returned, 0);
  assert.equal(rows.length, 0);
  assert.deepEqual(coverage.missingIds, REAL_COINS.map((c) => c.id));
  assert.ok(coverage.missingIds.every((x) => typeof x === "string" && x.length > 0), "missingIds 恒为真实 id（F5-01 回归点）");
});

await test("9b W5-01 契约: 真实 COINS 元素形 {id,paprikaId} + 命中 ticker → 覆盖率与 rows 按真实 id 计算", async () => {
  const coins = [
    { id: REAL_COINS[0].id, paprikaId: "x-first" },
    { id: REAL_COINS[1].id, paprikaId: "x-second" },
    { id: REAL_COINS[2].id, paprikaId: "x-third" },
    { id: REAL_COINS[3].id, paprikaId: null },
  ];
  const tickers = [
    { id: "x-first", rank: 7, quotes: { USD: { price: 1.5, market_cap: 1500, percent_change_24h: 0.5 } } },
    { id: "x-third", rank: 9, quotes: { USD: { price: 2.5, market_cap: 2500, percent_change_24h: -0.5 } } },
  ];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.coinpaprika.com/v1/tickers")) return jsonRes(tickers);
    throw new Error("unexpected " + u);
  };
  const { rows, coverage } = await paprika.fetchMarkets(coins);
  assert.equal(coverage.expected, 4);
  assert.equal(coverage.returned, 2, "备源在真实形状下真能产出覆盖（消除假备源）");
  assert.deepEqual(coverage.missingIds, [REAL_COINS[1].id, REAL_COINS[3].id]);
  assert.deepEqual(rows.map((r) => r.id).sort(), [REAL_COINS[0].id, REAL_COINS[2].id].sort());
  assert.ok(rows.every((r) => r._src === "coinpaprika"));
});

globalThis.fetch = originalFetch;
const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
