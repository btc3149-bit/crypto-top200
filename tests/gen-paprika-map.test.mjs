#!/usr/bin/env node
// gen-paprika-map.test.mjs — F8-29 scripts/gen-paprika-map.mjs 本体离线套件
// 沙箱副本运行：data/coins.json 用 fixture、fetch 用 --import 桩替换（不打真实
// 网络），断言候选匹配三档置信（高 / 中-同名多条 / 中-slug / 无候选）、非活跃
// 条目过滤与 CSV/detail 产物形态。不改被测脚本本体。
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"} ${label}`); if (!cond) failures++; };

const sb = mkdtempSync(join(tmpdir(), "gen-paprika-map-sandbox-"));
mkdirSync(join(sb, "scripts"), { recursive: true });
mkdirSync(join(sb, "data"), { recursive: true });
mkdirSync(join(sb, "docs"), { recursive: true });
cpSync(join(ROOT, "scripts/gen-paprika-map.mjs"), join(sb, "scripts/gen-paprika-map.mjs"));
cpSync(join(ROOT, "scripts/decode-coins.mjs"), join(sb, "scripts/decode-coins.mjs"));

const coinsFixture = { coins: [
  { name: "Alpha", symbol: "ALP", coingeckoId: "alpha", snapshotPrice: 1 },
  { name: "Beta", symbol: "BET", coingeckoId: "beta", snapshotPrice: 2 },
  { name: "Gamma Token", symbol: "GAM", coingeckoId: "gamma-token", snapshotPrice: 3 },
  { name: "Delta", symbol: "DEL", coingeckoId: "delta", snapshotPrice: 4 },
]};
writeFileSync(join(sb, "data/coins.json"), JSON.stringify(coinsFixture));
const paprikaFixture = [
  { id: "alp-alpha", symbol: "ALP", name: "Alpha", rank: 5, is_active: true },
  { id: "bet-beta-b", symbol: "BET", name: "Beta", rank: 9, is_active: true },
  { id: "bet-beta-a", symbol: "BET", name: "Beta", rank: 3, is_active: true },
  { id: "gam-gamma-token", symbol: "GAM", name: "Gamma", rank: 7, is_active: true },
  { id: "del-delta", symbol: "DEL", name: "Delta", rank: 1, is_active: false },
];
writeFileSync(join(sb, "stub-fetch.mjs"),
  `globalThis.fetch = async () => ({ json: async () => ${JSON.stringify(paprikaFixture)} });\n`);

const r = spawnSync("node", ["--import", join(sb, "stub-fetch.mjs"), "scripts/gen-paprika-map.mjs"],
  { cwd: sb, encoding: "utf8", timeout: 60000 });

ok(r.status === 0, `① F8-29 gen-paprika-map 沙箱离线运行退出 0（status=${r.status}, stderr=${(r.stderr || "").slice(0, 200)}）`);
const csvPath = join(sb, "docs/paprika-map-review.csv");
ok(existsSync(csvPath), "② F8-29 产出 docs/paprika-map-review.csv");
const rows = existsSync(csvPath) ? readFileSync(csvPath, "utf8").trim().split("\n").slice(1).map((l) => l.split(",")) : [];
const byId = Object.fromEntries(rows.map((row) => [row[2], row]));
ok(byId.alpha && byId.alpha[3] === "alp-alpha" && byId.alpha[4] === "高",
  `③ F8-29 名称全等唯一候选 → 高置信（alpha=${JSON.stringify(byId.alpha)}）`);
ok(byId.beta && byId.beta[3] === "bet-beta-a" && byId.beta[4] === "中-同名多条" && byId.beta[7] === "yes",
  `④ F8-29 同名多条 → 取 rank 最优且标记歧义（beta=${JSON.stringify(byId.beta)}）`);
ok(byId["gamma-token"] && byId["gamma-token"][3] === "gam-gamma-token" && byId["gamma-token"][4] === "中",
  `⑤ F8-29 slug 全等 → 中置信（gamma=${JSON.stringify(byId["gamma-token"])}）`);
ok(byId.delta && byId.delta[3] === "" && byId.delta[4] === "无候选",
  `⑥ F8-29 非活跃条目被过滤、无候选（delta=${JSON.stringify(byId.delta)}）`);
const detail = JSON.parse(readFileSync("/tmp/paprika-candidates.json", "utf8"));
ok(Array.isArray(detail) && detail.length === 4 && detail.find((d) => d.coingeckoId === "beta").nameEqualCandidates.length === 2,
  "⑦ F8-29 detail 中间件含全部币与同名候选组明细");

console.log(failures === 0 ? "[gen-paprika-map.test] 全部通过" : `[gen-paprika-map.test] ${failures} 条失败`);
process.exit(failures === 0 ? 0 : 1);
