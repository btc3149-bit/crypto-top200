// tests/health.test.mjs — W4-06 health.js 全分支补测 + W4-02 quota 总账（Node 24）
// 通过覆写 globalThis.fetch 模拟 /api/board、env.BOARD_KV mock 模拟 fetcher health
// 与 legacy 计数键、覆写 Date.now 固定月份/年龄口径；动态 import + query 参数隔离模块。
// 运行：node tests/health.test.mjs

import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

let seq = 0;
async function freshHealth() {
  seq += 1;
  const url = new URL("../functions/api/health.js", import.meta.url);
  url.searchParams.set("case", `h-${seq}-${Date.now()}-${Math.random()}`);
  return import(url.href);
}

// 固定时刻：2026-11-11T00:00:00Z（UTC 日期号 11 → elapsedDays=11，本月 30 天）
const NOW = Date.UTC(2026, 10, 11, 0, 0, 0);

function jsonRes(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function boardBody({ ageSec = 0, expected = 200, returned = 200, updatedAt } = {}) {
  return {
    mode: "live",
    updatedAt: updatedAt !== undefined ? updatedAt : NOW - ageSec * 1000,
    coverage: { expected, returned },
  };
}

// behaviour: (url) => Response | throw —— 默认返回健康 board
function installFetch(behaviour) {
  globalThis.fetch = async (url) => {
    if (behaviour) return behaviour(String(url));
    return jsonRes(boardBody({}));
  };
}

function makeKvEnv({ fetcherHealth = null, legacy = null } = {}) {
  return {
    BOARD_KV: {
      async get(key) {
        if (key === "v1:meta:health") return fetcherHealth;
        if (key === "v1:meta:legacy-credits") return legacy;
        return null;
      },
    },
  };
}

function fetcherHealthWith({ credits = 0, quotaMode = "normal", month = "2026-11" } = {}) {
  return { quota: { month, creditsUsedEst: credits, quotaMode } };
}

function ctx(env = {}, { method = "GET" } = {}) {
  return { request: new Request("https://example.com/api/health", { method }), env, waitUntil: () => {} };
}

const results = [];
async function test(name, fn) {
  try {
    Date.now = () => NOW;
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

await test("① GET 健康（fresh+complete）→ 200 ok:true、阈值 900、quota 在场", async () => {
  const mod = await freshHealth();
  installFetch();
  const res = await mod.onRequestGet(ctx(makeKvEnv({})));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.mode, "live");
  assert.equal(body.ageSec, 0);
  assert.equal(body.freshnessThresholdSec, 900);
  assert.deepEqual(body.coverage, { expected: 200, returned: 200 });
  assert.ok(body.quota, "quota 总账字段必须在场");
  assert.equal(body.quota.legacyCounted, false);
});

await test("② GET 陈旧（age=1000 > 900，normal）→ 503", async () => {
  const mod = await freshHealth();
  installFetch(() => jsonRes(boardBody({ ageSec: 1000 })));
  const res = await mod.onRequestGet(ctx(makeKvEnv({})));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.ageSec, 1000);
  assert.equal(body.freshnessThresholdSec, 900);
});

await test("③ GET 覆盖不全（199/200）→ 503（统一口径：returned 必须等于 expected）", async () => {
  const mod = await freshHealth();
  installFetch(() => jsonRes(boardBody({ returned: 199 })));
  const res = await mod.onRequestGet(ctx(makeKvEnv({})));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).ok, false);
});

await test("④ GET 期望漂移（188/188）→ 503（expected 本身须为 200，防假绿）", async () => {
  const mod = await freshHealth();
  installFetch(() => jsonRes(boardBody({ expected: 188, returned: 188 })));
  const res = await mod.onRequestGet(ctx(makeKvEnv({})));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).ok, false);
});

await test("⑤ board HTTP 500 → 503 board_http_error + boardStatus + quota 仍在场", async () => {
  const mod = await freshHealth();
  installFetch(() => jsonRes({ error: "x" }, { status: 500 }));
  const res = await mod.onRequestGet(ctx(makeKvEnv({ fetcherHealth: fetcherHealthWith({ credits: 100 }) })));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.reason, "board_http_error");
  assert.equal(body.boardStatus, 500);
  assert.equal(body.quota.totalUsed, 100);
});

