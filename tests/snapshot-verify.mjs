// tests/snapshot-verify.mjs — W2-17 静态快照注入校验（Node 24）
// ① 静态断言：标记区 <tr> =200、生成注释、noscript 定版、表注、无 href="#"；
// ② 逐行 diff：注入行（去掉 data-snapshot="1"）vs node 桩跑前端 rowHTML（快照模式，同份 coins.json）；
// ③ 失败路径桩测：board 500 / coins 取数失败 → tbody 不被触碰、横幅切「暂不可用」定版文案；
// ④ 成功路径：W3-05 口径——首次实时到达保住全部 200 行（快照标记清零、按实时序排列），
//    刷新 3 次行数恒 200 且 id 无重复。（W2-17 的「默认前 50 条」口径自 W3-05 起废止。）
// 运行：node tests/snapshot-verify.mjs（退出码 0 全过）

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf-8");
const coinsDoc = JSON.parse(readFileSync(new URL("../data/coins.json", import.meta.url), "utf-8"));
const generatedAt = coinsDoc.meta.generatedAt;
// W3-22：coins.json 为 rows 紧凑形态时按 meta.fields 解码（喂给页面脚本的仍是
// 原始文档，真实解码路径由页面内 decodeCoinsData 承担；此处仅供构造 live 载荷）。
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

// ---------- 静态断言 ----------
const regionMatch = html.match(/<!-- SNAPSHOT:BEGIN -->([\s\S]*?)<!-- SNAPSHOT:END -->/);
assert.ok(regionMatch, "SNAPSHOT 标记区存在");
const region = regionMatch[1];
const staticRows = region.split("\n").filter((l) => l.startsWith("<tr"));
const staticRowsStripped = staticRows.map((l) => l.replace(' data-snapshot="1"', ""));

await test("① 静态：标记区 200 行 + 生成注释 + 三态默认横幅", () => {
  assert.equal(staticRows.length, 200, `标记区行数 ${staticRows.length} != 200`);
  assert.ok(staticRows.every((l) => l.includes('data-snapshot="1"')), "每行须带 data-snapshot");
  assert.ok(
    region.includes(`<!-- generated:${generatedAt} source:data/coins.json count:200 -->`),
    "生成注释含时间与来源"
  );
  assert.ok(
    html.includes('id="statusBanner"') && html.includes(`data-snapshot-at="${generatedAt}"`),
    "横幅带 data-snapshot-at"
  );
  assert.ok(!html.includes('href="#"'), '全页不得有 href="#"');
  assert.ok(
    html.includes("本站榜单由 JavaScript 加载实时行情。未启用 JavaScript 时，您看到的是页面构建时的快照榜单（见表注时间），数据可能不是最新。"),
    "noscript 定版文案在位"
  );
  assert.ok(html.includes("无实时数据时显示构建快照，生成时间见状态条。"), "常驻表注在位");
});

// ---------- DOM 桩 ----------
function makeElement(id, registry) {
  const classes = new Set();
  const el = {
    id,
    textContent: "",
    innerHTML: "",
    className: "",
    value: "",
    disabled: false,
    dataset: {},
    style: {},
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    setAttribute() {},
    removeAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    closest() { return null; },
    querySelector() { return null; },
    focus() {},
    scrollIntoView() {},
  };
  registry.set(id, el);
  return el;
}

function buildContext(fetchImpl) {
  const registry = new Map();
  const get = (id) => registry.get(id) || makeElement(id, registry);
  // 用真实文件里的 tbody 初始内容（注入行）初始化桩
  const tbodyInit = html.match(/<tbody id="tbodyA">([\s\S]*?)<\/tbody>/)[1];
  get("tbodyA").innerHTML = tbodyInit;
  const banner = get("statusBanner");
  banner.dataset.snapshotAt = generatedAt;
  const documentStub = {
    title: "t",
    getElementById: get,
    querySelector: () => makeElement("thead", new Map()),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const sandbox = {
    document: documentStub,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hash: "" },
    history: { replaceState() {} },
    fetch: fetchImpl,
    requestAnimationFrame: () => {},
    addEventListener() {},
    setTimeout,
    clearTimeout,
    console,
  };
  const ctx = vm.createContext(sandbox);
  const scriptSrc = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((s) => s.includes("function rowHTML"));
  assert.ok(scriptSrc, "主 script 抽取成功");
  vm.runInContext(scriptSrc, ctx);
  return { ctx, registry };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
};
const jsonRes = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

