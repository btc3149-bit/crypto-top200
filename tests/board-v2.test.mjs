// tests/board-v2.test.mjs — W2-02 契约 v2 测试（BOARD_READ_MODE=kv）
// 六时刻状态机逐格断言（899/901/1799/1801/21599/21601）+ global 解耦两例 +
// 无 blob 落 L3 + 安全头同出口 + 响应/health grep 无 key 片段。
import assert from "node:assert/strict";
import { buildBlob } from "../shared/board-schema.js";

const originalDateNow = Date.now;
const originalFetch = globalThis.fetch;
let seq = 0;
async function freshBoard() {
  seq += 1;
  const url = new URL("../functions/api/board.js", import.meta.url);
  url.searchParams.set("case", `v2-${seq}-${Math.random()}`);
  return import(url.href);
}

const T0 = 1794300000000; // 固定基准时刻
function makeBlob({ fetchedAtMs = T0, globalAsOfMs = T0 } = {}) {
  const rows = ["bitcoin", "ethereum", "solana", "filecoin"].map((id, i) => ({
    id,
    price: 100 + i,
    mcapUsd: 1000000 + i,
    rank: i + 1,
    change24h: 1.5,
    _src: "coingecko",
  }));
  return buildBlob({
    source: "coingecko",
    fetchRunId: "test-run-1",
    fetchedAtMs,
    rows,
    coverage: { expected: 4, returned: 4, missingIds: [], ratio: 1 },
    global: { totalMarketCapUsd: 999, btcDominancePct: 55, totalMcapChange24h: 1, asOf: new Date(globalAsOfMs).toISOString(), _src: "coingecko" },
    fetchMeta: { durationMs: 10, upstreamStatus: { markets: 200, global: 200 }, attempts: { markets: 1, global: 1 }, quota: { month: "2026-11", creditsUsedEst: 5, quotaMode: "normal" } },
    healthSummary: { consecutiveFailures: 0, lastSuccessAt: new Date(fetchedAtMs).toISOString() },
  });
}

function kvEnv(blob, health = null) {
  return {
    BOARD_READ_MODE: "kv",
    BOARD_KV: {
      async get(key) {
        if (key === "v1:board:current") return blob;
        if (key === "v1:meta:health") return health;
        return null;
      },
    },
  };
}
function ctx(env) {
  return { request: new Request("https://example.com/api/board", { method: "GET" }), env, waitUntil: () => {} };
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
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
  }
}

// 六时刻逐格（期望按 §2 表：≤900 L0 / ≤1800 L1 / ≤21600 L2 / >21600 L3）
const SIX = [
  [899, "L0", "live", false],
  [901, "L1", "delayed", true],
  [1799, "L1", "delayed", true],
  [1801, "L2", "stale", true],
  [21599, "L2", "stale", true],
  [21601, "L3", "snapshot", true],
];
for (const [ageSec, level, mode, stale] of SIX) {
  await test(`v2 六时刻 age=${ageSec}s → ${level}/${mode}`, async () => {
    const mod = await freshBoard();
    Date.now = () => T0 + ageSec * 1000;
    const res = await mod.onRequestGet(ctx(kvEnv(makeBlob({}))));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.contractVersion, 2);
    assert.equal(body.freshness.level, level);
    assert.equal(body.mode, mode);
    assert.equal(body.stale, stale);
    assert.equal(body.staleAgeSec, ageSec);
    assert.equal(body.freshness.servedFrom, level === "L3" ? "snapshot" : "kv");
    assert.equal(body.fetch.fetchRunId, "test-run-1");
    if (level === "L3") {
      assert.equal(body.source, "snapshot");
      assert.deepEqual(body.coins, {});
      assert.equal(body.global, null);
    } else {
      assert.equal(body.source, "coingecko");
      assert.equal(body.count, 4);
      assert.equal(body.coins.bitcoin.price, 100);
      // v1 字段保留
      assert.equal(typeof body.updatedAt, "number");
      assert.equal(typeof body.servedAt, "number");
      assert.equal(body.snapshotDate, "2026-11-08");
    }
    // 安全头（W2-18 §18.3）200 出口在位
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("content-security-policy"), "default-src 'none'");
  });
}

await test("v2 global 解耦①: markets 新、global asOf 2h 前 → 整表 L0、global.stale=true、global 非 null", async () => {
  const mod = await freshBoard();
  Date.now = () => T0 + 600 * 1000; // 整表 age 600s → L0
  const blob = makeBlob({ fetchedAtMs: T0, globalAsOfMs: T0 - 2 * 3600 * 1000 });
  const res = await mod.onRequestGet(ctx(kvEnv(blob)));
  const body = await res.json();
  assert.equal(body.freshness.level, "L0");
  assert.ok(body.global, "global 不得为 null");
  assert.equal(body.global.stale, true);
  assert.equal(body.global.asOf, new Date(T0 - 7200000).toISOString());
  assert.equal(body.global.totalMcapUsd, 999);
  assert.equal(body.global.btcDominance, 55);
});

