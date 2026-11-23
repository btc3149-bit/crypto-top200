// tests/suite-manifest.test.mjs — F7-32 套件集合一致性守卫 + F8-27/F8-32 加固
// 套件集合的单一事实源是 tests/suites-manifest.json（run-tests.sh 与
// scripts/coverage-report.mjs 共用）。本套件断言：
//   ① manifest 与 tests/ 目录实际套件文件双向一致（有文件无条目、或有条目无文件均红）；
//   ② manifest 条目文件真实存在、runner 与扩展名匹配、无重复；
//   ③ run-tests.sh 与 coverage-report.mjs 均改为读 manifest（不得再出现硬编码套件清单）；
//   ④ F8-27 识别兜底：tests/ 递归扫描（除 fixtures/）中凡形似套件的文件
//      （*.test.mjs / *.test.js / *.check.mjs / *.check.js / snapshot-verify.mjs /
//      test_*.py / *_test.py，含子目录）必须已登记 manifest，未登记即红——
//      foo.check.mjs、*.test.js、子目录套件无法再静默漏册；
//   ⑤ F8-27 自证：临时目录放 foo.check.mjs 与子目录 *.test.js，同一扫描函数必须检出未登记；
//   ⑥ F8-32 计数登记：每条目必须有正整数 expectedPass，且 run-tests.sh 含
//      「实跑 PASS 行数 vs 登记值」比对与总账打印逻辑；
//   ⑦ F8-32 实跑计数：逐个实跑其余套件，数其 ^PASS 行数与登记 expectedPass 比对
//      （本套件自身除外，其登记值 = 本文件用例数，由 run-tests.sh 在外层比对）。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
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

// F8-27 扩大识别口径：.test.js / .check.* 与子目录套件均算候选
function isSuiteFile(name) {
  return name.endsWith(".test.mjs") || name.endsWith(".test.js") ||
    name.endsWith(".check.mjs") || name.endsWith(".check.js") ||
    name === "snapshot-verify.mjs" ||
    (name.startsWith("test_") && name.endsWith(".py")) || name.endsWith("_test.py");
}
// 递归扫描 testsDir 下全部候选套件，返回未登记者（相对路径以 tests/ 为前缀）。
// fixtures/ 为样本数据目录，不算套件；其余子目录（如 helpers/）一律纳入。
function scanUnregistered(testsDir, registered) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (prefix === "tests" && name === "fixtures") continue;
        walk(p, `${prefix}/${name}`);
      } else if (isSuiteFile(name)) {
        const relPath = `${prefix}/${name}`;
        if (!registered.has(relPath)) out.push(relPath);
      }
    }
  };
  walk(testsDir, "tests");
  return out.sort();
}
const onDiskAll = readdirSync(join(root, "tests")).filter(isSuiteFile).map((f) => `tests/${f}`).sort();

await test("① F7-32 manifest 与 tests/ 套件文件双向一致（无游离套件、无悬空条目）", () => {
  assert.deepEqual([...entries].sort(), onDiskAll,
    `manifest 与磁盘不一致：\nmanifest=${[...entries].sort().join(",")}\ndisk=${onDiskAll.join(",")}`);
});

await test("② F7-32 manifest 条目存在、runner 与扩展名匹配、无重复", () => {
  assert.equal(new Set(entries).size, entries.length, "manifest 有重复条目");
  for (const s of manifest.suites) {
    assert.ok(existsSync(join(root, s.path)), `manifest 条目文件不存在：${s.path}`);
    if (s.path.endsWith(".mjs") || s.path.endsWith(".js")) assert.equal(s.runner, "node", `${s.path} 应为 node`);
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

await test("④ F8-27 tests/ 递归扫描无未登记套件候选（子目录/*.test.js/*.check.* 兜底）", () => {
  const unregistered = scanUnregistered(join(root, "tests"), new Set(entries));
  assert.deepEqual(unregistered, [], `形似套件但未登记 manifest：${unregistered.join(",")}`);
});

await test("⑤ F8-27 自证：临时 foo.check.mjs 与子目录 *.test.js 能被同一扫描检出未登记", () => {
  const tmp = mkdtempSync(join(tmpdir(), "suite-manifest-f827-"));
  const tdir = join(tmp, "tests");
  mkdirSync(join(tdir, "helpers"), { recursive: true });
  writeFileSync(join(tdir, "foo.check.mjs"), "throw new Error('must fail');\n");
  writeFileSync(join(tdir, "helpers", "bar.test.js"), "throw new Error('must fail');\n");
  const found = scanUnregistered(tdir, new Set(entries));
  assert.ok(found.includes("tests/foo.check.mjs"), `foo.check.mjs 应被检出，实际=${found.join(",")}`);
  assert.ok(found.includes("tests/helpers/bar.test.js"), `子目录 *.test.js 应被检出，实际=${found.join(",")}`);
});

await test("⑥ F8-32 每套件登记正整数 expectedPass 且 run-tests.sh 含计数比对与总账逻辑", () => {
  for (const s of manifest.suites) {
    assert.ok(Number.isInteger(s.expectedPass) && s.expectedPass > 0,
      `${s.path} 必须登记正整数 expectedPass（F8-32）`);
  }
  const runTests = readFileSync(join(root, "scripts/run-tests.sh"), "utf-8");
  assert.ok(runTests.includes("expectedPass"), "run-tests.sh 应读 manifest 的 expectedPass 做比对");
  assert.ok(runTests.includes("总账"), "run-tests.sh 应打印 PASS 行总账");
});

await test("⑦ F8-32 实跑其余套件：^PASS 行数与登记 expectedPass 逐个一致", () => {
  const mismatches = [];
  for (const s of manifest.suites) {
    if (s.path === "tests/suite-manifest.test.mjs") continue; // 自身计数由 run-tests 外层比对，避免递归
    const r = spawnSync(s.runner, [s.path], { cwd: root, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || "") + (r.stderr || "");
    const count = out.split("\n").filter((l) => /^PASS([ \t:]|$)/.test(l)).length;
    if (r.status !== 0) mismatches.push(`${s.path}: 实跑退出 ${r.status}`);
    else if (count !== s.expectedPass) mismatches.push(`${s.path}: 实跑 PASS 行 ${count} != 登记 ${s.expectedPass}`);
  }
  assert.deepEqual(mismatches, [], `计数不一致（增删项须同步改 manifest）：\n${mismatches.join("\n")}`);
});

const failed = results.filter(([, s]) => s === "FAIL");
console.log(`\nsuite-manifest: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
