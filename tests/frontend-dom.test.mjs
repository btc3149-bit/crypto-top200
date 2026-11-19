// tests/frontend-dom.test.mjs — W4-16 前端 DOM 级回归（P1 / F4-18）
// 仓库无 jsdom 且零新依赖口径不变：仿 tests/snapshot-verify.mjs 的 vm + 桩 DOM 手法
// 加载 public/index.html 内联脚本。snapshot-verify 的桩 tbody 只有 innerHTML 字符串，
// patchInPlace 在其上恒返回 false、走整表退阶路径——真实原地修补路径从未被自动
// 执行过（F4-18）。本文件在自己的文件内把桩扩展为可承载真实路径的节点模型：
// tbody 持有 200 个 tr 桩节点（各 12 个 td 子节点），支持 querySelector(All)
// ("tr[data-snapshot]")、appendChild 重排、removeAttribute、nextElementSibling、
// insertAdjacentHTML，innerHTML 改为按节点序列化/解析的存取器（赋值即整表替换，
// 可据此断言「未整表替换」）。
//
// 覆盖核心路径：
// ① patchInPlace 真实路径：快照 200 行就位 → loadBoard 喂 live 载荷 → render
// 原地修补；断言行数恒 200、节点身份保持、innerHTML 未被整表赋值、快照标记
// 清零、行序与 cmpCoins 一致、目标行价格/涨幅单元格被更新。
// ② 详情展开结构：toggleExpand 插入/移除 detail-row 节点、expandedIds 同步。
// ③ detailHTML 24h 字段渲染（契约字段 change24h，應绿）。
// ④ detailHTML 实时市值契约断言：按契约（board 输出字段
// mcapUsd，见 functions/api/board.js 与 shared/board-schema.js）写断言；
// 基线前端 detailHTML 误读 lv.marketCapUsd，live 下市值恒显「—（无实时
// 数据）」，故本条在基线为红，待并行修复包（W4-08）合入后转绿。不得为
// 变绿而改按 bug 字段名断言。本条红会使本文件基线退出码为 1，属预期。
// ⑤ 自选：toggleStar → watchSet 与 localStorage 持久化；watchToggle 切
// watchOnly → currentFiltered/render 只剩自选、清空自选出空态、恢复全量。
//
// 运行：node tests/frontend-dom.test.mjs（基线预期：⑤条中仅 ④ 红，退出码 1）

import assert from "node:assert/strict";
import { readFileSync} from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf-8");
const coinsDoc = JSON.parse(readFileSync(new URL("../data/coins.json", import.meta.url), "utf-8"));
const generatedAt = coinsDoc.meta.generatedAt;
// W3-22：coins.json 为 rows 紧凑形态，按 meta.fields 解码为规范对象（与前端 decodeCoinsData 同口径）。
function decodeCoinsDoc(doc) {
  if (doc && Array.isArray(doc.coins)) return doc.coins;
  const fields = doc && doc.meta && Array.isArray(doc.meta.fields) ? doc.meta.fields : null;
  if (!fields || !Array.isArray(doc.rows)) return [];
  return doc.rows.map((r) => {
    const o = {};
    for (let i = 0; i < fields.length; i++) o[fields[i]] = r[i];
    return o;
  });
}
const coinsList = decodeCoinsDoc(coinsDoc);
const coinById = new Map(coinsList.map((c) => [c.coingeckoId, c]));

// ---------- live 载荷（board 契约形态：coins[id] = {price, mcapUsd, rank, change24h}） ----------
const BTC_NEW_PRICE = coinById.get("bitcoin").snapshotPrice * 2.5;
const ETH_CONTRACT_MCAP = 123456789000;
const liveCoins = {};
for (const c of coinsList) {
liveCoins[c.coingeckoId] = {
price: c.snapshotPrice * 1.01,
mcapUsd: c.snapshotMcapUsd,
rank: c.rankNow,
change24h: 1.23,
};
}
liveCoins["bitcoin"] = {...liveCoins["bitcoin"], price: BTC_NEW_PRICE, change24h: 7.77};
liveCoins["ethereum"] = {...liveCoins["ethereum"], mcapUsd: ETH_CONTRACT_MCAP, change24h: 5.678};
const boardPayload = {
mode: "live",
stale: false,
updatedAt: new Date().toISOString(),
snapshotDate: "2026-11-08",
coins: liveCoins,
global: { totalMcapUsd: 4.28e12, btcDominance: 57.1, totalMcapChange24h: 2.34},
coverage: { expected: 200, returned: 200, missingIds: []},
};
let boardLive = false; // false: /api/board 回 500（快照阶段）；true: 回 live 载荷

