// tests/board-fetcher.test.mjs — W2-01/W2-03 fetcher 与 schema 单元测试（Node）
// 覆盖：无 key 配置错误不覆写 blob + health 落盘计数；成功写 blob；覆盖率门禁；
// 429 跳过计数；buildBlob 混合源拒绝；PAPRIKA_ENABLED=false 时强制 coinpaprika 无效；
// source-state 状态机关键迁移。
import assert from "node:assert/strict";
import { buildBlob, validateBlob, normalizeCgMarkets } from "../shared/board-schema.js";
import { runFetch } from "../workers/fetcher/src/index.js";
import { emptySourceState, resolveProvider, applyOutcome } from "../workers/fetcher/src/source-state.js";

const originalFetch = globalThis.fetch;
const COINS = [
  { id: "bitcoin", paprikaId: "btc-bitcoin" },
  { id: "ethereum", paprikaId: "eth-ethereum" },
  { id: "solana", paprikaId: "sol-solana" },
  { id: "filecoin", paprikaId: "fil-filecoin" },
];
const IDS = COINS.map((c) => c.id);

function makeKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) {
      const v = store.get(key);
      if (v == null) return null;
      return opts && opts.type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
  };
}
function jsonRes(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
function marketsPayload(ids = IDS) {
  return ids.map((id, i) => ({
    id,
    current_price: 100 + i,
    market_cap: 1000000 + i,
    market_cap_rank: i + 1,
    price_change_percentage_24h_in_currency: 1.5,
    price_change_percentage_24h: 1.2,
    total_volume: 500000 + i,
  }));
}
const GLOBAL_PAYLOAD = { data: { total_market_cap: { usd: 999 }, market_cap_percentage: { btc: 55 }, market_cap_change_percentage_24h_usd: 1 } };

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

await test("schema: normalizeCgMarkets 行结构与现行 board 同构 + validateBlob", async () => {
  const { rows, coverage } = normalizeCgMarkets(marketsPayload(), IDS);
  assert.equal(coverage.returned, 4);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["_src", "change24h", "id", "mcapUsd", "price", "rank", "volume24h"]);
  assert.equal(rows[0].volume24h, 500000, "W3-25: total_volume → volume24h 映射");
  const blob = buildBlob({
    source: "coingecko",
    fetchRunId: "r1",
    fetchedAtMs: Date.now(),
    rows,
    coverage,
    global: { totalMarketCapUsd: 1, btcDominancePct: 2, totalMcapChange24h: 0, asOf: new Date().toISOString(), _src: "coingecko" },
    fetchMeta: { durationMs: 1, upstreamStatus: { markets: 200, global: 200 }, attempts: { markets: 1, global: 1 }, quota: { month: "2026-11", creditsUsedEst: 1, quotaMode: "normal" } },
  });
  assert.equal(validateBlob(blob).ok, true);
  assert.ok(!("_src" in blob.rows[0]), "对外 rows 必须剥除 _src");
});

await test("W2-03 §4.2: buildBlob 混合源 rows 必拒", async () => {
  const { rows } = normalizeCgMarkets(marketsPayload(), IDS);
  const mixed = [...rows.slice(0, 3), { ...rows[3], _src: "coinpaprika" }];
  assert.throws(() => buildBlob({ source: "coingecko", fetchRunId: "r", fetchedAtMs: Date.now(), rows: mixed, coverage: { expected: 4, returned: 4, missingIds: [] }, global: null }), /mixed-source/);
  // 跨源 global 同罪
  assert.throws(
    () =>
      buildBlob({
        source: "coingecko",
        fetchRunId: "r",
        fetchedAtMs: Date.now(),
        rows,
        coverage: { expected: 4, returned: 4, missingIds: [] },
        global: { totalMarketCapUsd: 1, asOf: new Date().toISOString(), _src: "coinpaprika" },
      }),
    /cross-source/
  );
});

await test("fetcher: 无 key → 配置错误、blob 不覆写、health 失败计数落盘", async () => {
  const kv = makeKv();
  const goodBlob = JSON.stringify({ schemaVersion: 1, source: "coingecko", fetchedAt: new Date().toISOString(), marketsUpdatedAt: new Date().toISOString(), coverage: { expected: 4, returned: 4, missingIds: [] }, rows: [{ id: "bitcoin", price: 1 }], global: null });
  kv.store.set("v1:board:current", goodBlob);
  globalThis.fetch = async () => {
    throw new Error("must not fetch anonymously");
  };
  const env = { BOARD_KV: kv, PAPRIKA_ENABLED: "false", BOARD_SOURCE: "auto", BOARD_TARGET_KEY: "current" };
  const r1 = await runFetch(env, { coins: COINS, ids: IDS });
  assert.equal(r1.ok, false);
  assert.equal(r1.code, "COINGECKO_API_KEY_MISSING");
  assert.equal(kv.store.get("v1:board:current"), goodBlob, "失败绝不覆写 blob");
  const health = JSON.parse(kv.store.get("v1:meta:health"));
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(health.lastError.stage, "config");
  assert.ok(!JSON.stringify(health).includes("COINGECKO_API_KEY=") && !("apiKey" in health));
  const r2 = await runFetch(env, { coins: COINS, ids: IDS });
  assert.equal(JSON.parse(kv.store.get("v1:meta:health")).consecutiveFailures, 2);
  void r2;
});

