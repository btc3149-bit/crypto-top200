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
// ③ detailHTML 24h 字段渲染（契约字段 change24h）+ 24h 成交量段（volume24h，F6-19）。
// ④ detailHTML 实时市值契约断言：按契约（board 输出字段 mcapUsd，见
// functions/api/board.js 与 shared/board-schema.js）渲染（F4-07 已由 W4-08
// 修复，本条应绿；F6-81 起删除旧「预期红」标注，红即真回归）。
// ⑤ 自选：toggleStar → watchSet 与 localStorage 持久化；watchToggle 切
// watchOnly → currentFiltered/render 只剩自选、清空自选出空态、恢复全量。
// ⑥ F6-56/F6-60 显示全部/收起按钮；⑦ F6-12 置信度筛选；⑧ F6-63/F6-14 fmt
// 边界与数值归一；⑨ F6-13/F6-18 实时字段 0/null 口径；⑩ F6-59 解码健全性
// 校验；⑪ F6-68 搜索口径；⑫ F6-57 修补刷新已展开详情；⑬ F6-62 delayed
// 横幅；⑭ F6-65 自选原始集落盘；⑮ F6-54 coins 失败态点星不覆写自选；
// ⑯ W5 aria-controls 全量关联（快照/模板/patch 三路 200/200 + toggle 同步）；
// ⑰ W5 展开按钮命中域 CSS 定版断言（28+2×8=44）；⑱ W5 SRI 处置守卫
// （外部脚本仅 beacon 一支、无 integrity，登记见 security-baseline §5.4）。
//
// 桩覆盖的 DOM API 清单（F6-82）：getElementById（注册表自动建桩）、
// document.querySelector（仅 thead）、querySelectorAll（tbody 仅
// "tr[data-snapshot]"，其余返回 []）、classList add/remove/toggle/contains、
// setAttribute/getAttribute/removeAttribute、dataset、style、textContent、
// className、value、disabled、title（赋值后可读）、布局量 scrollWidth/
// scrollHeight/clientWidth/clientHeight/scrollLeft/scrollTop（恒 0）、
// document.title、document.activeElement（恒 null，桩不建模焦点）、
// addEventListener/removeEventListener（空转）、closest（恒 null）、focus/
// scrollIntoView（空转）；tbody 节点模型另含 appendChild、insertAdjacentHTML、
// remove、nextElementSibling、children、innerHTML 节点序列化存取器。
// 通用元素桩经 Proxy 守卫：读取未实现且未赋值的属性即抛「桩未实现: <name>」，
// 使页面演进后新增的 DOM 依赖以显式假红暴露，而非静默 undefined 假绿/假红。
// tr 桩为定制节点模型（非 Proxy），其 API 以 makeTr 定义为准。
//
// 运行：node tests/frontend-dom.test.mjs（全绿，退出码 0）

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

// ---------- live 载荷（board 契约 v2 五字段：{price, mcapUsd, rank, change24h, volume24h}，F6-19 对齐生产契约） ----------
const BTC_NEW_PRICE = coinById.get("bitcoin").snapshotPrice * 2.5;
const ETH_CONTRACT_MCAP = 123456789000;
const ETH_VOL = 987654321;
const liveCoins = {};
for (const c of coinsList) {
liveCoins[c.coingeckoId] = {
price: c.snapshotPrice * 1.01,
mcapUsd: c.snapshotMcapUsd,
rank: c.rankNow,
change24h: 1.23,
volume24h: c.snapshotMcapUsd != null ? Math.round(c.snapshotMcapUsd * 0.05) : null,
};
}
liveCoins["bitcoin"] = {...liveCoins["bitcoin"], price: BTC_NEW_PRICE, change24h: 7.77};
liveCoins["ethereum"] = {...liveCoins["ethereum"], mcapUsd: ETH_CONTRACT_MCAP, change24h: 5.678, volume24h: ETH_VOL};
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
let boardPayloadOverride = null; // 非空时 /api/board 回此载荷（如 delayed 场景，F6-62）