await test("⑥ board fetch 抛错 → 503 board_unreachable_or_invalid", async () => {
  const mod = await freshHealth();
  installFetch(() => {
    throw new Error("network down");
  });
  const res = await mod.onRequestGet(ctx(makeKvEnv({})));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "board_unreachable_or_invalid");
});

await test("⑦ board 返回非法 JSON → 503 board_unreachable_or_invalid", async () => {
  const mod = await freshHealth();
  installFetch(() => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("bad json");
    },
  }));
  const res = await mod.onRequestGet(ctx(makeKvEnv({})));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "board_unreachable_or_invalid");
});

await test("⑧ board 字段缺失（无 updatedAt）→ 503 board_fields_missing", async () => {
  const mod = await freshHealth();
  installFetch(() => jsonRes({ mode: "live", coverage: { expected: 200, returned: 200 } }));
  const res = await mod.onRequestGet(ctx(makeKvEnv({})));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.reason, "board_fields_missing");
  assert.equal(body.mode, "live");
});

await test("⑨ board coverage 缺失 → 503 board_fields_missing（returned=null）", async () => {
  const mod = await freshHealth();
  installFetch(() => jsonRes({ mode: "live", updatedAt: NOW }));
  const res = await mod.onRequestGet(ctx(makeKvEnv({})));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.reason, "board_fields_missing");
  assert.deepEqual(body.coverage, { expected: null, returned: null });
});

await test("⑩ HEAD 健康 → 200 且 body 为空；HEAD 陈旧 → 503 且 body 为空", async () => {
  const mod = await freshHealth();
  installFetch();
  const resOk = await mod.onRequestHead(ctx(makeKvEnv({})));
  assert.equal(resOk.status, 200);
  assert.equal(await resOk.text(), "");
  installFetch(() => jsonRes(boardBody({ ageSec: 5000 })));
  const resBad = await mod.onRequest(ctx(makeKvEnv({}), { method: "HEAD" }));
  assert.equal(resBad.status, 503);
  assert.equal(await resBad.text(), "");
});

await test("⑪ 非 GET/HEAD → 405（onRequest 与 onRequestGet 双入口）", async () => {
  const mod = await freshHealth();
  installFetch();
  const res1 = await mod.onRequest(ctx(makeKvEnv({}), { method: "POST" }));
  assert.equal(res1.status, 405);
  assert.equal(res1.headers.get("allow"), "GET, HEAD");
  const res2 = await mod.onRequestGet(ctx(makeKvEnv({}), { method: "PUT" }));
  assert.equal(res2.status, 405);
});

await test("⑫ quotaMode=critical 阈值联动：age=1000 → 200 且阈值 1800（不误报）", async () => {
  const mod = await freshHealth();
  installFetch(() => jsonRes(boardBody({ ageSec: 1000 })));
  const env = makeKvEnv({ fetcherHealth: fetcherHealthWith({ credits: 10, quotaMode: "critical" }) });
  const res = await mod.onRequestGet(ctx(env));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.freshnessThresholdSec, 1800);
  assert.equal(body.quotaMode, "critical");
});

await test("⑬ quotaMode=critical：age=1900（>1800，错过一整个抓取周期）→ 503", async () => {
  const mod = await freshHealth();
  installFetch(() => jsonRes(boardBody({ ageSec: 1900 })));
  const env = makeKvEnv({ fetcherHealth: fetcherHealthWith({ credits: 10, quotaMode: "critical" }) });
  const res = await mod.onRequestGet(ctx(env));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).freshnessThresholdSec, 1800);
});

await test("⑭ quota 总账计算：fetcher 4400 + legacy 1100 → 已用 5500 / 投影 15000 / 9 天后击穿", async () => {
  const mod = await freshHealth();
  installFetch();
  const env = makeKvEnv({
    fetcherHealth: fetcherHealthWith({ credits: 4400 }),
    legacy: { month: "2026-11", credits: 1100, updatedAt: new Date(NOW).toISOString() },
  });
  const res = await mod.onRequestGet(ctx(env));
  assert.equal(res.status, 200);
  const q = (await res.json()).quota;
  assert.equal(q.month, "2026-11");
  assert.equal(q.fetcherCreditsUsedEst, 4400);
  assert.equal(q.legacyCredits, 1100);
  assert.equal(q.legacyCounted, true);
  assert.equal(q.totalUsed, 5500);
  assert.equal(q.dailyRate, 500); // 5500 / 11 天
  assert.equal(q.totalProjected, 15000); // 500 × 30 天
  assert.equal(q.daysToExhaust, 9); // (10000-5500)/500
  assert.equal(q.projectedExhaustDate, "2026-11-20");
  assert.equal(q.limit, 10000);
});

