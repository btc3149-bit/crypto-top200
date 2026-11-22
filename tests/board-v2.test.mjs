// tests/board-v2.test.mjs — W2-02 契约 v2 测试（BOARD_READ_MODE=kv）
// 六时刻状态机逐格断言（899/901/1799/1801/21599/21601）+ global 解耦两例 +
// 无 blob 落 L3 + 安全头同出口 + 响应/health grep 无 key 片段。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    volume24h: 5000 + i,
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
      // F6-17：kv 模式首行五字段逐项断言（price/mcapUsd/rank/change24h/volume24h）
      assert.equal(body.coins.bitcoin.price, 100);
      assert.equal(body.coins.bitcoin.mcapUsd, 1000000);
      assert.equal(body.coins.bitcoin.rank, 1);
      assert.equal(body.coins.bitcoin.change24h, 1.5);
      assert.equal(body.coins.bitcoin.volume24h, 5000);
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

await test("v2 无 blob（KV 空）→ L3 snapshot、coins 空、无 5xx；F6-39: staleAgeSec=null、expected=真实 ids 数", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  // snapshotV2Body 会尽力取 ids 作 expected：mock coins.json 给出 4 个 id
  globalThis.fetch = async (url) => {
    if (String(url).includes("/data/coins.json")) {
      return new Response(JSON.stringify({ coins: ["bitcoin", "ethereum", "solana", "filecoin"].map((id) => ({ coingeckoId: id })) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("unexpected " + url);
  };
  const res = await mod.onRequestGet(ctx(kvEnv(null, { consecutiveFailures: 9 })));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.freshness.level, "L3");
  assert.equal(body.mode, "snapshot");
  assert.equal(body.source, "snapshot");
  assert.deepEqual(body.coins, {});
  assert.equal(body.freshness.consecutiveFailures, 9, "health 摘要应透传至 freshness");
  assert.equal(body.staleAgeSec, null, "F6-39: 无 blob 时 staleAgeSec 必须为 null（未知），不得伪装 0");
  assert.equal(body.coverage.expected, 4, "F6-39: expected 填可得的真实期望（ids 数）");
  assert.equal(body.coverage.returned, 0);
  assert.deepEqual([...body.coverage.missingIds].sort(), ["bitcoin", "ethereum", "filecoin", "solana"]);
  assert.equal(res.headers.get("cache-control"), "no-store", "F6-32: snapshot 应答 no-store");
});

await test("v2 时钟钳制+F6-05: fetchedAt 在未来 120s → staleAgeSec 钳为 0、clockSkew=true、level 封顶 L1（不再冒充 L0/live）", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const blob = makeBlob({ fetchedAtMs: T0 + 120000, globalAsOfMs: T0 + 120000 });
  const res = await mod.onRequestGet(ctx(kvEnv(blob)));
  const body = await res.json();
  assert.equal(body.staleAgeSec, 0);
  assert.equal(body.freshness.clockSkew, true, "freshness 必须暴露 clockSkew:true");
  assert.equal(body.freshness.level, "L1", "CLOCK_SKEW 时 level 不高于 L1");
  assert.equal(body.mode, "delayed");
  assert.equal(body.stale, true);
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

await test("v2 dual 模式: 对外仍 legacy 结果（走抓取路径），KV 差异仅日志；F6-83: 人为价差 1% → 中位数日志为非零期望值", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const jr = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/data/coins.json")) return jr({ coins: [{ coingeckoId: "bitcoin" }, { coingeckoId: "ethereum" }, { coingeckoId: "solana" }, { coingeckoId: "filecoin" }] });
    if (u.includes("/coins/markets"))
      // F6-83：legacy 侧价格人为设为 KV 侧（100+i）的 1.01 倍 → 相对价差恒 1/101≈0.00990099
      return jr(["bitcoin", "ethereum", "solana", "filecoin"].map((id, i) => ({ id, current_price: (100 + i) * 1.01, market_cap: 1000000 + i, market_cap_rank: i + 1, price_change_percentage_24h_in_currency: 1.5 })));
    if (u.includes("/global")) return jr({ data: { total_market_cap: { usd: 999 }, market_cap_percentage: { btc: 55 }, market_cap_change_percentage_24h_usd: 1 } });
    throw new Error("unexpected " + u);
  };
  const env = { ...kvEnv(makeBlob({})), BOARD_READ_MODE: "dual", COINGECKO_API_KEY: "test-key-not-real" };
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  let res;
  try {
    res = await mod.onRequestGet(ctx(env));
  } finally {
    console.log = origLog;
  }
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.contractVersion, undefined, "dual 对外是 legacy 契约（无 contractVersion）");
  const cmp = logs.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean).find((o) => o.event === "dual_compare");
  assert.ok(cmp, "必须有 dual_compare 日志");
  assert.equal(cmp.compared, 4);
  assert.ok(Math.abs(cmp.priceDiffMedian - 1 / 101) < 1e-9, `价差中位数应为 1/101≈0.00990099，实际 ${cmp.priceDiffMedian}`);
});

