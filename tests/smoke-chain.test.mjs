#!/usr/bin/env node
// smoke-chain.test.mjs — F8-04 部署冒烟链离线套件
// 被测本体：scripts/smoke.sh、ops/headers/gen-headers.mjs、ops/headers/smoke-headers.mjs
// 全部离线：gen-headers 在仓库只读 --check + /tmp 沙箱副本上做篡改判定；
// smoke-headers / smoke.sh 打本地 mock 服务（响应头取自真实 public/_headers、
// board 载荷为契约 v2 fixture），不访问生产。
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"} ${label}`); if (!cond) failures++; };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: 120000, ...opts });
// 异步 run：mock 服务在本进程内，spawnSync 会阻塞事件循环使 mock 无法响应（死锁）
const runAsync = (cmd, args) => new Promise((resolvePromise, reject) => {
  const child = spawn(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  let stdout = "", stderr = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  child.on("error", reject);
  child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
});

// ---- 解析 public/_headers 的路径组（mock 服务用，与 Pages 合并语义近似：/* + 具体组叠加） ----
function parseHeaders(text) {
  const groups = [];
  let cur = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { cur = { path: line.trim(), headers: {} }; groups.push(cur); }
    else if (cur) { const i = line.indexOf(":"); cur.headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  }
  return groups;
}
const groups = parseHeaders(readFileSync(join(ROOT, "public/_headers"), "utf8"));
const star = groups.find((g) => g.path === "/*").headers;
const dataG = groups.find((g) => g.path === "/data/*").headers;
const API_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'" };

// ---- board fixture（契约 v2，coins 键数与 data/coins.json 期望数一致） ----
const coinsDoc = JSON.parse(readFileSync(join(ROOT, "data/coins.json"), "utf8"));
// data/coins.json 为 rows 紧凑形态时按 meta.fields 取 coingeckoId（与 decode-coins 同口径）
const ids = Array.isArray(coinsDoc.coins)
  ? coinsDoc.coins.map((c) => c.coingeckoId)
  : coinsDoc.rows.map((r) => r[coinsDoc.meta.fields.indexOf("coingeckoId")]);
function boardBody(servedFrom) {
  const coins = {}; for (const id of ids) coins[id] = {};
  return JSON.stringify({ contractVersion: 2, coins, updatedAt: "2026-11-23T00:00:00Z", coverage: { expected: ids.length, returned: ids.length }, freshness: { servedFrom }, fetch: { fetchRunId: "smoke-chain-fixture" } });
}
function makeServer({ badCsp = false, servedFrom = "kv" } = {}) {
  const homeHtml = readFileSync(join(ROOT, "public/index.html"));
  const privHtml = readFileSync(join(ROOT, "public/privacy/index.html"));
  const dataBody = readFileSync(join(ROOT, "public/data/coins.json"));
  return createServer((req, res) => {
    const pageHeaders = badCsp ? { "content-type": "text/html" } : { ...star, "content-type": "text/html; charset=utf-8" };
    if (req.url === "/") { res.writeHead(200, pageHeaders); res.end(homeHtml); }
    else if (req.url === "/privacy/") { res.writeHead(200, pageHeaders); res.end(privHtml); }
    else if (req.url === "/data/coins.json") { res.writeHead(200, { ...star, ...dataG }); res.end(dataBody); }
    else if (req.url === "/api/board") {
      if (req.method === "POST") { res.writeHead(405, { ...API_HEADERS, "content-type": "application/json" }); res.end("{}"); }
      else { res.writeHead(200, { ...API_HEADERS, "content-type": "application/json" }); res.end(boardBody(servedFrom)); }
    } else { res.writeHead(404); res.end("nf"); }
  });
}
async function listen(srv) { await new Promise((r) => srv.listen(0, "127.0.0.1", r)); return `http://127.0.0.1:${srv.address().port}`; }

// ① gen-headers --check 对现行 _headers 判一致（只读，不写出）
{
  const r = run("node", ["ops/headers/gen-headers.mjs", "--check", "--variant=on"]);
  ok(r.status === 0, `① F8-04 gen-headers --check 现行 _headers 一致（status=${r.status}）`);
}
// ②③ 沙箱副本：篡改 _headers 或 HTML 后 --check 必须判不一致；重新生成后恢复一致
{
  const sb = mkdtempSync(join(tmpdir(), "gen-headers-sandbox-"));
  cpSync(join(ROOT, "ops/headers"), join(sb, "ops/headers"), { recursive: true });
  cpSync(join(ROOT, "public"), join(sb, "public"), { recursive: true });
  const chk = () => spawnSync("node", ["ops/headers/gen-headers.mjs", "--check", "--variant=on"], { cwd: sb, encoding: "utf8", timeout: 120000 });
  ok(chk().status === 0, "② F8-04 沙箱副本 --check 基线一致");
  appendFileSync(join(sb, "public/_headers"), "\n# tampered\n");
  ok(chk().status !== 0, "② F8-04 篡改 _headers 后 --check 判不一致（非零退出）");
  const gen = spawnSync("node", ["ops/headers/gen-headers.mjs", "--variant=on"], { cwd: sb, encoding: "utf8", timeout: 120000 });
  ok(gen.status === 0 && chk().status === 0, "② F8-04 沙箱重新生成后 --check 恢复一致");
  appendFileSync(join(sb, "public/index.html"), "<!-- tamper -->");
  ok(chk().status !== 0, "③ F8-04 篡改 index.html 后 --check 判不一致（hash 漂移被抓）");
}

const good = makeServer(); const goodBase = await listen(good);
const badBoard = makeServer({ servedFrom: "legacy" }); const badBoardBase = await listen(badBoard);
const badCsp = makeServer({ badCsp: true }); const badCspBase = await listen(badCsp);

// ④ smoke-headers 对 mock 的定版头集合判 PASS（S1/S2/S4/S6 离线子集）
{
  const r = await runAsync("node", ["ops/headers/smoke-headers.mjs", goodBase, "--variant=on", "--only=S1,S2,S4,S6"]);
  ok(r.status === 0, `④ F8-04 smoke-headers 对 mock 定版头集合全过（status=${r.status}）`);
}
// ⑤ smoke-headers 对缺 CSP 的 mock 判 FAIL
{
  const r = await runAsync("node", ["ops/headers/smoke-headers.mjs", badCspBase, "--variant=on", "--only=S1"]);
  ok(r.status === 1 && /FAIL/.test(r.stdout), `⑤ F8-04 smoke-headers 对缺 CSP 的 mock 判 FAIL（status=${r.status}）`);
}
// ⑥ smoke.sh production 对健康 mock 判 PASS
{
  const r = await runAsync("bash", ["scripts/smoke.sh", goodBase, "production"]);
  ok(r.status === 0 && /SMOKE OK/.test(r.stdout), `⑥ F8-04 smoke.sh production 健康 mock 全过（status=${r.status}）`);
}
// ⑦ smoke.sh production 对 servedFrom=legacy 的 mock 判 FAIL（⑦号断言抓回落）
{
  const r = await runAsync("bash", ["scripts/smoke.sh", badBoardBase, "production"]);
  ok(r.status === 1 && /SMOKE FAILED/.test(r.stderr + r.stdout), `⑦ F8-04 smoke.sh 对 servedFrom 异常 mock 判 FAIL（status=${r.status}）`);
}
// ⑧ smoke.sh preview 对健康 mock 只跑静态子集并 PASS
{
  const r = await runAsync("bash", ["scripts/smoke.sh", goodBase, "preview"]);
  ok(r.status === 0 && /SKIP/.test(r.stdout) && /SMOKE OK/.test(r.stdout), `⑧ F8-04 smoke.sh preview 静态子集全过且 board 组 SKIP（status=${r.status}）`);
}

good.close(); badBoard.close(); badCsp.close();
console.log(failures === 0 ? "[smoke-chain.test] 全部通过" : `[smoke-chain.test] ${failures} 条失败`);
process.exit(failures === 0 ? 0 : 1);
