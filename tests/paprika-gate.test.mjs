// tests/paprika-gate.test.mjs — 第七期批 0（F7-01/F7-02/F7-15）新套件
// 覆盖：Paprika 身份判定（symbol+规范化 name/别名，价差不作证据）、四项门禁计数
// 分开统计与 94% 对齐、normalizePaprikaTickers/CG 字段清洗对齐、主流程 candidate
// preflight（门禁不过同 run 强制 CG 且 health 落 paprikaGate 分项计数）。
// 运行：node tests/paprika-gate.test.mjs（已登记于 tests/suites-manifest.json，
// 由 scripts/run-tests.sh 在部署门禁中全量执行；F8-29 修正过期注释）
// 第八期追加：F8-01 登记册身份回归、F8-02 市值合理性、F8-16 畸形 id 计数、
// F8-18 重复 paprikaId 去重、F8-15 paprikaGate 未测态、F8-17 preflight 失败记账。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KV_KEYS, normalizePaprikaTickers, normalizeCgMarkets, validateBlob, buildBlob } from "../shared/board-schema.js";
import { paprikaIdentityMatch, countPaprikaGateStats, normalizePaprikaName, diffPaprikaRegistry } from "../shared/paprika-identity.js";
import { evaluatePaprikaGate, paprikaGateThreshold } from "../workers/fetcher/src/source-state.js";
import { PAPRIKA_IDENTITY_REGISTRY } from "../workers/fetcher/src/paprika-registry.js";
import { COINS as FETCHER_COINS } from "../workers/fetcher/src/coins-list.js";
import { decodeCoins } from "../scripts/decode-coins.mjs";
import fetcher, { runFetch } from "../workers/fetcher/src/index.js";

const originalFetch = globalThis.fetch;
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

// ---------- F7-01 身份判定 ----------
await test("F7-01: 3 条错配旧值身份不符、修正值身份相符（同 symbol 异资产被 name 拦下）", async () => {
  const cases = [
    [{ name: "Pump.fun", symbol: "PUMP" }, { id: "pump-pumpbtc", name: "PumpBTC", symbol: "PUMP" }, { id: "pump-pumpfun", name: "Pump.fun", symbol: "PUMP" }],
    [{ name: "Sky", symbol: "SKY" }, { id: "sky-skycoin", name: "Skycoin", symbol: "SKY" }, { id: "sky-sky", name: "Sky", symbol: "SKY" }],
    [{ name: "Seeker", symbol: "SKR" }, { id: "skr-saakuru-labs", name: "Saakuru", symbol: "SKR" }, { id: "skr-seeker", name: "Seeker", symbol: "SKR" }],
  ];
  for (const [local, wrong, right] of cases) {
    assert.equal(paprikaIdentityMatch(local, wrong).ok, false, `${wrong.id} 应被判身份不符`);
    assert.equal(paprikaIdentityMatch(local, right).ok, true, `${right.id} 应被判身份相符`);
  }
});

await test("F7-01: 通用后缀/别名/符号空白均按定版口径通过，异名同 symbol 不通过", async () => {
  assert.equal(paprikaIdentityMatch({ name: "Litecoin", symbol: "LTC" }, { id: "ltc-litecoin-token", name: "Litecoin Token", symbol: "LTC" }).ok, true);
  assert.equal(paprikaIdentityMatch({ name: "EigenCloud", symbol: "EIGEN" }, { id: "eigen-eigenlayer", name: "Eigenlayer", symbol: "EIGEN" }).via, "alias");
  assert.equal(paprikaIdentityMatch({ name: "Zebec Network", symbol: "ZBCN" }, { id: "zbcn-zebec-network", name: "Zebec Network", symbol: "ZBCN " }).ok, true, "目录 symbol 带尾随空白须 trim 后比对");
  assert.equal(paprikaIdentityMatch({ name: "Gate", symbol: "GT" }, { id: "gt-gatechain-token", name: "GateToken", symbol: "GT" }).ok, true, "驼峰拆分");
  assert.equal(normalizePaprikaName("UltimaEcosystem"), "ultima");
  assert.equal(paprikaIdentityMatch({ name: "Cosmos Hub", symbol: "ATOM" }, { id: "atom-cosmos-token", name: "Cosmos Token", symbol: "ATOM" }).ok, true);
  assert.equal(paprikaIdentityMatch({ name: "Filecoin", symbol: "FIL" }, { id: "fil-filecoin", name: "Filecoin", symbol: "FIL2" }).ok, false, "symbol 不符必拒");
});

