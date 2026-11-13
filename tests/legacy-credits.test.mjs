// tests/legacy-credits.test.mjs — W4-02 legacy 回源计数测试（Node 24）
// 口径：board.js legacy 路径每轮真实回源（markets+global 同发）给 KV 键
// v1:meta:legacy-credits 累加 2 credits（结构 {month, credits, updatedAt}，跨月重置）；
// 缓存命中、熔断短路、KV 只读路径均不计数；无 BOARD_KV 时主流程不受影响。
// ⚠️ 该计数键是 wrangler.toml「Function 只 get」约定的局部突破（见 board.js 注释）。
// 运行：node tests/legacy-credits.test.mjs

import assert from "node:assert/strict";
import { buildBlob, KV_KEYS } from "../shared/board-schema.js";

const IDS = ["bitcoin", "ethereum", "solana", "filecoin"];
const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const T0 = Date.UTC(2026, 10, 13, 12, 0, 0); // 2026-11-13T12:00Z

let seq = 0;
async function freshBoard() {
  seq += 1;
  const url = new URL("../functions/api/board.js", import.meta.url);
  url.searchParams.set("case", `lc-${seq}-${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function jsonRes(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function makeKv() {
  const store = new Map();
  const puts = [];
  return {
    store,
    puts,
    async get(key, opts) {
      const v = store.get(key);
      if (v == null) return null;
      return opts && opts.type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) {
      puts.push(key);
      store.set(key, String(value));
    },
  };
}

function installFetch({ marketsStatus = 200 } = {}) {
  const counts = { markets: 0, global: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/data/coins.json")) return jsonRes({ coins: IDS.map((id) => ({ coingeckoId: id })) });
    if (u.includes("/coins/markets")) {
      counts.markets += 1;
      if (marketsStatus !== 200) {
        return new Response(JSON.stringify({ error: "rl" }), {
          status: marketsStatus,
          headers: { "content-type": "application/json", "Retry-After": "120" },
        });
      }
      return jsonRes(
        IDS.map((id, i) => ({
          id,
          current_price: 100 + i,
          market_cap: 1000000 + i,
          market_cap_rank: i + 1,
          price_change_percentage_24h_in_currency: 1.5,
        }))
      );
    }
    if (u.includes("/global")) {
      counts.global += 1;
      return jsonRes({ data: { total_market_cap: { usd: 999 }, market_cap_percentage: { btc: 55 }, market_cap_change_percentage_24h_usd: 1 } });
    }
    throw new Error("unexpected fetch: " + u);
  };
  return counts;
}

function ctx(env) {
  return { request: new Request("https://example.com/api/board", { method: "GET" }), env, waitUntil: () => {} };
}

function counterOf(kv) {
  const raw = kv.store.get(KV_KEYS.legacyCredits);
  return raw ? JSON.parse(raw) : null;
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
    Date.now = originalDateNow;
  }
}

await test("① 一轮真实回源 → 计数 2（markets 1 + global 1），结构 {month, credits, updatedAt}", async () => {
  const mod = await freshBoard();
  let fakeNow = T0;
  Date.now = () => fakeNow;
  installFetch();
  const kv = makeKv();
  const res = await mod.onRequestGet(ctx({ BOARD_KV: kv }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).mode, "live");
  const c = counterOf(kv);
  assert.ok(c, "计数键必须被写入");
  assert.equal(c.month, "2026-11");
  assert.equal(c.credits, 2);
  assert.equal(typeof c.updatedAt, "string");
});

await test("② 缓存命中不计数；缓存过期再回源累加至 4", async () => {
  const mod = await freshBoard();
  let fakeNow = T0;
  Date.now = () => fakeNow;
  const counts = installFetch();
  const kv = makeKv();
  const env = { BOARD_KV: kv };
  await (await mod.onRequestGet(ctx(env))).json();
  assert.equal(counterOf(kv).credits, 2);
  // 60s 后：120s 缓存内 → 命中，不打上游、不计数
  fakeNow += 60 * 1000;
  const res2 = await mod.onRequestGet(ctx(env));
  assert.equal((await res2.json()).mode, "live");
  assert.equal(counts.markets, 1, "缓存命中不得再打上游");
  assert.equal(counterOf(kv).credits, 2);
  // 121s 后：缓存过期 → 再回源 +2
  fakeNow += 61 * 1000;
  await (await mod.onRequestGet(ctx(env))).json();
  assert.equal(counts.markets, 2);
  assert.equal(counterOf(kv).credits, 4);
});

await test("③ 跨月自动重置：上月 9000 → 本月首轮回源后为 2、month 翻新", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  installFetch();
  const kv = makeKv();
  kv.store.set(KV_KEYS.legacyCredits, JSON.stringify({ month: "2026-10", credits: 9000, updatedAt: "2026-10-31T00:00:00.000Z" }));
  await (await mod.onRequestGet(ctx({ BOARD_KV: kv }))).json();
  const c = counterOf(kv);
  assert.equal(c.month, "2026-11");
  assert.equal(c.credits, 2);
});

await test("④ 429 熔断：首轮已发出计 2；熔断期内第二请求不再计数、不打上游", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const counts = installFetch({ marketsStatus: 429 });
  const kv = makeKv();
  const env = { BOARD_KV: kv };
  const res1 = await mod.onRequestGet(ctx(env));
  assert.equal(res1.status, 503);
  assert.equal(counterOf(kv).credits, 2);
  const res2 = await mod.onRequestGet(ctx(env));
  assert.equal(res2.status, 503);
  assert.equal(counts.markets, 1, "熔断短路不得再打上游");
  assert.equal(counterOf(kv).credits, 2, "熔断短路不得计数");
});

await test("⑤ KV 只读路径（BOARD_READ_MODE=kv）不计数、不写任何键", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  installFetch();
  const kv = makeKv();
  const rows = IDS.map((id, i) => ({ id, price: 100 + i, mcapUsd: 1000 + i, rank: i + 1, change24h: 1, _src: "coingecko" }));
  const blob = buildBlob({
    source: "coingecko",
    fetchRunId: "lc-kv",
    fetchedAtMs: T0,
    rows,
    coverage: { expected: 4, returned: 4, missingIds: [], ratio: 1 },
    global: { totalMarketCapUsd: 1, btcDominancePct: 2, totalMcapChange24h: 0, asOf: new Date(T0).toISOString(), _src: "coingecko" },
    fetchMeta: null,
    healthSummary: null,
  });
  kv.store.set(KV_KEYS.current, JSON.stringify(blob));
  const env = { BOARD_READ_MODE: "kv", BOARD_KV: kv };
  const res = await mod.onRequestGet(ctx(env));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).mode, "live");
  assert.equal(counterOf(kv), null, "kv 路径不得写 legacy 计数键");
  assert.deepEqual(kv.puts, [], "kv 路径不得有任何 KV 写");
});

await test("⑥ 无 BOARD_KV 绑定：计数静默跳过，live 主流程不受影响", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  installFetch();
  const res = await mod.onRequestGet(ctx({}));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).mode, "live");
});

globalThis.fetch = originalFetch;
Date.now = originalDateNow;
const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