// ---------- 桩 DOM ----------
function makeClassList(initial = "") {
const s = new Set(String(initial).split(/\s+/).filter(Boolean));
return {
add: (...cs) => cs.forEach((c) => s.add(c)),
remove: (...cs) => cs.forEach((c) => s.delete(c)),
toggle: (c, on) => { const v = on === undefined?!s.has(c):!!on; v? s.add(c): s.delete(c); return v;},
contains: (c) => s.has(c),
_set: s,
};
}
function makeGenericEl(id, registry) {
const attrs = new Map();
const el = {
id, textContent: "", innerHTML: "", className: "", value: "", disabled: false,
dataset: {}, style: {}, parentNode: null, children: [],
classList: makeClassList(),
setAttribute(k, v) { attrs.set(k, String(v));},
getAttribute(k) { return attrs.has(k)? attrs.get(k): null;},
removeAttribute(k) { attrs.delete(k);},
addEventListener() {}, removeEventListener() {},
closest() { return null;},
querySelector() { return null;},
querySelectorAll() { return [];},
focus() {}, scrollIntoView() {},
};
if (registry) registry.set(id, el);
return el;
}
// tr 桩：children 为 td 桩数组；_attrs 承载 data-snapshot 等属性存在性。
function makeTr({ id, className = "", snapshot = false, cells = [], rawHtml = null}) {
const tr = {
id, className, _rawHtml: rawHtml,
_attrs: new Set(snapshot? ["data-snapshot"]: []),
children: cells, parentNode: null, dataset: {}, style: {},
classList: makeClassList(className),
setAttribute(k, v) { if (k === "class") { tr.className = v; tr.classList = makeClassList(v);} else tr._attrs.add(k);},
getAttribute(k) { return tr._attrs.has(k)? "": null;},
removeAttribute(k) { tr._attrs.delete(k);},
addEventListener() {}, removeEventListener() {},
closest() { return null;}, querySelector() { return null;}, focus() {}, scrollIntoView() {},
get nextElementSibling() {
if (!tr.parentNode ||!tr.parentNode._nodes) return null;
const n = tr.parentNode._nodes;
const i = n.indexOf(tr);
return i >= 0 && i + 1 < n.length? n[i + 1]: null;
},
insertAdjacentHTML(pos, htmlStr) {
if (pos!== "afterend" ||!tr.parentNode) return;
const det = parseTr(htmlStr);
const n = tr.parentNode._nodes;
n.splice(n.indexOf(tr) + 1, 0, det);
det.parentNode = tr.parentNode;
},
remove() {
if (!tr.parentNode ||!tr.parentNode._nodes) return;
const n = tr.parentNode._nodes;
const i = n.indexOf(tr);
if (i >= 0) n.splice(i, 1);
tr.parentNode = null;
},
};
return tr;
}
function parseTr(chunk) {
const idM = /id='([^']+)'/.exec(chunk) || /id="([^"]+)"/.exec(chunk);
const clsM = /class='([^']*)'/.exec(chunk);
const className = clsM? clsM[1]: "";
const cells = [];
for (const m of chunk.matchAll(/<td[^>]*class='([^']*)'[^>]*>([\s\S]*?)<\/td>/g)) {
cells.push({ className: m[1], innerHTML: m[2], textContent: ""});
}
if (!cells.length) {
// 无 class 的 td（如详情行 colspan）：保留整行原文，单元格内容不参与断言。
for (const m of chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)) {
cells.push({ className: "", innerHTML: m[1], textContent: ""});
}
}
return makeTr({
id: idM? idM[1]: "",
className,
snapshot: chunk.includes('data-snapshot="1"'),
cells,
rawHtml: chunk,
});
}
function serializeTr(tr) {
if (tr._rawHtml && tr.classList.contains("detail-row")) return tr._rawHtml;
return "<tr" + (tr._attrs.has("data-snapshot")? ' data-snapshot="1"': "") +
(tr.className? ` class='${tr.className}'`: "") + ` id='${tr.id}'>` +
tr.children.map((td) => `<td class='${td.className}'>${td.innerHTML}</td>`).join("") + "</tr>";
}
function makeTbody(id, registry) {
const tb = makeGenericEl(id, registry);
tb._nodes = [];
tb._setCount = 0; // innerHTML 整表赋值次数（patch 路径断言用）
Object.defineProperty(tb, "innerHTML", {
get() { return tb._nodes.map(serializeTr).join("\n");},
set(v) {
tb._setCount++;
tb._nodes = [];
if (!v) return;
for (const chunk of v.match(/<tr[\s\S]*?<\/tr>/g) || []) {
const tr = parseTr(chunk);
tr.parentNode = tb;
tb._nodes.push(tr);
}
},
});
tb.querySelectorAll = (sel) => {
if (sel === "tr[data-snapshot]") return tb._nodes.filter((n) => n._attrs.has("data-snapshot"));
return [];
};
tb.querySelector = (sel) => {
if (sel === "tr[data-snapshot]") return tb._nodes.find((n) => n._attrs.has("data-snapshot")) || null;
return null;
};
tb.appendChild = (node) => {
const i = tb._nodes.indexOf(node);
if (i >= 0) tb._nodes.splice(i, 1);
tb._nodes.push(node);
node.parentNode = tb;
return node;
};
tb.mainRows = () => tb._nodes.filter((n) => n.id.startsWith("row-"));
return tb;
}

