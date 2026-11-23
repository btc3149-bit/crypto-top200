// tests/paprika-verify-scripts.test.mjs — 第八期 F8-29（Paprika 路部分）新套件
// 覆盖 scripts/verify-paprika-identity.mjs 与 scripts/verify-paprika-coverage.mjs
// 本体的纯逻辑（登记册生成/一致性/门禁汇总；覆盖计数/同源阈值结论/天数推导）。
// 全部离线：网络部分以 fixture 数组注入被测纯函数，不真打 Paprika/线上 API；
// 两脚本仅直接执行时才走 main（import 本身不触发网络），本套件直接 import 验证。
import assert from "node:assert/strict";
import { buildRegistryEntries, checkRegistryConsistency, summarizeGate, renderRegistryModule } from "../scripts/verify-paprika-identity.mjs";
import { computeCoverage, coverageVerdict, resolveDay } from "../scripts/verify-paprika-coverage.mjs";
import { evaluatePaprikaGate, paprikaGateThreshold } from "../shared/paprika-identity.js";

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

// ---------- verify-paprika-identity ----------
const ID_COINS = [
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC", snapshotMcapUsd: 1.5e12, paprikaId: "btc-bitcoin" },
  { id: "pump-fun", name: "Pump.fun", symbol: "PUMP", snapshotMcapUsd: 3e8, paprikaId: "pump-pumpbtc" },
  { id: "none", name: "None", symbol: "NON", snapshotMcapUsd: null, paprikaId: null },
];
const ID_DIR = [
  { id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", is_active: true, rank: 1 },
  { id: "pump-pumpbtc", name: "PumpBTC", symbol: "PUMP", is_active: true, rank: 1418 },
];

await test("F8-29 identity: buildRegistryEntries 只收全名复核通过者，错配不入册并记 failure", async () => {
  const { entries, failures } = buildRegistryEntries(ID_COINS, ID_DIR);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].cgId, "bitcoin");
  assert.equal(entries[0].paprikaName, "Bitcoin");
  assert.equal(entries[0].cgSnapshotMcapUsd, 1.5e12);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].id, "pump-fun");
  assert.equal(failures[0].reason, "name_mismatch");
});

await test("F8-29 identity: checkRegistryConsistency 一致为空、映射/市值漂移必检出", async () => {
  const { entries } = buildRegistryEntries(ID_COINS.slice(0, 1), ID_DIR);
  assert.deepEqual(checkRegistryConsistency(ID_COINS.slice(0, 1), entries), []);
  const stale = ID_COINS.map((c) => (c.id === "bitcoin" ? { ...c, paprikaId: "btc-bitcoin-token" } : c));
  assert.ok(checkRegistryConsistency(stale, entries).length > 0);
  const drifted = ID_COINS.map((c) => (c.id === "bitcoin" ? { ...c, snapshotMcapUsd: 1 } : c));
  assert.ok(checkRegistryConsistency(drifted, entries).length > 0);
});

await test("F8-29 identity: summarizeGate 四计数与门禁阈值同源（94%）；renderRegistryModule 产出可入仓模块形", async () => {
  const ticks = [{ id: "btc-bitcoin", quotes: { USD: { price: 100, market_cap: 1.6e12 } } }];
  const { entries } = buildRegistryEntries(ID_COINS.slice(0, 1), ID_DIR);
  const { stats, gate } = summarizeGate(ID_COINS.slice(0, 1), ID_DIR, ticks, entries);
  assert.deepEqual(
    { mapped: stats.mapped, identityValid: stats.identityValid, activeUsable: stats.activeUsable, tickerHit: stats.tickerHit },
    { mapped: 1, identityValid: 1, activeUsable: 1, tickerHit: 1 }
  );
  assert.equal(gate.threshold, paprikaGateThreshold(1));
  assert.equal(gate.ok, true);
  const text = renderRegistryModule(entries, "2026-11-23T00:00:00.000Z");
  assert.ok(text.includes("export const PAPRIKA_IDENTITY_REGISTRY"));
  assert.ok(text.includes('"cgId": "bitcoin"'));
});

// ---------- verify-paprika-coverage ----------
const COV_COINS = [
  { coingeckoId: "bitcoin", paprikaId: "btc-bitcoin" },
  { coingeckoId: "ethereum", paprikaId: "eth-ethereum" },
  { coingeckoId: "solana", paprikaId: "sol-solana" },
  { coingeckoId: "none", paprikaId: null },
];
const COV_TICKS = [
  { id: "btc-bitcoin", last_updated: "2026-11-23T00:00:00Z", quotes: { USD: { price: 100, market_cap: 1 } } },
  { id: "eth-ethereum", last_updated: "2026-11-23T00:00:00Z", quotes: { USD: { price: "3123", market_cap: 1 } } },
];

await test("F8-29 coverage: computeCoverage 分项计数——validQuoteHit 只计报价有效、presentInvalidQuote 单列、无映射计 missing", async () => {
  const cov = computeCoverage(COV_COINS, COV_TICKS, { bitcoin: { price: 101 } });
  assert.equal(cov.total, 4);
  assert.equal(cov.mapped, 3);
  assert.equal(cov.present, 2);
  assert.equal(cov.validQuoteHit, 1);
  assert.equal(cov.presentInvalidQuote.length, 1);
  assert.equal(cov.missing.length, 3, "solana 不在 tickers、ethereum 报价无效、none 无映射");
  assert.equal(cov.diffs.length, 1);
  assert.ok(Math.abs(cov.diffs[0].diffPct - (1 / 101) * 100) < 1e-9);
});

await test("F8-29/F8-21 coverage: coverageVerdict 阈值与 fetcher preflight 同源（200→188），且覆盖达标 ≠ 启用判定", async () => {
  assert.equal(coverageVerdict(179, 200).threshold, 188);
  assert.equal(coverageVerdict(179, 200).meetsThreshold, false);
  assert.equal(coverageVerdict(190, 200).meetsThreshold, true, "覆盖单项 190 已过同源门禁线（旧 197 口径已废除）");
  // 同一批数据在 preflight 仍可因 identity/active 不足被拒——覆盖结论不构成启用判定
  const gate = evaluatePaprikaGate({ mapped: 196, identityValid: 100, activeUsable: 100, tickerHit: 190 }, 200);
  assert.equal(gate.ok, false);
});

await test("F8-29 coverage: resolveDay 显式 --day 优先、无参数时按报告数推导不报错", async () => {
  assert.equal(resolveDay(["node", "x", "--day", "3"]), 3);
  assert.ok(resolveDay(["node", "x", "--day", "0"]) >= 2, "--day 0 非法时回退推导（docs 已有 1 份报告 → ≥2）");
  assert.ok(resolveDay(["node", "x"]) >= 1);
});

const failed = results.filter(([, s]) => s !== "PASS");
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) process.exitCode = 1;
