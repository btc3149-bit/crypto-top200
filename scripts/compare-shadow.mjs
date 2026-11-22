// scripts/compare-shadow.mjs — G1/G2 影子比对（本地/CI 运行，只读）
// W4-07 返工版（2026-11-14）：针对 F4-09 四处缺口 + F4-08 字段级缺口逐项补强：
//   ① top20SameSet 纳入 pass 判据（旧版只算不用）；
//   ② compared 数量下限（默认 188 = 200×94%，与覆盖率门禁同口径，--min-compared 可调），
//      低于下限判 fail；
//   ③ 按 fetchRunId 对齐：shadow.fetchRunId 与 health.lastRunId 互验，并与 live 侧
//      live.fetch.fetchRunId（契约 v2）对齐；live 为 legacy 契约（无 fetchRunId）或 ID
//      不一致时 alignment.status="unaligned"，结论降级为 conditional（数值全过也不得称
//      pass），禁止假装对齐；同时给出 timeSkewSec 与 240s 时间容差判定作近 run 配对参考；
//   ④ 运行次数自动计数：从 health.quota.creditsUsedEst（或 shadow.fetchMeta.quota 快照）
//      按单 run 成本区间 [4/3, 2] 估算累计成功运行数，门禁取保守下界 ceil(credits/2)，
//      方法与误差口径见 runGate.caveats（估算非精确计数，绝不表述为精确值）；
//   ⑤ 字段级非空抽查入门禁（F4-08）：shadow 任一行 price 或 mcapUsd 为 null/缺失即判
//      fail 并列出 id；rank=null 如实计数上报（id 清单）但不判 fail——已证实系
//      CoinGecko 源数据属性（无市值排名的币 mcapUsd 同时为 0，两路一致）。
//
// 用法：node scripts/compare-shadow.mjs [--shadow <blob.json，默认 /tmp/shadow-blob.json>]
//   [--health <health.json>] [--shadow-prev <prev-blob.json>]
//   [--live <基址，默认 https://top200.oppcal.com> | --live-file <board 响应 json>]
//   [--min-compared <n，默认 188>] [--required-runs <n，默认 400>]
//   [--window-start <ISO 时刻>] [--interval-sec <n，默认 600>]
// 输入均为只读导出（KV 键 v1:board:shadow / v1:meta:health / v1:board:shadow:prev）；
// 本脚本不写 KV、不触发抓取；GET /api/board 是站点常态读路径。
// 阈值（G1 定版）：价差中位数 ≤0.3%、P95 ≤1.5%、shadow 覆盖率 ≥94%、missingIds 一致、
//   top20 集合一致、compared ≥ 下限、字段门禁（见 ⑤）。
// 退出码：0 = pass（数值+字段全过且已按 fetchRunId 对齐）；2 = conditional（全过但未对齐）；
//   1 = fail 或输入/读取错误。runGate 单独给出 met/shortfall，g1Ready = pass 且 runGate.met。
// 第六期补强：F6-08 同源检测（servedFrom∈{kv,memory} 且同 run，或 --shadow-key current）
//   → mode="same-source"、verdict 上限 conditional（永不许 pass），另输出 current vs prev
//   的 blobDiff 信息段（不进 verdict）；F6-20 runGate.met!==true 同样压上限 conditional；
//   F6-21 live 侧 null 计入门禁（>2 fail、1–2 压上限）且计入 compared 分母。
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
const liveFile = argVal("--live-file", null);
const liveBase = argVal("--live", "https://top200.oppcal.com").replace(/\/$/, "");
const minCompared = argNum("--min-compared", 188);
const requiredRuns = argNum("--required-runs", 400);
const windowStart = argVal("--window-start", null);
const intervalSec = argNum("--interval-sec", 600);
const TIME_TOLERANCE_SEC = 240; // 90s KV 传播窗 + 120s live 缓存 TTL + 余量

