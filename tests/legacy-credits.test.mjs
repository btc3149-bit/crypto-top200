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
  // 6) F7-10/F7-30 口径：markets 失败（已发出、成败无关）仍 +2；熔断短路不计数
  {
    installFetch();
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/data/coins.json")) return jsonRes({ coins: IDS.map((id) => ({ coingeckoId: id })) });
      if (u.includes("/coins/markets")) return jsonRes({ error: "boom" }, { status: 500 });
      if (u.includes("/global")) return jsonRes({ data: { total_market_cap: { usd: 1 }, market_cap_percentage: { btc: 1 }, market_cap_change_percentage_24h_usd: 0 } });
      throw new Error("unexpected " + u);
    };
    const mod = await freshBoard();
    const kv = makeKv();
    const res = await mod.onRequestGet(ctx({ BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }));
    assert.equal(res.status, 200);
    assert.equal(counterOf(kv).credits, 2, "请求已发出即计、与成败无关");
    console.log("PASS 6 markets 失败仍 +2（已发出即计）");
    installFetch();
  }
  // 7) F7-11: prev 坏值钳制自愈（负数 / 异常大 / 字符串）→ base 归 0、本轮 +2
  for (const bad of [-50, 1e12, "999"]) {
    const mod = await freshBoard();
    const kv = makeKv();
    kv.store.set(KV_KEYS.legacyCredits, JSON.stringify({ month: new Date().toISOString().slice(0, 7), credits: bad, updatedAt: new Date().toISOString() }));
    await (await mod.onRequestGet(ctx({ BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }))).json();
    assert.equal(counterOf(kv).credits, 2, `prev=${JSON.stringify(bad)} 应钳制为 0 后 +2`);
  }
  console.log("PASS 7 prev 坏值（负/异常大/字符串）钳制自愈");
  // 8) F7-42: 写节流 + pending 累积——间隔内不落 KV、到期后一并 flush
  {
    const mod = await freshBoard();
    assert.equal(typeof mod.addLegacyCredits, "function");
    const kv = makeKv();
    const env = { BOARD_KV: kv };
    const realNow = Date.now;
    let fakeNow = realNow();
    Date.now = () => fakeNow;
    try {
      await mod.addLegacyCredits(env, 2);
      assert.equal(counterOf(kv).credits, 2);
      await mod.addLegacyCredits(env, 2); // 间隔内：pending 累积、不写 KV
      assert.equal(counterOf(kv).credits, 2, "节流间隔内不得再写 KV");
      fakeNow += 61 * 1000;
      await mod.addLegacyCredits(env, 2); // 到期：flush pending 2 + 本轮 2
      assert.equal(counterOf(kv).credits, 6, "pending 应在下一次到期计数时一并 flush（总量不丢）");
    } finally {
      Date.now = realNow;
    }
    console.log("PASS 8 计数写节流 60s + pending 累积 flush");
  }
  // 9) dual 模式同走 legacy 抓取路径 → 同样 +2
  {
    const mod = await freshBoard();
    const kv = makeKv();
    const res = await mod.onRequestGet(ctx({ BOARD_READ_MODE: "dual", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }));
    assert.equal(res.status, 200);
    assert.equal(counterOf(kv).credits, 2);
    console.log("PASS 9 dual 模式计数 +2（与 legacy 同口径）");
  }
  // 10) F7-09: HEAD legacy 与 GET 同路 → 同样回源计数 +2、body 空
  {
    const mod = await freshBoard();
    const kv = makeKv();
    const res = await mod.onRequestHead({ request: new Request("https://example.com/api/board", { method: "HEAD" }), env: { BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }, waitUntil: () => {} });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "");
    assert.equal(counterOf(kv).credits, 2, "HEAD 与 GET 计数口径一致");
    console.log("PASS 10 HEAD legacy 计数 +2（F7-09）");
  }
  console.log("\n=== 10/10 passed ===");
} finally {
  globalThis.fetch = originalFetch;
}
