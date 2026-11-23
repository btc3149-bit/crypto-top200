// scripts/verify-paprika-coverage.mjs — W2-03 §2 覆盖率实测
// 单次 GET /v1/tickers?quotes=USD&limit=5000（1 call，与 fetcher F6-53 同口径）→
// 按映射交集计数 → 命中数/缺失清单/每币 last_updated 新鲜度/与 CoinGecko 同刻
// 价差分布（Markdown 输出到 stdout）。
// F7-14：命中口径与 fetcher 对齐——ticker 存在且报价字段经清洗有效（price 有限
// 正数，见 shared/paprika-identity.js paprikaQuoteValid）才计 hit；仅存在但报价
// 无效单列 presentInvalidQuote，不再以「存在性」冒充命中。输出分项计数：
// mapped / present / validQuoteHit / presentInvalidQuote / missing。
// 映射来源：优先 data/coins.json 的 paprikaId（W2-11 落库后）；未落库时读
// docs/paprika-mapping-proposal.json 的核定提案（本期形态）。
// 启用门槛：命中 ≥197/200 且缺失均有归因；195–196 黄区须站长知情；<195 禁止启用。
// 启用前须连续 3 天各跑 1 次、三日均达标；结果存 docs/paprika-coverage-<日期>.md。
import { readFileSync, readdirSync } from "node:fs";
import { decodeCoins } from "./decode-coins.mjs"; // F6-71：JS 侧解码单一来源（带行长断言）
import { paprikaQuoteValid } from "../shared/paprika-identity.js";

// F6-77：天数不再写死「第 1 天」——优先 --day N 参数；未给时按 docs/ 下已有
// paprika-coverage-<日期>.md 报告文件数 +1 推导（连测第几天 = 已有报告数 +1）。
function resolveDay() {
  const i = process.argv.indexOf("--day");
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  if (Number.isInteger(n) && n >= 1) return n;
  try {
    const files = readdirSync(new URL("../docs/", import.meta.url)).filter((f) => /^paprika-coverage-\d{4}-\d{2}-\d{2}\.md$/.test(f));
    return files.length + 1;
  } catch {
    return 1;
  }
}
const day = resolveDay();

const coinsData = JSON.parse(readFileSync(new URL("../data/coins.json", import.meta.url), "utf-8"));
const coinsList = decodeCoins(coinsData);
let mappingSource = "data/coins.json:paprikaId";
let map = new Map(coinsList.filter((c) => c.paprikaId).map((c) => [c.coingeckoId, c.paprikaId]));
if (map.size === 0) {
  const proposal = JSON.parse(readFileSync(new URL("../docs/paprika-mapping-proposal.json", import.meta.url), "utf-8"));
  map = new Map(decodeCoins(proposal).filter((c) => c.paprikaId).map((c) => [c.coingeckoId, c.paprikaId]));
  mappingSource = "docs/paprika-mapping-proposal.json（提案，未落库）";
}
const allIds = coinsList.map((c) => c.coingeckoId);

const tickers = await (await fetch("https://api.coinpaprika.com/v1/tickers?quotes=USD&limit=5000")).json();
if (!Array.isArray(tickers)) throw new Error("paprika tickers payload invalid");
const tickById = new Map(tickers.map((t) => [t.id, t]));
const live = await (await fetch("https://top200.oppcal.com/api/board")).json();

const hits = [];
const missing = [];
const presentInvalidQuote = [];
const diffs = [];
for (const cgId of allIds) {
  const pid = map.get(cgId);
  if (!pid) {
    missing.push({ cgId, reason: "无映射（paprikaId=null，见提案未决清单）" });
    continue;
  }
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
  const cg = live.coins && live.coins[cgId];
  const pp = t.quotes && t.quotes.USD && t.quotes.USD.price;
  if (cg && cg.price && pp) diffs.push({ cgId, diffPct: Math.abs(pp - cg.price) / cg.price * 100 });
}
diffs.sort((a, b) => a.diffPct - b.diffPct);
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))].diffPct : null);
const today = new Date().toISOString().slice(0, 10);
const gate = hits.length >= 197 ? "达启用门槛（≥197）" : hits.length >= 195 ? "黄区（195–196，须站长知情确认）" : "未达门槛（<195，禁止启用）";
// F6-77：机器可读结论置于报告首行；hits<195（禁止启用）时退出码置 1，
// 使门槛拦截不再只靠人读文案。黄区（195–196）记 RESULT: WARN、退出码仍 0（须站长知情确认，非硬失败）。
const resultTag = hits.length >= 197 ? "PASS" : hits.length >= 195 ? "WARN" : "FAIL";
if (hits.length < 195) process.exitCode = 1;

const presentCount = hits.length + presentInvalidQuote.length;
const lines = [
  `RESULT: ${resultTag} hits=${hits.length} mapped=${map.size} present=${presentCount} validQuoteHit=${hits.length} presentInvalidQuote=${presentInvalidQuote.length} missing=${missing.length} required=195 enableGate=197 day=${day}`,
  `# CoinPaprika 覆盖率实测 ${today}（第 ${day} 天）`,
  "",
  `- 映射来源：${mappingSource}`,
  `- 分项计数（F7-14）：映射非空 mapped=${map.size}/${allIds.length}；ticker 存在 present=${presentCount}；报价有效命中 validQuoteHit=${hits.length}；存在但报价无效 presentInvalidQuote=${presentInvalidQuote.length}；缺失 missing=${missing.length}`,
  `- tickers 命中（报价有效口径）：**${hits.length}/${allIds.length}** → ${gate}`,
  `- 价差分布（命中且双边有价 ${diffs.length} 币）：中位数 ${pct(diffs, 0.5)?.toFixed(3)}%、P95 ${pct(diffs, 0.95)?.toFixed(3)}%、最大 ${diffs.length ? diffs[diffs.length - 1].diffPct.toFixed(3) : "—"}%`,
  `- 价差 >5% 的币：${diffs.filter((d) => d.diffPct > 5).map((d) => `${d.cgId}(${d.diffPct.toFixed(1)}%)`).join("、") || "无"}`,
  "",
  "## 缺失清单",
  "",
  ...missing.map((m) => `- ${m.cgId}${m.paprikaId ? `（${m.paprikaId}）` : ""}：${m.reason}`),
  "",
  "## 说明",
  "",
  `- 本期要求连测 3 天（方案 W2-03 §2），本文件为第 ${day} 天；其余天数由协调者在后续日期补跑并另存 \`paprika-coverage-<日期>.md\`。`,
  "- 即使覆盖达标，启用仍须 U8（站长书面确认个人非商业运营）+ 映射落库（W2-11）；当前 PAPRIKA_ENABLED=false 不变。",
  `- 命中币 last_updated 示例：${hits.slice(0, 3).map((h) => `${h.cgId}=${h.lastUpdated}`).join("；")}`,
];
console.log(lines.join("\n"));