// F6-90（compare 部分）：错误输出脱敏——32 位 hex 串（账号/命名空间 ID 形态）一律打码。
function redact(s) {
  return String(s).replace(/\b[0-9a-fA-F]{32}\b/g, "[redacted-hex32]");
}
function fatal(error) {
  console.log(JSON.stringify({ tool: "compare-shadow", verdict: "error", error: redact(error) }, null, 2));
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
const isNull = (v) => v == null || (typeof v === "number" && Number.isNaN(v));

const shadow = readJsonFile(shadowPath, "shadow");
const health = healthPath ? readJsonFile(healthPath, "health") : null;
const shadowPrev = shadowPrevPath ? readJsonFile(shadowPrevPath, "shadow-prev") : null;

let live;
if (liveFile) {
  live = readJsonFile(liveFile, "live-file");
} else {
  try {
    live = await (await fetch(`${liveBase}/api/board`)).json();
  } catch (e) {
    fatal(`live /api/board 读取失败（${liveBase}）：${e.message}`);
  }
}

// ---------- 数值比对 ----------
// F6-21：compared 为分母口径 = 两侧同 id 的配对总数（含任一侧 price 为 null 的配对）；
// priceCompared = 实际算出价差的配对数。live 侧 null 不再被静默 skip 出分母。
const shadowById = new Map((shadow.rows || []).map((r) => [r.id, r]));
const diffs = [];
let compared = 0;
let priceCompared = 0;
for (const [id, c] of Object.entries(live.coins || {})) {
  const s = shadowById.get(id);
  if (!s) continue;
  compared += 1;
  if (!c.price || !s.price) continue;
  diffs.push(Math.abs(s.price - c.price) / c.price);
  priceCompared += 1;
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

// ---------- ⑤ 字段级非空抽查（F4-08） ----------
const shadowRows = shadow.rows || [];
const nullPriceIds = shadowRows.filter((r) => isNull(r.price)).map((r) => r.id);
const nullMcapIds = shadowRows.filter((r) => isNull(r.mcapUsd)).map((r) => r.id);
const rankNullIds = shadowRows.filter((r) => isNull(r.rank)).map((r) => r.id);
const mcapZeroIds = shadowRows.filter((r) => r.mcapUsd === 0).map((r) => r.id);
const liveCoins = Object.values(live.coins || {});
const fieldGate = {
  shadowNullPriceIds: nullPriceIds,
  shadowNullMcapIds: nullMcapIds,
  shadowFieldOk: nullPriceIds.length === 0 && nullMcapIds.length === 0,
  rankNullCount: rankNullIds.length,
  rankNullIds, // 只上报不判 fail：CoinGecko 源数据属性（无市值排名）
  mcapZeroIds, // 与 rank=null 同源（源端 market_cap=0），只上报
  liveNullPriceCount: liveCoins.filter((c) => isNull(c.price)).length,
  liveNullMcapCount: liveCoins.filter((c) => isNull(c.mcapUsd)).length,
};

// ---------- ③ fetchRunId 对齐 ----------
const shadowRunId = shadow.fetchRunId || null;
const healthLastRunId = health ? health.lastRunId || null : null;
const liveRunId = (live.fetch && live.fetch.fetchRunId) || live.fetchRunId || null;
const shadowFetchedMs = toMs(shadow.fetchedAt);
const liveUpdatedMs = toMs(live.updatedAt);
const timeSkewSec =
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
  alignmentBasis = "live-run-id-unavailable：live 侧无 fetchRunId（legacy 契约不暴露运行标识），无法按 run 对齐";
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
  timeSkewSec,
  timeToleranceSec: TIME_TOLERANCE_SEC,
  withinTimeTolerance: timeSkewSec != null ? timeSkewSec <= TIME_TOLERANCE_SEC : null,
  note:
    alignmentStatus === "aligned"
      ? "已按 fetchRunId 对齐同一 run。"
      : `未对齐：${alignmentBasis}。时间差 ${timeSkewSec != null ? timeSkewSec + "s" : "未知"}` +
        `（容差 ${TIME_TOLERANCE_SEC}s，withinTimeTolerance=${timeSkewSec != null && timeSkewSec <= TIME_TOLERANCE_SEC}）仅作近 run 配对参考，` +
        "数值比对结论降级为 conditional，不得表述为同 run 比对通过；run-id 对齐须待 live 改读同一 blob（G2 金丝雀 kv 形态/G3）后才可能成立。",
};

// ---------- F6-08 同源检测 ----------
// live 由 KV current blob 组装（freshness.servedFrom ∈ {kv, memory}）且比对输入与 live
// 为同一 run（fetchRunId 相同）时，比对退化为「同一 blob 与自己比」：verdict 永远
// 不得 pass，上限 conditional。也可用 --shadow-key current 显式声明输入导自 current 键。
const shadowKeyArg = argVal("--shadow-key", null);
const liveServedFrom = live.freshness ? live.freshness.servedFrom || null : null;
const sameSource =
  shadowKeyArg === "current" ||
  (["kv", "memory"].includes(liveServedFrom) && liveRunId != null && shadowRunId != null && liveRunId === shadowRunId);
const compareMode = sameSource ? "same-source" : "independent";

// ---------- F6-08 附带信息：current（--shadow 输入）vs prev（--shadow-prev 输入）字段级 diff ----------
// 仅作信息输出，不进 verdict：价格变动 >5% 的币数、由非 null 变为 null 的字段数。
let blobDiff = null;
if (shadowPrev) {
  const prevById = new Map((shadowPrev.rows || []).map((r) => [r.id, r]));
  let moveCount = 0;
  let newNullCount = 0;
  const newNullIds = [];
  for (const r of shadow.rows || []) {
    const p = prevById.get(r.id);
    if (!p) continue;
    if (p.price && r.price && Math.abs(r.price - p.price) / p.price > 0.05) moveCount += 1;
    for (const f of ["price", "mcapUsd", "volume24h"]) {
      if (!isNull(p[f]) && isNull(r[f])) {
        newNullCount += 1;
        if (newNullIds.length < 20) newNullIds.push(`${r.id}.${f}`);
      }
    }
  }
  blobDiff = {
    basis: "shadow-input(current) vs shadow-prev-input(prev)，仅信息、非独立验证、不进 verdict",
    comparedRows: (shadow.rows || []).filter((r) => prevById.has(r.id)).length,
    priceMoveThresholdPct: 5,
    priceMoveOverThresholdCount: moveCount,
    newNullFieldCount: newNullCount,
    newNullFieldsSample: newNullIds,
  };
}

// ---------- ④ 运行次数自动计数（估算，口径见 caveats） ----------
// 证据来源（只读导出）：health.quota.creditsUsedEst（自然月累计）、
// shadow.fetchMeta.quota.creditsUsedEst（写 blob 时同一计数器快照）。
// 每成功 run 的 credits 成本：markets 恒 1；global 定版每 30min 一次（≈1/3 per run），
// F4-01 缺陷期每 run 一次（2 per run）——单 run 成本区间 [4/3, 2]，
// 累计 run 数区间 = [ceil(credits/2), floor(credits/(4/3))]，门禁取保守下界。
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
      ? "credits 保守估算：countedRuns = ceil(creditsUsedEst / 2)，取单 run 成本上界 2（F4-01 缺陷期 global 每 run 口径）；修复后真实成本 4/3，估算只会偏低、不会高估达标"
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
    "creditsUsedEst 为自然月累计：含窗口外的 run（如 G0 手动验证）时会高估窗口内次数；失败 run 不计 credits 时会低估尝试次数。故 countedRuns 是保守估算、不是精确计数。",
    "精确逐 run 计数须 fetcher 侧提供单调递增 run 序号（当前 health/blob 均无此字段），属后续改进项；本脚本只用现有只读证据，绝不把估算表述为精确值。",
    "windowScheduledSlots 只是按节奏推算的应到槽位数（含失败/跳过），仅作交叉核对，不作门禁计数。",
  ],
};