// ---------- F7-02 四项计数与门禁 ----------
const DIR = [
  { id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", is_active: true, rank: 1 },
  { id: "eth-ethereum", name: "Ethereum", symbol: "ETH", is_active: true, rank: 2 },
  { id: "yzy-yzy", name: "YZY", symbol: "YZY", is_active: false, rank: 0 },
  { id: "x-wrong", name: "Other Asset", symbol: "X", is_active: true, rank: 9 },
];
const TICKS = [
  { id: "btc-bitcoin", quotes: { USD: { price: 100 } } },
  { id: "eth-ethereum", quotes: { USD: { price: null } } },
  { id: "yzy-yzy", quotes: { USD: { price: 1 } } },
];
const GATE_COINS = [
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC", paprikaId: "btc-bitcoin" },
  { id: "ethereum", name: "Ethereum", symbol: "ETH", paprikaId: "eth-ethereum" },
  { id: "yzy", name: "YZY", symbol: "YZY", paprikaId: "yzy-yzy" },
  { id: "xcoin", name: "X Coin", symbol: "X", paprikaId: "x-wrong" },
  { id: "none", name: "None", symbol: "NON", paprikaId: null },
  { id: "badtype", name: "Bad", symbol: "BAD", paprikaId: 42 },
];
await test("F7-02: 四项计数分开统计——非空≠身份有效≠活跃≠命中；yzy 下线不计活跃；畸形 paprikaId 不计 mapped", async () => {
  const s = countPaprikaGateStats(GATE_COINS, DIR, TICKS);
  assert.equal(s.total, 6);
  assert.equal(s.mapped, 4, "仅非空字符串计 mapped（null 与数字 42 不计）");
  assert.equal(s.identityValid, 3, "x-wrong 身份不符被剔");
  assert.equal(s.activeUsable, 2, "yzy is_active=false 不计活跃可用");
  assert.equal(s.tickerHit, 1, "eth 报价 null 不计命中");
});

await test("F7-02: evaluatePaprikaGate 与发布门禁 94% 对齐（200→188），任一计数不足即不放行", async () => {
  assert.equal(paprikaGateThreshold(200), 188);
  assert.equal(paprikaGateThreshold(4), 4);
  const ok = evaluatePaprikaGate({ mapped: 196, identityValid: 196, activeUsable: 195, tickerHit: 188 }, 200);
  assert.equal(ok.ok, true);
  const bad = evaluatePaprikaGate({ mapped: 196, identityValid: 196, activeUsable: 195, tickerHit: 179 }, 200);
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.some((f) => f.startsWith("tickerHit 179/200")));
  const mappedOnly = evaluatePaprikaGate({ mapped: 200, identityValid: 100, activeUsable: 100, tickerHit: 100 }, 200);
  assert.equal(mappedOnly.ok, false, "mapped 满格不得冒充其余计数放行");
});

// ---------- F7-15 字段清洗对齐 ----------
await test("F7-15: normalizePaprikaTickers 坏值置 null 并计数，不再透传脏值", async () => {
  const tickers = [
    { id: "btc-bitcoin", rank: 1, quotes: { USD: { price: 100, market_cap: 1000, volume_24h: 50, percent_change_24h: -2.5 } } },
    { id: "eth-ethereum", rank: 0, quotes: { USD: { price: "3123", market_cap: -5, volume_24h: Infinity, percent_change_24h: "up" } } },
    { id: "sol-solana", rank: 2.5, quotes: { USD: { price: 10, market_cap: 100, volume_24h: 5, percent_change_24h: 1 } } },
  ];
  const coins = [
    { id: "bitcoin", paprikaId: "btc-bitcoin" },
    { id: "ethereum", paprikaId: "eth-ethereum" },
    { id: "solana", paprikaId: "sol-solana" },
  ];
  const { rows, invalidFields } = normalizePaprikaTickers(tickers, coins);
  const eth = rows.find((r) => r.id === "ethereum");
  assert.deepEqual(
    { price: eth.price, mcapUsd: eth.mcapUsd, volume24h: eth.volume24h, change24h: eth.change24h, rank: eth.rank },
    { price: null, mcapUsd: null, volume24h: null, change24h: null, rank: null }
  );
  assert.equal(rows.find((r) => r.id === "solana").rank, null, "非整数 rank 置 null");
  assert.equal(rows.find((r) => r.id === "bitcoin").change24h, -2.5, "合法负 change24h 保留");
  assert.equal(invalidFields.price, 1);
  assert.equal(invalidFields.mcapUsd, 1);
  assert.equal(invalidFields.volume24h, 1);
  assert.equal(invalidFields.change24h, 1);
  assert.equal(invalidFields.rank, 2);
  assert.equal(invalidFields.total, 6);
});

