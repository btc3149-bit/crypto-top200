#!/usr/bin/env node
// audit-deps.test.mjs — F7-46 OSV 审计脚本测试（本地桩 HTTP 服务，不访问外网）
// 断言：① enumeratePackages 从 lockfile 正确枚举/排序/去重；② 对桩 OSV 的
// querybatch+vulns 流程能汇总漏洞计数与明细且退出码 1；③ 上游不可达时退出码 2
// 且输出含「未审计」而非「0 漏洞」。
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enumeratePackages } from "../scripts/audit-deps.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}`);
  if (!cond) failures++;
};

// ① 枚举逻辑（纯函数）
{
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { version: "0.0.0" },
      "node_modules/b-pkg": { version: "2.0.0" },
      "node_modules/a-pkg": { version: "1.0.0" },
      "node_modules/x/node_modules/a-pkg": { version: "1.0.0" },
      "node_modules/@scope/c-pkg": { version: "3.1.0" },
    },
  };
  const got = enumeratePackages(lock).map((p) => `${p.name}@${p.version}`);
  ok(
    JSON.stringify(got) === JSON.stringify(["@scope/c-pkg@3.1.0", "a-pkg@1.0.0", "b-pkg@2.0.0"]),
    `① 枚举/排序/去重（got=${JSON.stringify(got)}）`
  );
}

// ②+③ 需要起本地桩服务
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/querybatch") {
      const { queries } = JSON.parse(body);
      // 只给 wrangler 包造一条漏洞，其余包无漏洞
      res.end(
        JSON.stringify({
          results: queries.map((q) =>
            q.package.name === "wrangler" ? { vulns: [{ id: "GHSA-TEST-0001", modified: "2026-01-01T00:00:00Z" }] } : {}
          ),
        })
      );
    } else if (req.url === "/v1/vulns/GHSA-TEST-0001") {
      res.end(JSON.stringify({ id: "GHSA-TEST-0001", summary: "stub vuln", severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N" }], aliases: ["CVE-0000-0001"] }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// 必须用异步 spawn：桩 HTTP 服务在本进程内，spawnSync 会阻塞事件循环、桩无法响应子进程请求（实测死锁至超时）
function runAudit(env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("node", ["scripts/audit-deps.mjs"], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolvePromise({ status, stdout, stderr });
    });
  });
}

// ② 桩 OSV 有漏洞 → 退出 1、计数 1、明细含包名与 id
{
  const r = await runAudit({ OSV_API_BASE: base });
  ok(r.status === 1 && /漏洞 1 条/.test(r.stdout) && /wrangler@4\.159\.0 GHSA-TEST-0001/.test(r.stdout), `② 桩审计汇总（status=${r.status}）`);
}
// ③ 上游不可达 → 退出 2、明示未审计
{
  const r = await runAudit({ OSV_API_BASE: "http://127.0.0.1:1" });
  ok(r.status === 2 && /未审计/.test(r.stderr) && !/漏洞 0 条/.test(r.stdout), `③ 不可达时退出 2 且不冒充 0 漏洞（status=${r.status}）`);
}
// ④ --list 离线枚举真实 lockfile
{
  const r = spawnSync("node", ["scripts/audit-deps.mjs", "--list"], { cwd: ROOT, encoding: "utf8" });
  ok(r.status === 0 && /wrangler@4\.159\.0/.test(r.stdout) && /未联网、未审计/.test(r.stdout), "④ --list 离线枚举含 wrangler@pin");
}

server.close();
console.log(failures === 0 ? "[audit-deps.test] 全部通过" : `[audit-deps.test] ${failures} 条失败`);
process.exit(failures === 0 ? 0 : 1);