// ---------- 桩 DOM ----------
// F6-82：通用元素桩 Proxy 守卫——未实现且未赋值的属性读取即抛显式错误，区分假红来源。
function guardStub(el, label) {
return new Proxy(el, {
get(t, p) {
if (typeof p === "symbol") return t[p];
if (p in t) return t[p];
if (p === "then" || p === "toJSON") return undefined;
throw new Error("桩未实现: " + label + "." + String(p));
},
});
}
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
const el = guardStub({
id, textContent: "", innerHTML: "", className: "", value: "", disabled: false,
dataset: {}, style: {}, parentNode: null, children: [],
scrollWidth: 0, scrollHeight: 0, clientWidth: 0, clientHeight: 0, scrollLeft: 0, scrollTop: 0,
classList: makeClassList(),
setAttribute(k, v) { attrs.set(k, String(v));},
getAttribute(k) { return attrs.has(k)? attrs.get(k): null;},
removeAttribute(k) { attrs.delete(k);},
addEventListener() {}, removeEventListener() {},
closest() { return null;},
querySelector() { return null;},
querySelectorAll() { return [];},
focus() {}, scrollIntoView() {},
}, "el#" + id);
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
// opts.seedWatch：预置 localStorage 自选（F6-54/F6-65 场景）；opts.coinsFail：coins.json 取数失败。
function buildContext(opts = {}) {
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
  if (opts.seedWatch) lsStore.set("top200.watchlist.v1", opts.seedWatch);
  const documentStub = guardStub({
    title: "t",
    activeElement: null, // F6-82/F6-58：桩不建模焦点，恒 null（patchInPlace 的焦点跳过分支在桩下不触发）
    getElementById: get,
    querySelector: () => theadEl,
    querySelectorAll: () => [],
    addEventListener() {},
  }, "document");
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes("coins.json")) {
      if (opts.coinsFail) throw new Error("network down");
      return { ok: true, status: 200, json: async () => coinsDoc };
    }
    if (u.includes("/api/board")) {
      return boardLive
        ? { ok: true, status: 200, json: async () => boardPayloadOverride || boardPayload }
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
  assert.equal(inPage("livePatchCount"), 1, "原地修补应恰发生一次（F6-56 起 livePatched 保留至用户点「收起」，见 ⑥）");
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

await test("③ detailHTML 24h 字段：按契约 change24h 渲染实时涨幅 + 成交量段按 volume24h 渲染（F6-19）", () => {
  const out = inPage("detailHTML(COINS.find((c) => c.coingeckoId === 'ethereum'))");
  const seg = /<dt>24h（实时）<\/dt><dd>([\s\S]*?)<\/dd>/.exec(out);
  assert.ok(seg, "详情应含 24h（实时）段");
  assert.ok(seg[1].includes(inPage("fmtPct(5.678)")), `24h 段应含 +5.7%，实际：${seg[1]}`);
  const vseg = /<dt>24h 成交量（实时）<\/dt><dd>([\s\S]*?)<\/dd>/.exec(out);
  assert.ok(vseg, "详情应含 24h 成交量（实时）段");
  assert.equal(vseg[1], inPage(`fmtMcap(${ETH_VOL})`), `成交量段应为契约字段 volume24h=${ETH_VOL} 的格式化值，实际「${vseg[1]}」`);
});

await test("④ detailHTML 实时市值契约：应按 board 契约字段 mcapUsd 渲染", () => {
  const out = inPage("detailHTML(COINS.find((c) => c.coingeckoId === 'ethereum'))");
  const seg = /<dt>实时市值<\/dt><dd>([\s\S]*?)<\/dd>/.exec(out);
  assert.ok(seg, "详情应含 实时市值 段");
  const expect = inPage(`fmtMcap(${ETH_CONTRACT_MCAP})`);
  assert.equal(
    seg[1], expect,
    `实时市值应为契约字段 mcapUsd=${ETH_CONTRACT_MCAP} 的格式化值 ${expect}，实际「${seg[1]}」`
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

await test("⑥ F6-56/F6-60：「收起为前 50 条」在实时修补后可达、收起后可再展开", async () => {
  // 前置：⑤ 后为全量 200 行、livePatched 仍为修补态 true
  assert.equal(inPage("livePatched"), true);
  assert.equal(tbody.mainRows().length, 200);
  inPage("renderShowAllBar(200, 200)");
  const btn = registry.get("showAllBtn");
  assert.equal(btn.dataset.act, "less", "修补态全量显示时应提供「收起」入口");
  assert.equal(btn.textContent, "收起为前 50 条");
  assert.ok(!btn.classList.contains("hidden"), "收起按钮应可见");
  btn.onclick({ currentTarget: btn }); // act=less → 清 livePatched 并 render
  await settle(2, 10);
  assert.equal(inPage("livePatched"), false, "收起后 livePatched 应清除");
  assert.equal(tbody.mainRows().length, 50, "收起后应为前 50 条");
  assert.equal(btn.dataset.act, "more", "收起后按钮应转为「显示全部」");
  btn.onclick({ currentTarget: btn });
  await settle(2, 10);
  assert.equal(tbody.mainRows().length, 200, "再展开应回到 200 条");
});

await test("⑦ F6-12 置信度筛选：以浏览器语义（select.value 取 option 的 value）驱动过滤、非空且口径正确", () => {
  const selHtml = /<select id="confSel">([\s\S]*?)<\/select>/.exec(html)[1];
  const opts = [...selHtml.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map((m) => {
    const v = /value="([^"]*)"/.exec(m[1]);
    return { value: v ? v[1] : m[2], text: m[2] }; // 无 value 属性时浏览器以文本内容为值（F6-12 的 bug 形态）
  });
  const hi = opts.find((o) => o.text.startsWith("高"));
  assert.equal(hi.value, "高", "「高」选项 value 应为纯置信度值而非含计数的文本");
  const sel = registry.get("confSel");
  sel.value = hi.value;
  const filtered = Array.from(inPage("currentFiltered()"));
  const expect = coinsList.filter((c) => c.confidence === "高").length;
  assert.ok(filtered.length > 0, "选「高」不得出空表");
  assert.equal(filtered.length, expect, `应恰筛出 ${expect} 条高置信度`);
  assert.ok(filtered.every((c) => c.confidence === "高"));
  sel.value = "";
});

await test("⑧ F6-63/F6-14 fmt 边界与数值归一：千分位小数位/负价/涨跌舍入/市值进位/数字字符串不抛错", () => {
  assert.equal(inPage("fmtPrice(2127.5)"), "2,127.50", "≥1000 应补足两位小数");
  assert.equal(inPage("fmtPrice(-5)"), "—", "负价应显「—」而非 0");
  assert.equal(inPage("fmtPrice('12.34')"), "12.34", "数字字符串应归一后格式化（F6-14）");
  assert.equal(inPage("fmtPrice('abc')"), "—", "非数应显「—」");
  assert.equal(inPage("fmtPct(-0.04)"), "0.0%", "舍入后为 0 的涨跌幅不带负号");
  assert.equal(inPage("chgCls(-0.04)"), "", "舍入后为 0 的涨跌幅不着色");
  assert.equal(inPage("fmtPct('2.34')"), "+2.3%");
  assert.equal(inPage("fmtMcap(9.9995e11)"), "$1万亿", "亿位进位达 10000 应提升万亿重算");
  assert.equal(inPage("fmtMcap('500000000')"), "$5亿");
  // 数字字符串实时价喂整表渲染：不得抛 TypeError 中断（F6-14 回归）
  const keep = liveCoins["solana"];
  liveCoins["solana"] = { ...keep, price: "12.34" };
  inPage("rebuildDerived(); render();");
  assert.equal(tbody.mainRows().length, 200, "畸形字段下整表仍应渲染 200 行");
  const sol = tbody.mainRows().find((tr) => tr.id === "row-solana");
  assert.ok(sol.children[4].innerHTML.includes("12.34"), "字符串价应归一显示");
  liveCoins["solana"] = keep;
  inPage("rebuildDerived(); render();");
});

await test("⑨ F6-13/F6-18 实时字段 0 与 null：mcapUsd=0 主表/详情同显「—」、price=0 不回退快照、volume24h=null 显占位", () => {
  const keep = liveCoins["solana"];
  liveCoins["solana"] = { ...keep, mcapUsd: 0, price: 0, volume24h: null, rank: null };
  inPage("rebuildDerived()");
  assert.equal(inPage("effMcap(COINS.find((c) => c.coingeckoId === 'solana'))"), null, "mcapUsd=0 应按缺失处理");
  assert.equal(inPage("effPrice(COINS.find((c) => c.coingeckoId === 'solana'))"), null, "price=0 应按缺失处理、不得回退快照价算倍数");
  const cells = JSON.parse(JSON.stringify(inPage("rowCells(COINS.find((c) => c.coingeckoId === 'solana'))")));
  assert.equal(cells[6][1], "—", "主表市值应显「—」而非快照市值");
  assert.equal(cells[4][1], "—", "主表价格应显「—」");
  const out = inPage("detailHTML(COINS.find((c) => c.coingeckoId === 'solana'))");
  const mcapSeg = /<dt>实时市值<\/dt><dd>([\s\S]*?)<\/dd>/.exec(out);
  assert.equal(mcapSeg[1], "—", "详情实时市值应与主表一致显「—」");
  const volSeg = /<dt>24h 成交量（实时）<\/dt><dd>([\s\S]*?)<\/dd>/.exec(out);
  assert.equal(volSeg[1], "—（无实时数据）", "volume24h=null 应显占位且不抛错（F6-18）");
  liveCoins["solana"] = keep;
  inPage("rebuildDerived()");
});

await test("⑩ F6-59 decodeCoinsData 健全性校验：fields 改名/行形变即 throw 走快照兜底", () => {
  ctx.__goodDoc = coinsDoc;
  assert.equal(inPage("decodeCoinsData(__goodDoc).length"), 200, "正常文档应解码 200 条");
  ctx.__bad1 = { meta: { fields: coinsDoc.meta.fields.map((f) => (f === "coingeckoId" ? "cgId" : f)) }, rows: coinsDoc.rows };
  assert.equal(inPage("try { decodeCoinsData(__bad1); 'no-throw' } catch (e) { 'threw' }"), "threw", "coingeckoId 改名应被校验拦下");
  ctx.__bad2 = { meta: { fields: coinsDoc.meta.fields }, rows: coinsDoc.rows.map((r) => ({ 0: r[0] })) };
  assert.equal(inPage("try { decodeCoinsData(__bad2); 'no-throw' } catch (e) { 'threw' }"), "threw", "行元素为对象应被校验拦下");
  delete ctx.__goodDoc; delete ctx.__bad1; delete ctx.__bad2;
});

await test("⑪ F6-68 搜索口径：coingeckoId 可搜、跨界子串不再误命中", () => {
  const btcBlob = inPage("COINS.find((c) => c.coingeckoId === 'bitcoin')._d.searchBlob");
  assert.ok(!btcBlob.includes("nbt"), "\"nbt\" 不应跨界命中 bitcoin+btc 拼接");
  const q = registry.get("q");
  q.value = "avalanche-2";
  assert.deepEqual(Array.from(inPage("currentFiltered().map((c) => c.coingeckoId)")), ["avalanche-2"], "粘贴 coingeckoId 应恰命中对应币");
  q.value = "nbt";
  assert.ok(!Array.from(inPage("currentFiltered().map((c) => c.coingeckoId)")).includes("bitcoin"), "\"nbt\" 过滤结果不应含 bitcoin");
  q.value = "";
});

await test("⑫ F6-57 patchInPlace 刷新已展开详情：实时到达后详情以最新 detailHTML 重建", async () => {
  boardLive = false; // 本场景独立上下文：先快照态展开、再喂 live 触发修补
  const c2 = buildContext();
  const inPage2 = (expr) => vm.runInContext(expr, c2.ctx);
  await settle();
  const btcTr = c2.tbody.mainRows().find((tr) => tr.id === "row-bitcoin");
  const btn = { dataset: { exp: "bitcoin" }, textContent: "▸", setAttribute() {}, removeAttribute() {}, closest: () => btcTr };
  c2.ctx.__btn = btn;
  inPage2("toggleExpand('bitcoin', __btn)");
  const det0 = c2.tbody._nodes[c2.tbody._nodes.indexOf(btcTr) + 1];
  assert.ok(det0 && det0.id === "d-bitcoin", "快照态展开应插入详情行");
  assert.ok(det0.children[0].innerHTML.includes("无实时数据"), "修补前详情应为「无实时数据」旧值");
  boardLive = true;
  await inPage2("loadBoard()");
  await settle();
  assert.equal(inPage2("livePatchCount"), 1, "应走原地修补路径");
  const btcTr2 = c2.tbody.mainRows().find((tr) => tr.id === "row-bitcoin");
  const det = c2.tbody._nodes[c2.tbody._nodes.indexOf(btcTr2) + 1];
  assert.ok(det && det.id === "d-bitcoin", "详情行应随主行保留");
  const expectMcap = inPage2(`fmtMcap(${coinById.get("bitcoin").snapshotMcapUsd})`);
  assert.ok(det.children[0].innerHTML.includes(expectMcap), "详情应以最新实时市值重建");
  assert.ok(!det.children[0].innerHTML.includes("无实时数据"), "详情不应再残留旧的「无实时数据」");
  delete c2.ctx.__btn;
});

await test("⑬ F6-62 delayed 模式：横幅中性文案「行情延迟约 X 分钟」、不误称上游不可达", async () => {
  boardPayloadOverride = {
    mode: "delayed", stale: false, staleAgeSec: 1200,
    updatedAt: new Date().toISOString(), snapshotDate: "2026-11-08",
    coins: liveCoins,
    global: { totalMcapUsd: 4.28e12, btcDominance: 57.1, totalMcapChange24h: 2.34 },
    coverage: { expected: 200, returned: 200, missingIds: [] },
  };
  boardLive = true;
  const c3 = buildContext();
  const inPage3 = (expr) => vm.runInContext(expr, c3.ctx);
  await settle();
  assert.equal(inPage3("boardMode()"), "delayed", "boardMode 应显式识别 delayed");
  const banner = c3.registry.get("statusBanner").textContent;
  assert.ok(banner.includes("行情延迟约 20 分钟"), "横幅应为延迟中性文案，实际：" + banner);
  assert.ok(!banner.includes("上游暂不可达"), "delayed 不得误称上游不可达");
  assert.ok(c3.registry.get("liveBadge").textContent.includes("行情延迟"), "徽标应为行情延迟");
  boardPayloadOverride = null;
});

await test("⑭ F6-65 自选落盘保留原始 id 集：不在榜单的自选不被保存冲掉且有显性标注", async () => {
  const c4 = buildContext({ seedWatch: JSON.stringify(["solana", "ghost-coin-xyz"]) });
  const inPage4 = (expr) => vm.runInContext(expr, c4.ctx);
  await settle();
  assert.equal(inPage4("watchSet.has('solana')"), true);
  assert.equal(inPage4("watchSet.has('ghost-coin-xyz')"), false, "显示集应过滤不在榜单的 id");
  assert.equal(inPage4("watchRawSet.has('ghost-coin-xyz')"), true, "原始集应保留不在榜单的 id");
  assert.equal(inPage4("watchOffBoard"), 1);
  assert.ok(inPage4("metaText(200, 200, 200)").includes("1 个自选已不在榜单"), "计数文案应标注不在榜单的自选数");
  inPage4("toggleStar('ethereum')");
  await settle(3, 60); // saveWatch 防抖 100ms
  const saved = JSON.parse(c4.lsStore.get("top200.watchlist.v1") || "[]");
  assert.ok(saved.includes("ghost-coin-xyz") && saved.includes("solana") && saved.includes("ethereum"),
    "落盘应为原始集（含不在榜单 id），实际：" + JSON.stringify(saved));
});

await test("⑮ F6-54 coins 加载失败态下点星不覆写已存自选", async () => {
  const c5 = buildContext({ seedWatch: JSON.stringify(["solana"]), coinsFail: true });
  const inPage5 = (expr) => vm.runInContext(expr, c5.ctx);
  await settle();
  assert.equal(inPage5("COINS.length"), 0, "coins 失败态 COINS 应为空");
  assert.equal(inPage5("watchSet.has('solana')"), true, "失败态下自选应已由 init 最前按原始数组载入");
  inPage5("toggleStar('bitcoin')");
  await settle(3, 60); // saveWatch 防抖 100ms
  const saved = JSON.parse(c5.lsStore.get("top200.watchlist.v1") || "[]");
  assert.deepEqual([...saved].sort(), ["bitcoin", "solana"], "旧自选不得被失败态点星冲掉");
});

await test("⑯ W5 aria-controls 全量关联：快照静态行/JS 模板行/patchInPlace 修补后均 200/200 且指向详情行 id", async () => {
  const pairCheck = (htmlStr, label) => {
    const btns = [...htmlStr.matchAll(/<button class='exp'[^>]*>/g)].map((m) => m[0]);
    assert.equal(btns.length, 200, `${label}：展开按钮应为 200 个，实际 ${btns.length}`);
    for (const b of btns) {
      const exp = /data-exp='([^']+)'/.exec(b)[1];
      const ctl = /aria-controls='([^']+)'/.exec(b);
      assert.ok(ctl, `${label}：${exp} 缺 aria-controls`);
      assert.equal(ctl[1], "d-" + exp, `${label}：${exp} 的 aria-controls 应指向 d-${exp}，实际 ${ctl[1]}`);
      assert.ok(/aria-expanded='(true|false)'/.test(b), `${label}：${exp} 缺 aria-expanded`);
    }
  };
  // (a) 构建期快照静态行（文件原文 tbody）
  const tbodyInit = html.match(/<tbody id="tbodyA">([\s\S]*?)<\/tbody>/)[1];
  pairCheck(tbodyInit, "快照静态行");
  // (b) JS 模板整表渲染（rowHTML × 200）
  boardLive = false; // 先快照态建上下文，保证 (c) 走真实 patchInPlace 路径
  const c6 = buildContext();
  const inPage6 = (expr) => vm.runInContext(expr, c6.ctx);
  await settle();
  pairCheck(inPage6("COINS.map((c) => rowHTML(c)).join('')"), "JS 模板行");
  // (c) patchInPlace 修补后：按钮随单元格 innerHTML 重建，aria-controls 不得丢失
  boardLive = true;
  await inPage6("loadBoard()");
  await settle();
  assert.equal(inPage6("livePatched"), true, "应走 patchInPlace 路径");
  pairCheck(c6.tbody.innerHTML, "patchInPlace 修补后");
  // (d) toggleExpand 属性同步：展开 aria-expanded=true 且 aria-controls 与实际插入的详情行 id 一致；收起保留 aria-controls
  const btcTr = c6.tbody.mainRows().find((tr) => tr.id === "row-bitcoin");
  const attrs = {};
  const btn = { dataset: { exp: "bitcoin" }, textContent: "▸",
    setAttribute(k, v) { attrs[k] = String(v); }, removeAttribute(k) { delete attrs[k]; },
    closest: () => btcTr };
  c6.ctx.__btn6 = btn;
  inPage6("toggleExpand('bitcoin', __btn6)");
  assert.equal(attrs["aria-expanded"], "true", "展开后 aria-expanded 应为 true");
  assert.equal(attrs["aria-controls"], "d-bitcoin");
  const det = c6.tbody._nodes[c6.tbody._nodes.indexOf(btcTr) + 1];
  assert.ok(det && det.id === attrs["aria-controls"], "aria-controls 应指向实际插入的详情行");
  inPage6("toggleExpand('bitcoin', __btn6)");
  assert.equal(attrs["aria-expanded"], "false", "收起后 aria-expanded 应为 false");
  assert.equal(attrs["aria-controls"], "d-bitcoin", "收起后 aria-controls 应保留");
  delete c6.ctx.__btn6;
});