await test("F7-15: CG 路径 change24h/rank 同口径清洗；validateBlob 对坏 rank/change 整 blob 拒绝", async () => {
  const { rows, invalidFields } = normalizeCgMarkets(
    [{ id: "bitcoin", current_price: 100, market_cap: 1000, market_cap_rank: "1", price_change_percentage_24h_in_currency: NaN, total_volume: 5 }],
    ["bitcoin"]
  );
  assert.equal(rows[0].rank, null);
  assert.equal(rows[0].change24h, null);
  assert.equal(invalidFields.rank, 1);
  assert.equal(invalidFields.change24h, 1);
  const blob = buildBlob({
    source: "coinpaprika",
    fetchRunId: "r1",
    fetchedAtMs: Date.now(),
    rows: [{ id: "bitcoin", price: 100, mcapUsd: 1000, rank: -3, change24h: 1, volume24h: 5, _src: "coinpaprika" }],
    coverage: { expected: 1, returned: 1, missingIds: [] },
    global: null,
  });
  const v = validateBlob(blob);
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("row_field_invalid"));
});

// ---------- F7-02 主流程 preflight ----------
function makeKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) {
      const v = store.get(key);
      if (v == null) return null;
      return opts && opts.type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, String(value)); },
  };
}
function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const RUN_COINS = [
  { id: "bitcoin", paprikaId: "btc-bitcoin" },
  { id: "ethereum", paprikaId: "eth-ethereum" },
  { id: "solana", paprikaId: "sol-solana" },
  { id: "filecoin", paprikaId: "fil-filecoin" },
];
const RUN_IDS = RUN_COINS.map((c) => c.id);
const NOW = Date.UTC(2026, 10, 23, 5, 0, 0);
function baseEnv(kv, extra = {}) {
  return { BOARD_KV: kv, COINGECKO_API_KEY: "test-key-not-real", PAPRIKA_ENABLED: "true", BOARD_SOURCE: "coinpaprika", BOARD_TARGET_KEY: "current", ...extra };
}
function installMock({ paprikaTickersMissing = [] } = {}) {
  const counts = { cg: 0, paprikaCoins: 0, paprikaTickers: 0 };
  const dir = RUN_COINS.map((c, i) => ({ id: c.paprikaId, name: c.id, symbol: c.paprikaId.split("-")[0], is_active: true, rank: i + 1 }));
  // 身份判定（运行时 symbol-prefix 形态）只需目录 symbol 与 paprikaId 前缀一致
  for (const d of dir) d.symbol = d.id.split("-")[0].toUpperCase();
  const ticks = RUN_COINS.filter((c) => !paprikaTickersMissing.includes(c.id)).map((c, i) => ({
    // market_cap 须与登记册 CG 快照市值量级相符（F8-02 合理性校验），取足够大值
    id: c.paprikaId, rank: i + 1, quotes: { USD: { price: 100 + i, market_cap: 2e12, volume_24h: 500, percent_change_24h: 1 } },
  }));
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.coinpaprika.com/v1/coins")) { counts.paprikaCoins += 1; return jsonRes(dir); }
    if (u.includes("api.coinpaprika.com/v1/tickers")) { counts.paprikaTickers += 1; return jsonRes(ticks); }
    if (u.includes("api.coinpaprika.com/v1/global")) return jsonRes({ market_cap_usd: 999, bitcoin_dominance_percentage: 55, market_cap_change_24h: 1 });
    if (u.includes("coingecko.com")) {
      counts.cg += 1;
      if (u.includes("/coins/markets")) {
        const ids = new URL(u).searchParams.get("ids").split(",");
        return jsonRes(ids.map((id, i) => ({ id, current_price: 100 + i, market_cap: 10000, market_cap_rank: i + 1, price_change_percentage_24h_in_currency: 1, total_volume: 500 })));
      }
      return jsonRes({ data: { total_market_cap: { usd: 999 }, market_cap_percentage: { btc: 55 }, market_cap_change_percentage_24h_usd: 1 } });
    }
    throw new Error("unexpected " + u);
  };
  return counts;
}