await test("⑮ legacy 计数缺失降级：按 0 计 + legacyCounted:false，投影仅按 fetcher", async () => {
  const mod = await freshHealth();
  installFetch();
  const env = makeKvEnv({ fetcherHealth: fetcherHealthWith({ credits: 5500 }), legacy: null });
  const res = await mod.onRequestGet(ctx(env));
  const q = (await res.json()).quota;
  assert.equal(q.legacyCredits, 0);
  assert.equal(q.legacyCounted, false);
  assert.equal(q.totalUsed, 5500);
  assert.equal(q.totalProjected, 15000);
  assert.equal(q.daysToExhaust, 9);
});

await test("⑯ 无 BOARD_KV 绑定：quota 全降级（0/false/null）、健康判定本体不受影响", async () => {
  const mod = await freshHealth();
  installFetch();
  const res = await mod.onRequestGet(ctx({}));
  assert.equal(res.status, 200);
  const q = (await res.json()).quota;
  assert.equal(q.fetcherCreditsUsedEst, 0);
  assert.equal(q.fetcherCounted, false);
  assert.equal(q.legacyCounted, false);
  assert.equal(q.totalUsed, 0);
  assert.equal(q.totalProjected, 0);
  assert.equal(q.daysToExhaust, null);
  assert.equal(q.projectedExhaustDate, null);
  assert.equal(q.quotaMode, "normal");
});

await test("⑰ legacy 计数跨月（上月 9999）：本月按 0 计、legacyCounted 仍 true", async () => {
  const mod = await freshHealth();
  installFetch();
  const env = makeKvEnv({
    fetcherHealth: fetcherHealthWith({ credits: 0 }),
    legacy: { month: "2026-10", credits: 9999, updatedAt: "2026-10-31T00:00:00.000Z" },
  });
  const res = await mod.onRequestGet(ctx(env));
  const q = (await res.json()).quota;
  assert.equal(q.legacyCounted, true);
  assert.equal(q.legacyCredits, 0);
  assert.equal(q.totalUsed, 0);
});

await test("⑱ 已击穿（已用 ≥10000）：daysToExhaust=0、击穿日为今日", async () => {
  const mod = await freshHealth();
  installFetch();
  const env = makeKvEnv({ fetcherHealth: fetcherHealthWith({ credits: 10050 }) });
  const res = await mod.onRequestGet(ctx(env));
  const q = (await res.json()).quota;
  assert.equal(q.daysToExhaust, 0);
  assert.equal(q.projectedExhaustDate, "2026-11-11");
});

await test("⑲ updatedAt 兼容形态：ISO 字符串与秒级数值均可判新鲜", async () => {
  const mod = await freshHealth();
  installFetch(() => jsonRes(boardBody({ updatedAt: new Date(NOW).toISOString() })));
  const resIso = await mod.onRequestGet(ctx(makeKvEnv({})));
  assert.equal(resIso.status, 200);
  installFetch(() => jsonRes(boardBody({ updatedAt: NOW / 1000 })));
  const resSec = await mod.onRequestGet(ctx(makeKvEnv({})));
  assert.equal(resSec.status, 200);
});

await test("⑳ board 对象字段访问抛错 → 503 health_check_error 兜底分支", async () => {
  const mod = await freshHealth();
  const evil = { updatedAt: NOW, mode: "live" };
  Object.defineProperty(evil, "coverage", {
    get() {
      throw new Error("evil getter");
    },
  });
  installFetch(() => ({ ok: true, status: 200, json: async () => evil }));
  const res = await mod.onRequestGet(ctx(makeKvEnv({})));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "health_check_error");
});

Date.now = originalDateNow;
globalThis.fetch = originalFetch;
const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
