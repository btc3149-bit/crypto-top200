// scripts/probe.mjs — W2-02 §3 探针判读（站长巡检/上线验收用，不落任何调度）
// 用法：node scripts/probe.mjs [基址，默认 https://top200.oppcal.com]
// 判读规则（定版，三选二满足即判异常；第 3 条单独不判异常，仅与前两条组合）：
//   R1 freshness.consecutiveFailures ≥ 3
//   R2 staleAgeSec > 1800
//   R3 fetch.upstreamStatus.markets 非 200 且 consecutiveFailures ≥ 1（组合项）
//      —— F6-41 后 board 不再对外透传 upstreamStatus，R3 恒不可判读（输出中显式标注），
//         上游健康权威覆盖移交 /api/health 与 HC4 影子链探针；字段若再现仍按原规则判读。
// 对 v1 契约（无 contractVersion/freshness/fetch）：缺失字段按「不可判读」处理并注明，
// 仅以可得的 staleAgeSec 等 v1 字段做降级判读，输出中明确标注 v1-compat。
const base = (process.argv[2] || "https://top200.oppcal.com").replace(/\/$/, "");

let body;
try {
  const res = await fetch(`${base}/api/board`);
  body = await res.json();
  if (!res.ok && !body) throw new Error(`http ${res.status}`);
} catch (e) {
  console.log(JSON.stringify({ base, verdict: "FAIL", reason: `fetch_failed: ${e.message}` }, null, 2));
  process.exit(1);
}

const isV2 = body.contractVersion === 2;
// F6-22：v2 应答缺 freshness/staleAgeSec/fetch 任一字段 = 契约坏死，判 FAIL（非零退出）。
// 「不可判读」按字段缺失触发，而非按版本号推定。
const missingFields = [];
if (isV2) {
  if (!body.freshness || typeof body.freshness !== "object") missingFields.push("freshness");
  if (typeof body.staleAgeSec !== "number") missingFields.push("staleAgeSec");
  if (!body.fetch || typeof body.fetch !== "object") missingFields.push("fetch");
}
const consecutiveFailures =
  body.freshness && typeof body.freshness.consecutiveFailures === "number" ? body.freshness.consecutiveFailures : null;
const staleAgeSec = typeof body.staleAgeSec === "number" ? body.staleAgeSec : null;
const marketsStatus =
  body.fetch && body.fetch.upstreamStatus && typeof body.fetch.upstreamStatus.markets === "number"
    ? body.fetch.upstreamStatus.markets
    : null;

const hits = [];
if (consecutiveFailures != null && consecutiveFailures >= 3) hits.push("R1:consecutiveFailures>=3");
if (staleAgeSec != null && staleAgeSec > 1800) hits.push("R2:staleAgeSec>1800");
const r3 = marketsStatus != null && marketsStatus !== 200 && consecutiveFailures != null && consecutiveFailures >= 1;
if (r3) hits.push("R3:upstreamStatus.markets!=200 && consecutiveFailures>=1 (组合项)");

// 定版口径落地：三条中任两条满足即异常；R3 单独不算（R1+R2、R1+R3、R2+R3 均为两条）。
// F6-22：v2 字段缺失直接 FAIL，优先于规则命中口径。
const verdict = missingFields.length > 0 || hits.length >= 2 ? "FAIL" : "PASS";

const out = {
  base,
  at: new Date().toISOString(),
  contract: isV2 ? "v2" : "v1-compat（缺 freshness/fetch 字段，R1/R3 不可判读，仅 R2 可判）",
  mode: body.mode ?? null,
  source: body.source ?? null,
  level: body.freshness ? body.freshness.level : null,
  staleAgeSec,
  consecutiveFailures,
  marketsUpstreamStatus: marketsStatus,
  fetchRunId: body.fetch ? body.fetch.fetchRunId : null,
  coverage: body.coverage ? `${body.coverage.returned}/${body.coverage.expected}` : null,
  rulesHit: hits,
  missingFields: missingFields.length ? missingFields : undefined,
  verdict,
  note:
    missingFields.length > 0
      ? `v2 契约字段缺失（不可判读）：${missingFields.join(", ")}——判 FAIL。`
      : !isV2
        ? "v1 契约下 consecutiveFailures/upstreamStatus 缺失按不可判读处理；当前结论仅基于 staleAgeSec。"
        : marketsStatus == null
          ? "R3 不可判读：F6-41 后 fetch.upstreamStatus 不再对外透传，上游健康以 /api/health 与 HC4 为准；本结论基于 R1/R2。"
          : undefined,
};
console.log(JSON.stringify(out, null, 2));
if (verdict === "FAIL") process.exitCode = 1;
