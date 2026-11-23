// scripts/coverage-report.mjs — W4-27 覆盖率度量（P2 / F4-43）
// 用 Node 内置 NODE_V8_COVERAGE（V8 精确覆盖，零依赖、0 元）逐个子进程跑全部
// Node 测试套件；Python 套件不在 V8 口径内，F6-80 起一并实跑并把其计数纳入
// 下方汇总输出。套件集合单一事实源（F7-32）：tests/suites-manifest.json，
// 与 scripts/run-tests.sh 共用（旧版 Python 清单硬编码曾漏 quota_check_test.py）。
// 汇总 functions/、workers/fetcher/src/、shared/ 三处源文件的行/函数覆盖率。
// 若 NODE_V8_COVERAGE 路线无任何产出，自动退到 `node --test
// --experimental-test-coverage` 并在输出中注明实际方法。
//
// 口径（近似，与 c8 的差异在此写明）：
//   - 行分母：被任一 V8 范围（函数/块范围）覆盖到的非空行；行被任一字符位置
//     count>0 触及时计为已覆盖。多套件结果取并集（任一套件覆盖即算覆盖）。
//   - 函数分母：V8 functions 条目（排除整文件根条目 functionName==="")，
//     以（函数名 + 起始偏移）去重；首范围 count>0 即已覆盖。
//   - 从未被任何套件加载的文件（如 health.js）无 V8 条目：行覆盖记 0，
//     分母以其全部非空行计并在表中标注「未加载」；函数覆盖记 —。
//   - 前端 public/index.html 内联脚本不在三处源文件口径内，不计入本表。
//
// 用法：node scripts/coverage-report.mjs [--out=<md 路径>] [--report-only]
//   F7-26 fail-closed：默认任一套件非零退出则本脚本亦非零退出（与 run-tests
//   口径一致，不再默认吞失败）；确需只报告不拦截时显式传 --report-only。
//   --strict 为历史开关，现与默认行为等价（保留兼容、接受但无额外作用）。
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const REPORT_ONLY = args.includes("--report-only");
const STRICT = args.includes("--strict"); // 历史兼容：默认已 fail-closed，本开关无额外作用
const outArg = args.find((a) => a.startsWith("--out="));
const OUT = outArg ? path.resolve(outArg.slice("--out=".length)) : null;

// ---------- 套件发现（F7-32：单一事实源 tests/suites-manifest.json） ----------
const testDir = path.join(ROOT, "tests");
const manifest = JSON.parse(readFileSync(path.join(testDir, "suites-manifest.json"), "utf-8"));
const suites = manifest.suites.filter((s) => s.runner === "node").map((s) => path.join(ROOT, s.path));

// ---------- 目标源文件 ----------
function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}
const targetFiles = [
  ...walk(path.join(ROOT, "functions")),
  ...walk(path.join(ROOT, "workers/fetcher/src")),
  ...walk(path.join(ROOT, "shared")),
].sort();
const targetSet = new Set(targetFiles);

// ---------- 逐套件跑 V8 覆盖 ----------
const perFile = new Map(); // absPath -> { ranges: [{start,end,count}], funcs: Map<key,{name,covered}> }
function entryFor(p) {
  if (!perFile.has(p)) perFile.set(p, { ranges: [], funcs: new Map() });
  return perFile.get(p);
}
const suiteResults = [];
let method = "NODE_V8_COVERAGE";
for (const suite of suites) {
  const covDir = mkdtempSync(path.join(tmpdir(), "top200-cov-"));
  const run = spawnSync(process.execPath, [suite], {
    cwd: ROOT,
    env: { ...process.env, NODE_V8_COVERAGE: covDir },
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300000,
  });
  suiteResults.push({ suite: path.relative(ROOT, suite), exit: run.status });
  let files = [];
  try { files = readdirSync(covDir).filter((f) => f.endsWith(".json")); } catch { files = []; }
  for (const f of files) {
    let data;
    try { data = JSON.parse(readFileSync(path.join(covDir, f), "utf-8")); } catch { continue; }
    for (const entry of data.result || []) {
      if (!entry.url || !entry.url.startsWith("file://")) continue;
      let p;
      try { p = decodeURIComponent(new URL(entry.url).pathname); } catch { continue; }
      if (!targetSet.has(p)) continue;
      const rec = entryFor(p);
      for (const fn of entry.functions || []) {
        for (const r of fn.ranges || []) rec.ranges.push({ start: r.startOffset, end: r.endOffset, count: r.count });
        if (fn.functionName === "") continue; // 整文件根条目不计函数分母
        const r0 = (fn.ranges || [])[0];
        if (!r0) continue;
        const key = `${fn.functionName}@${r0.startOffset}`;
        const prev = rec.funcs.get(key);
        rec.funcs.set(key, { name: fn.functionName, covered: (prev ? prev.covered : false) || r0.count > 0 });
      }
    }
  }
}

