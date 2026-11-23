// scripts/verify-paprika-identity.mjs — 第七期 F7-01 Paprika 落库身份复核（可复现）
// 对 data/coins.json 的全部 paprikaId 逐条做身份复核：Paprika /v1/coins 目录中
// 该 id 必须存在、symbol 全等（trim+大写）、且规范化 name 全等或命中已知别名表
// （shared/paprika-identity.js，与 fetcher 门禁同一口径）。仅 symbol+价差不再算证据。
// 同时产出四项计数（mapped / identityValid / activeUsable / tickerHit，tickerHit
// 须 tickers 存在且报价有效）并按 F7-02 门禁（四项均 ≥94%=188/200）给结论。
// 用法：node scripts/verify-paprika-identity.mjs [--coins-file <缓存/v1/coins.json>]
//       [--tickers-file <缓存 tickers.json>]（缺省实时拉 Paprika 公开 API 各 1 次）
// 退出码：任一已映射条目身份不符 → 1；四项计数未达门禁 → 1（Paprika 保持关闭为预期）。
import { readFileSync } from "node:fs";
import { decodeCoins } from "./decode-coins.mjs";
import { countPaprikaGateStats, paprikaIdentityMatch } from "../shared/paprika-identity.js";
import { evaluatePaprikaGate } from "../workers/fetcher/src/source-state.js";

function argFile(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
async function loadJson(flag, url) {
  const f = argFile(flag);
  if (f) return JSON.parse(readFileSync(f, "utf-8"));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.json();
}

const coinsData = JSON.parse(readFileSync(new URL("../data/coins.json", import.meta.url), "utf-8"));
const coins = decodeCoins(coinsData).map((c) => ({ id: c.coingeckoId, name: c.name, symbol: c.symbol, paprikaId: c.paprikaId }));
const directory = await loadJson("--coins-file", "https://api.coinpaprika.com/v1/coins");
const tickers = await loadJson("--tickers-file", "https://api.coinpaprika.com/v1/tickers?quotes=USD&limit=5000");
if (!Array.isArray(directory) || !Array.isArray(tickers)) throw new Error("paprika payload invalid");

const stats = countPaprikaGateStats(coins, directory, tickers);
const gate = evaluatePaprikaGate(stats, coins.length);
const dirById = new Map(directory.map((e) => [e.id, e]));
const identityFailures = stats.failures.filter((f) => f.stage === "identity");

console.log(`paprika directory=${directory.length} tickers=${tickers.length} total=${stats.total}`);
console.log(`mapped=${stats.mapped} identityValid=${stats.identityValid} activeUsable=${stats.activeUsable} tickerHit=${stats.tickerHit}`);
console.log(`gate(94%): threshold=${gate.threshold} ok=${gate.ok}${gate.ok ? "" : " failures: " + gate.failures.join("; ")}`);
for (const f of stats.failures) {
  const e = dirById.get(f.paprikaId);
  console.log(`- ${f.id} (${f.paprikaId}) stage=${f.stage} reason=${f.reason}${e ? ` paprikaName=${JSON.stringify(e.name)} paprikaSymbol=${JSON.stringify(e.symbol)} active=${e.is_active} rank=${e.rank}` : " (not in directory)"}`);
}
// 逐条身份明细（via 标注证据类型：name / alias / symbol-prefix）
for (const c of coins) {
  if (!c.paprikaId) continue;
  const m = paprikaIdentityMatch(c, dirById.get(c.paprikaId));
  if (m.ok && m.via === "alias") console.log(`alias-accept ${c.id} -> ${c.paprikaId} (local name ${JSON.stringify(c.name)} vs directory ${JSON.stringify(dirById.get(c.paprikaId)?.name)})`);
}
if (identityFailures.length) {
  console.error(`IDENTITY FAIL: ${identityFailures.length} mapped entries fail identity review`);
  process.exitCode = 1;
}
if (!gate.ok) process.exitCode = 1;
