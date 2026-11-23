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
// F7-30：fetch 行为开关（markets 失败形态），默认全成功与旧用例一致
const fetchBehavior = { markets: "ok" }; // ok | http500 | throw | rate429
function installFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/data/coins.json")) return jsonRes({ coins: IDS.map((id) => ({ coingeckoId: id })) });
    if (u.includes("/coins/markets")) {
      if (fetchBehavior.markets === "http500") return jsonRes({ error: "boom" }, { status: 500 });
      if (fetchBehavior.markets === "throw") throw new Error("network down (test)");
      if (fetchBehavior.markets === "rate429") return jsonRes({ error: "rate" }, { status: 429, headers: { "retry-after": "120" } });
      return jsonRes(IDS.map((id, i) => ({ id, current_price: 100 + i, market_cap: 1000000 + i, market_cap_rank: i + 1, price_change_percentage_24h_in_currency: 1.5 })));
    }
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
  // ---------- F7-10/F7-30：计数时机关键口径（按已发出计、与成败无关） ----------
  // 6) markets 失败（HTTP 500 / 网络抛错）→ 主流程回退，但已发出仍 +2
  // F8-32：两子例合并为单行 PASS 输出（旧实现每子例一行、自报 14 项却 15 行 PASS）；
  // 子断言仍逐个执行，任一失败照常抛错使整项 FAIL。
  for (const [label, behavior] of [["HTTP 500", "http500"], ["网络抛错", "throw"]]) {
    fetchBehavior.markets = behavior;
    const mod = await freshBoard();
    const kv = makeKv();
    const res = await mod.onRequestGet(ctx({ BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }));
    assert.notEqual((await res.clone().json()).mode, "live", `${label} 时不应为 live`);
    assert.equal(counterOf(kv)?.credits, 2, `${label}：请求已发出应仍计数 +2（与成败无关）`);
  }
  fetchBehavior.markets = "ok";
  console.log("PASS 6 markets 失败（HTTP 500/网络抛错）仍计数 +2");
  // 7) 熔断短路不计数：首轮 429 触发熔断（该轮已发出计 +2），熔断期内第二轮不再发请求、不得再计
  {
    fetchBehavior.markets = "rate429";
    const mod = await freshBoard();
    const kv = makeKv();
    const env = { BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv };
    const r1 = await mod.onRequestGet(ctx(env));
    assert.equal(r1.status, 503, "429 且无缓存应 503 upstream_unavailable");
    assert.equal(counterOf(kv)?.credits, 2, "触发熔断的一轮已发出，应计 +2");
    const r2 = await mod.onRequestGet(ctx(env));
    assert.equal(r2.status, 503, "熔断期内应直接 503 短路");
    assert.equal(counterOf(kv)?.credits, 2, "熔断短路未发请求，不得计数");
    console.log("PASS 7 熔断短路不计数（首轮 429 计 +2、期内第二轮仍 2）");
  }
  fetchBehavior.markets = "ok";
  // 8) F7-11: prev 坏值钳制自愈（负数 / 异常大 / 字符串）→ base 归 0、本轮 +2
  for (const bad of [-50, 1e12, "999"]) {
    const mod = await freshBoard();
    const kv = makeKv();
    kv.store.set(KV_KEYS.legacyCredits, JSON.stringify({ month: new Date().toISOString().slice(0, 7), credits: bad, updatedAt: new Date().toISOString() }));
    await (await mod.onRequestGet(ctx({ BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }))).json();
    assert.equal(counterOf(kv).credits, 2, `prev=${JSON.stringify(bad)} 应钳制为 0 后 +2`);
  }
  console.log("PASS 8 prev 坏值（负/异常大/字符串）钳制自愈");
  // 9) F7-42: 写节流 + pending 累积——间隔内不落 KV、到期后一并 flush
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
    console.log("PASS 9 计数写节流 60s + pending 累积 flush");
  }
  // 10) 旧计数键 credits 为字符串 → 回退为 0 基数（不把字符串当数累加、不崩溃）
  {
    const mod = await freshBoard();
    const kv = makeKv();
    const month = new Date().toISOString().slice(0, 7);
    kv.store.set(KV_KEYS.legacyCredits, JSON.stringify({ month, credits: "42", updatedAt: "2026-01-01T00:00:00.000Z" }));
    await (await mod.onRequestGet(ctx({ BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }))).json();
    assert.equal(counterOf(kv)?.credits, 2, "credits 为字符串应回退 0 基数后 +2");
    console.log("PASS 10 旧键 credits 为字符串 → 回退 0 基数");
  }
  // 11) 旧计数键 JSON 损坏 → 回退为 0 基数
  {
    const mod = await freshBoard();
    const kv = makeKv();
    kv.store.set(KV_KEYS.legacyCredits, "{not-json");
    await (await mod.onRequestGet(ctx({ BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }))).json();
    assert.equal(counterOf(kv)?.credits, 2, "JSON 损坏应回退 0 基数后 +2");
    console.log("PASS 11 旧键 JSON 损坏 → 回退 0 基数");
  }
  // 12) 旧计数键为 JSON 字符串形态（get 回字符串）→ board 内二次解析后按其 credits 累加
  {
    const mod = await freshBoard();
    const kv = makeKv();
    const month = new Date().toISOString().slice(0, 7);
    kv.store.set(KV_KEYS.legacyCredits, JSON.stringify(JSON.stringify({ month, credits: 40, updatedAt: "2026-01-01T00:00:00.000Z" })));
    await (await mod.onRequestGet(ctx({ BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }))).json();
    assert.equal(counterOf(kv)?.credits, 42, "字符串形态计数应被解析并累加 40+2");
    console.log("PASS 12 旧键为 JSON 字符串形态 → 解析后累加");
  }
  // 13) dual 模式同走 legacy 抓取路径 → 同样计数 +2
  {
    const mod = await freshBoard();
    const kv = makeKv();
    const res = await mod.onRequestGet(ctx({ BOARD_READ_MODE: "dual", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }));
    assert.equal(res.status, 200);
    assert.equal(counterOf(kv)?.credits, 2, "dual 回源一轮应计数 +2");
    console.log("PASS 13 dual 模式计数 +2");
  }
  // 14) F7-09: HEAD legacy 与 GET 同路 → 同样回源计数 +2、body 空
  {
    const mod = await freshBoard();
    const kv = makeKv();
    const res = await mod.onRequestHead({ request: new Request("https://example.com/api/board", { method: "HEAD" }), env: { BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }, waitUntil: () => {} });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "");
    assert.equal(counterOf(kv).credits, 2, "HEAD 与 GET 计数口径一致");
    console.log("PASS 14 HEAD legacy 计数 +2（F7-09）");
  }
  // 15) F8-10: KV put 永不返回 + 上游即时响应 → 请求须在限定时间内返回（计数超时吞掉、不阻塞行情、不留未处理 rejection）
  {
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const mod = await freshBoard();
      assert.equal(mod.LEGACY_CREDITS_KV_TIMEOUT_MS, 3500, "计数 KV 超时须与 UPSTREAM_TIMEOUT_MS=3500 对齐");
      const kv = makeKv();
      const origPut = kv.put.bind(kv);
      kv.put = (key, value) => (key === KV_KEYS.legacyCredits ? new Promise(() => {}) : origPut(key, value));
      const t0 = Date.now();
      const res = await mod.onRequestGet(ctx({ BOARD_READ_MODE: "legacy", COINGECKO_API_KEY: "test-key-not-real", BOARD_KV: kv }));
      const elapsed = Date.now() - t0;
      assert.equal(res.status, 200);
      assert.equal((await res.json()).mode, "live", "put 挂起时行情应答仍须 live 返回");
      assert.ok(elapsed < 8000, `put 永不返回时请求应在超时后返回（<8000ms），实际 ${elapsed}ms`);
      assert.ok(elapsed >= 3000, `应在约 3500ms 超时后才返回，实际 ${elapsed}ms（过早说明未真正等待/超时口径异常）`);
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(unhandled, [], "计数超时不得留下未处理 rejection");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    console.log("PASS 15 F8-10 KV put 永不返回 → 3500ms 超时吞掉、行情在限定时间内 live 返回");
  }
  console.log("\n=== 15/15 passed ===");
} finally {
  globalThis.fetch = originalFetch;
}
