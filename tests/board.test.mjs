// tests/board.test.mjs — board.js 故障矩阵测试（Node 24）
// 通过覆写 globalThis.fetch 模拟上游与 /data/coins.json，
// 通过动态 import + query 参数获得每个用例独立的模块实例（重置 MEM/IDS/熔断状态）。

import assert from "node:assert/strict";

const IDS = ["bitcoin", "ethereum", "solana", "filecoin"];
const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

let seq = 0;
async function freshBoard() {
  seq += 1;
  const url = new URL("../functions/api/board.js", import.meta.url);
  url.searchParams.set("case", `${seq}-${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function marketsPayload(idsSubset = IDS) {
  return idsSubset.map((id, i) => ({
    id,
    current_price: 100 + i,
    market_cap: 1000000 + i,
    market_cap_rank: i + 1,
    price_change_percentage_24h_in_currency: 1.5,
    price_change_percentage_24h: 1.2,
  }));
}

function globalPayload() {
  return {
    data: {
      total_market_cap: { usd: 123456789 },
      market_cap_percentage: { btc: 55.5 },
      market_cap_change_percentage_24h_usd: 2.3,
    },
  };
}

function jsonRes(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// behaviour: { markets: fn(counts)=>Response|throw, global: fn(counts)=>Response|throw }
function installFetch(behaviour) {
  const counts = { total: 0, coinsJson: 0, markets: 0, global: 0 };
  globalThis.fetch = async (url, _opts) => {
    const u = String(url);
    counts.total += 1;
    if (u.includes("/data/coins.json")) {
      counts.coinsJson += 1;
      return jsonRes({ coins: IDS.map((id) => ({ coingeckoId: id })) });
    }
    if (u.includes("/coins/markets")) {
      counts.markets += 1;
      if (behaviour.markets) return behaviour.markets(counts);
      return jsonRes(marketsPayload());
    }
    if (u.includes("/global")) {
      counts.global += 1;
      if (behaviour.global) return behaviour.global(counts);
      return jsonRes(globalPayload());
    }
    throw new Error("unexpected fetch: " + u);
  };
  return counts;
}

function ctx(mod, { method = "GET" } = {}) {
  return {
    request: new Request("https://example.com/api/board", { method }),
    env: {},
    waitUntil: () => {},
  };
}

async function callGet(mod, opts) {
  const handler = mod.onRequestGet || mod.onRequest;
  assert.equal(typeof handler, "function", "handler export must exist");
  return handler(ctx(mod, opts));
}

function restore() {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([name, "PASS"]);
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push([name, "FAIL: " + (e && e.stack ? e.stack : String(e))]);
    console.error(`FAIL ${name}\n`, e);
  } finally {
    restore();
  }
}

// ① 正常 live
await test("① 正常 live（global 在场、coverage 满、mode=live）", async () => {
  const mod = await freshBoard();
  installFetch({});
  const res = await callGet(mod);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") || "", /public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400/);
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.source, "coingecko");
  assert.equal(body.stale, false);
  assert.equal(body.staleAgeSec, 0);
  assert.ok(body.global, "global should be present");
  assert.equal(body.global.totalMcapUsd, 123456789);
  assert.equal(body.coverage.expected, IDS.length);
  assert.equal(body.coverage.returned, IDS.length);
  assert.deepEqual(body.coverage.missingIds, []);
  assert.equal(body.count, IDS.length);
  assert.equal(body.coins.bitcoin.price, 100);
  assert.equal(body.snapshotDate, "2026-11-08");
  assert.equal(typeof body.updatedAt, "number");
  assert.equal(typeof body.servedAt, "number");
});

// ② global fetch reject
await test("② global fetch reject（整单仍成功、global=null）", async () => {
  const mod = await freshBoard();
  installFetch({
    global: () => {
      throw new Error("global network down");
    },
  });
  const res = await callGet(mod);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.global, null);
  assert.equal(body.count, IDS.length);
  assert.ok(body.coins.ethereum);
});

// ③ markets 只返回 50%
await test("③ markets 只返回 50% 条数（判失败走 snapshot 信号）", async () => {
  const mod = await freshBoard();
  installFetch({
    markets: () => jsonRes(marketsPayload(IDS.slice(0, 2))),
  });
  const res = await callGet(mod);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "snapshot");
  assert.equal(body.stale, true);
  assert.deepEqual(body.coins, {});
  assert.equal(body.global, null);
  assert.equal(body.coverage.expected, IDS.length);
  assert.equal(body.coverage.returned, 0);
  assert.deepEqual([...body.coverage.missingIds].sort(), [...IDS].sort());
  assert.equal(body.snapshotDate, "2026-11-08");
});

// ④ markets 429 带 Retry-After（熔断）
await test("④ markets 429 带 Retry-After（熔断、无缓存 503 + error 收敛 + Retry-After 头、第二次不打上游）", async () => {
  const mod = await freshBoard();
  const counts = installFetch({
    markets: () =>
      new Response(JSON.stringify({ error: "UPSTREAM_SECRET_TEXT_SHOULD_NOT_LEAK 429 detail" }), {
        status: 429,
        headers: { "content-type": "application/json", "Retry-After": "120" },
      }),
  });
  const res1 = await callGet(mod);
  assert.equal(res1.status, 503);
  const text1 = await res1.text();
  assert.ok(!text1.includes("UPSTREAM_SECRET_TEXT"), "response must not leak upstream text");
  assert.ok(!text1.includes("429"), "response must not leak upstream status detail");
  const body1 = JSON.parse(text1);
  assert.deepEqual(body1, { error: "upstream_unavailable" });
  const ra = res1.headers.get("Retry-After");
  assert.ok(ra, "Retry-After header must be present");
  const raNum = Number.parseInt(ra, 10);
  assert.ok(raNum > 0 && raNum <= 120, `Retry-After should be <=120, got ${ra}`);
  assert.equal(counts.markets, 1, "first request should hit markets once");

  const marketsAfterFirst = counts.markets;
  const globalAfterFirst = counts.global;
  const res2 = await callGet(mod);
  assert.equal(res2.status, 503);
  const body2 = await res2.json();
  assert.deepEqual(body2, { error: "upstream_unavailable" });
  assert.ok(res2.headers.get("Retry-After"), "second (circuit) response must carry Retry-After");
  assert.equal(counts.markets, marketsAfterFirst, "circuit: second request must NOT hit markets upstream");
  assert.equal(counts.global, globalAfterFirst, "circuit: second request must NOT hit global upstream");
});

// ⑤ 有缓存且上游失败、缓存 10 分钟龄
await test("⑤ 有缓存且上游失败、缓存 10 分钟龄（mode=stale、staleAgeSec≈600、价格仍在）", async () => {
  const mod = await freshBoard();
  let fakeNow = originalDateNow();
  Date.now = () => fakeNow;
  let failMode = false;
  installFetch({
    markets: () => {
      if (failMode) throw new Error("upstream down");
      return jsonRes(marketsPayload());
    },
    global: () => {
      if (failMode) throw new Error("upstream down");
      return jsonRes(globalPayload());
    },
  });
  const res1 = await callGet(mod);
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.mode, "live");

  fakeNow += 10 * 60 * 1000;
  failMode = true;
  const res2 = await callGet(mod);
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.mode, "stale");
  assert.equal(body2.stale, true);
  assert.ok(Math.abs(body2.staleAgeSec - 600) <= 2, `staleAgeSec should be ~600, got ${body2.staleAgeSec}`);
  assert.ok(body2.coins.bitcoin, "stale coins should still contain prices");
  assert.equal(body2.coins.bitcoin.price, 100);
});

// ⑥ 缓存 7 小时龄且上游失败
await test("⑥ 缓存 7 小时龄且上游失败（mode=snapshot、coins 为空）", async () => {
  const mod = await freshBoard();
  let fakeNow = originalDateNow();
  Date.now = () => fakeNow;
  const firstUpdatedAt = fakeNow;
  let failMode = false;
  installFetch({
    markets: () => {
      if (failMode) throw new Error("upstream down");
      return jsonRes(marketsPayload());
    },
    global: () => {
      if (failMode) throw new Error("upstream down");
      return jsonRes(globalPayload());
    },
  });
  const res1 = await callGet(mod);
  assert.equal(res1.status, 200);
  assert.equal((await res1.json()).mode, "live");

  fakeNow += 7 * 3600 * 1000;
  failMode = true;
  const res2 = await callGet(mod);
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.mode, "snapshot");
  assert.deepEqual(body2.coins, {});
  assert.equal(body2.global, null);
  assert.equal(body2.updatedAt, firstUpdatedAt);
  assert.ok(Math.abs(body2.staleAgeSec - 7 * 3600) <= 2, `staleAgeSec ~25200, got ${body2.staleAgeSec}`);
  assert.equal(body2.coverage.returned, 0);
});

// ⑦ POST 请求得 405
await test("⑦ POST 请求得 405", async () => {
  const mod = await freshBoard();
  installFetch({});
  assert.equal(typeof mod.onRequest, "function", "onRequest fallback export must exist for non-GET");
  const res = await mod.onRequest(ctx(mod, { method: "POST" }));
  assert.equal(res.status, 405);
  // onRequestGet itself must exist as GET handler
  assert.equal(typeof mod.onRequestGet, "function");
});

await test("⑧ W5-02: BOARD_READ_MODE 误写（kvv）→ 结构化 error 日志留痕 + 回落 legacy 正常应答", async () => {
  const mod = await freshBoard();
  installFetch({});
  const errs = [];
  const origErr = console.error;
  console.error = (...args) => errs.push(args.join(" "));
  let res;
  try {
    res = await mod.onRequestGet({
      request: new Request("https://example.com/api/board", { method: "GET" }),
      env: { BOARD_READ_MODE: "kvv" },
      waitUntil: () => {},
    });
  } finally {
    console.error = origErr;
  }
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "live", "未知 mode 回落 legacy 应答（可用性优先）");
  const logged = errs.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean);
  const hit = logged.find((o) => o.event === "board_mode_unknown");
  assert.ok(hit, "必须有 board_mode_unknown 结构化日志（不得静默走错路）");
  assert.equal(hit.level, "error");
  assert.equal(hit.mode, "kvv");
  assert.equal(hit.fallback, "legacy");
});

await test("⑨ W3-22: coins.json 为 rows 紧凑形态 → getIds 按 meta.fields 解码、legacy 正常 live", async () => {
  const mod = await freshBoard();
  const FIELDS = ["table", "estRank", "rankNow", "rankNote", "name", "symbol", "coingeckoId", "snapshotPrice", "snapshotMcapUsd", "snapshotMcapRaw", "athPrice", "athDate", "athFlag", "estLo", "estHi", "multLo", "multHi", "impliedMcapLoUsd", "impliedMcapHiUsd", "impliedMcapRaw", "confidence", "reason", "dataDate"];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/data/coins.json")) {
      return jsonRes({ meta: { fields: FIELDS }, rows: IDS.map((id) => FIELDS.map((f) => (f === "coingeckoId" ? id : null))) });
    }
    if (u.includes("/coins/markets")) return jsonRes(marketsPayload().map((m, i) => ({ ...m, total_volume: 7000 + i })));
    if (u.includes("/global")) return jsonRes(globalPayload());
    throw new Error("unexpected fetch: " + u);
  };
  const res = await callGet(mod);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.coverage.returned, IDS.length);
  assert.deepEqual(Object.keys(body.coins).sort(), [...IDS].sort());
  assert.equal(body.coins.bitcoin.volume24h, 7000, "W3-25: legacy 路径 total_volume → volume24h");
});

restore();
const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
for (const [name, s] of results) console.log(`${s === "PASS" ? "✓" : "✗"} ${name} ${s === "PASS" ? "" : s}`);
if (failed.length) process.exitCode = 1;