await test("v2 dual 模式 + rows 形态 coins.json（W3-22）: getIds 解码 rows、对外仍 legacy 结果", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const FIELDS = ["table", "estRank", "rankNow", "rankNote", "name", "symbol", "coingeckoId", "snapshotPrice", "snapshotMcapUsd", "snapshotMcapRaw", "athPrice", "athDate", "athFlag", "estLo", "estHi", "multLo", "multHi", "impliedMcapLoUsd", "impliedMcapHiUsd", "impliedMcapRaw", "confidence", "reason", "dataDate"];
  // F6-79：本地 FIELDS23 副本必须与产物 data/coins.json 的 meta.fields 运行时对账，漂移即红。
  const coinsJson = JSON.parse(readFileSync(new URL("../data/coins.json", import.meta.url), "utf-8"));
  assert.deepEqual(FIELDS, coinsJson.meta.fields, "FIELDS23 副本与 data/coins.json meta.fields 漂移——以产物 meta 为准更新副本");
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
  const env = { ...kvEnv(makeBlob({})), BOARD_READ_MODE: "dual", COINGECKO_API_KEY: "test-key-not-real" };
  const res = await mod.onRequestGet(ctx(env));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.contractVersion, undefined, "dual 对外是 legacy 契约（无 contractVersion）");
  assert.equal(body.coins.bitcoin.volume24h, 9000, "W3-25: legacy 路径 total_volume → volume24h");
});

function makeBigBlob(n, { missing = [], fetchedAtMs = T0 } = {}) {
  const missingSet = new Set(missing);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const id = `coin-${i}`;
    if (missingSet.has(id)) continue;
    rows.push({ id, price: 10 + i, mcapUsd: 1000 + i, rank: i + 1, change24h: 0.5, volume24h: 100 + i, _src: "coingecko" });
  }
  return buildBlob({
    source: "coingecko",
    fetchRunId: "big-run",
    fetchedAtMs,
    rows,
    coverage: { expected: n, returned: rows.length, missingIds: missing },
    global: null,
    fetchMeta: { durationMs: 1, upstreamStatus: { markets: 200, global: null }, attempts: { markets: 1, global: 0 }, quota: { month: "2026-11", creditsUsedEst: 1, quotaMode: "normal" } },
  });
}

await test("F6-17: volume24h 缺失的旧 blob 行 → 输出 volume24h=null（键在位）", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const blob = makeBlob({});
  for (const r of blob.rows) delete r.volume24h;
  const res = await mod.onRequestGet(ctx(kvEnv(blob)));
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.ok("volume24h" in body.coins.bitcoin);
  assert.equal(body.coins.bitcoin.volume24h, null);
  assert.equal(body.coins.bitcoin.price, 100);
});

await test("F6-18: 整行多字段 null（rank/price/volume24h 均 null，100 行中 1 行）→ board 不抛错、占位为 null", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const blob = makeBigBlob(100);
  const row = blob.rows.find((r) => r.id === "coin-50");
  row.price = null;
  row.rank = null;
  row.volume24h = null;
  const res = await mod.onRequestGet(ctx(kvEnv(blob)));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, 100);
  assert.deepEqual(body.coins["coin-50"], { price: null, mcapUsd: 1050, rank: null, change24h: 0.5, volume24h: null });
});

await test("F6-83: 200 行 blob 走 kv 路径 → count/coverage 均按 200 行重算一致", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const res = await mod.onRequestGet(ctx(kvEnv(makeBigBlob(200))));
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.count, 200);
  assert.equal(Object.keys(body.coins).length, 200);
  assert.deepEqual(body.coverage, { expected: 200, returned: 200, missingIds: [] });
});