await test("v2 global 解耦②: global asOf 7h 前 → global=null 且整表级别不受影响", async () => {
  const mod = await freshBoard();
  Date.now = () => T0 + 600 * 1000;
  const blob = makeBlob({ fetchedAtMs: T0, globalAsOfMs: T0 - 7 * 3600 * 1000 });
  const res = await mod.onRequestGet(ctx(kvEnv(blob)));
  const body = await res.json();
  assert.equal(body.freshness.level, "L0");
  assert.equal(body.global, null);
  assert.equal(body.count, 4);
});

await test("v2 无 blob（KV 空）→ L3 snapshot、coins 空、无 5xx", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const res = await mod.onRequestGet(ctx(kvEnv(null, { consecutiveFailures: 9 })));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.freshness.level, "L3");
  assert.equal(body.mode, "snapshot");
  assert.equal(body.source, "snapshot");
  assert.deepEqual(body.coins, {});
  assert.equal(body.freshness.consecutiveFailures, 9, "health 摘要应透传至 freshness");
});

await test("v2 时钟钳制: fetchedAt 在未来 120s → staleAgeSec 钳为 0、L0", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const blob = makeBlob({ fetchedAtMs: T0 + 120000, globalAsOfMs: T0 + 120000 });
  const res = await mod.onRequestGet(ctx(kvEnv(blob)));
  const body = await res.json();
  assert.equal(body.staleAgeSec, 0);
  assert.equal(body.freshness.level, "L0");
});

await test("v2 安全: 响应文本 grep 无 key/令牌片段；405 同出口安全头", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const res = await mod.onRequestGet(ctx(kvEnv(makeBlob({}))));
  const text = await res.text();
  for (const pat of ["x-cg-demo-api-key", "COINGECKO_API_KEY", "MANUAL_RUN_TOKEN", "api_key", "apiKey"]) {
    assert.ok(!text.includes(pat), `response must not contain ${pat}`);
  }
  const res405 = await mod.onRequest({ request: new Request("https://example.com/api/board", { method: "POST" }), env: kvEnv(makeBlob({})), waitUntil: () => {} });
  assert.equal(res405.status, 405);
  assert.equal(res405.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res405.headers.get("content-security-policy"), "default-src 'none'");
});

await test("v2 dual 模式: 对外仍 legacy 结果（走抓取路径），KV 差异仅日志", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const jr = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/data/coins.json")) return jr({ coins: [{ coingeckoId: "bitcoin" }, { coingeckoId: "ethereum" }, { coingeckoId: "solana" }, { coingeckoId: "filecoin" }] });
    if (u.includes("/coins/markets"))
      return jr(["bitcoin", "ethereum", "solana", "filecoin"].map((id, i) => ({ id, current_price: 100 + i, market_cap: 1000000 + i, market_cap_rank: i + 1, price_change_percentage_24h_in_currency: 1.5 })));
    if (u.includes("/global")) return jr({ data: { total_market_cap: { usd: 999 }, market_cap_percentage: { btc: 55 }, market_cap_change_percentage_24h_usd: 1 } });
    throw new Error("unexpected " + u);
  };
  const env = { ...kvEnv(makeBlob({})), BOARD_READ_MODE: "dual" };
  const res = await mod.onRequestGet(ctx(env));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.contractVersion, undefined, "dual 对外是 legacy 契约（无 contractVersion）");
});

await test("v2 dual 模式 + rows 形态 coins.json（W3-22）: getIds 解码 rows、对外仍 legacy 结果", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const FIELDS = ["table", "estRank", "rankNow", "rankNote", "name", "symbol", "coingeckoId", "snapshotPrice", "snapshotMcapUsd", "snapshotMcapRaw", "athPrice", "athDate", "athFlag", "estLo", "estHi", "multLo", "multHi", "impliedMcapLoUsd", "impliedMcapHiUsd", "impliedMcapRaw", "confidence", "reason", "dataDate"];
  const IDS4 = ["bitcoin", "ethereum", "solana", "filecoin"];
  globalThis.fetch = async (url) => {
    const u = String(url);
    const jr = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/data/coins.json")) return jr({ meta: { fields: FIELDS }, rows: IDS4.map((id) => FIELDS.map((f) => (f === "coingeckoId" ? id : null))) });
    if (u.includes("/coins/markets"))
      return jr(IDS4.map((id, i) => ({ id, current_price: 100 + i, market_cap: 1000000 + i, market_cap_rank: i + 1, price_change_percentage_24h_in_currency: 1.5, total_volume: 9000 + i })));
    if (u.includes("/global")) return jr({ data: { total_market_cap: { usd: 999 }, market_cap_percentage: { btc: 55 }, market_cap_change_percentage_24h_usd: 1 } });
    throw new Error("unexpected " + u);
  };
  const env = { ...kvEnv(makeBlob({})), BOARD_READ_MODE: "dual" };
  const res = await mod.onRequestGet(ctx(env));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.contractVersion, undefined, "dual 对外是 legacy 契约（无 contractVersion）");
  assert.equal(body.coins.bitcoin.volume24h, 9000, "W3-25: legacy 路径 total_volume → volume24h");
});

Date.now = originalDateNow;
globalThis.fetch = originalFetch;
const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