// ---------- 上下文构建 ----------
function buildContext() {
  const registry = new Map();
  const get = (id) => registry.get(id) || makeGenericEl(id, registry);
  const tbody = makeTbody("tbodyA", registry);
  const tbodyInit = html.match(/<tbody id="tbodyA">([\s\S]*?)<\/tbody>/)[1];
  tbody.innerHTML = tbodyInit; // 构建期注入的 200 快照行（真实文件内容）
  tbody._setCount = 0; // 初始化赋值不计入 patch 断言
  const banner = get("statusBanner");
  banner.dataset.snapshotAt = generatedAt;
  const theadEl = makeGenericEl("thead", null);
  const lsStore = new Map();
  const documentStub = {
    title: "t",
    getElementById: get,
    querySelector: () => theadEl,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes("coins.json")) return { ok: true, status: 200, json: async () => coinsDoc };
    if (u.includes("/api/board")) {
      return boardLive
        ? { ok: true, status: 200, json: async () => boardPayload }
        : { ok: false, status: 500, json: async () => ({}) };
    }
    throw new Error("unexpected fetch: " + url);
  };
  const sandbox = {
    document: documentStub,
    localStorage: {
      getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
      setItem: (k, v) => lsStore.set(k, String(v)),
      removeItem: (k) => lsStore.delete(k),
    },
    location: { hash: "" },
    history: { replaceState() {} },
    fetch: fetchImpl,
    requestAnimationFrame: () => {},
    addEventListener() {},
    setTimeout, clearTimeout, console,
    AbortController: typeof AbortController !== "undefined" ? AbortController : undefined,
  };
  const ctx = vm.createContext(sandbox);
  const scriptSrc = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((s) => s.includes("function rowHTML"));
  assert.ok(scriptSrc, "主 script 抽取成功");
  vm.runInContext(scriptSrc, ctx);
  return { ctx, registry, tbody, lsStore };
}

const settle = async (rounds = 6, ms = 10) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, ms));
};
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

// ---------- 场景：单上下文贯穿 快照 → live 修补 → 详情 → 自选 ----------
const { ctx, registry, tbody, lsStore } = buildContext();
await settle();
const inPage = (expr) => vm.runInContext(expr, ctx);