await test("F6-30: L3 分支 missingIds = 真缺失（200 期望、190 在场、老化 7h）→ 只含 10 个缺失 id、在场 id 不入列", async () => {
  const mod = await freshBoard();
  Date.now = () => T0 + 7 * 3600 * 1000;
  const missing = Array.from({ length: 10 }, (_, i) => `coin-${190 + i}`);
  const res = await mod.onRequestGet(ctx(kvEnv(makeBigBlob(200, { missing }))));
  const body = await res.json();
  assert.equal(body.mode, "snapshot");
  assert.equal(body.freshness.level, "L3");
  assert.equal(body.coverage.expected, 200);
  assert.equal(body.coverage.returned, 0);
  assert.deepEqual([...body.coverage.missingIds].sort(), [...missing].sort());
  assert.ok(!body.coverage.missingIds.includes("coin-0"), "在场 id 绝不得出现在 missingIds");
});

await test("F6-04: blob 自报 returned=4 但 rows 仅 3 行 → 读端拒绝假绿（落 snapshot、count=0）", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const blob = makeBlob({});
  blob.rows = blob.rows.slice(0, 3); // coverage 仍自报 {expected:4, returned:4, missingIds:[]}
  globalThis.fetch = async (url) => {
    if (String(url).includes("/data/coins.json")) {
      return new Response(JSON.stringify({ coins: ["bitcoin", "ethereum", "solana", "filecoin"].map((id) => ({ coingeckoId: id })) }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("unexpected " + url);
  };
  const res = await mod.onRequestGet(ctx(kvEnv(blob)));
  const body = await res.json();
  assert.equal(body.mode, "snapshot", "计数与 rows 不一致的 blob 不得端出 live");
  assert.equal(body.count, 0);
});

await test("F6-35（board 侧）: fetchedAt 新、marketsUpdatedAt 2h 前 → board 仍 live/L0、staleAgeSec 按 fetchedAt=600（分裂形态留痕，health 侧按 staleAgeSec 对齐）", async () => {
  const mod = await freshBoard();
  Date.now = () => T0 + 600 * 1000;
  const blob = makeBlob({});
  blob.marketsUpdatedAt = new Date(T0 - 2 * 3600 * 1000).toISOString();
  const res = await mod.onRequestGet(ctx(kvEnv(blob)));
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.freshness.level, "L0");
  assert.equal(body.staleAgeSec, 600);
  assert.equal(body.updatedAt, T0 - 2 * 3600 * 1000, "updatedAt 仍取 marketsUpdatedAt（语义不改，前端展示用）");
});

await test("F6-41: 对外 fetch 只保留 fetchRunId（无 upstreamStatus/attempts/durationMs）", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const res = await mod.onRequestGet(ctx(kvEnv(makeBlob({}))));
  const body = await res.json();
  assert.deepEqual(body.fetch, { fetchRunId: "test-run-1" });
});

await test("F6-40: 先 Cache 命中回填 MEM_BLOB、后 KV 与 Cache 双坏 → servedFrom=memory", async () => {
  const mod = await freshBoard();
  Date.now = () => T0;
  const blob = makeBlob({});
  let stored = null;
  let cacheEmpty = true;
  let kvDown = false;
  globalThis.caches = {
    default: {
      async match() {
        return !cacheEmpty && stored ? new Response(JSON.stringify(stored), { headers: { "content-type": "application/json" } }) : null;
      },
      async put(_key, res) {
        stored = await res.json();
        cacheEmpty = false;
      },
    },
  };
  const env = {
    BOARD_READ_MODE: "kv",
    BOARD_KV: {
      async get(key) {
        if (kvDown) throw new Error("kv down");
        if (key === "v1:board:current") return blob;
        return null;
      },
    },
  };
  try {
    const r1 = await (await mod.onRequestGet(ctx(env))).json();
    assert.equal(r1.freshness.servedFrom, "kv");
    kvDown = true; // KV 坏、Cache 仍命中 → cache 层（并回填 MEM_BLOB）
    const r2 = await (await mod.onRequestGet(ctx(env))).json();
    assert.equal(r2.freshness.servedFrom, "cache");
    cacheEmpty = true; // Cache 过期 + KV 仍坏 → 内存 last-good
    const r3 = await (await mod.onRequestGet(ctx(env))).json();
    assert.equal(r3.freshness.servedFrom, "memory", "Cache 命中回填后双坏应走 memory 而非 snapshot");
    assert.equal(r3.count, 4);
  } finally {
    delete globalThis.caches;
  }
});

Date.now = originalDateNow;
globalThis.fetch = originalFetch;
const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
