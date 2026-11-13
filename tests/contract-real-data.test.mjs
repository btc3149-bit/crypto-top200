// tests/contract-real-data.test.mjs — W4-05 真实产物契约测试（P0 / F4-05，W3-22 硬前置）
// 以真实 public/data/coins.json 为 fixture，喂两条从未被既有套件测过的契约路径：
//   (a) functions/api/board.js 的 getIds()——getIds 未导出，沿用 tests/board.test.mjs 的
//       模块加载手法（动态 import + query 破缓存 + 覆写 globalThis.fetch），经
//       onRequestGet 间接驱动：/data/coins.json 喂真实产物全文，上游 markets 按请求
//       ids 动态回填，断言 200 个 id 完整、且 markets 请求中的 id 顺序与产物一致
//       （getIds 的顺序即请求顺序，是唯一可观测的顺序证据）。
//   (b) public/index.html 的 decodeCoinsData——从 HTML 抽出函数源码在 Node 内执行。
//
// 红/绿语义（务必先读）：
//   - 默认运行：对象形态用例（fixture 自检 / getIds / 对象解码 / dataHash 口径 A）
//     全部应绿；rows 紧凑形态用例以「PENDING-W322」明确标记跳过并打印原因，
//     不影响退出码。原因是基线 decodeCoinsData 为直通桩（rows 原样返回位置数组，
//     未按 meta.fields 解码），rows 段在基线必然红——这正是 W3-22 的硬前置留痕：
//     先红后绿即 W3-22 的验收方式。
//   - --rows 模式：只运行 rows 段并如实计红/绿（基线退出码 1）。W3-22（前端按
//     meta.fields 补全解码）合入后此模式应转绿，届时把 rows 段改为默认常驻。
//   - rows fixture 的字段序：当前真实产物 meta 尚无 fields 字段（对象形态），
//     故按 W3-22 规格来源构造——scripts/build.py 的 FIELDS23（与
//     ops/w322-assessment.md 第一/五节定版一致），即未来 rows 产物
//     meta.fields 的预定值；本文件另有断言校验 FIELDS23 与真实产物逐币键集合
//     完全一致，字段表漂移会先在这里红。
//   - dataHash 口径 A（ops/w322-assessment.md 第四节）：dataHash = 解码后规范
//     对象数组的 sha256（check_meta.data_hash 口径：json.dumps(sort_keys,
//     separators=(",",":"), ensure_ascii=False)）。解码无损（逐字段全等）时
//     解码结果与产物 coins 同一逻辑数据集、哈希必然同值，故口径 A 以
//     「原始产物规范化哈希 == meta.dataHash」+「解码逐字段全等」两段合证。
//
// 运行：node tests/contract-real-data.test.mjs        （默认，rows 段跳过）
//       node tests/contract-real-data.test.mjs --rows （只跑 rows 段，基线为红）

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const ROWS_MODE = process.argv.includes("--rows");

// FIELDS23：与 scripts/build.py 的 FIELDS23 逐字一致（未来 rows 产物 meta.fields 的定版值）。
const FIELDS23 = [
  "table", "estRank", "rankNow", "rankNote", "name", "symbol", "coingeckoId",
  "snapshotPrice", "snapshotMcapUsd", "snapshotMcapRaw", "athPrice", "athDate",
  "athFlag", "estLo", "estHi", "multLo", "multHi", "impliedMcapLoUsd",
  "impliedMcapHiUsd", "impliedMcapRaw", "confidence", "reason", "dataDate",
];
// 真实数据中合法可为 null 的字段（只断言键存在，不断言非空）：
// rankNow 6、rankNote 193、snapshotMcapUsd 1、athPrice 36、athDate 35、
// impliedMcapLoUsd/HiUsd 各 1（2026-11-13 基线实测分布）。
const NULLABLE = new Set([
  "rankNow", "rankNote", "snapshotMcapUsd", "snapshotMcapRaw", "athPrice",
  "athDate", "impliedMcapLoUsd", "impliedMcapHiUsd",
]);

const coinsText = readFileSync(new URL("../public/data/coins.json", import.meta.url), "utf-8");
const realDoc = JSON.parse(coinsText);
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf-8");
const EXPECTED_IDS = realDoc.coins.map((c) => c.coingeckoId);

// ---------- decodeCoinsData 抽取（花括号配平，不依赖行号） ----------
function extractDecode() {
  const start = html.indexOf("function decodeCoinsData");
  assert.ok(start >= 0, "index.html 中应存在 decodeCoinsData");
  let depth = 0, end = -1;
  for (let i = html.indexOf("{", start); i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > start, "decodeCoinsData 函数体配平失败");
  const src = html.slice(start, end);
  return new Function(`${src}\nreturn decodeCoinsData;`)();
}
const decodeCoinsData = extractDecode();

