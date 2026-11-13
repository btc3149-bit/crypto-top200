// tests/sfs-enforce.test.mjs — W4-15 Sec-Fetch-Site 转正测试（Node 24）
// ENFORCE_SFS=true 后：仅显式 cross-site 被拦（403）；same-origin / same-site / none /
// 缺失 Sec-Fetch-Site 头的正常请求一律放行并走通 legacy live 路径。
// 沿用 board.test.mjs harness：mock globalThis.fetch、动态 import 隔离模块实例。
// 运行：node tests/sfs-enforce.test.mjs

import assert from "node:assert/strict";

const IDS = ["bitcoin", "ethereum", "solana", "filecoin"];
const originalFetch = globalThis.fetch;

let seq = 0;
async function freshBoard() {
  seq += 1;
  const url = new URL("../functions/api/board.js", import.meta.url);
  url.searchParams.set("case", `sfs-${seq}-${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function jsonRes(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch() {
  const counts = { markets: 0, global: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/data/coins.json")) {
      return jsonRes({ coins: IDS.map((id) => ({ coingeckoId: id })) });
    }
    if (u.includes("/coins/markets")) {
      counts.markets += 1;
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
      return jsonRes({
        data: {
          total_market_cap: { usd: 999 },
          market_cap_percentage: { btc: 55 },
          market_cap_change_percentage_24h_usd: 1,
        },
      });
    }
    throw new Error("unexpected fetch: " + u);
  };
  return counts;
}

function ctxWithSfs(sfs, { viaOnRequest = false } = {}) {
  const headers = {};
  if (sfs != null) headers["Sec-Fetch-Site"] = sfs;
  return {
    request: new Request("https://example.com/api/board", { method: "GET", headers }),
    env: {},
    waitUntil: () => {},
    viaOnRequest,
  };
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

await test("① 显式 cross-site → 403 forbidden_cross_site 且不打上游", async () => {
  const mod = await freshBoard();
  const counts = installFetch();
  const res = await mod.onRequestGet(ctxWithSfs("cross-site"));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "forbidden_cross_site" });
  assert.equal(counts.markets, 0, "被拦请求不得触发上游抓取");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

await test("② cross-site 经 onRequest 兜底入口同样 403", async () => {
  const mod = await freshBoard();
  installFetch();
  const res = await mod.onRequest(ctxWithSfs("cross-site"));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "forbidden_cross_site" });
});

await test("③ same-origin → 放行（200 live）", async () => {
  const mod = await freshBoard();
  installFetch();
  const res = await mod.onRequestGet(ctxWithSfs("same-origin"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "live");
  assert.equal(body.count, IDS.length);
});

await test("④ same-site → 放行（仅拦显式 cross-site）", async () => {
  const mod = await freshBoard();
  installFetch();
  const res = await mod.onRequestGet(ctxWithSfs("same-site"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).mode, "live");
});

await test("⑤ none（用户直达/书签等）→ 放行", async () => {
  const mod = await freshBoard();
  installFetch();
  const res = await mod.onRequestGet(ctxWithSfs("none"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).mode, "live");
});

await test("⑥ 缺失 Sec-Fetch-Site 头（老客户端/探针/脚本）→ 放行", async () => {
  const mod = await freshBoard();
  installFetch();
  const res = await mod.onRequestGet(ctxWithSfs(null));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).mode, "live");
});

globalThis.fetch = originalFetch;
const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