// ---------- 判据汇总 ----------
// F6-21：live 侧 null 门禁——liveNullPrice/liveNullMcap 任一 >2 判 fail；1–2 只压 verdict 上限。
const liveNullTotal = Math.max(fieldGate.liveNullPriceCount, fieldGate.liveNullMcapCount);
const checks = {
  priceDiffMedianOk: median != null && median * 100 <= 0.3,
  priceDiffP95Ok: p95 != null && p95 * 100 <= 1.5,
  shadowCoverageOk: shadowCoverageRatio != null && shadowCoverageRatio >= 0.94,
  missingConsistent,
  top20SameSet, // ① 纳入判据
  comparedFloorOk: compared >= minCompared, // ② 下限判据（F6-21：compared 为含 null 配对的分母口径）
  shadowFieldOk: fieldGate.shadowFieldOk, // ⑤ 字段门禁
  liveFieldOk: liveNullTotal <= 2, // F6-21 live 侧 null 门禁
};
const failReasons = [];
if (!checks.priceDiffMedianOk) failReasons.push(`价差中位数 ${median != null ? (median * 100).toFixed(4) + "%" : "无数据"} > 0.3% 或无可比数据`);
if (!checks.priceDiffP95Ok) failReasons.push(`价差 P95 ${p95 != null ? (p95 * 100).toFixed(4) + "%" : "无数据"} > 1.5% 或无可比数据`);
if (!checks.shadowCoverageOk) failReasons.push(`shadow 覆盖率 ${shadowCoverageRatio != null ? (shadowCoverageRatio * 100).toFixed(1) + "%" : "无数据"} < 94%`);
if (!checks.missingConsistent) failReasons.push("missingIds 两侧不一致");
if (!checks.top20SameSet) failReasons.push("top20SameSet=false：市值前 20 集合不一致");
if (!checks.comparedFloorOk) failReasons.push(`compared=${compared} 低于下限 ${minCompared}，样本量不足以支撑结论`);
if (!checks.shadowFieldOk) failReasons.push(`shadow 字段门禁未过：price=null [${nullPriceIds.join(",")}] mcapUsd=null [${nullMcapIds.join(",")}]`);
if (!checks.liveFieldOk)
  failReasons.push(`live 字段门禁未过：liveNullPrice=${fieldGate.liveNullPriceCount}、liveNullMcap=${fieldGate.liveNullMcapCount}（任一 >2 判 fail）`);