await test("F7-02 主流程: 门禁四项达标（4/4）→ Paprika 放行、health.paprikaGate 分项落盘", async () => {
  const kv = makeKv();
  const counts = installMock();
  const r = await runFetch(baseEnv(kv), { coins: RUN_COINS, ids: RUN_IDS, nowMs: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.provider, "coinpaprika");
  assert.ok(counts.paprikaCoins >= 1 && counts.paprikaTickers >= 1, "preflight 应拉目录+tickers");
  const health = JSON.parse(kv.store.get(KV_KEYS.health));
  assert.deepEqual(
    { mapped: health.paprikaGate.mapped, identityValid: health.paprikaGate.identityValid, activeUsable: health.paprikaGate.activeUsable, tickerHit: health.paprikaGate.tickerHit, ok: health.paprikaGate.ok },
    { mapped: 4, identityValid: 4, activeUsable: 4, tickerHit: 4, ok: true }
  );
  assert.equal(health.paprikaMappedCount, 4);
});

await test("F7-02 主流程: tickerHit 不足（3/4 < 94%）→ 同 run 强制 CG、health 记门禁分项、Paprika 主抓不发生", async () => {
  const kv = makeKv();
  const counts = installMock({ paprikaTickersMissing: ["filecoin"] });
  const r = await runFetch(baseEnv(kv), { coins: RUN_COINS, ids: RUN_IDS, nowMs: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.provider, "coingecko", "门禁不过必须同 run 回 CG");
  assert.ok(counts.cg >= 1);
  const health = JSON.parse(kv.store.get(KV_KEYS.health));
  assert.equal(health.paprikaGate.ok, false);
  assert.equal(health.paprikaGate.tickerHit, 3);
  assert.equal(health.paprikaGate.mapped, 4);
});

await test("F7-02 主流程: PAPRIKA_ENABLED=false（生产现状）→ 零 Paprika 调用、paprikaGate=null、走 CG", async () => {
  const kv = makeKv();
  const counts = installMock();
  const r = await runFetch(baseEnv(kv, { PAPRIKA_ENABLED: "false" }), { coins: RUN_COINS, ids: RUN_IDS, nowMs: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.provider, "coingecko");
  assert.equal(counts.paprikaCoins, 0, "CG 正常路径不得有 Paprika preflight 额外调用");
  assert.equal(counts.paprikaTickers, 0);
  const health = JSON.parse(kv.store.get(KV_KEYS.health));
  assert.equal(health.paprikaGate, null);
});

// ---------- 第八期批 0：F8-01/F8-02/F8-16/F8-18 ----------
await test("F8-01: F7-01 三个旧错配值以运行时形态（只有 {id, paprikaId}）+ 登记册喂入 → identityValid 必须拦下（不得全过）", async () => {
  const dir = [
    { id: "pump-pumpbtc", name: "PumpBTC", symbol: "PUMP", is_active: true, rank: 1418 },
    { id: "sky-skycoin", name: "Skycoin", symbol: "SKY", is_active: true, rank: 1378 },
    { id: "skr-saakuru-labs", name: "Saakuru", symbol: "SKR", is_active: true, rank: 831 },
  ];
  const ticks = dir.map((d) => ({ id: d.id, quotes: { USD: { price: 1, market_cap: 1e9 } } }));
  const runtimeCoins = [
    { id: "pump-fun", paprikaId: "pump-pumpbtc" },
    { id: "sky", paprikaId: "sky-skycoin" },
    { id: "seeker", paprikaId: "skr-saakuru-labs" },
  ];
  const s = countPaprikaGateStats(runtimeCoins, dir, ticks, { registry: PAPRIKA_IDENTITY_REGISTRY });
  assert.equal(s.mapped, 3);
  assert.equal(s.identityValid, 0, "旧错配值不得再以自洽校验通过身份门禁");
  assert.equal(s.tickerHit, 0);
  assert.ok(s.failures.every((f) => f.stage === "identity" && f.reason === "registry_missing"));
  // 对照：不传登记册的旧退化口径会 3/3 全过——证明登记册是拦截来源
  const legacy = countPaprikaGateStats(runtimeCoins, dir, ticks);
  assert.equal(legacy.identityValid, 3, "无登记册旧口径自洽全过（F8-01 证据形态）");
});

await test("F8-01: 登记册与币表一致性强制校验——coins-list + data/coins.json 与登记册逐条对齐，篡改映射必红", async () => {
  const dataCoins = decodeCoins(JSON.parse(readFileSync(new URL("../data/coins.json", import.meta.url), "utf-8"))).map((c) => ({
    id: c.coingeckoId, name: c.name, symbol: c.symbol, snapshotMcapUsd: c.snapshotMcapUsd, paprikaId: c.paprikaId,
  }));
  assert.deepEqual(diffPaprikaRegistry(dataCoins, PAPRIKA_IDENTITY_REGISTRY), []);
  const listCoins = FETCHER_COINS.map((c) => {
    const d = dataCoins.find((x) => x.id === c.id);
    return { id: c.id, name: d.name, symbol: d.symbol, snapshotMcapUsd: d.snapshotMcapUsd, paprikaId: c.paprikaId };
  });
  assert.deepEqual(diffPaprikaRegistry(listCoins, PAPRIKA_IDENTITY_REGISTRY), []);
  const tampered = listCoins.map((c) => (c.id === "bitcoin" ? { ...c, paprikaId: "btc-bitcoin-token" } : c));
  assert.ok(diffPaprikaRegistry(tampered, PAPRIKA_IDENTITY_REGISTRY).length > 0, "映射变更未同步登记册必须被检出");
});

await test("F8-02: 市值合理性校验拦下原三条 -token 次级条目、放行主条目；htx 走已登记例外且留痕", async () => {
  const dir = [
    { id: "atom-cosmos-token", name: "Cosmos Token", symbol: "ATOM", is_active: true, rank: 1107 },
    { id: "atom-cosmos", name: "Cosmos", symbol: "ATOM", is_active: true, rank: 108 },
    { id: "ltc-litecoin-token", name: "Litecoin Token", symbol: "LTC", is_active: true, rank: 424 },
    { id: "zec-zcash-token", name: "Zcash Token", symbol: "ZEC", is_active: true, rank: 235 },
    { id: "htx-htx", name: "HTX", symbol: "HTX", is_active: true, rank: 1273 },
  ];
  const ticks = [
    { id: "atom-cosmos-token", quotes: { USD: { price: 1.19, market_cap: 2631746 } } },
    { id: "atom-cosmos", quotes: { USD: { price: 1.19, market_cap: 465072701 } } },
    { id: "ltc-litecoin-token", quotes: { USD: { price: 40.6, market_cap: 30183558 } } },
    { id: "zec-zcash-token", quotes: { USD: { price: 793, market_cap: 94838502 } } },
    { id: "htx-htx", quotes: { USD: { price: 1.46e-6, market_cap: 1381990 } } },
  ];
  const coins = [
    { id: "cosmos", name: "Cosmos Hub", symbol: "ATOM", paprikaId: "atom-cosmos-token", snapshotMcapUsd: 739000000 },
    { id: "litecoin", name: "Litecoin", symbol: "LTC", paprikaId: "ltc-litecoin-token", snapshotMcapUsd: 3990000000 },
    { id: "zcash", name: "Zcash", symbol: "ZEC", paprikaId: "zec-zcash-token", snapshotMcapUsd: 19900000000 },
    { id: "htx-dao", name: "HTX DAO", symbol: "HTX", paprikaId: "htx-htx", snapshotMcapUsd: 1370000000 },
  ];
  const s = countPaprikaGateStats(coins, dir, ticks);
  assert.equal(s.identityValid, 4, "-token 条目身份（同名规范化）本身通过，拦截须来自合理性校验");
  assert.equal(s.tickerHit, 1, "仅 htx 经登记例外计入，其余三条 -token 须被合理性拦下");
  assert.equal(s.failures.filter((f) => f.stage === "plausibility").length, 3);
  assert.deepEqual(s.plausibilityExceptions.map((x) => x.paprikaId), ["htx-htx"]);
  const main = countPaprikaGateStats(
    [{ id: "cosmos", name: "Cosmos Hub", symbol: "ATOM", paprikaId: "atom-cosmos", snapshotMcapUsd: 739000000 }],
    dir, ticks
  );
  assert.equal(main.tickerHit, 1, "主条目 atom-cosmos 市值量级正常应放行");
});

await test("F8-16/F8-18: 畸形 paprikaId 不计 mapped；重复 paprikaId 只计一次", async () => {
  const dir = [{ id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", is_active: true, rank: 1 }];
  const ticks = [{ id: "btc-bitcoin", quotes: { USD: { price: 100, market_cap: 1e12 } } }];
  const s = countPaprikaGateStats(
    [
      { id: "bitcoin", paprikaId: "btc-bitcoin" },
      { id: "bitcoin-clone", paprikaId: "btc-bitcoin" },
      { id: "bad", paprikaId: "not in directory!!" },
    ],
    dir, ticks
  );
  assert.equal(s.mapped, 1, "畸形串与重复 id 均不得计入 mapped");
  assert.equal(s.tickerHit, 1, "重复 paprikaId 不得双计 tickerHit");
  assert.ok(s.failures.some((f) => f.stage === "mapped" && f.reason === "paprika_id_malformed"));
  assert.ok(s.failures.some((f) => f.stage === "duplicate" && f.reason === "duplicate_paprika_id"));
});

globalThis.fetch = originalFetch;
const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
