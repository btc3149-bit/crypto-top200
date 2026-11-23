// tests/suite-manifest.test.mjs — F7-32 套件集合一致性守卫
// 套件集合的单一事实源是 tests/suites-manifest.json（run-tests.sh 与
// scripts/coverage-report.mjs 共用）。本套件断言：
//   ① manifest 与 tests/ 目录实际套件文件双向一致（有文件无条目、或有条目无文件均红）；
//   ② manifest 条目文件真实存在、runner 与扩展名匹配、无重复；
//   ③ run-tests.sh 与 coverage-report.mjs 均改为读 manifest（不得再出现硬编码套件清单，
//      尤其 coverage-report 的 Python 清单不得漏 quota_check_test.py——F7-32 已漏一例）。
// 套件文件口径（与 coverage-report 的发现口径对齐）：tests/ 顶层 *.test.mjs、
// snapshot-verify.mjs、test_*.py、*_test.py。helpers/ 与 fixtures/ 子目录不算套件。
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, "tests/suites-manifest.json"), "utf-8"));
const entries = manifest.suites.map((s) => s.path);
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([name, "PASS"]);
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push([name, "FAIL"]);
    console.error(`FAIL ${name}\n`, e);
  }
}

function isSuiteFile(name) {
  return name.endsWith(".test.mjs") || name === "snapshot-verify.mjs" ||
    (name.startsWith("test_") && name.endsWith(".py")) || name.endsWith("_test.py");
}
const onDisk = readdirSync(join(root, "tests")).filter(isSuiteFile).map((f) => `tests/${f}`).sort();

await test("① F7-32 manifest 与 tests/ 套件文件双向一致（无游离套件、无悬空条目）", () => {
  assert.deepEqual([...entries].sort(), onDisk,
    `manifest 与磁盘不一致：\nmanifest=${[...entries].sort().join(",")}\ndisk=${onDisk.join(",")}`);
});

await test("② F7-32 manifest 条目存在、runner 与扩展名匹配、无重复", () => {
  assert.equal(new Set(entries).size, entries.length, "manifest 有重复条目");
  for (const s of manifest.suites) {
    assert.ok(existsSync(join(root, s.path)), `manifest 条目文件不存在：${s.path}`);
    if (s.path.endsWith(".mjs")) assert.equal(s.runner, "node", `${s.path} 应为 node`);
    else if (s.path.endsWith(".py")) assert.equal(s.runner, "python3", `${s.path} 应为 python3`);
    else assert.fail(`manifest 条目扩展名未识别：${s.path}`);
  }
});

await test("③ F7-32 run-tests.sh 与 coverage-report.mjs 均读 manifest、无硬编码套件清单", () => {
  const runTests = readFileSync(join(root, "scripts/run-tests.sh"), "utf-8");
  const coverage = readFileSync(join(root, "scripts/coverage-report.mjs"), "utf-8");
  assert.ok(runTests.includes("suites-manifest.json"), "run-tests.sh 应读 tests/suites-manifest.json");
  assert.ok(coverage.includes("suites-manifest.json"), "coverage-report.mjs 应读 tests/suites-manifest.json");
  assert.ok(!/pySuites\s*=\s*\[/.test(coverage), "coverage-report 不得再硬编码 pySuites 数组（F7-32 漏 quota_check_test.py 的复发通道）");
  assert.ok(entries.includes("tests/quota_check_test.py"), "manifest 必须含 tests/quota_check_test.py");
});

const failed = results.filter(([, s]) => s === "FAIL");
console.log(`\nsuite-manifest: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
