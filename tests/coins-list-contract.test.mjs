// tests/coins-list-contract.test.mjs — F6-51 coins-list 一致性契约
// 断言 workers/fetcher/src/coins-list.js 的 COINS id 集合 == data/coins.json 经 rows 解码后的
// coingeckoId 集合。coins-list.js 靠手工命令再生成、无此断言时榜单换币漏跑再生成会让 fetcher
// 静默继续抓旧 200 币而 coverage 仍显示全绿（潜伏型内容错误）。
// 解码口径与 scripts/gen-paprika-map.mjs / check_meta 一致：rows 形态按 meta.fields 逐项 zip。
// 运行：node tests/coins-list-contract.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COINS, IDS } from "../workers/fetcher/src/coins-list.js";

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([name, "PASS"]);
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push([name, "FAIL"]);
    console.error(`FAIL ${name}\n`, e);
  }
}

// rows 形态解码（meta.fields zip）；对象形态（coins 数组）直通——与 gen-paprika-map.mjs 同口径。
function decodeCoins(doc) {
  if (doc && Array.isArray(doc.coins)) return doc.coins;
  if (doc && Array.isArray(doc.rows)) {
    const fields = doc.meta && Array.isArray(doc.meta.fields) ? doc.meta.fields : null;
    if (!fields) return [];
    return doc.rows.map((r) => {
      const o = {};
      for (let i = 0; i < fields.length; i++) o[fields[i]] = r[i];
      return o;
    });
  }
  return [];
}

const doc = JSON.parse(readFileSync(new URL("../data/coins.json", import.meta.url), "utf-8"));
const decoded = decodeCoins(doc);
const dataIds = decoded.map((c) => c.coingeckoId);

await test("F6-51: data/coins.json 可解码且含 coingeckoId 字段（解码口径自检）", async () => {
  assert.ok(decoded.length > 0, "解码结果为空——meta.fields 口径可能已漂移");
  assert.ok(dataIds.every((x) => typeof x === "string" && x.length > 0), "coingeckoId 须全为非空字符串");
});

await test("F6-51: COINS id 集合 == data/coins.json 的 coingeckoId 集合（无多、无少、无重复）", async () => {
  const a = new Set(COINS.map((c) => c.id));
  const b = new Set(dataIds);
  assert.equal(COINS.length, a.size, "coins-list.js COINS 内部有重复 id");
  assert.equal(dataIds.length, b.size, "data/coins.json coingeckoId 有重复");
  assert.equal(a.size, b.size, `集合大小不一致：coins-list=${a.size} data=${b.size}`);
  const onlyList = [...a].filter((x) => !b.has(x));
  const onlyData = [...b].filter((x) => !a.has(x));
  assert.deepEqual(onlyList, [], `coins-list 多出（data 已无此币，疑似漏跑再生成）: ${onlyList.slice(0, 5)}`);
  assert.deepEqual(onlyData, [], `data 多出（coins-list 未同步，fetcher 抓不到）: ${onlyData.slice(0, 5)}`);
});

await test("F6-51: IDS 导出与 COINS 同序同集（主流程 ids 入口不漂移）", async () => {
  assert.deepEqual(IDS, COINS.map((c) => c.id));
});

await test("F6-51: COINS 元素形为 {id, paprikaId}（W5-01 标准形，paprikaId 可为 null 但键须在）", async () => {
  for (const c of COINS) {
    assert.equal(typeof c.id, "string");
    assert.ok("paprikaId" in c, `元素 ${c.id} 缺 paprikaId 键`);
  }
});

const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
