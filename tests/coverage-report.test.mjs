#!/usr/bin/env node
// coverage-report.test.mjs — F8-29 scripts/coverage-report.mjs 本体离线套件
// 沙箱副本运行：沙箱 manifest 只登记平凡桩套件（Node + Python 各一），断言
// 报告生成、套件退出码汇总与 F7-26 fail-closed 语义（失败套件默认非零、
// --report-only 仍为 0）。不改被测脚本本体；沙箱口径避免递归跑全仓套件。
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"} ${label}`); if (!cond) failures++; };

const sb = mkdtempSync(join(tmpdir(), "coverage-report-sandbox-"));
mkdirSync(join(sb, "scripts"), { recursive: true });
mkdirSync(join(sb, "tests"), { recursive: true });
mkdirSync(join(sb, "functions"), { recursive: true });
mkdirSync(join(sb, "shared"), { recursive: true });
mkdirSync(join(sb, "workers/fetcher/src"), { recursive: true });
cpSync(join(ROOT, "scripts/coverage-report.mjs"), join(sb, "scripts/coverage-report.mjs"));
writeFileSync(join(sb, "functions/sample.js"), "export function add(a, b) { return a + b; }\n");
writeFileSync(join(sb, "tests/pass-suite.test.mjs"),
  "import { add } from \"../functions/sample.js\";\nconsole.log(add(1, 2) === 3 ? \"PASS stub\" : \"FAIL stub\");\n");
writeFileSync(join(sb, "tests/fail-suite.test.mjs"), "console.log(\"FAIL stub\");\nprocess.exit(1);\n");
writeFileSync(join(sb, "tests/py_suite_test.py"), "print(\"3 CHECKS PASSED\")\n");
function writeManifest(withFail) {
  const suites = [
    { path: "tests/pass-suite.test.mjs", runner: "node" },
    ...(withFail ? [{ path: "tests/fail-suite.test.mjs", runner: "node" }] : []),
    { path: "tests/py_suite_test.py", runner: "python3" },
  ];
  writeFileSync(join(sb, "tests/suites-manifest.json"), JSON.stringify({ suites }, null, 1));
}
const runCov = (extra = []) => spawnSync("node", ["scripts/coverage-report.mjs", ...extra],
  { cwd: sb, encoding: "utf8", timeout: 300000 });

writeManifest(false);
{
  const r = runCov();
  ok(r.status === 0 && /覆盖率报告/.test(r.stdout) && /functions\/sample\.js/.test(r.stdout),
    `① F8-29 coverage-report 全过沙箱：退出 0 且报告含源文件行（status=${r.status}）`);
  ok(/py_suite_test\.py/.test(r.stdout) && /3\/3|3/.test(r.stdout),
    "② F8-29 coverage-report Python 套件计数纳入汇总");
}
writeManifest(true);
{
  const r = runCov();
  ok(r.status === 1, `③ F8-29 coverage-report 含失败套件时默认 fail-closed 退出 1（status=${r.status}）`);
  const r2 = runCov(["--report-only"]);
  ok(r2.status === 0 && /report-only/.test(r2.stdout),
    `④ F8-29 coverage-report --report-only 时退出 0 且明示报告口径（status=${r2.status}）`);
}

console.log(failures === 0 ? "[coverage-report.test] 全部通过" : `[coverage-report.test] ${failures} 条失败`);
process.exit(failures === 0 ? 0 : 1);
