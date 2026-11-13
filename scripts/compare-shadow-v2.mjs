// scripts/compare-shadow-v2.mjs — W4-07 G1 影子比对 v2（W4-04/W4-07 准备分支产物，未取代原版）
// 与 scripts/compare-shadow.mjs 的关系：原版保持不动（G1 结算仍用原版）；本脚本是其升级准备版，
// 针对 F4-09 的四处缺口逐项补强：
//   ① top20SameSet 纳入 pass 判据（原版只算不用）；
//   ② compared 数量下限（默认 188 = 200×94%，与覆盖率门禁同口径，可用 --min-compared 调整），
//      低于下限判 fail 并在 failReasons 中说明实际值与下限；
//   ③ 两次抓取按 fetchRunId 对齐：shadow.fetchRunId 与 health.lastRunId 互验，
//      并与 live 侧运行标识（live.fetch.fetchRunId，契约 v2）对齐；
//      live 为 legacy 契约（无 fetchRunId）或两侧 ID 不一致时，alignment.status="unaligned"，
//      报告明确写「未对齐」，结论降级为 conditional（即使数值判据全过也不得称 pass），禁止假装对齐；
//   ④ 「≥400 次运行」自动计数：从 KV v1:meta:health 与 shadow blob 可得的运行证据估算
//      累计运行次数并输出门禁差额（方法与误差口径见 runGate.estimators / caveats，估算非精确计数）。
//
// 输入读法与原版一致、纯只读：shadow（及可选 health / shadow-prev）为 KV 键的本地只读导出文件
// （v1:board:shadow / v1:meta:health / v1:board:shadow:prev），live 为对 --live 基址 /api/board 的
// 一次 GET。本脚本不写 KV、不触发 fetcher 抓取、不消耗 CoinGecko 额度
// （GET /api/board 是站点常态读路径，与原版相同）。
//
// 用法：
//   node scripts/compare-shadow-v2.mjs [--shadow <blob.json，默认 /tmp/shadow-blob.json>]
//     [--health <health.json>] [--shadow-prev <prev-blob.json>]
//     [--live <基址，默认 https://top200.oppcal.com>]
//     [--min-compared <n，默认 188>] [--required-runs <n，默认 400>]
//     [--window-start <ISO 时刻，G1 窗口起点，用于时窗估算>] [--interval-sec <n，默认 600>]
//
// 阈值（沿用 G1 定版，仅新增 ①②）：价差中位数 ≤0.3%、P95 ≤1.5%、shadow 覆盖率 ≥94%、
//   missingIds 一致率 100%、top20 集合一致、compared ≥ 下限。
// 退出码：0 = pass（数值判据全过且已对齐）；1 = fail 或输入/读取错误；
//   2 = conditional（数值判据全过但未对齐，结论降级，不得作为 G2 的干净通过证据）。
//   runGate（≥400 次）单独给出 met/shortfall，并汇总进 g1Ready（= pass 且 runGate.met）。
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
function argNum(name, dflt) {
  const v = Number(argVal(name, ""));
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
const shadowPath = argVal("--shadow", "/tmp/shadow-blob.json");
const healthPath = argVal("--health", null);
const shadowPrevPath = argVal("--shadow-prev", null);
const liveBase = argVal("--live", "https://top200.oppcal.com").replace(/\/$/, "");
const minCompared = argNum("--min-compared", 188);
const requiredRuns = argNum("--required-runs", 400);
const windowStart = argVal("--window-start", null);
const intervalSec = argNum("--interval-sec", 600);

function fatal(error) {
  console.log(JSON.stringify({ tool: "compare-shadow-v2", verdict: "error", error }, null, 2));
  process.exit(1);
}
function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    fatal(`${label} 读取失败（${path}）：${e.message}`);
  }
}
function toMs(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

const shadow = readJsonFile(shadowPath, "shadow");
const health = healthPath ? readJsonFile(healthPath, "health") : null;
const shadowPrev = shadowPrevPath ? readJsonFile(shadowPrevPath, "shadow-prev") : null;

let live;
try {
  live = await (await fetch(`${liveBase}/api/board`)).json();
} catch (e) {
  fatal(`live /api/board 读取失败（${liveBase}）：${e.message}`);
}

// ---------- 数值比对（与原版同口径） ----------
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

const shadowCoverageRatio =
  shadow.coverage && shadow.coverage.expected ? shadow.coverage.returned / shadow.coverage.expected : null;

// ---------- ③ fetchRunId 对齐 ----------
const shadowRunId = shadow.fetchRunId || null;
const healthLastRunId = health ? health.lastRunId || null : null;
const liveRunId = (live.fetch && live.fetch.fetchRunId) || live.fetchRunId || null;
const shadowFetchedMs = toMs(shadow.fetchedAt);
const liveUpdatedMs = toMs(live.updatedAt);
const timeDeltaSec =
  shadowFetchedMs != null && liveUpdatedMs != null
    ? Math.round(Math.abs(shadowFetchedMs - liveUpdatedMs) / 1000)
    : null;

const shadowMatchesHealth =
  health == null || shadowRunId == null || healthLastRunId == null
    ? null
    : shadowRunId === healthLastRunId;

let alignmentStatus;
let alignmentBasis;
if (shadowRunId == null) {
  alignmentStatus = "unaligned";
  alignmentBasis = "shadow-run-id-missing：shadow blob 无 fetchRunId，无法对齐";
} else if (liveRunId == null) {
  alignmentStatus = "unaligned";
  alignmentBasis =
    "live-run-id-unavailable：live 侧无 fetchRunId（legacy 契约不暴露运行标识），无法按 run 对齐";
} else if (liveRunId !== shadowRunId) {
  alignmentStatus = "unaligned";
  alignmentBasis = "run-id-mismatch：live 与 shadow 的 fetchRunId 不一致";
} else if (shadowMatchesHealth === false) {
  alignmentStatus = "unaligned";
  alignmentBasis = "shadow-health-mismatch：shadow.fetchRunId 与 health.lastRunId 不一致，疑为过期导出";
} else {
  alignmentStatus = "aligned";
  alignmentBasis = "fetchRunId：live 与 shadow 为同一 run";
}
const alignment = {
  status: alignmentStatus,
  aligned: alignmentStatus === "aligned",
  basis: alignmentBasis,
  shadowRunId,
  healthLastRunId,
  liveRunId,
  shadowMatchesHealth,
  shadowFetchedAt: shadow.fetchedAt || null,
  liveUpdatedAt: live.updatedAt || null,
  timeDeltaSec,
  note:
    alignmentStatus === "aligned"
      ? "已按 fetchRunId 对齐同一 run。"
      : `未对齐：${alignmentBasis}。时间差 ${timeDeltaSec != null ? timeDeltaSec + "s" : "未知"} 仅作参考，` +
        "数值比对结论降级为 conditional，不得表述为同 run 比对通过。",
};

// ---------- ④ ≥400 次运行自动计数（估算，口径见 caveats） ----------
// 证据来源（均为只读导出）：health.quota.creditsUsedEst（月度累计成功调用数）、
// shadow.fetchMeta.quota.creditsUsedEst（写 blob 时的同一计数器快照）、
// health.lastRunId / shadow.fetchRunId / shadowPrev.fetchRunId（可直接核实的 run 标识）。
// 每成功 run 的 credits 成本：markets 恒 1；global 正常每 30min 一次（≈1/3 per run），
// F4-01 缺陷期 global 每 run 一次（2 per run）——故单 run 成本区间 [4/3, 2]，
// 累计 run 数区间 = [ceil(credits/2), floor(credits/(4/3))]，门禁计数取保守下界。
const distinctRunIds = [
  ...new Set([healthLastRunId, shadowRunId, shadowPrev ? shadowPrev.fetchRunId || null : null].filter(Boolean)),
];
const creditsFromHealth = health && health.quota ? health.quota.creditsUsedEst : null;
const creditsFromShadow =
  shadow.fetchMeta && shadow.fetchMeta.quota ? shadow.fetchMeta.quota.creditsUsedEst : null;
const creditsUsedEst = creditsFromHealth != null ? creditsFromHealth : creditsFromShadow;
const creditsSource =
  creditsFromHealth != null ? "health.quota.creditsUsedEst" : creditsFromShadow != null ? "shadow.fetchMeta.quota.creditsUsedEst" : null;
const creditsRange =
  typeof creditsUsedEst === "number"
    ? { low: Math.ceil(creditsUsedEst / 2), high: Math.floor(creditsUsedEst / (4 / 3)) }
    : null;

let windowSlots = null;
if (windowStart) {
  const startMs = toMs(windowStart);
  const endMs = toMs(health && health.lastRunAt) ?? shadowFetchedMs;
  if (startMs != null && endMs != null && endMs >= startMs) {
    windowSlots = Math.floor((endMs - startMs) / (intervalSec * 1000)) + 1;
  }
}
const countedRuns = creditsRange ? creditsRange.low : null;
const runGate = {
  required: requiredRuns,
  countedRuns,
  shortfall: countedRuns != null ? Math.max(0, requiredRuns - countedRuns) : null,
  met: countedRuns != null ? countedRuns >= requiredRuns : null,
  method:
    countedRuns != null
      ? "credits 保守估算：countedRuns = ceil(creditsUsedEst / 2)，取单 run 成本上界 2（F4-01 global 每 run 口径）"
      : "无可用计数证据（未提供 --health 且 shadow 无 fetchMeta.quota），运行次数未知，不得判定达标",
  estimators: {
    distinctRunIdsObserved: distinctRunIds,
    distinctRunIdCount: distinctRunIds.length,
    creditsUsedEst,
    creditsSource,
    creditsImpliedRunsRange: creditsRange,
    windowScheduledSlots: windowSlots,
    windowStart,
    intervalSec,
  },
  caveats: [
    "creditsUsedEst 为自然月累计：含 G1 窗口外的 run（如 G0 手动验证）时会高估窗口内次数；失败 run 不计 credits 时会低估尝试次数。故 countedRuns 是保守估算、不是精确计数。",
    "精确逐 run 计数须 fetcher 侧提供单调递增的 run 序号（当前 health/blob 均无此字段），属后续改进项；本脚本只用现有只读证据，绝不把估算表述为精确值。",
    "windowScheduledSlots 只是按节奏推算的应到槽位数（含失败/跳过），仅作交叉核对，不作门禁计数。",
  ],
};

// ---------- 判据汇总 ----------
const checks = {
  priceDiffMedianOk: median != null && median * 100 <= 0.3,
  priceDiffP95Ok: p95 != null && p95 * 100 <= 1.5,
  shadowCoverageOk: shadowCoverageRatio != null && shadowCoverageRatio >= 0.94,
  missingConsistent,
  top20SameSet, // ① 纳入判据（原版只算不用）
  comparedFloorOk: compared >= minCompared, // ② 下限判据（原版无）
};
const failReasons = [];
if (!checks.priceDiffMedianOk) failReasons.push(`价差中位数 ${median != null ? (median * 100).toFixed(4) + "%" : "无数据"} > 0.3% 或无可比数据`);
if (!checks.priceDiffP95Ok) failReasons.push(`价差 P95 ${p95 != null ? (p95 * 100).toFixed(4) + "%" : "无数据"} > 1.5% 或无可比数据`);
if (!checks.shadowCoverageOk) failReasons.push(`shadow 覆盖率 ${shadowCoverageRatio != null ? (shadowCoverageRatio * 100).toFixed(1) + "%" : "无数据"} < 94%`);
if (!checks.missingConsistent) failReasons.push("missingIds 两侧不一致");
if (!checks.top20SameSet) failReasons.push("top20SameSet=false：市值前 20 集合不一致（v2 新增判据）");
if (!checks.comparedFloorOk) failReasons.push(`compared=${compared} 低于下限 ${minCompared}（v2 新增判据），样本量不足以支撑结论`);

const numericPass = failReasons.length === 0;
const verdict = !numericPass ? "fail" : alignment.aligned ? "pass" : "conditional";

const report = {
  tool: "compare-shadow-v2",
  at: new Date().toISOString(),
  // 与原版同名字段（便于对照）：pass 在 v2 中指「数值判据全过且已对齐」的严格通过
  shadowRunId,
  shadowFetchedAt: shadow.fetchedAt || null,
  liveUpdatedAt: live.updatedAt || null,
  compared,
  priceDiffMedianPct: median != null ? +(median * 100).toFixed(4) : null,
  priceDiffP95Pct: p95 != null ? +(p95 * 100).toFixed(4) : null,
  shadowCoverage: shadow.coverage || null,
  liveCoverage: live.coverage || null,
  top20SameSet,
  missingConsistent,
  pass: verdict === "pass",
  // v2 新增
  minCompared,
  checks,
  failReasons,
  alignment,
  verdict,
  verdictNote:
    verdict === "pass"
      ? "数值判据全过且已按 fetchRunId 对齐。"
      : verdict === "conditional"
        ? "数值判据全过，但未对齐（见 alignment.note）：结论降级，不得作为 G2 的干净通过证据。"
        : "数值判据未全过（见 failReasons）。",
  runGate,
  g1Ready: verdict === "pass" && runGate.met === true,
};
console.log(JSON.stringify(report, null, 2));
if (verdict === "fail") process.exitCode = 1;
else if (verdict === "conditional") process.exitCode = 2;