// ---------- 覆盖计算 ----------
function fileCoverage(absPath) {
  const src = readFileSync(absPath, "utf-8");
  const rec = perFile.get(absPath);
  const lines = src.split("\n");
  const lineStart = [];
  { let off = 0; for (const ln of lines) { lineStart.push(off); off += ln.length + 1; } }
  if (!rec || rec.ranges.length === 0) {
    const total = lines.filter((l) => l.trim().length > 0).length;
    return { coveredLines: 0, totalLines: total, coveredFuncs: 0, totalFuncs: null, loaded: false };
  }
  const cnt = new Int32Array(src.length).fill(0);
  const instr = new Uint8Array(src.length);
  // 并集语义：字符的最终 count 取「最小包含范围」内的计数；同一最小范围在
  // 不同套件/进程条目中重复出现时取最大值（任一套件跑到即算覆盖）。
  const bestSpan = new Float64Array(src.length).fill(Infinity);
  for (const r of rec.ranges) {
    const s = Math.max(0, r.start), e = Math.min(src.length, r.end);
    const len = r.end - r.start;
    for (let i = s; i < e; i++) {
      instr[i] = 1;
      if (len < bestSpan[i]) { bestSpan[i] = len; cnt[i] = r.count; }
      else if (len === bestSpan[i] && r.count > cnt[i]) cnt[i] = r.count;
    }
  }
  let coveredLines = 0, totalLines = 0;
  lines.forEach((ln, li) => {
    if (!ln.trim()) return;
    const s = lineStart[li], e = Math.min(src.length, s + ln.length);
    let anyInstr = false, anyCov = false;
    for (let i = s; i < e; i++) { if (instr[i]) { anyInstr = true; if (cnt[i] > 0) anyCov = true; } }
    if (!anyInstr) return;
    totalLines++;
    if (anyCov) coveredLines++;
  });
  const funcs = [...rec.funcs.values()];
  return {
    coveredLines, totalLines,
    coveredFuncs: funcs.filter((f) => f.covered).length,
    totalFuncs: funcs.length,
    loaded: true,
  };
}

const rows = targetFiles.map((p) => ({ file: path.relative(ROOT, p), ...fileCoverage(p) }));
const pct = (c, t) => (t ? ((c / t) * 100).toFixed(1) + "%" : "—");
function subtotal(list) {
  const cl = list.reduce((a, r) => a + r.coveredLines, 0);
  const tl = list.reduce((a, r) => a + r.totalLines, 0);
  const cf = list.reduce((a, r) => a + (r.coveredFuncs || 0), 0);
  const tf = list.reduce((a, r) => a + (r.totalFuncs || 0), 0);
  return { cl, tl, cf, tf };
}
const groups = [
  ["functions/", rows.filter((r) => r.file.startsWith("functions/"))],
  ["workers/fetcher/src/", rows.filter((r) => r.file.startsWith("workers/fetcher/src/"))],
  ["shared/", rows.filter((r) => r.file.startsWith("shared/"))],
];
const grand = subtotal(rows);

