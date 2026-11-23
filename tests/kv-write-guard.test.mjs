// tests/kv-write-guard.test.mjs — F6-92 硬性检查项（契约测试形态）
// 平台层 KV 绑定不区分读写，Pages 侧「BOARD_KV 只读」靠代码自律兜底：
// 扫描 functions/ 全部文件，出现 BOARD_KV.put 或 BOARD_KV.delete 即失败。
// 写方只能是 fetcher（workers/），functions/ 任一文件新增写调用必须先过评审改本条。
//
// W5 修订（2026-11-23，用户批准）：唯一例外 = board.js 的 legacy 实测计量计数器
// addLegacyCredits 对 KV_KEYS.legacyCredits（v1:meta:legacy-credits）的 put——
// 只写这一个计数键、不写任何数据键（见 board.js W5 注释与 tests/legacy-credits.test.mjs）。
// 例外按「调用点参数必须是 KV_KEYS.legacyCredits」逐点核准，其余任何 put/delete 仍失败。
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
let allowed = 0;
for (const f of files) {
  const src = readFileSync(f, "utf-8");
  for (const m of src.matchAll(/BOARD_KV\s*\.\s*(put|delete)\s*\(\s*([^,)]*)/g)) {
    const isAllowedLegacyCounter =
      m[1] === "put" && f.endsWith("functions/api/board.js") && m[2].trim() === "KV_KEYS.legacyCredits";
    if (isAllowedLegacyCounter) allowed += 1;
    else offenders.push(`${f}: BOARD_KV.${m[1]}(${m[2].trim()}...)`);
  }
}
assert.deepEqual(offenders, [], `F6-92/W5: functions/ 不得出现未批准的 BOARD_KV.put/delete，违规：${offenders.join(", ")}`);
assert.equal(allowed, 1, "W5 例外应恰为 board.js 对 legacyCredits 的 1 处 put");
console.log(`PASS F6-92 kv-write-guard: functions/ 共 ${files.length} 个文件，仅 board.js legacyCredits 计数 1 处 put（W5 批准例外），无其他 BOARD_KV.put/delete`);
console.log("\n=== 1/1 passed ===");