// ---------- dataHash 口径 A：保留数字字面量的 JSON 解析 + Python 风格规范化 ----------
// JS JSON.parse 会把 2127.0 压成 2127，与 Python json.dumps 的浮点字面量不一致，
// 故此处用保留原始数字 token 的微型解析器重算 check_meta.data_hash 口径。
function parsePreserving(text) {
  let i = 0;
  const ws = () => { while (i < text.length && " \t\n\r".includes(text[i])) i++; };
  function str() {
    let j = i + 1, out = "";
    while (text[j] !== '"') {
      if (text[j] === "\\") {
        const e = text[j + 1];
        if (e === "u") { out += String.fromCharCode(parseInt(text.slice(j + 2, j + 6), 16)); j += 6; }
        else { out += { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "/": "/", "\\": "\\", '"': '"' }[e]; j += 2; }
      } else { out += text[j]; j++; }
    }
    i = j + 1; return out;
  }
  function value() {
    ws();
    const ch = text[i];
    if (ch === "{") { i++; const o = {}; ws(); if (text[i] === "}") { i++; return o; }
      for (;;) { ws(); const k = str(); ws(); i++; o[k] = value(); ws(); if (text[i] === ",") { i++; continue; } i++; return o; } }
    if (ch === "[") { i++; const a = []; ws(); if (text[i] === "]") { i++; return a; }
      for (;;) { a.push(value()); ws(); if (text[i] === ",") { i++; continue; } i++; return a; } }
    if (ch === '"') return str();
    if (text.startsWith("true", i)) { i += 4; return true; }
    if (text.startsWith("false", i)) { i += 5; return false; }
    if (text.startsWith("null", i)) { i += 4; return null; }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    i += m[0].length; return { __num: m[0] };
  }
  return value();
}
function pyStr(s) {
  return '"' + s.replace(/[\u0000-\u001f"\\]/g, (ch) => {
    const map = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
    return map[ch] ?? ("\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
  }) + '"';
}
function canon(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return pyStr(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object" && "__num" in v) return v.__num;
  const ks = Object.keys(v).sort();
  return "{" + ks.map((k) => pyStr(k) + ":" + canon(v[k])).join(",") + "}";
}
function dataHashOfCoins() {
  const doc = parsePreserving(coinsText);
  return "sha256:" + createHash("sha256").update(canon(doc.coins), "utf-8").digest("hex");
}

// ---------- 测试收集器（沿用 board.test.mjs 风格） ----------
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
const originalFetch = globalThis.fetch;

// ---------- board.js 加载（同 board.test.mjs：query 破缓存得独立模块实例） ----------
let seq = 0;
async function freshBoard() {
  seq += 1;
  const url = new URL("../functions/api/board.js", import.meta.url);
  url.searchParams.set("case", `contract-${seq}-${Date.now()}-${Math.random()}`);
  return import(url.href);
}
function jsonRes(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ================= 默认套件（对象形态，应全绿） =================
async function runMain() {
  await test("① fixture 自检：真实产物 200 币、id 唯一、逐币键集合 == FIELDS23", () => {
    assert.equal(realDoc.coins.length, 200);
    assert.equal(new Set(EXPECTED_IDS).size, 200, "coingeckoId 应 200 个不重复");
    assert.equal(realDoc.meta.totalCoins, 200);
    assert.ok(typeof realDoc.meta.dataHash === "string" && realDoc.meta.dataHash.startsWith("sha256:"));
    const want = [...FIELDS23].sort().join(",");
    for (const c of realDoc.coins) {
      assert.equal(Object.keys(c).sort().join(","), want, `${c.coingeckoId} 键集合与 FIELDS23 不一致`);
    }
  });

  await test("② getIds 契约：真实产物喂 board.js → 200 id 完整且请求顺序与产物一致", async () => {
    const mod = await freshBoard();
    let capturedIds = null;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/data/coins.json")) return jsonRes(realDoc);
      if (u.includes("/coins/markets")) {
        capturedIds = new URL(u).searchParams.get("ids").split(",");
        return jsonRes(capturedIds.map((id, i) => ({
          id,
          current_price: 100 + i,
          market_cap: 1000000 + i,
          market_cap_rank: i + 1,
          price_change_percentage_24h_in_currency: 1.5,
          price_change_percentage_24h: 1.2,
        })));
      }
      if (u.includes("/global")) {
        return jsonRes({ data: { total_market_cap: { usd: 123 }, market_cap_percentage: { btc: 55 }, market_cap_change_percentage_24h_usd: 1 } });
      }
      throw new Error("unexpected fetch: " + u);
    };
    const res = await mod.onRequestGet({
      request: new Request("https://example.com/api/board", { method: "GET" }),
      env: {},
      waitUntil: () => {},
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, "live");
    assert.equal(body.coverage.expected, 200, "getIds 应从真实产物得到 200 个 id");
    assert.equal(body.coverage.returned, 200);
    assert.deepEqual(body.coverage.missingIds, []);
    assert.equal(body.count, 200);
    assert.deepEqual(Object.keys(body.coins).sort(), [...EXPECTED_IDS].sort(), "响应 coins 键集合应为完整 200 id");
    assert.deepEqual(capturedIds, EXPECTED_IDS, "markets 请求 id 顺序应与产物 coins 顺序逐一一致（getIds 顺序证据）");
  });

  await test("③ decodeCoinsData 对象形态：200 行、顺序一致、关键字段逐项完整", () => {
    const decoded = decodeCoinsData(realDoc);
    assert.ok(Array.isArray(decoded), "解码结果应为数组");
    assert.equal(decoded.length, 200);
    const problems = [];
    decoded.forEach((coin, i) => {
      const src = realDoc.coins[i];
      if (!coin || typeof coin !== "object" || Array.isArray(coin)) { problems.push(`#${i} 非对象`); return; }
      if (coin.coingeckoId !== src.coingeckoId) problems.push(`#${i} 顺序错位 ${coin.coingeckoId} != ${src.coingeckoId}`);
      for (const f of FIELDS23) if (!(f in coin)) problems.push(`#${i} ${src.coingeckoId} 缺键 ${f}`);
      for (const f of FIELDS23) {
        if (NULLABLE.has(f)) continue;
        if (coin[f] === null || coin[f] === undefined || coin[f] === "") problems.push(`#${i} ${src.coingeckoId} 非空字段 ${f} 为空`);
      }
      if (coin.estRank !== i + 1) problems.push(`#${i} estRank ${coin.estRank} != ${i + 1}`);
      for (const f of ["snapshotPrice", "estLo", "estHi", "multLo", "multHi"]) {
        if (!(typeof coin[f] === "number" && Number.isFinite(coin[f]))) problems.push(`#${i} ${src.coingeckoId} ${f} 非有限数`);
      }
      if (!["高", "中", "低"].includes(coin.confidence)) problems.push(`#${i} confidence 非法 ${coin.confidence}`);
      if (!["verified", "approx", "unverified"].includes(coin.athFlag)) problems.push(`#${i} athFlag 非法 ${coin.athFlag}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(coin.dataDate || "")) problems.push(`#${i} dataDate 非法 ${coin.dataDate}`);
      assert.deepEqual(coin, src);
    });
    assert.deepEqual(problems, [], `字段完整性问题:\n${problems.slice(0, 10).join("\n")}`);
  });

  await test("④ dataHash 口径 A：产物 coins 规范化哈希 == meta.dataHash", () => {
    assert.equal(dataHashOfCoins(), realDoc.meta.dataHash);
  });
}

// ================= rows 紧凑形态段（W3-22 前置；基线为红） =================
function buildRowsDoc(coins) {
  return {
    meta: { ...realDoc.meta, fields: [...FIELDS23] },
    rows: coins.map((c) => FIELDS23.map((f) => (c[f] === undefined ? null : c[f]))),
  };
}
function assertDecodedEquals(decoded, expectedCoins, label) {
  assert.ok(Array.isArray(decoded), `${label}: 解码结果应为数组`);
  assert.equal(decoded.length, expectedCoins.length, `${label}: 解码行数`);
  decoded.forEach((coin, i) => {
    assert.ok(
      coin && typeof coin === "object" && !Array.isArray(coin),
      `${label}: 第 ${i} 行应为具名对象，实际为 ${Array.isArray(coin) ? "位置数组（桩直通）" : typeof coin}`
    );
    assert.deepEqual(coin, expectedCoins[i], `${label}: 第 ${i} 行字段应对齐 ${expectedCoins[i].coingeckoId}`);
  });
}
async function runRows() {
  await test("R1 rows 小样本（前 3 币）：按 meta.fields 解码后字段对齐", () => {
    const small = realDoc.coins.slice(0, 3);
    assertDecodedEquals(decodeCoinsData(buildRowsDoc(small)), small, "rows-small");
  });
  await test("R2 rows 全量 200：解码顺序/字段与对象形态逐一全等（口径 A 前提）", () => {
    assertDecodedEquals(decodeCoinsData(buildRowsDoc(realDoc.coins)), realDoc.coins, "rows-full");
  });
}

const PENDING_REASON =
  "decodeCoinsData 当前为直通桩（public/index.html：rows 原样返回位置数组，未按 meta.fields 解码），" +
  "此段在基线必然失败，是 W3-22 的硬前置留痕（先红后绿）。单独运行看红：node tests/contract-real-data.test.mjs --rows";

if (ROWS_MODE) {
  await runRows();
} else {
  await runMain();
  console.log("SKIP [PENDING-W322] R1 rows 小样本字段对齐 — " + PENDING_REASON);
  console.log("SKIP [PENDING-W322] R2 rows 全量 200 解码全等 — " + PENDING_REASON);
  results.push(["R1 rows 小样本 [PENDING-W322]", "SKIP"], ["R2 rows 全量 [PENDING-W322]", "SKIP"]);
}

const failed = results.filter(([, s]) => s === "FAIL");
const passed = results.filter(([, s]) => s === "PASS");
const skipped = results.filter(([, s]) => s === "SKIP");
console.log(`\ncontract-real-data: ${passed.length} PASS / ${failed.length} FAIL / ${skipped.length} SKIP（模式 ${ROWS_MODE ? "--rows" : "默认"}）`);
if (ROWS_MODE && failed.length) {
  console.log("注：--rows 在基线为预期红（W3-22 未合入）；W3-22 合入后本模式应全绿。");
}
process.exit(failed.length ? 1 : 0);
