// tests/health.test.mjs — F6-15：functions/api/health.js 端点套件（此前零覆盖）
// 仿 board-v2 mock 手法：覆写 globalThis.fetch 模拟 /api/board 应答，
// 覆盖正常 ok / 降级 / down 三态、board 不可达（KV 缺失的等价形态）、
// 负 ageSec（F6-05）、count 断言（F6-04）、契约版本断言（F6-03）、
// 判龄口径（F6-35）、内部 fetch 超时（F6-38）、敏感字段 grep、安全头（F6-33）。
import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
let seq = 0;
async function freshHealth() {
  seq += 1;
  const url = new URL("../functions/api/health.js", import.meta.url);
  url.searchParams.set("case", `h-${seq}-${Math.random()}`);
  return import(url.href);
}

function coinsObj(n) {
  const o = {};
  for (let i = 0; i < n; i++) o[`coin-${i}`] = { price: 1 };
  return o;
}
function boardBody(overrides = {}) {
  // F7-08 后 health 验 coins 本体：默认按 count/coverage 生成守恒的 coins，
  // 用例可用 overrides.coins 显式构造假汇总形态。
  const n =
    typeof overrides.count === "number"
      ? overrides.count
      : overrides.coverage && typeof overrides.coverage.returned === "number"
        ? overrides.coverage.returned
        : 200;
  return {
    contractVersion: 2,
    mode: "live",
    updatedAt: Date.now(),
    staleAgeSec: 60,
    coverage: { expected: 200, returned: 200, missingIds: [] },
    count: 200,
    coins: coinsObj(n),
    freshness: { level: "L0", clockSkew: false, fetchedAt: new Date().toISOString(), servedFrom: "kv" },
    ...overrides,
  };
}
function mockBoard(body, { status = 200 } = {}) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function ctx(env = {}) {
  return { request: new Request("https://example.com/api/health", { method: "GET" }), env, waitUntil: () => {} };
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

await test("health 正常 ok：v2 + 新鲜 + 200/200 + count 一致 → 200 ok:true、安全头齐全", async () => {
  const mod = await freshHealth();
  mockBoard(boardBody());
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.ageSec, 60);
  assert.deepEqual(body.coverage, { expected: 200, returned: 200 });
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("content-security-policy"), "default-src 'none'");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

await test("health 降级：staleAgeSec=1000（>900）→ 503 board_stale", async () => {
  const mod = await freshHealth();
  mockBoard(boardBody({ staleAgeSec: 1000, mode: "delayed" }));
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, "board_stale");
});

await test("health down：coverage 不全（190/200）→ 503 board_incomplete", async () => {
  const mod = await freshHealth();
  mockBoard(boardBody({ coverage: { expected: 200, returned: 190, missingIds: [] }, count: 190 }));
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "board_incomplete");
});

await test("health down：board HTTP 503（KV 缺失时 board 落 snapshot/不可用形态的上游等价）→ 503 board_http_error", async () => {
  const mod = await freshHealth();
  mockBoard({ error: "upstream_unavailable" }, { status: 503 });
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, "board_http_error");
});

await test("health down：board 为无 blob snapshot 应答（staleAgeSec=null、expected=null）→ 503", async () => {
  const mod = await freshHealth();
  mockBoard(boardBody({ mode: "snapshot", staleAgeSec: null, coverage: { expected: null, returned: 0, missingIds: [] }, count: 0 }));
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).ok, false);
});

await test("F6-05: updatedAt 在未来 3600s（无 staleAgeSec 可用）→ 503 board_clock_skew、ageSec 为负", async () => {
  const mod = await freshHealth();
  const body = boardBody({ updatedAt: Date.now() + 3600 * 1000 });
  delete body.staleAgeSec;
  mockBoard(body);
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 503);
  const out = await res.json();
  assert.equal(out.reason, "board_clock_skew");
  assert.ok(out.ageSec < -60, `ageSec 应为负，实际 ${out.ageSec}`);
});

await test("F6-05: board 自报 freshness.clockSkew=true → 503 board_clock_skew", async () => {
  const mod = await freshHealth();
  mockBoard(boardBody({ freshness: { level: "L1", clockSkew: true, fetchedAt: new Date(Date.now() + 120000).toISOString(), servedFrom: "kv" } }));
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "board_clock_skew");
});

await test("F6-04: count(199) ≠ coverage.returned(200) → 503 board_count_mismatch", async () => {
  const mod = await freshHealth();
  mockBoard(boardBody({ count: 199 }));
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "board_count_mismatch");
});

await test("F6-03: board 非契约 v2（legacy 应答无 contractVersion）→ 503 board_contract_version", async () => {
  const mod = await freshHealth();
  const body = boardBody();
  delete body.contractVersion;
  mockBoard(body);
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "board_contract_version");
});

await test("F6-35: fetchedAt 新（staleAgeSec=60）但 updatedAt 2h 前 → 按 staleAgeSec 判龄 → 200 ok（不再分裂假红）", async () => {
  const mod = await freshHealth();
  mockBoard(boardBody({ updatedAt: Date.now() - 2 * 3600 * 1000, staleAgeSec: 60 }));
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

await test("F6-38: board 内部 fetch 永不 resolve → 超时（测试覆写 50ms）内返回 503", async () => {
  const mod = await freshHealth();
  globalThis.fetch = (url, opts) =>
    new Promise((_, reject) => {
      if (opts && opts.signal) opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const t0 = Date.now();
  const res = await mod.onRequestGet(ctx({ HEALTH_BOARD_TIMEOUT_MS: "50" }));
  const elapsed = Date.now() - t0;
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "board_unreachable_or_invalid");
  assert.ok(elapsed < 5000, `应在超时内返回，实际 ${elapsed}ms`);
});

await test("health 安全：响应文本 grep 无 key/token 字样；HEAD 与 GET 同状态、body 空", async () => {
  const mod = await freshHealth();
  mockBoard(boardBody());
  const res = await mod.onRequestGet(ctx());
  const text = await res.text();
  for (const pat of ["COINGECKO_API_KEY", "x-cg-demo-api-key", "api_key", "apiKey", "token", "secret", "MANUAL_RUN_TOKEN"]) {
    assert.ok(!text.includes(pat), `health 响应不得含 ${pat}`);
  }
  const head = await mod.onRequestHead(ctx());
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

await test("F7-08: coins 为空但 coverage/count 自报满格（200/200/200）→ 503 board_coins_mismatch（汇总假绿封堵）", async () => {
  const mod = await freshHealth();
  mockBoard(boardBody({ coins: {} }));
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, "board_coins_mismatch");
  assert.equal(body.coinsCount, 0);
});

await test("F7-08: coins 字段缺失但汇总满格 → 503 board_coins_mismatch", async () => {
  const mod = await freshHealth();
  const b = boardBody();
  delete b.coins;
  mockBoard(b);
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "board_coins_mismatch");
});

await test("F7-08: coins 实际 199 个但 returned/count=200 → 503 board_coins_mismatch", async () => {
  const mod = await freshHealth();
  mockBoard(boardBody({ coins: coinsObj(199) }));
  const res = await mod.onRequestGet(ctx());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "board_coins_mismatch");
});

globalThis.fetch = originalFetch;
const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