await test("⓪ 环境：脚本加载完成、COINS 200 就绪、board 失败未触碰快照 tbody", () => {
  assert.equal(inPage("COINS.length"), 200);
  assert.equal(tbody.mainRows().length, 200);
  assert.ok(tbody.mainRows().every((tr) => tr._attrs.has("data-snapshot")), "初始应全为快照行");
  assert.ok(tbody.mainRows().every((tr) => tr.children.length === 12), "每行应 12 个单元格");
  assert.equal(tbody._setCount, 0, "快照阶段 tbody 不应被整表赋值");
});

await test("① patchInPlace 真实路径：live 到达原地修补（200 行/节点身份/innerHTML 未整表赋值/目标行已更新）", async () => {
  const before = new Map(tbody.mainRows().map((tr) => [tr.id, tr]));
  const btcBefore = before.get("row-bitcoin");
  const btcPriceBefore = btcBefore.children[4].innerHTML;
  const setsBefore = tbody._setCount;

  boardLive = true;
  await inPage("loadBoard()");
  await settle();

  assert.equal(inPage("livePatched"), true, "render 应走 patch 分支并置 livePatched");
  assert.equal(tbody._setCount, setsBefore, "patch 路径不得整表赋值 innerHTML（整表赋值即退阶路径）");
  const rows = tbody.mainRows();
  assert.equal(rows.length, 200, "修补后行数应仍为 200");
  assert.equal(new Set(rows.map((tr) => tr.id)).size, 200, "行 id 不得重复");
  for (const tr of rows) {
    assert.equal(tr, before.get(tr.id), `行节点身份应保持：${tr.id}`);
    assert.ok(!tr._attrs.has("data-snapshot"), `快照标记应清零：${tr.id}`);
  }
  // Array.from 把 vm realm 数组转回本 realm（否则 deepStrictEqual 卡原型不一致）
  const expectOrder = Array.from(inPage("[...COINS].sort(cmpCoins).map((c) => 'row-' + c.coingeckoId)"));
  assert.deepEqual(rows.map((tr) => tr.id), expectOrder, "修补后行序应与 cmpCoins 当前排序一致");

  const btc = rows.find((tr) => tr.id === "row-bitcoin");
  assert.equal(btc, btcBefore, "目标行节点身份应保持");
  const expectPrice = inPage(`fmtPrice(${BTC_NEW_PRICE})`);
  const expectChg = inPage("fmtPct(7.77)");
  assert.notEqual(btc.children[4].innerHTML, btcPriceBefore, "目标行价格单元格应被更新");
  assert.ok(btc.children[4].innerHTML.includes(expectPrice), `价格单元格应含 ${expectPrice}，实际 ${btc.children[4].innerHTML}`);
  assert.ok(btc.children[5].innerHTML.includes(expectChg), `涨幅单元格应含 ${expectChg}，实际 ${btc.children[5].innerHTML}`);
  assert.ok(btc.children[5].className.includes("up"), "涨幅单元格应带 up 类");
  const eth = rows.find((tr) => tr.id === "row-ethereum");
  assert.ok(eth.children[6].innerHTML.includes(inPage(`fmtMcap(${ETH_CONTRACT_MCAP})`)), "目标行市值单元格应按 mcapUsd 更新");
});

await test("② 详情展开结构：toggleExpand 插入/移除 detail-row 且 expandedIds 同步", () => {
  const ethTr = tbody.mainRows().find((tr) => tr.id === "row-ethereum");
  const btn = {
    dataset: { exp: "ethereum" }, textContent: "▸",
    setAttribute() {}, removeAttribute() {},
    closest: () => ethTr,
  };
  ctx.__btn = btn; // contextified sandbox：挂到全局供页内表达式取用
  inPage("toggleExpand('ethereum', __btn)");
  assert.equal(inPage("expandedIds.has('ethereum')"), true, "展开后 expandedIds 应含 ethereum");
  const idx = tbody._nodes.indexOf(ethTr);
  const det = tbody._nodes[idx + 1];
  assert.ok(det && det.id === "d-ethereum", "主行之后应插入 d-ethereum 详情行");
  assert.ok(det.classList.contains("detail-row"), "详情行应带 detail-row 类");
  assert.ok(det._rawHtml.includes("detail-row") && det._rawHtml.includes("隐含市值区间"), "详情行内容应为 detailHTML 输出");
  inPage("toggleExpand('ethereum', __btn)");
  assert.equal(inPage("expandedIds.has('ethereum')"), false, "收起后 expandedIds 应移除 ethereum");
  assert.ok(!tbody._nodes.some((n) => n.id === "d-ethereum"), "收起后详情行应被移除");
  delete ctx.__btn;
});

