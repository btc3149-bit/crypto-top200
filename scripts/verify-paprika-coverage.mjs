// scripts/verify-paprika-coverage.mjs — W2-03 §2 覆盖率实测
// 单次 GET /v1/tickers?quotes=USD（1 call）→ 按映射交集计数 → 命中数/缺失清单/
// 每币 last_updated 新鲜度/与 CoinGecko 同刻价差分布（Markdown 输出到 stdout）。
// 映射来源：优先 data/coins.json 的 paprikaId（W2-11 落库后）；未落库时读
// docs/paprika-mapping-proposal.json 的核定提案（本期形态）。
// 启用门槛：命中 ≥197/200 且缺失均有归因；195–196 黄区须站长知情；<195 禁止启用。
// 启用前须连续 3 天各跑 1 次、三日均达标；结果存 docs/paprika-coverage-<日期>.md。
import { readFileSync } from "node:fs";

const coinsData = JSON.parse(readFileSync(new URL("../data/coins.json", import.meta.url), "utf-8"));
let mappingSource = "data/coins.json:paprikaId";
let map = new Map(coinsData.coins.filter((c) => c.paprikaId).map((c) => [c.coingeckoId, c.paprikaId]));
if (map.size === 0) {
  const proposal = JSON.parse(readFileSync(new URL("../docs/paprika-mapping-proposal.json", import.meta.url), "utf-8"));
  map = new Map(proposal.coins.filter((c) => c.paprikaId).map((c) => [c.coingeckoId, c.paprikaId]));
  mappingSource = "docs/paprika-mapping-proposal.json（提案，未落库）";
}
const allIds = coinsData.coins.map((c) => c.coingeckoId);

const tickers = await (await fetch("https://api.coinpaprika.com/v1/tickers?quotes=USD")).json();
if (!Array.isArray(tickers)) throw new Error("paprika tickers payload invalid");
const tickById = new Map(tickers.map((t) => [t.id, t]));
const live = await (await fetch("https://top200.oppcal.com/api/board")).json();

const hits = [];
const missing = [];
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
  hits.push({ cgId, paprikaId: pid, lastUpdated: t.last_updated });
  const cg = live.coins && live.coins[cgId];
  const pp = t.quotes && t.quotes.USD && t.quotes.USD.price;
  if (cg && cg.price && pp) diffs.push({ cgId, diffPct: Math.abs(pp - cg.price) / cg.price * 100 });
}
diffs.sort((a, b) => a.diffPct - b.diffPct);
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))].diffPct : null);
const today = new Date().toISOString().slice(0, 10);
const gate = hits.length >= 197 ? "达启用门槛（≥197）" : hits.length >= 195 ? "黄区（195–196，须站长知情确认）" : "未达门槛（<195，禁止启用）";

const lines = [
  `# CoinPaprika 覆盖率实测 ${today}（第 1 天）`,
  "",
  `- 映射来源：${mappingSource}`,
  `- 映射非空：${map.size}/${allIds.length}`,
  `- tickers 命中：**${hits.length}/${allIds.length}** → ${gate}`,
  `- 价差分布（命中且双边有价 ${diffs.length} 币）：中位数 ${pct(diffs, 0.5)?.toFixed(3)}%、P95 ${pct(diffs, 0.95)?.toFixed(3)}%、最大 ${diffs.length ? diffs[diffs.length - 1].diffPct.toFixed(3) : "—"}%`,
  `- 价差 >5% 的币：${diffs.filter((d) => d.diffPct > 5).map((d) => `${d.cgId}(${d.diffPct.toFixed(1)}%)`).join("、") || "无"}`,
  "",
  "## 缺失清单",
  "",
  ...missing.map((m) => `- ${m.cgId}${m.paprikaId ? `（${m.paprikaId}）` : ""}：${m.reason}`),
  "",
  "## 说明",
  "",
  "- 本期要求连测 3 天（方案 W2-03 §2），本文件为第 1 天；第 2/3 天由协调者在后续日期补跑并另存 `paprika-coverage-<日期>.md`。",
  "- 即使覆盖达标，启用仍须 U8（站长书面确认个人非商业运营）+ 映射落库（W2-11）；当前 PAPRIKA_ENABLED=false 不变。",
  `- 命中币 last_updated 示例：${hits.slice(0, 3).map((h) => `${h.cgId}=${h.lastUpdated}`).join("；")}`,
];
console.log(lines.join("\n"));
