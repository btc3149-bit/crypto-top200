// tests/kv-write-guard.test.mjs — F6-92 硬性检查项（契约测试形态）
// 平台层 KV 绑定不区分读写，Pages 侧「BOARD_KV 只读」靠代码自律兜底：
// 扫描 functions/ 全部文件，出现 BOARD_KV.put 或 BOARD_KV.delete 即失败。
// 写方只能是 fetcher（workers/），functions/ 任一文件新增写调用必须先过评审改本条。
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../functions/", import.meta.url);
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const files = walk(root.pathname);
assert.ok(files.length > 0, "functions/ 应至少有一个文件");
const offenders = [];
for (const f of files) {
  const src = readFileSync(f, "utf-8");
  if (/BOARD_KV\s*\.\s*(put|delete)\s*\(/.test(src)) offenders.push(f);
}
assert.deepEqual(offenders, [], `F6-92: functions/ 不得出现 BOARD_KV.put/delete，违规文件：${offenders.join(", ")}`);
console.log(`PASS F6-92 kv-write-guard: functions/ 共 ${files.length} 个文件，无 BOARD_KV.put/delete`);
console.log("\n=== 1/1 passed ===");