const numericPass = failReasons.length === 0;
// verdict 上限（取更严者）：F6-08 同源 → 上限 conditional（永远不许 pass）；
// F6-20 runGate.met!==true → 上限 conditional；F6-21 live null 1–2 → 上限 conditional。
const verdictCaps = [];
if (sameSource) verdictCaps.push("same-source（F6-08）：同源自比、非独立验证");
if (runGate.met !== true) verdictCaps.push("runGate 未达标（F6-20）：运行次数无达标证据");
if (liveNullTotal >= 1 && liveNullTotal <= 2) verdictCaps.push("live 侧 null 1–2 个（F6-21）");
const verdict = !numericPass ? "fail" : alignment.aligned && verdictCaps.length === 0 ? "pass" : "conditional";

const report = {
  tool: "compare-shadow",
  version: "w4-07-rework-2026-11-14",
  at: new Date().toISOString(),
  shadowRunId,
  shadowFetchedAt: shadow.fetchedAt || null,
  liveUpdatedAt: live.updatedAt || null,
  mode: compareMode, // F6-08："same-source" = 同源自比、非独立验证；"independent" = 独立比对
  liveServedFrom,
  compared, // F6-21：分母口径（两侧同 id 配对总数，含 null 配对）
  priceCompared, // 实际算出价差的配对数
  priceDiffMedianPct: median != null ? +(median * 100).toFixed(4) : null,
  priceDiffP95Pct: p95 != null ? +(p95 * 100).toFixed(4) : null,
  shadowCoverage: shadow.coverage || null,
  liveCoverage: live.coverage || null,
  top20SameSet,
  missingConsistent,
  pass: verdict === "pass",
  minCompared,
  checks,
  failReasons,
  fieldGate,
  alignment,
  verdict,
  verdictCaps, // 本次 verdict 上限来源（F6-08/F6-20/F6-21，取更严者）
  verdictNote:
    verdict === "pass"
      ? "数值+字段判据全过、已按 fetchRunId 对齐、非同源比对且 runGate 达标。"
      : verdict === "conditional"
        ? `数值+字段判据全过，但结论降级为 conditional，不得作为干净通过证据。降级原因：${[
            ...verdictCaps,
            ...(alignment.aligned ? [] : ["未按 fetchRunId 对齐（见 alignment.note）"]),
          ].join("；")}${sameSource ? "。同源自比、非独立验证：live 与比对输入为同一 blob，数值一致是同义反复。" : ""}`
        : "判据未全过（见 failReasons）。",
  blobDiff,
  runGate,
  g1Ready: verdict === "pass" && runGate.met === true,
};
console.log(JSON.stringify(report, null, 2));
if (verdict === "fail") process.exitCode = 1;
else if (verdict === "conditional") process.exitCode = 2;
