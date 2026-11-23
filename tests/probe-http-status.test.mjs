// probe_http_status_test.mjs — F7-21 离线单测（第七期批 4 新增套件）。
// 本地 mock HTTP 服务喂 probe.mjs 三种应答，断言 verdict/退出码：
//   ① 503 + v1 形态错误体 → FAIL / exit 1（旧实现判 PASS / exit 0，实测复现）
//   ② 200 + v1 形态正常体（staleAgeSec 小）→ PASS / exit 0（不误伤 v1-compat）
//   ③ 500 + v2 形态完整体 → FAIL / exit 1（状态优先于规则判读）
// 运行：node tests/probe_http_status_test.mjs（全过退出 0）
// 注：本套件尚未列入 scripts/run-tests.sh 的 SUITES 清单，请协调人纳入 manifest。
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = path.join(ROOT, "scripts", "probe.mjs");

let mode = "503v1";
const server = http.createServer((req, res) => {
  if (mode === "503v1") {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "upstream down" }));
  } else if (mode === "200v1") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ staleAgeSec: 10, mode: "live" }));
  } else if (mode === "500v2") {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({
      contractVersion: 2, staleAgeSec: 10, mode: "live",
      freshness: { consecutiveFailures: 0, level: "fresh" },
      fetch: { fetchRunId: "x" },
    }));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const PASS = [];
// 注意：mock 服务与测试同进程，必须异步 spawn（spawnSync 会阻塞事件循环、
// 服务器无法应答子进程请求而死锁——首版实测卡死后改此实现）。
function run(m) {
  mode = m;
  return new Promise((resolve, reject) => {
    const child = spawn("node", [PROBE, base], { encoding: "utf-8" });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out: JSON.parse(stdout) }));
  });
}
function ok(name, cond, extra) {
  if (!cond) { console.error(`FAIL ${name}: ${extra}`); process.exit(1); }
  PASS.push(name); console.log(`PASS ${name}`);
}

let r = await run("503v1");
ok("① 503+v1 错误体 → FAIL/exit 1", r.code === 1 && r.out.verdict === "FAIL" && r.out.httpStatus === 503, JSON.stringify(r));
r = await run("200v1");
ok("② 200+v1 正常体 → PASS/exit 0", r.code === 0 && r.out.verdict === "PASS" && r.out.httpStatus === 200, JSON.stringify(r));
r = await run("500v2");
ok("③ 500+v2 完整体 → FAIL/exit 1（状态优先）", r.code === 1 && r.out.verdict === "FAIL" && r.out.httpStatus === 500, JSON.stringify(r));

server.close();
server.closeAllConnections?.();
console.log(`\nALL ${PASS.length} CHECKS PASSED`);
