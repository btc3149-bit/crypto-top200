// scripts/compare-shadow.mjs — W2-01 G1 影子比对（本地/CI 运行）
// 用法：node scripts/compare-shadow.mjs [--shadow <blob.json 文件>] [--live <基址，默认 https://top200.oppcal.com>]
// 比对影子 blob 与线上 /api/board：覆盖率、逐币价差中位数与 P95、市值排序前 20 一致性、missingIds 一致性。
// 验收阈值（G1）：价差中位数 ≤0.3%、P95 ≤1.5%、覆盖率 ≥94%、missingIds 一致率 100%。
// 注意：双读比对须容忍 90 秒 KV 传播窗；正式 G1 按 fetchRunId 对齐同一 run 再比数值
// （影子 blob 的 fetchRunId 与其来源 live 响应对应关系由 fetcher 日志提供）。
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const shadowPath = argVal("--shadow", "/tmp/shadow-blob.json");
const liveBase = argVal("--live", "https://top200.oppcal.com").replace(/\/$/, "");

const shadow = JSON.parse(readFileSync(shadowPath, "utf-8"));
const live = await (await fetch(`${liveBase}/api/board`)).json();

const shadowById = new Map((shadow.rows || []).map((r) => [r.id, r]));
const diffs = [];
let compared = 0;
for (const [id, c] of Object.entries(live.coins || {})) {
  const s = shadowById.get(id);
  if (!s || !c.price || !s.price) continue;
  diffs.push(Math.abs(s.price - c.price) / c.price);
  compared += 1;
}
diffs.sort((a, b) => a - b);
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);
const median = pct(diffs, 0.5);
const p95 = pct(diffs, 0.95);

const top20 = (entries) =>
  entries
    .slice()
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 20)
    .map(([id]) => id);
const liveTop20 = top20(Object.entries(live.coins || {}).map(([id, c]) => [id, c.mcapUsd]));
const shadowTop20 = top20((shadow.rows || []).map((r) => [r.id, r.mcapUsd]));
const top20SameSet = liveTop20.every((id) => shadowTop20.includes(id)) && shadowTop20.every((id) => liveTop20.includes(id));

const liveMissing = new Set((live.coverage && live.coverage.missingIds) || []);
const shadowMissing = new Set((shadow.coverage && shadow.coverage.missingIds) || []);
const missingConsistent = liveMissing.size === shadowMissing.size && [...liveMissing].every((id) => shadowMissing.has(id));

const report = {
  at: new Date().toISOString(),
  shadowRunId: shadow.fetchRunId || null,
  shadowFetchedAt: shadow.fetchedAt || null,
  liveUpdatedAt: live.updatedAt || null,
  compared,
  priceDiffMedianPct: median != null ? +(median * 100).toFixed(4) : null,
  priceDiffP95Pct: p95 != null ? +(p95 * 100).toFixed(4) : null,
  shadowCoverage: shadow.coverage || null,
  liveCoverage: live.coverage || null,
  top20SameSet,
  missingConsistent,
};
report.pass =
  report.priceDiffMedianPct != null &&
  report.priceDiffMedianPct <= 0.3 &&
  report.priceDiffP95Pct <= 1.5 &&
  shadow.coverage &&
  shadow.coverage.returned / shadow.coverage.expected >= 0.94 &&
  missingConsistent;
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
