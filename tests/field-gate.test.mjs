// tests/field-gate.test.mjs — W4-08 字段级非空率门禁测试（Node 24）
// 口径（shared/board-schema.js fieldQualityFor，阈值 FIELD_NONEMPTY_MIN_RATIO=0.99）：
//   fail 档（价格/市值/rank 任一非空率 <99%）：fetcher 拒绝写 blob + health 记错误；
//     board legacy 抛错走 stale/快照降级；KV blob 被 validateBlob 判 invalid。
//   warn 档（≥99% 但 <100%）：照常出数 + WARN 口径可见（fieldQuality.status="warn"）。
// 关键用例：200 币 2 个 rank=null（=99%，2026-11-13 实测形态）→ WARN；价格全 null → 不得 pass。
// 运行：node tests/field-gate.test.mjs

import assert from "node:assert/strict";
import { buildBlob, validateBlob, fieldQualityFor, FIELD_NONEMPTY_MIN_RATIO } from "../shared/board-schema.js";
import { runFetch } from "../workers/fetcher/src/index.js";
import { KV_KEYS } from "../shared/board-schema.js";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

let seq = 0;
async function freshBoard() {
  seq += 1;
  const url = new URL("../functions/api/board.js", import.meta.url);
  url.searchParams.set("case", `fg-${seq}-${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function jsonRes(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------- 200 行 blob 构造（buildBlob 单入口） ----------
function makeBlob200({ nullRankIdx = new Set(), nullPriceAll = false } = {}) {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    id: `coin-${i}`,
    price: nullPriceAll ? null : 100 + i,
    mcapUsd: 1000000 + i,
    rank: nullRankIdx.has(i) ? null : i + 1,
    change24h: 1.0,
    _src: "coingecko",
  }));
  return buildBlob({
    source: "coingecko",
    fetchRunId: "fg-run",
    fetchedAtMs: Date.now(),
    rows,
    coverage: { expected: 200, returned: 200, missingIds: [], ratio: 1 },
    global: {
      totalMarketCapUsd: 999,
      btcDominancePct: 55,
      totalMcapChange24h: 1,
      asOf: new Date().toISOString(),
      _src: "coingecko",
    },
    fetchMeta: { durationMs: 1, upstreamStatus: { markets: 200, global: 200 }, attempts: { markets: 1, global: 1 }, quota: { month: "2026-11", creditsUsedEst: 1, quotaMode: "normal" } },
    healthSummary: { consecutiveFailures: 0, lastSuccessAt: new Date().toISOString() },
  });
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

// ---------- validateBlob / fieldQualityFor ----------
await test("① 200 币 2 个 rank=null → WARN 口径（validateBlob ok、warnings 含 field_quality_warn、rate=0.99）", async () => {
  assert.equal(FIELD_NONEMPTY_MIN_RATIO, 0.99);
  const blob = makeBlob200({ nullRankIdx: new Set([5, 100]) });
  const fq = fieldQualityFor(blob.rows);
  assert.equal(fq.status, "warn");
  assert.equal(fq.rates.rank, 0.99);
  assert.equal(fq.rates.price, 1);
  assert.deepEqual(fq.warnFields, ["rank"]);
  assert.deepEqual(fq.failingFields, []);
  const v = validateBlob(blob);
  assert.equal(v.ok, true, "warn 档不得拦 blob");
  assert.ok(v.warnings.includes("field_quality_warn"), `warnings 应含 field_quality_warn，实际 ${v.warnings}`);
});

await test("② 价格全 null 的 blob → validateBlob 不得 pass（field_nonempty_below_gate）", async () => {
  const blob = makeBlob200({ nullPriceAll: true });
  const fq = fieldQualityFor(blob.rows);
  assert.equal(fq.status, "fail");
  assert.equal(fq.rates.price, 0);
  const v = validateBlob(blob);
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("field_nonempty_below_gate"), `errors 应含 field_nonempty_below_gate，实际 ${v.errors}`);
});

await test("③ 字段全齐的 blob → pass 且无 field 警告", async () => {
  const blob = makeBlob200({});
  assert.equal(fieldQualityFor(blob.rows).status, "pass");
  const v = validateBlob(blob);
  assert.equal(v.ok, true);
  assert.ok(!v.warnings.includes("field_quality_warn"));
  assert.ok(!v.errors.includes("field_nonempty_below_gate"));
});

// ---------- board KV 路径 ----------
function kvCtx(blob) {
  return {
    request: new Request("https://example.com/api/board", { method: "GET" }),
    env: {
      BOARD_READ_MODE: "kv",
      BOARD_KV: {
        async get(key) {
          if (key === KV_KEYS.current) return blob;
          return null;
        },
      },
    },
    waitUntil: () => {},
  };
}

await test("④ board KV：200 币 2 个 rank=null 的 blob → 照常出数 + fieldQuality.status=warn 透出", async () => {
  const mod = await freshBoard();
  const res = await mod.onRequestGet(kvCtx(makeBlob200({ nullRankIdx: new Set([5, 100]) })));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.count, 200);
  assert.equal(body.fieldQuality.status, "warn");
  assert.equal(body.fieldQuality.rates.rank, 0.99);
});

await test("⑤ board KV：价格全 null 的 blob → validateBlob 拦截 → 降级 snapshot（coins 空）", async () => {
  const mod = await freshBoard();
  const res = await mod.onRequestGet(kvCtx(makeBlob200({ nullPriceAll: true })));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "snapshot");
  assert.deepEqual(body.coins, {});
  assert.equal(body.count, 0);
});

// ---------- board legacy 路径 ----------
const IDS4 = ["bitcoin", "ethereum", "solana", "filecoin"];
function installLegacyFetch({ priceNull = false } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/data/coins.json")) return jsonRes({ coins: IDS4.map((id) => ({ coingeckoId: id })) });
    if (u.includes("/coins/markets")) {
      return jsonRes(
        IDS4.map((id, i) => ({
          id,
          current_price: priceNull ? null : 100 + i,
          market_cap: 1000000 + i,
          market_cap_rank: i + 1,
          price_change_percentage_24h_in_currency: 1.5,
        }))
      );
    }
    if (u.includes("/global")) {
      return jsonRes({ data: { total_market_cap: { usd: 999 }, market_cap_percentage: { btc: 55 }, market_cap_change_percentage_24h_usd: 1 } });
    }
    throw new Error("unexpected fetch: " + u);
  };
}

await test("⑥ board legacy：价格全 null（id 数齐、旧门禁会 pass）→ 不得 live，走快照降级", async () => {
  const mod = await freshBoard();
  installLegacyFetch({ priceNull: true });
  const res = await mod.onRequestGet({
    request: new Request("https://example.com/api/board", { method: "GET" }),
    env: {},
    waitUntil: () => {},
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "snapshot");
  assert.deepEqual(body.coins, {});
});

await test("⑦ board legacy：字段全齐 → live + fieldQuality.status=pass", async () => {
  const mod = await freshBoard();
  installLegacyFetch({});
  const res = await mod.onRequestGet({
    request: new Request("https://example.com/api/board", { method: "GET" }),
    env: {},
    waitUntil: () => {},
  });
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.fieldQuality.status, "pass");
});

// ---------- fetcher 写前校验 ----------
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
const GLOBAL_PAYLOAD = { data: { total_market_cap: { usd: 999 }, market_cap_percentage: { btc: 55 }, market_cap_change_percentage_24h_usd: 1 } };

function installCgFetch({ mutate } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/coins/markets")) {
      let requested = IDS4;
      try {
        const p = new URL(u).searchParams.get("ids");
        if (p) requested = p.split(",");
      } catch (_) {}
      const payload = requested.map((id, i) => ({
        id,
        current_price: 100 + i,
        market_cap: 1000000 + i,
        market_cap_rank: i + 1,
        price_change_percentage_24h_in_currency: 1.5,
      }));
      if (mutate) mutate(payload);
      return jsonRes(payload);
    }
    if (u.includes("/global")) return jsonRes(GLOBAL_PAYLOAD);
    throw new Error("unexpected fetch: " + u);
  };
}
const COINS4 = IDS4.map((id) => ({ id, paprikaId: null }));

await test("⑧ fetcher：价格全 null → 拒绝写 blob + health 记 field_quality_insufficient", async () => {
  const kv = makeKv();
  installCgFetch({ mutate: (p) => p.forEach((m) => (m.current_price = null)) });
  const env = { BOARD_KV: kv, COINGECKO_API_KEY: "test-key-not-real", PAPRIKA_ENABLED: "false" };
  const r = await runFetch(env, { coins: COINS4, ids: IDS4, nowMs: Date.UTC(2026, 10, 13, 12) });
  assert.equal(r.ok, false);
  assert.equal(r.code, "field_quality_insufficient");
  assert.equal(r.stage, "validate");
  assert.ok(!kv.store.has(KV_KEYS.current), "坏 blob 不得写入 current");
  const health = JSON.parse(kv.store.get(KV_KEYS.health));
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(health.lastError.code, "field_quality_insufficient");
});

await test("⑨ fetcher：100 币 1 个 rank=null（99%，warn 档）→ 照常写 blob、不记失败", async () => {
  const kv = makeKv();
  const ids100 = Array.from({ length: 100 }, (_, i) => `coin-${i}`);
  const coins100 = ids100.map((id) => ({ id, paprikaId: null }));
  installCgFetch({
    mutate: (p) => {
      p[7].market_cap_rank = null;
    },
  });
  const env = { BOARD_KV: kv, COINGECKO_API_KEY: "test-key-not-real", PAPRIKA_ENABLED: "false" };
  const r = await runFetch(env, { coins: coins100, ids: ids100, nowMs: Date.UTC(2026, 10, 13, 12) });
  assert.equal(r.ok, true, `warn 档应放行，实际 ${JSON.stringify(r)}`);
  const blob = JSON.parse(kv.store.get(KV_KEYS.current));
  assert.equal(blob.rows.length, 100);
  assert.equal(blob.rows[7].rank, null);
  const health = JSON.parse(kv.store.get(KV_KEYS.health));
  assert.equal(health.consecutiveFailures, 0);
});

globalThis.fetch = originalFetch;
Date.now = originalDateNow;
const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
