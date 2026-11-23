// scripts/verify-paprika-coverage.mjs — W2-03 §2 覆盖率实测（仅覆盖核验，非启用判定）
// 单次 GET /v1/tickers?quotes=USD&limit=5000（1 call，与 fetcher F6-53 同口径）→
// 按映射交集计数 → 命中数/缺失清单/每币 last_updated 新鲜度/与 CoinGecko 同刻
// 价差分布（Markdown 输出到 stdout）。
// F7-14：命中口径与 fetcher 对齐——ticker 存在且报价字段经清洗有效（price 有限
// 正数，见 shared/paprika-identity.js paprikaQuoteValid）才计 hit；仅存在但报价
// 无效单列 presentInvalidQuote，不再以「存在性」冒充命中。输出分项计数：
// mapped / present / validQuoteHit / presentInvalidQuote / missing。
// 映射来源：优先 data/coins.json 的 paprikaId（W2-11 落库后）；未落库时读
// docs/paprika-mapping-proposal.json 的核定提案（本期形态）。
//
// F8-21（门槛双口径统一）：本脚本旧口径「hits ≥197 PASS / <195 FAIL」与 fetcher
// preflight 四项门禁（均 ≥188）并存且结论可相反，现已废除。阈值与计数定义同源
// shared/paprika-identity.js（paprikaGateThreshold = 94% 门禁）。本脚本只核验
// tickers 覆盖一项（近似 tickerHit 单项），不拉目录、不查 identity/active/
// plausibility——其输出一律标注 COVERAGE_ONLY / 非启用判定；Paprika 启用判定
// 唯一口径 = fetcher preflight 四项计数（mapped/identityValid/activeUsable/
// tickerHit 均 ≥ 阈值，见 evaluatePaprikaGate）。启用前另须连测 3 天达标 +
// 站长书面确认（U8）；结果存 docs/paprika-coverage-<日期>.md。
// F8-29：纯逻辑已抽为可导出函数（computeCoverage/coverageVerdict/resolveDay），
// 离线套件 tests/paprika-verify-scripts.test.mjs 以 fixture 覆盖；仅直接执行
// 本文件时才走 main（拉 API）。
import { readFileSync, readdirSync } from "node:fs";
import { decodeCoins } from "./decode-coins.mjs"; // F6-71：JS 侧解码单一来源（带行长断言）
import { paprikaQuoteValid, paprikaGateThreshold } from "../shared/paprika-identity.js";

// F6-77：天数不再写死「第 1 天」——优先 --day N 参数；未给时按 docs/ 下已有
// paprika-coverage-<日期>.md 报告文件数 +1 推导（连测第几天 = 已有报告数 +1）。
export function resolveDay(argv = process.argv, docsDirUrl = new URL("../docs/", import.meta.url)) {
  const i = argv.indexOf("--day");
  const n = i >= 0 ? Number(argv[i + 1]) : NaN;
  if (Number.isInteger(n) && n >= 1) return n;
  try {
    const files = readdirSync(docsDirUrl).filter((f) => /^paprika-coverage-\d{4}-\d{2}-\d{2}\.md$/.test(f));
    return files.length + 1;
  } catch {
    return 1;
  }
}

// 覆盖计数（纯函数）：coinsList 为 decodeCoins 形态（含 coingeckoId/paprikaId），
// tickers 为 Paprika /v1/tickers 数组，liveCoins 为线上 board 的 coins 字典（可空）。
export function computeCoverage(coinsList, tickers, liveCoins) {
  const tickById = new Map((tickers || []).map((t) => [t.id, t]));
  const hits = [];
  const missing = [];
  const presentInvalidQuote = [];
  const diffs = [];
  let mapped = 0;
  for (const c of coinsList) {
    const cgId = c.coingeckoId;
    const pid = c.paprikaId;
    if (!pid) {
      missing.push({ cgId, reason: "无映射（paprikaId=null，见提案未决清单）" });
      continue;
    }
    mapped += 1;
    const t = tickById.get(pid);
    if (!t) {
      missing.push({ cgId, paprikaId: pid, reason: "映射存在但不在免费层 tickers 前 2000（或已下线）" });
      continue;
    }
    if (!paprikaQuoteValid(t)) {
      // F7-14：存在但报价无效——不计 hit，单列分项并计入缺失清单说明。
      presentInvalidQuote.push({ cgId, paprikaId: pid });
      missing.push({ cgId, paprikaId: pid, reason: "ticker 存在但报价无效（price 非有限正数，与 fetcher 清洗口径一致）" });
      continue;
    }
    hits.push({ cgId, paprikaId: pid, lastUpdated: t.last_updated });
    const cg = liveCoins && liveCoins[cgId];
    const pp = t.quotes && t.quotes.USD && t.quotes.USD.price;
    if (cg && cg.price && pp) diffs.push({ cgId, diffPct: Math.abs(pp - cg.price) / cg.price * 100 });
  }
  diffs.sort((a, b) => a.diffPct - b.diffPct);
  return {
    total: coinsList.length,
    mapped,
    present: hits.length + presentInvalidQuote.length,
    validQuoteHit: hits.length,
    presentInvalidQuote,
    missing,
    hits,
    diffs,
  };
}