await test("fetcher: 有 key 成功 → 写 blob、health 清零、额度 +2(markets+global)", async () => {
  const kv = makeKv();
  kv.store.set("v1:meta:health", JSON.stringify({ consecutiveFailures: 5, quota: { month: new Date().toISOString().slice(0, 7), creditsUsedEst: 10, quotaMode: "normal" } }));
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/coins/markets")) return jsonRes(marketsPayload());
    if (u.includes("/global")) return jsonRes(GLOBAL_PAYLOAD);
    throw new Error("unexpected " + u);
  };
  const env = { BOARD_KV: kv, COINGECKO_API_KEY: "test-key-not-real", PAPRIKA_ENABLED: "false", BOARD_SOURCE: "auto", BOARD_TARGET_KEY: "current" };
  const r = await runFetch(env, { coins: COINS, ids: IDS });
  assert.equal(r.ok, true, JSON.stringify(r));
  const blob = JSON.parse(kv.store.get("v1:board:current"));
  assert.equal(blob.source, "coingecko");
  assert.equal(blob.coverage.returned, 4);
  assert.ok(blob.global && blob.global.asOf, "global.asOf 必须在");
  assert.equal(blob.global.totalMarketCapUsd, 999);
  const health = JSON.parse(kv.store.get("v1:meta:health"));
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.status, "ok");
  assert.equal(health.quota.creditsUsedEst, 12);
  assert.ok(!kv.store.get("v1:board:current").includes("test-key-not-real"), "blob 不得含 key");
  assert.ok(!kv.store.get("v1:meta:health").includes("test-key-not-real"), "health 不得含 key");
});

await test("fetcher: 覆盖率不足 → validate 失败不写 blob", async () => {
  const kv = makeKv();
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/coins/markets")) return jsonRes(marketsPayload(IDS.slice(0, 2)));
    if (u.includes("/global")) return jsonRes(GLOBAL_PAYLOAD);
    throw new Error("unexpected");
  };
  const env = { BOARD_KV: kv, COINGECKO_API_KEY: "k", PAPRIKA_ENABLED: "false", BOARD_SOURCE: "auto", BOARD_TARGET_KEY: "current" };
  const r = await runFetch(env, { coins: COINS, ids: IDS });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "validate");
  assert.equal(kv.store.has("v1:board:current"), false);
});

await test("fetcher: markets 429 Retry-After=1200 → skipRuns=2，下一 run 跳过且不计失败", async () => {
  const kv = makeKv();
  globalThis.fetch = async (url) => {
    if (String(url).includes("/coins/markets")) {
      return new Response(JSON.stringify({ error: "slow down" }), { status: 429, headers: { "content-type": "application/json", "Retry-After": "1200" } });
    }
    return jsonRes(GLOBAL_PAYLOAD);
  };
  const env = { BOARD_KV: kv, COINGECKO_API_KEY: "k", PAPRIKA_ENABLED: "false", BOARD_SOURCE: "auto", BOARD_TARGET_KEY: "current" };
  const r1 = await runFetch(env, { coins: COINS, ids: IDS });
  assert.equal(r1.ok, false);
  assert.equal(r1.skipRunsSet, 2);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonRes(marketsPayload());
  };
  const r2 = await runFetch(env, { coins: COINS, ids: IDS });
  assert.equal(r2.skipped, true);
  assert.equal(calls, 0, "跳过 run 不得打上游");
  assert.equal(JSON.parse(kv.store.get("v1:meta:health")).consecutiveFailures, 1, "跳过不计入 N");
});

await test("W2-03: PAPRIKA_ENABLED=false 时 BOARD_SOURCE=coinpaprika 无效（走 CG）", async () => {
  const { provider, warnings } = resolveProvider({ PAPRIKA_ENABLED: "false", BOARD_SOURCE: "coinpaprika" }, emptySourceState(Date.now()), Date.now());
  assert.equal(provider, "coingecko");
  assert.equal(warnings.length, 1);
});

await test("W2-03 状态机: CG 连败 3 次切 Paprika；静默期探针成功不回切；三连胜+静默期过回切", async () => {
  let s = emptySourceState(0);
  const env = { PAPRIKA_ENABLED: "true", BOARD_SOURCE: "auto" };
  for (let i = 0; i < 3; i++) s = applyOutcome(s, { provider: "coingecko", ok: false }, i * 600000);
  assert.equal(s.state, "PAPRIKA_ACTIVE");
  // 静默期（60min）内探针三连胜也不回切
  for (let i = 0; i < 3; i++) s = applyOutcome(s, { isProbe: true, ok: true, coverageRatio: 0.99 }, 1800000 + i * 600000);
  assert.equal(s.state, "PAPRIKA_ACTIVE");
  // 静默期过后再一次探针成功 → 回切且 justReturned（切入时刻 1200000，静默期至 4800000）
  s = applyOutcome(s, { isProbe: true, ok: true, coverageRatio: 0.99 }, 4900000);
  assert.equal(s.state, "CG_PRIMARY");
  assert.equal(s.justReturned, true);
  // 回切首 run 失败 → 立即切回，静默期减半 30min
  s = applyOutcome(s, { provider: "coingecko", ok: false }, 5000000);
  assert.equal(s.state, "PAPRIKA_ACTIVE");
  assert.equal(s.cooldownUntil - 5000000, 30 * 60 * 1000);
  void env;
});

globalThis.fetch = originalFetch;
const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