// ---------- 回退路线：node --test --experimental-test-coverage ----------
let fallbackNote = "";
if (!rows.some((r) => r.loaded)) {
  method = "node --test --experimental-test-coverage（回退）";
  const run = spawnSync(process.execPath, ["--test", "--experimental-test-coverage", ...suites], {
    cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, timeout: 300000,
  });
  fallbackNote = "\nNODE_V8_COVERAGE 无产出，已回退原生 test coverage，原始输出如下：\n" +
    "```\n" + (run.stdout || "") + (run.stderr || "") + "\n```\n";
}

// ---------- Python 套件（F6-80：纳入汇总，计数从套件自报输出解析） ----------
const pySuites = manifest.suites.filter((s) => s.runner === "python3").map((s) => s.path);
const pyResults = [];
for (const rel of pySuites) {
  const run = spawnSync("python3", [path.join(ROOT, rel)], {
    cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, timeout: 300000,
  });
  const out = (run.stdout || "") + (run.stderr || "");
  let count = null;
  let m = out.match(/(\d+)\s+CHECKS PASSED/) || out.match(/:\s*(\d+)\/(\d+)\s+PASS/);
  if (m) count = m[2] ? `${m[1]}/${m[2]}` : `${m[1]}`;
  pyResults.push({ suite: rel, exit: run.status, count });
}

// ---------- 输出 ----------
const L = [];
L.push("# 覆盖率报告（W4-27 / F4-43）");
L.push("");
L.push(`方法：${method}；套件 ${suites.length} 个（Node）+ ${pySuites.length} 个（Python，不在 V8 口径内、计数纳入汇总）。`);
L.push("");
L.push("## 套件退出码");
L.push("");
L.push("| 套件 | 退出码 | 计数 |");
L.push("|---|---|---|");
for (const s of suiteResults) L.push(`| ${s.suite} | ${s.exit} | —（Node，见各套件自报） |`);
for (const s of pyResults) L.push(`| ${s.suite}（Python） | ${s.exit} | ${s.count ?? "未解析"} |`);
L.push("");
L.push("## 源文件覆盖率");
L.push("");
L.push("| 文件 | 行覆盖 | 函数覆盖 | 备注 |");
L.push("|---|---|---|---|");
for (const r of rows) {
  L.push(`| ${r.file} | ${r.coveredLines}/${r.totalLines}（${pct(r.coveredLines, r.totalLines)}） | ` +
    (r.totalFuncs === null ? "—" : `${r.coveredFuncs}/${r.totalFuncs}（${pct(r.coveredFuncs, r.totalFuncs)}）`) +
    ` | ${r.loaded ? "" : "未被任何套件加载"} |`);
}
L.push("");
L.push("## 分组小计");
L.push("");
L.push("| 分组 | 行覆盖 | 函数覆盖 |");
L.push("|---|---|---|");
for (const [name, list] of groups) {
  const s = subtotal(list);
  L.push(`| ${name} | ${s.cl}/${s.tl}（${pct(s.cl, s.tl)}） | ${s.cf}/${s.tf}（${pct(s.cf, s.tf)}） |`);
}
L.push(`| **合计** | **${grand.cl}/${grand.tl}（${pct(grand.cl, grand.tl)}）** | **${grand.cf}/${grand.tf}（${pct(grand.cf, grand.tf)}）** |`);
if (fallbackNote) L.push(fallbackNote);
const report = L.join("\n");
console.log(report);
if (OUT) { writeFileSync(OUT, report + "\n", "utf-8"); console.log(`\n已写入 ${OUT}`); }
const suiteFailed = suiteResults.some((s) => s.exit !== 0) || pyResults.some((s) => s.exit !== 0);
if (suiteFailed && !REPORT_ONLY) process.exitCode = 1; // F7-26：默认 fail-closed，--report-only 才只报告
if (suiteFailed && REPORT_ONLY) console.log("\n[coverage] 注意：有套件失败，因 --report-only 显式开关本次退出码仍为 0（报告口径，不作门禁判定）");