await test("⑰ W5/F7-34 展开按钮命中域定版：基础档视觉 28，::after 上/下/左扩 8、右扩 4（止于星标左缘不侵入），有效 40×44；本体 44 的档位扩展收回", () => {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const base = /\.exp\{background:none;border:1px solid var\(--line-strong\)[^}]*?min-width:(\d+)px;min-height:(\d+)px/.exec(style);
  assert.ok(base, "应找到 .exp 基础规则");
  const bw = Number(base[1]), bh = Number(base[2]);
  // F7-34：inset 四值 = 上 -8 / 右 -4 / 下 -8 / 左 -8；右扩 4 恰填 .exp 的 margin-right:4px
  // 间隙（星标左缘 = .exp 右缘 + 4），不得再以单值 -8px 侵入星标命中域。
  const ext = /\.exp::after\{content:"";position:absolute;inset:-(\d+)px -(\d+)px -(\d+)px -(\d+)px\}/.exec(style);
  assert.ok(ext, "应找到 .exp::after 四值 inset 命中扩展规则");
  const [eT, eR, eB, eL] = [Number(ext[1]), Number(ext[2]), Number(ext[3]), Number(ext[4])];
  assert.equal(bh + eT + eB, 44, "纵向有效命中域应维持 44（28+8+8）");
  assert.equal(eR, 4, "右扩应恰为 4px（= margin-right 间隙），止于星标左缘");
  assert.equal(bw + eL + eR, 40, "横向有效命中域应为 40（28+8+4，不侵星标约束下的最大值）");
  assert.ok(/\.exp\{[^}]*margin-right:4px/.test(style), ".exp margin-right 应为 4px（星标左缘几何前提）");
  // ≤640 与粗指针 ≥641 两档本体已 44×44，对应 ::after 必须收回 inset:0（命中域恰 44、不再外扩）
  assert.ok(/\.exp\{min-width:44px;min-height:44px\}/.test(style), "≤640 档 .exp 本体应为 44×44");
  assert.equal((style.match(/\.exp::after\{inset:0\}/g) || []).length, 2, "两档本体 44 的媒体查询内应各有一处 ::after{inset:0} 收回");
  // 级联顺序回归（W5 实测教训）：≤640 档 44px 规则必须位于基础 .exp 规则之后，
  // 否则同特异性被基础 28px 覆盖而失效（修复前 computed min-width 实测恒 28px）
  const baseIdx = style.indexOf(".exp{background:none");
  const lateIdx = style.indexOf("@media (max-width:640px){.exp{min-width:44px");
  assert.ok(baseIdx >= 0 && lateIdx > baseIdx, "≤640 档 .exp 44px 规则必须在基础 .exp 规则之后（级联顺序）");
});