await test("③ detailHTML 24h 字段：按契约 change24h 渲染实时涨幅", () => {
  const out = inPage("detailHTML(COINS.find((c) => c.coingeckoId === 'ethereum'))");
  const seg = /<dt>24h（实时）<\/dt><dd>([\s\S]*?)<\/dd>/.exec(out);
  assert.ok(seg, "详情应含 24h（实时）段");
  assert.ok(seg[1].includes(inPage("fmtPct(5.678)")), `24h 段应含 +5.7%，实际：${seg[1]}`);
});

await test("④ detailHTML 实时市值契约【预期红 · F4-07】：应按 board 契约字段 mcapUsd 渲染", () => {
  const out = inPage("detailHTML(COINS.find((c) => c.coingeckoId === 'ethereum'))");
  const seg = /<dt>实时市值<\/dt><dd>([\s\S]*?)<\/dd>/.exec(out);
  assert.ok(seg, "详情应含 实时市值 段");
  const expect = inPage(`fmtMcap(${ETH_CONTRACT_MCAP})`);
  assert.equal(
    seg[1], expect,
    `实时市值应为契约字段 mcapUsd=${ETH_CONTRACT_MCAP} 的格式化值 ${expect}，实际「${seg[1]}」` +
    "——基线 detailHTML 误读 lv.marketCapUsd（F4-07），待 W4-08 修复包合入后本条转绿"
  );
});

await test("⑤ 自选切换：toggleStar → watchSet/持久化；watchOnly 过滤、空态与恢复", async () => {
  assert.equal(inPage("watchSet.has('solana')"), false);
  inPage("toggleStar('solana')");
  assert.equal(inPage("watchSet.has('solana')"), true, "toggleStar 后 watchSet 应含 solana");
  assert.equal(inPage("watchSet.size"), 1);
  await settle(3, 60); // saveWatch 防抖 100ms
  const saved = JSON.parse(lsStore.get("top200.watchlist.v1") || "[]");
  assert.deepEqual(saved, ["solana"], "自选应持久化到 localStorage");

  const toggle = registry.get("watchToggle");
  assert.equal(typeof toggle.onclick, "function", "watchToggle 应已绑定 onclick");
  toggle.onclick(); // watchOnly = true → render
  await settle(2, 10);
  assert.equal(inPage("watchOnly"), true);
  assert.deepEqual(tbody.mainRows().map((tr) => tr.id), ["row-solana"], "只看自选时应仅剩 solana 行");
  assert.ok(registry.get("resultMeta").textContent.includes("仅自选"), "resultMeta 应标注仅自选");

  inPage("toggleStar('solana')"); // watchOnly 下取消唯一自选 → render 空态
  assert.equal(inPage("watchSet.size"), 0);
  assert.equal(tbody.mainRows().length, 0, "自选清空后应无主行（空态行）");
  assert.ok(tbody.innerHTML.includes("还没有自选币种"), "应呈现自选空态文案");

  toggle.onclick(); // watchOnly = false → 恢复全量
  await settle(2, 10);
  assert.equal(inPage("watchOnly"), false);
  assert.equal(tbody.mainRows().length, 200, "恢复后应回到 200 行");
});

const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\nfrontend-dom: ${results.length - failed.length}/${results.length} PASS`);
for (const [name, s] of failed) console.log(`红：${name}（见上方断言信息）`);
if (failed.some(([n]) => n.includes("F4-07"))) {
  console.log("注：④ 为预期红（F4-07 基线 bug），其余条目应全绿；W4-08 修复合入后本文件应全绿、退出码 0。");
}
process.exit(failed.length ? 1 : 0);