// 覆盖结论（纯函数）：阈值与 fetcher preflight 同源（94% 门禁，F8-21）。
// meetsThreshold 只表示「覆盖单项达门禁线」，不构成启用判定。
export function coverageVerdict(validQuoteHit, total) {
  const threshold = paprikaGateThreshold(total);
  return { threshold, meetsThreshold: validQuoteHit >= threshold };
}

async function main() {
  const day = resolveDay();
  const coinsData = JSON.parse(readFileSync(new URL("../data/coins.json", import.meta.url), "utf-8"));
  const coinsList = decodeCoins(coinsData);
  let mappingSource = "data/coins.json:paprikaId";
  if (!coinsList.some((c) => c.paprikaId)) {
    const proposal = JSON.parse(readFileSync(new URL("../docs/paprika-mapping-proposal.json", import.meta.url), "utf-8"));
    const propById = new Map(decodeCoins(proposal).map((c) => [c.coingeckoId, c.paprikaId]));
    for (const c of coinsList) c.paprikaId = propById.get(c.coingeckoId) || null;
    mappingSource = "docs/paprika-mapping-proposal.json（提案，未落库）";
  }

  const tickers = await (await fetch("https://api.coinpaprika.com/v1/tickers?quotes=USD&limit=5000")).json();
  if (!Array.isArray(tickers)) throw new Error("paprika tickers payload invalid");
  const live = await (await fetch("https://top200.oppcal.com/api/board")).json();

  const cov = computeCoverage(coinsList, tickers, live.coins);
  const { threshold, meetsThreshold } = coverageVerdict(cov.validQuoteHit, cov.total);
  // 覆盖单项未达同源门禁线 → exit 1（与 preflight 方向一致）；达线也只是覆盖达标。
  if (!meetsThreshold) process.exitCode = 1;
  const resultTag = meetsThreshold ? "COVERAGE_OK" : "COVERAGE_BELOW_THRESHOLD";
  const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))].diffPct : null);
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `RESULT: ${resultTag} scope=coverage-only notEnablementDecision=true validQuoteHit=${cov.validQuoteHit} mapped=${cov.mapped} present=${cov.present} presentInvalidQuote=${cov.presentInvalidQuote.length} missing=${cov.missing.length} gateThreshold=${threshold} day=${day}`,
    `# CoinPaprika 覆盖率实测 ${today}（第 ${day} 天）`,
    "",
    `- 映射来源：${mappingSource}`,
    `- 分项计数（F7-14）：映射非空 mapped=${cov.mapped}/${cov.total}；ticker 存在 present=${cov.present}；报价有效命中 validQuoteHit=${cov.validQuoteHit}；存在但报价无效 presentInvalidQuote=${cov.presentInvalidQuote.length}；缺失 missing=${cov.missing.length}`,
    `- tickers 覆盖（报价有效口径）：**${cov.validQuoteHit}/${cov.total}** → ${meetsThreshold ? `覆盖单项达门禁线（≥${threshold}，与 fetcher preflight 同源阈值，F8-21）` : `覆盖单项未达门禁线（<${threshold}，与 fetcher preflight 同源阈值，F8-21）`}`,
    `- **非启用判定声明（F8-21）**：本脚本只核验 tickers 覆盖单项，不查 identity/active/plausibility，其结论不得读作「可启用」。启用判定唯一口径 = fetcher preflight 四项计数均 ≥${threshold}（shared/paprika-identity.js evaluatePaprikaGate）；当前 Paprika 保持关闭（PAPRIKA_ENABLED=false）。`,
    `- 价差分布（命中且双边有价 ${cov.diffs.length} 币）：中位数 ${pct(cov.diffs, 0.5)?.toFixed(3)}%、P95 ${pct(cov.diffs, 0.95)?.toFixed(3)}%、最大 ${cov.diffs.length ? cov.diffs[cov.diffs.length - 1].diffPct.toFixed(3) : "—"}%`,
    `- 价差 >5% 的币：${cov.diffs.filter((d) => d.diffPct > 5).map((d) => `${d.cgId}(${d.diffPct.toFixed(1)}%)`).join("、") || "无"}`,
    "",
    "## 缺失清单",
    "",
    ...cov.missing.map((m) => `- ${m.cgId}${m.paprikaId ? `（${m.paprikaId}）` : ""}：${m.reason}`),
    "",
    "## 说明",
    "",
    `- 本期要求连测 3 天（方案 W2-03 §2），本文件为第 ${day} 天；其余天数由协调者在后续日期补跑并另存 \`paprika-coverage-<日期>.md\`。`,
    "- 即使覆盖达标，启用仍须 U8（站长书面确认个人非商业运营）+ fetcher preflight 四项门禁全过；当前 PAPRIKA_ENABLED=false 不变。",
    `- 命中币 last_updated 示例：${cov.hits.slice(0, 3).map((h) => `${h.cgId}=${h.lastUpdated}`).join("；")}`,
  ];
  console.log(lines.join("\n"));
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  await main();
}