await test("⑱ W5 SRI 处置守卫：全站外部脚本仅 CF beacon 一支（两页各一）且无 integrity——处置登记见 security-baseline §5.4", () => {
  const priv = readFileSync(new URL("../public/privacy/index.html", import.meta.url), "utf-8");
  const tags = [];
  for (const doc of [html, priv]) {
    for (const m of doc.matchAll(/<script\b[^>]*\bsrc=['"](https?:[^'"]+)['"][^>]*>/g)) tags.push(m);
  }
  assert.equal(tags.length, 2, `外部脚本应恰为两页各一支 beacon，实际 ${tags.length} 支`);
  for (const m of tags) {
    assert.equal(m[1], "https://static.cloudflareinsights.com/beacon.min.js", "外部脚本只允许 CF Web Analytics beacon");
    assert.ok(!/integrity=/.test(m[0]), "beacon 不得带 integrity（CF 不支持版本锁定、内容随版本更新，见 §5.4 接受登记）；变更处置须先改登记再改本断言");
  }
});

await test("⑲ F7-38/F7-35/F7-36/F7-37 第七期前端定版：decode 全行校验、hash/排序防 NaN、† 与 th-sort 命中域、≤640 五列几何", () => {
  // F7-38：后段行（第 50 行）symbol 为数字 → decodeCoinsData 应整表 throw 走快照兜底
  const badDoc = JSON.parse(JSON.stringify(coinsDoc));
  const si = coinsDoc.meta.fields.indexOf("symbol");
  badDoc.rows[49][si] = 123;
  ctx.__badDoc = badDoc;
  assert.equal(inPage("try { decodeCoinsData(__badDoc); 'no-throw' } catch (e) { 'threw' }"), "threw", "第 50 行 symbol 非字符串应被全行校验拦下");
  const badRank = JSON.parse(JSON.stringify(coinsDoc));
  badRank.rows[10][coinsDoc.meta.fields.indexOf("estRank")] = "11";
  ctx.__badRank = badRank;
  assert.equal(inPage("try { decodeCoinsData(__badRank); 'no-throw' } catch (e) { 'threw' }"), "threw", "estRank 为字符串应被全行校验拦下");
  delete ctx.__badDoc; delete ctx.__badRank;
  // hash 路径防御：即便 COINS 被注入畸形行，parseHashTarget 不得 TypeError
  ctx.__keepCoins = null;
  inPage("__keepCoins = COINS; COINS = [{ symbol: 123, coingeckoId: 9, estRank: 1 }, ...__keepCoins.slice(0, 3)]; location.hash = '#BTC'");
  assert.equal(inPage("try { parseHashTarget(); 'no-throw' } catch (e) { 'threw:' + e.constructor.name }"), "no-throw", "畸形 symbol 下 parseHashTarget 不得抛错");
  inPage("COINS = __keepCoins; location.hash = ''; delete __keepCoins");
  // 排序 tie-break 不产 NaN：estRank 字符串参与 cmpCoins 结果须为有限数
  const cmp = inPage("(() => { const a = { ...COINS[0], estRank: '5', _d: {} }, b = { ...COINS[1], estRank: 7, _d: {} }; const r = cmpRankTie(a, b); return Number.isFinite(r) ? 'finite' : 'nan'; })()");
  assert.equal(cmp, "finite", "cmpRankTie 对字符串 estRank 应产有限比较值");
  // CSS 定版断言（F7-35/36/37）
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  assert.ok(/button\.ath-flag::after\{content:"";position:absolute;inset:-16px -12px\}/.test(style), "† 按钮应有 ::after 命中扩展（约 33×45）");
  assert.ok(/@media \(pointer:coarse\) and \(min-width:641px\)\{[\s\S]*?\.th-sort\{min-height:44px\}/.test(style), "粗指针档 .th-sort 应为 44px");
  const m640 = /@media \(max-width:640px\)\{([\s\S]*?)\n  \}/.exec(style)[1];
  const cols = [...m640.matchAll(/col\.c-(rank|coin|price|est|mult)\{width:(\d+)px\}/g)];
  assert.equal(cols.length, 5, "≤640 应找到五列列宽");
  const sum = cols.reduce((s, m) => s + Number(m[2]), 0);
  assert.ok(sum <= 330, `≤640 五列总宽应 ≤330（360 视口 clientWidth），实际 ${sum}`);
  assert.ok(!/#thRank\{[^}]*clip:rect/.test(m640), "≤640 #thRank 不得再被 clip 视觉隐藏");
  assert.ok(/#thRank\{font-size:10px/.test(m640), "≤640 #thRank 应以可见小字号折行呈现");
});

const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\nfrontend-dom: ${results.length - failed.length}/${results.length} PASS`);
for (const [name, s] of failed) console.log(`红：${name}（见上方断言信息）`);
process.exit(failed.length ? 1 : 0);
