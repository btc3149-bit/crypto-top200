// tests/legacy-credits.test.mjs — W5 legacy 实测计量（W4-02 计数键激活）
// 口径：board.js legacy 路径每轮真实回源（markets+global 同发）给 KV 键
// v1:meta:legacy-credits 累加 2 credits（结构 {month, credits, updatedAt}，跨月重置）；
// kv 路径不计数；计数写失败不影响主流程。设计沿用 prep/w402-w406-w415 的 W4-02 方案，
// 约定突破经用户 2026-11-23 批准（见 board.js 注释）。
// 运行：node tests/legacy-credits.test.mjs
import assert from "node:assert/strict";
import { KV_KEYS } from "../shared/board-schema.js";

const IDS = ["bitcoin", "ethereum", "solana", "filecoin"];
const originalFetch = globalThis.fetch;
let seq = 0;
async function freshBoard() {
  seq += 1;
  const url = new URL("../functions/api/board.js", import.meta.url);
  url.searchParams.set("case", `lc-${seq}-${Date.now()}-${Math.random()}`);
  return import(url.href);
}
function jsonRes(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
function makeKv({ failLegacyPut = false } = {}) {
  const store = new Map();
  const puts = [];
  return {
    store, puts,
    async get(key, opts) {
      const v = store.get(key);
      if (v == null) return null;
      return opts && opts.type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) {
      if (failLegacyPut && key === KV_KEYS.legacyCredits) throw new Error("kv put failed (test)");
      puts.push(key);
      store.set(key, String(value));
    },
  };
}
function installFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/data/coins.json")) return jsonRes({ coins: IDS.map((id) => ({ coingeckoId: id })) });
    if (u.includes("/coins/markets")) return jsonRes(IDS.map((id, i) => ({ id, current_price: 100 + i, market_cap: 1000000 + i, market_cap_rank: i + 1, price_change_percentage_24h_in_currency: 1.5 })));
    if (u.includes("/global")) return jsonRes({ data: { total_market_cap: { usd: 999 }, market_cap_percentage: { btc: 55 }, market_cap_change_percentage_24h_usd: 1 } });
    throw new Error("unexpected fetch: " + u);
  };
}
function ctx(env) { return { request: new Request("https://example.com/api/board", { method: "GET" }), env, waitUntil: () => {} }; }
const counterOf = (kv) => { const raw = kv.store.get(KV_KEYS.legacyCredits); return raw ? JSON.parse(raw) : null; };

try {
  installFetch();
  // 1) legacy 成功回源一轮 → +2
  {
    const mod = await freshBoard();
    const kv = makeKv();
    const res = await mod.onRequestGet(ctx({ BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, "live");
    const c = counterOf(kv);
    assert.ok(c, "legacy 回源后计数键应存在");
    assert.equal(c.credits, 2);
    assert.equal(c.month, new Date().toISOString().slice(0, 7));
    assert.ok(typeof c.updatedAt === "string" && c.updatedAt);
    console.log("PASS 1 legacy 回源一轮计数 +2，结构 {month,credits,updatedAt}");
  }
  // 2) 新一轮回源（新模块实例、同一 KV）→ 累加到 4；同实例缓存命中不重复计
  {
    const kv = makeKv();
    const mod = await freshBoard();
    const env = { BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv };
    await (await mod.onRequestGet(ctx(env))).json();
    await (await mod.onRequestGet(ctx(env))).json(); // 120s 缓存命中
    assert.equal(counterOf(kv).credits, 2, "缓存命中不得重复计数");
    const mod2 = await freshBoard();
    await (await mod2.onRequestGet(ctx(env))).json();
    assert.equal(counterOf(kv).credits, 4);
    console.log("PASS 2 缓存命中不计、下一轮真实回源累加到 4");
  }
  // 3) 跨月旧计数 → 从 0 重置累加
  {
    const mod = await freshBoard();
    const kv = makeKv();
    kv.store.set(KV_KEYS.legacyCredits, JSON.stringify({ month: "2000-01", credits: 999, updatedAt: "2000-01-01T00:00:00.000Z" }));
    await (await mod.onRequestGet(ctx({ BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }))).json();
    assert.equal(counterOf(kv).credits, 2);
    console.log("PASS 3 跨月自动重置");
  }
  // 4) kv 模式 → 不回源、不计数、无计数键写
  {
    const mod = await freshBoard();
    const kv = makeKv();
    const res = await mod.onRequestGet(ctx({ BOARD_READ_MODE: "kv", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }));
    assert.equal(res.status, 200);
    assert.equal(counterOf(kv), null);
    assert.ok(!kv.puts.includes(KV_KEYS.legacyCredits));
    console.log("PASS 4 kv 模式不计数（现行生产计数应恒为 0）");
  }
  // 5) 计数写失败 → 主流程仍 live
  {
    const mod = await freshBoard();
    const kv = makeKv({ failLegacyPut: true });
    const res = await mod.onRequestGet(ctx({ BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).mode, "live");
    console.log("PASS 5 计数写失败不影响主流程");
  }
  console.log("\n=== 5/5 passed ===");
} finally {
  globalThis.fetch = originalFetch;
}