// ---------- 场景 A：逐行 diff + board 失败保留快照 ----------
{
  const fetchImpl = async (url) => {
    if (String(url).includes("coins.json")) return jsonRes(coinsDoc);
    return jsonRes({}, false, 500); // /api/board 故障
  };
  const { ctx, registry } = buildContext(fetchImpl);
  await settle();

  await test("② 逐行 diff：注入行 == 前端 rowHTML 快照渲染（diff=0）", () => {
    const frontRows = vm
      .runInContext(
        "[...COINS].sort((a,b)=>a.estRank-b.estRank).map((c)=>rowHTML(c)).join('\\n')",
        ctx
      )
      .split("\n");
    assert.equal(frontRows.length, 200);
    const diffs = [];
    for (let i = 0; i < 200; i++) {
      if (frontRows[i] !== staticRowsStripped[i]) {
        diffs.push(`行 ${i + 1}:\n  前端: ${frontRows[i]}\n  注入: ${staticRowsStripped[i]}`);
      }
    }
    assert.equal(diffs.length, 0, `逐行 diff 非零:\n${diffs.slice(0, 3).join("\n")}`);
  });

  await test("③ 失败路径（board 500）：tbody 不触碰 + 横幅切暂不可用文案", () => {
    const tbody = registry.get("tbodyA").innerHTML;
    assert.equal((tbody.match(/<tr/g) || []).length, 200, "快照行数应仍为 200");
    assert.ok(tbody.includes('data-snapshot="1"'), "注入行应原样保留");
    const expectTime = vm.runInContext(`fmtTimeStr(${JSON.stringify(generatedAt)})`, ctx);
    assert.equal(
      registry.get("statusBanner").textContent,
      `实时行情暂不可用，显示构建时快照 · 生成于 ${expectTime}`
    );
  });
}

// ---------- 场景 B：coins 取数失败 ----------
{
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const { ctx, registry } = buildContext(fetchImpl);
  await settle();
  await test("③ 失败路径（coins 取数失败）：tbody 不触碰 + 横幅暂不可用文案", () => {
    const tbody = registry.get("tbodyA").innerHTML;
    assert.equal((tbody.match(/<tr/g) || []).length, 200);
    assert.ok(tbody.includes('data-snapshot="1"'));
    const expectTime = vm.runInContext(`fmtTimeStr(${JSON.stringify(generatedAt)})`, ctx);
    assert.equal(
      registry.get("statusBanner").textContent,
      `实时行情暂不可用，显示构建时快照 · 生成于 ${expectTime}`
    );
  });
}

// ---------- 场景 C：成功原地修补口径 + 刷新 3 次幂等 ----------
{
  const liveCoins = {};
  for (const c of decodeCoinsDoc(coinsDoc)) {
    liveCoins[c.coingeckoId] = {
      price: c.snapshotPrice * 1.01,
      mcapUsd: c.snapshotMcapUsd,
      change24h: 1.23,
    };
  }
  const boardPayload = {
    mode: "live",
    stale: false,
    updatedAt: new Date().toISOString(),
    snapshotDate: "2026-11-08",
    coins: liveCoins,
    global: { totalMcapUsd: 4.28e12, btcDominance: 57.1, totalMcapChange24h: 2.34 },
  };
  const fetchImpl = async (url) => {
    if (String(url).includes("coins.json")) return jsonRes(coinsDoc);
    return jsonRes(boardPayload);
  };
  const { ctx, registry } = buildContext(fetchImpl);
  await settle();

  const rowIds = () =>
    [...registry.get("tbodyA").innerHTML.matchAll(/id='row-([^']+)'/g)].map((m) => m[1]);

  await test("④ 成功路径：首次实时到达保 200 行（快照标记清零+实时序）+ 刷新×3 恒 200 无重复", async () => {
    assert.ok(
      !registry.get("tbodyA").innerHTML.includes('data-snapshot="1"'),
      "成功后快照行标记应清零（原地修补或整表渲染均须去除）"
    );
    // W3-05：默认视图首次实时到达即为全部 200 行，不再塌缩为前 50 条。
    assert.equal(rowIds().length, 200, "首次实时到达后应保持 200 行");
    assert.equal(new Set(rowIds()).size, 200, "行 id 不得重复");
    const expectOrder = vm.runInContext(
      "[...COINS].sort(cmpCoins).map(function (c) { return c.coingeckoId; })",
      ctx
    );
    assert.equal(rowIds().join(","), expectOrder.join(","), "行序应与当前排序（默认实时排名）一致");
    for (let i = 1; i <= 3; i++) {
      await vm.runInContext("loadBoard()", ctx);
      const ids = rowIds();
      assert.equal(ids.length, 200, `第 ${i} 次刷新后行数 ${ids.length} != 200`);
      assert.equal(new Set(ids).size, 200, `第 ${i} 次刷新后出现重复行`);
    }
    assert.ok(registry.get("statusBanner").className.includes("live"), "横幅应为实时态");
  });
}

const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\nsnapshot-verify: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
