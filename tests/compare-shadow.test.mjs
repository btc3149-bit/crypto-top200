// tests/compare-shadow.test.mjs — F6-16 判级逻辑用例（第六期批 5/6 新增）
// scripts/compare-shadow.mjs 无导出（顶层脚本），但原生支持纯文件 fixture 输入：
//   --shadow <blob.json> --health <health.json> --live-file <board 响应 json>
// 故本套件以子进程驱动真实脚本，喂固定双 blob fixture，断言 stdout JSON 的
// verdict 与进程退出码。退出码口径（脚本头定版）：pass=0、fail=1、conditional=2。
// 覆盖：pass（同 run 对齐+数值全过）/ conditional（runId 不一致、live 无 runId
// 两条不对齐分支）/ fail（价差超限、compared 低于下限、shadow 字段门禁 null price）。
// 全离线：不访问 KV、不请求线上 /api/board（--live-file 替代）、零额度消耗。
// 运行：node tests/compare-shadow.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "compare-shadow-test-"));
const N = 200;
const ids = Array.from({ length: N }, (_, i) => `coin-${String(i + 1).padStart(3, "0")}`);

function makeShadow({ priceFactor = 1, runId = "run-1", nullPriceId = null } = {}) {
  return {
    fetchRunId: runId,
    fetchedAt: "2026-11-23T00:00:00.000Z",
    coverage: { expected: N, returned: N, missingIds: [] },
    rows: ids.map((id, i) => ({
      id,
      price: id === nullPriceId ? null : 100 * priceFactor,
      mcapUsd: (N - i) * 1000,
      rank: i + 1,
    })),
  };
}
function makeLive({ price = 100, runId = "run-1", coinCount = N } = {}) {
  const coins = {};
  ids.slice(0, coinCount).forEach((id, i) => {
    coins[id] = { price, mcapUsd: (N - i) * 1000, rank: i + 1, change24h: 0, volume24h: 1000 };
  });
  const live = {
    updatedAt: "2026-11-23T00:00:00.000Z",
    coverage: { expected: N, returned: coinCount, missingIds: [] },
    coins,
  };
  if (runId !== null) live.fetch = { fetchRunId: runId };
  return live;
}
const health = { lastRunId: "run-1", lastRunAt: "2026-11-23T00:00:00.000Z", quota: { creditsUsedEst: 2000 } };

function run(shadow, live) {
  const sp = join(dir, "shadow.json");
  const lp = join(dir, "live.json");
  const hp = join(dir, "health.json");
  writeFileSync(sp, JSON.stringify(shadow));
  writeFileSync(lp, JSON.stringify(live));
  writeFileSync(hp, JSON.stringify(health));
  const r = spawnSync(
    process.execPath,
    ["scripts/compare-shadow.mjs", "--shadow", sp, "--live-file", lp, "--health", hp, "--required-runs", "10"],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf-8" }
  );
  assert.ok(r.stdout, "脚本应有 stdout 输出");
  return { report: JSON.parse(r.stdout), status: r.status };
}

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

await test("① pass：双 blob 同 run 对齐、价差 0、覆盖/字段全过 → verdict=pass 退出 0", () => {
  const { report, status } = run(makeShadow(), makeLive());
  assert.equal(report.verdict, "pass");
  assert.equal(report.alignment.status, "aligned");
  assert.equal(report.compared, N);
  assert.equal(status, 0);
});

await test("② conditional：live 与 shadow 的 fetchRunId 不一致 → 降级 conditional 退出 2", () => {
  const { report, status } = run(makeShadow(), makeLive({ runId: "run-2" }));
  assert.equal(report.verdict, "conditional");
  assert.equal(report.alignment.status, "unaligned");
  assert.match(report.alignment.basis, /run-id-mismatch/);
  assert.equal(status, 2);
});

await test("③ conditional：live 无 fetchRunId（legacy 契约形态）→ conditional 退出 2", () => {
  const { report, status } = run(makeShadow(), makeLive({ runId: null }));
  assert.equal(report.verdict, "conditional");
  assert.match(report.alignment.basis, /live-run-id-unavailable/);
  assert.equal(status, 2);
});

await test("④ fail：shadow 全币价差 +5%（中位数 >0.3%）→ verdict=fail 退出 1", () => {
  const { report, status } = run(makeShadow({ priceFactor: 1.05 }), makeLive());
  assert.equal(report.verdict, "fail");
  assert.ok(report.failReasons.some((s) => s.includes("价差中位数")), report.failReasons.join(";"));
  assert.equal(status, 1);
});

await test("⑤ fail：live 仅 10 币、compared=10 低于下限 188 → verdict=fail 退出 1", () => {
  const { report, status } = run(makeShadow(), makeLive({ coinCount: 10 }));
  assert.equal(report.verdict, "fail");
  assert.equal(report.compared, 10);
  assert.equal(report.checks.comparedFloorOk, false);
  assert.equal(status, 1);
});

await test("⑥ fail：shadow 一行 price=null 触字段门禁 → verdict=fail 退出 1", () => {
  const { report, status } = run(makeShadow({ nullPriceId: "coin-007" }), makeLive());
  assert.equal(report.verdict, "fail");
  assert.deepEqual(report.fieldGate.shadowNullPriceIds, ["coin-007"]);
  assert.equal(status, 1);
});

const failed = results.filter(([, s]) => s === "FAIL");
console.log(`\ncompare-shadow: ${results.length - failed.length} PASS / ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
