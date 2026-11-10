// scripts/gen-paprika-map.mjs — W2-03 §2 步骤 1：生成 Paprika id 候选审查表
// 拉 GET /v1/coins（1 call）与本地 200 币表做候选匹配：
//   ① symbol 全等 + name 归一化全等 → 高置信
//   ② symbol 全等 + name slug 与 CoinGecko id 后缀相似 → 中置信
//   ③ 其余 → 无候选
// 产出 docs/paprika-map-review.csv（人工核定用）+ /tmp/paprika-candidates.json（核定中间件）。
// 注意：本脚本只产候选，禁止全自动采信；核定结论见 docs/paprika-mapping-proposal.json。
import { readFileSync, writeFileSync } from "node:fs";

const coins = JSON.parse(readFileSync(new URL("../data/coins.json", import.meta.url), "utf-8")).coins;
const paprika = await (await fetch("https://api.coinpaprika.com/v1/coins")).json();
if (!Array.isArray(paprika)) throw new Error("paprika /v1/coins payload invalid");
const active = paprika.filter((p) => p.is_active);

const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const bySymbol = new Map();
for (const p of active) {
  const k = String(p.symbol || "").toUpperCase();
  if (!bySymbol.has(k)) bySymbol.set(k, []);
  bySymbol.get(k).push(p);
}

const rows = [];
const detail = [];
for (const c of coins) {
  const cands = bySymbol.get(String(c.symbol).toUpperCase()) || [];
  let best = null;
  let confidence = "无候选";
  for (const p of cands) {
    if (normName(p.name) === normName(c.name)) {
      best = p;
      confidence = "高";
      break;
    }
  }
  if (!best) {
    for (const p of cands) {
      const slugPart = p.id.slice(p.id.indexOf("-") + 1);
      if (slugPart === c.coingeckoId || slugPart === slugify(c.name) || slugPart.includes(c.coingeckoId) || c.coingeckoId.includes(slugPart)) {
        best = p;
        confidence = "中";
        break;
      }
    }
  }
  rows.push({
    name: c.name,
    symbol: c.symbol,
    coingeckoId: c.coingeckoId,
    candidatePaprikaId: best ? best.id : "",
    confidence,
    candidateRank: best ? best.rank : "",
    candidatesForSymbol: cands.length,
  });
  detail.push({
    coingeckoId: c.coingeckoId,
    symbol: c.symbol,
    name: c.name,
    snapshotPrice: c.snapshotPrice,
    confidence,
    best: best ? { id: best.id, rank: best.rank, name: best.name } : null,
    allCandidates: cands.map((p) => ({ id: p.id, rank: p.rank, name: p.name })),
  });
}

const csvEsc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = [
  "name,symbol,coingeckoId,candidatePaprikaId,confidence,candidateRank,candidatesForSymbol",
  ...rows.map((r) => [r.name, r.symbol, r.coingeckoId, r.candidatePaprikaId, r.confidence, r.candidateRank, r.candidatesForSymbol].map(csvEsc).join(",")),
].join("\n");
writeFileSync(new URL("../docs/paprika-map-review.csv", import.meta.url), csv);
writeFileSync("/tmp/paprika-candidates.json", JSON.stringify(detail, null, 1));
const stat = rows.reduce((a, r) => ((a[r.confidence] = (a[r.confidence] || 0) + 1), a), {});
console.log(`coins=${rows.length} paprikaActive=${active.length} 置信分布:`, stat);
console.log("multi-candidate symbols:", rows.filter((r) => r.candidatesForSymbol > 1).length);
