// tests/kv-write-guard.test.mjs — F6-92 硬性检查项 + F7-03 守卫重构（契约测试形态）
// 平台层 KV 绑定不区分读写，Pages 侧「BOARD_KV 只读」靠代码自律兜底。
// F7-03 重构：旧实现仅正则匹配字面 BOARD_KV.(put|delete)(，别名/解构/计算属性
// 写法可绕过（评审实测坐实）。现改用 tests/helpers/kv-guard-scan.mjs 的 token 级
// 扫描器：来源追踪（别名链/解构/计算属性/方法别名）+ fail-closed（接收者来源
// 不可判定亦拦），逐点核准唯一批准写：
//   functions/api/board.js 的 addLegacyCredits 函数体内、env.BOARD_KV.put、
//   第一实参恰为 KV_KEYS.legacyCredits，共恰 1 处。
// 已证明非 KV 的接收者（如 caches.default 派生的 cache.put）不在拦截口径内。
// 负向 fixture（tests/fixtures/kv-guard/*.js）逐一样本断言被拦；正向样本断言放行。
// 写方只能是 fetcher（workers/），functions/ 任一文件新增写调用必须先过评审改本条。
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scanKvWrites } from "./helpers/kv-guard-scan.mjs";

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

// F8-35：扫描范围 = functions/ + shared/（Functions 实际 import 仓库根 shared/，
// 写调用藏进 shared/*.js 由 board.js 引用同样属写面）。
const repoRoot = new URL("..", import.meta.url).pathname;
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const files = [...walk(join(repoRoot, "functions")), ...walk(join(repoRoot, "shared"))];
assert.ok(files.length > 0, "functions/ 与 shared/ 应至少有一个文件");
const rel = (f) => f.slice(repoRoot.length);

await test("① F7-03+F8-35 现行 functions/+shared/ 全仓扫描：仅 board.js addLegacyCredits 的批准 put 1 处，其余零写", () => {
  let totalAllowed = 0;
  const allOffenders = [];
  for (const f of files) {
    const r = scanKvWrites(readFileSync(f, "utf-8"), rel(f));
    totalAllowed += r.allowed;
    allOffenders.push(...r.offenders);
  }
  assert.deepEqual(allOffenders, [], `未批准的 KV 写：\n${allOffenders.join("\n")}`);
  assert.equal(totalAllowed, 1, "W5 批准例外应恰为 1 处");
});

// ---------- 负向 fixture：评审 F7-03 绕过样本逐一被拦 ----------
const fixtureDir = new URL("./fixtures/kv-guard/", import.meta.url).pathname;
const NEGATIVE = [
  "alias.js", "destruct-method.js", "computed.js", "indirect-alias.js",
  "method-alias.js", "destruct-rename.js", "bracket-binding.js",
  "wrong-key.js", "delete-approved-key.js", "unknown-receiver.js", "computed-dynamic.js",
];
for (const name of NEGATIVE) {
  await test(`② F7-03 负向 fixture ${name}：绕过写法被守卫拦下`, () => {
    // wrong-key/delete-approved-key 以 board.js 路径扫描：形似批准亦须被拦（键/方法不合）
    const asPath = ["wrong-key.js", "delete-approved-key.js"].includes(name)
      ? "functions/api/board.js"
      : "functions/api/evil.js";
    const r = scanKvWrites(readFileSync(join(fixtureDir, name), "utf-8"), asPath);
    assert.equal(r.allowed, 0, `${name} 不得产生批准写`);
    assert.ok(r.offenders.length >= 1, `${name} 应至少被拦 1 处，实际 offenders=${JSON.stringify(r.offenders)}`);
  });
}

await test("③ F7-03 正向 fixture approved-shape：以 board.js 路径扫描恰计 1 处批准写、零 offender", () => {
  const r = scanKvWrites(readFileSync(join(fixtureDir, "approved-shape.js"), "utf-8"), "functions/api/board.js");
  assert.equal(r.allowed, 1);
  assert.deepEqual(r.offenders, []);
});

await test("④ F7-03 正向 fixture approved-shape：以其他文件路径扫描则被拦（批准与文件绑定）", () => {
  const r = scanKvWrites(readFileSync(join(fixtureDir, "approved-shape.js"), "utf-8"), "functions/api/health.js");
  assert.equal(r.allowed, 0);
  assert.ok(r.offenders.length >= 1);
});

await test("⑤ F7-03 正向 fixture non-kv-put：caches.default 派生 cache.put 不被误拦", () => {
  const r = scanKvWrites(readFileSync(join(fixtureDir, "non-kv-put.js"), "utf-8"), "functions/api/board.js");
  assert.deepEqual(r.offenders, []);
});

// ---------- 第八期红队语料（F8-03/F8-33/F8-34/F8-37 + 原已拦类别回归） ----------
const P8_NEGATIVE = [
  "p8-optional-direct.js", "p8-optional-method.js", "p8-optional-delete.js",
  "p8-optional-computed.js", "p8-optional-extract.js",
  "p8-nested-destruct.js", "p8-forof-destruct.js", "p8-param-destruct.js",
  "p8-unicode-method.js", "p8-unicode-binding.js", "p8-unicode-string-key.js",
  "p8-template-key.js", "p8-param-pass.js", "p8-return-pass.js",
  "p8-container-array.js", "p8-container-object.js", "p8-proxy.js",
  "p8-bind.js", "p8-call.js", "p8-obfuscate-comment.js",
  "p8-eval.js", "p8-function-ctor.js",
];
for (const name of P8_NEGATIVE) {
  await test(`⑥ F8 红队语料 ${name}：被守卫拦下`, () => {
    const r = scanKvWrites(readFileSync(join(fixtureDir, name), "utf-8"), "functions/api/evil.js");
    assert.equal(r.allowed, 0, `${name} 不得产生批准写`);
    assert.ok(r.offenders.length >= 1, `${name} 应至少被拦 1 处，实际 offenders=${JSON.stringify(r.offenders)}`);
  });
}

await test("⑦ F8-36 已登记边界 p8-boundary-reflect.js：守卫放行（边界口径固化，靠 baseline §5.2 人工评审兜底）", () => {
  const r = scanKvWrites(readFileSync(join(fixtureDir, "p8-boundary-reflect.js"), "utf-8"), "functions/api/evil.js");
  assert.deepEqual(r.offenders, [], "Reflect 抽取属已声明边界；若此断言变红，说明边界口径已变化，须同步更新 baseline 登记");
});

await test("⑧ F8-35 shared/ 单独扫描：零 offender、零批准写（批准例外仍仅 functions/api/board.js 一处）", () => {
  const sharedFiles = files.filter((f) => rel(f).startsWith("shared/"));
  assert.ok(sharedFiles.length > 0, "shared/ 应至少有一个文件");
  for (const f of sharedFiles) {
    const r = scanKvWrites(readFileSync(f, "utf-8"), rel(f));
    assert.deepEqual(r.offenders, [], `${rel(f)} 不得有未批准写`);
    assert.equal(r.allowed, 0, `${rel(f)} 不得有批准写`);
  }
});

const failed = results.filter(([, s]) => s === "FAIL");
console.log(`\nkv-write-guard: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
