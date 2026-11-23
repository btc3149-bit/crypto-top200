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
function makeLive({ price = 100, runId = "run-1", coinCount = N, nullPriceIds = [], nullMcapIds = [], servedFrom = null } = {}) {
  const coins = {};
  ids.slice(0, coinCount).forEach((id, i) => {
    coins[id] = {
      price: nullPriceIds.includes(id) ? null : price,
      mcapUsd: nullMcapIds.includes(id) ? null : (N - i) * 1000,
      rank: i + 1, change24h: 0, volume24h: 1000,
    };
  });
  const live = {
    updatedAt: "2026-11-23T00:00:00.000Z",
    coverage: { expected: N, returned: coinCount, missingIds: [] },
    coins,
  };
  if (runId !== null) live.fetch = { fetchRunId: runId };
  if (servedFrom) live.freshness = { servedFrom };
  return live;
}
const health = { lastRunId: "run-1", lastRunAt: "2026-11-23T00:00:00.000Z", quota: { creditsUsedEst: 2000 } };

function run(shadow, live, { healthOverride = null, extraArgs = [] } = {}) {
  const sp = join(dir, "shadow.json");
  const lp = join(dir, "live.json");
  const hp = join(dir, "health.json");
  writeFileSync(sp, JSON.stringify(shadow));
  writeFileSync(lp, JSON.stringify(live));
  writeFileSync(hp, JSON.stringify(healthOverride ?? health));
  const r = spawnSync(
    process.execPath,
    ["scripts/compare-shadow.mjs", "--shadow", sp, "--live-file", lp, "--health", hp, "--required-runs", "10", ...extraArgs],
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

// ---------- F7-06：F6-08/F6-20/F6-21 三条 verdict 上限（删任一逻辑本组即变红） ----------
await test("⑦ F7-06 same-source（servedFrom=kv 且同 run）：数值全过亦上限 conditional、mode=same-source 退出 2", () => {
  const { report, status } = run(makeShadow(), makeLive({ servedFrom: "kv" }));
  assert.equal(report.mode, "same-source");
  assert.equal(report.verdict, "conditional");
  assert.ok(report.verdictCaps.some((s) => s.includes("same-source")), report.verdictCaps.join(";"));
  assert.equal(status, 2);
});

await test("⑧ F7-06 same-source（--shadow-key current 显式声明）：independent 形态亦上限 conditional 退出 2", () => {
  const { report, status } = run(makeShadow(), makeLive(), { extraArgs: ["--shadow-key", "current"] });
  assert.equal(report.mode, "same-source");
  assert.equal(report.verdict, "conditional");
  assert.ok(report.verdictCaps.some((s) => s.includes("same-source")), report.verdictCaps.join(";"));
  assert.equal(status, 2);
});

await test("⑨ F7-06 runGate 未达标（credits 仅够 2 run < 要求 10）：上限 conditional、runGate.met=false 退出 2", () => {
  const h = { lastRunId: "run-1", lastRunAt: "2026-11-23T00:00:00.000Z", quota: { creditsUsedEst: 4 } };
  const { report, status } = run(makeShadow(), makeLive(), { healthOverride: h });
  assert.equal(report.runGate.met, false);
  assert.equal(report.runGate.countedRuns, 2);
  assert.equal(report.verdict, "conditional");
  assert.ok(report.verdictCaps.some((s) => s.includes("runGate")), report.verdictCaps.join(";"));
  assert.equal(status, 2);
});

await test("⑩ F7-06 runGate 无证据（health 无 quota）：countedRuns=null、met=null → 上限 conditional 退出 2", () => {
  const h = { lastRunId: "run-1", lastRunAt: "2026-11-23T00:00:00.000Z" };
  const { report, status } = run(makeShadow(), makeLive(), { healthOverride: h });
  assert.equal(report.runGate.countedRuns, null);
  assert.equal(report.runGate.met, null);
  assert.equal(report.verdict, "conditional");
  assert.ok(report.verdictCaps.some((s) => s.includes("runGate")), report.verdictCaps.join(";"));
  assert.equal(status, 2);
});

await test("⑪ F7-06 live null 恰 1 个（price）：不 fail、上限 conditional、liveFieldOk=true 退出 2", () => {
  const { report, status } = run(makeShadow(), makeLive({ nullPriceIds: ["coin-007"] }));
  assert.equal(report.fieldGate.liveNullPriceCount, 1);
  assert.equal(report.checks.liveFieldOk, true);
  assert.equal(report.verdict, "conditional");
  assert.ok(report.verdictCaps.some((s) => s.includes("live 侧 null 1–2")), report.verdictCaps.join(";"));
  assert.equal(status, 2);
});

await test("⑫ F7-06 live null 恰 2 个（mcap）：不 fail、上限 conditional 退出 2", () => {
  // 用尾部币：头部币 mcap 置 null 会连带 top20SameSet 判 fail，与本例要隔离的上限逻辑无关
  const { report, status } = run(makeShadow(), makeLive({ nullMcapIds: ["coin-199", "coin-200"] }));
  assert.equal(report.fieldGate.liveNullMcapCount, 2);
  assert.equal(report.checks.liveFieldOk, true);
  assert.equal(report.verdict, "conditional");
  assert.ok(report.verdictCaps.some((s) => s.includes("live 侧 null 1–2")), report.verdictCaps.join(";"));
  assert.equal(status, 2);
});

await test("⑬ F7-06 live null 3 个（>2）：verdict=fail、liveFieldOk=false 退出 1", () => {
  const { report, status } = run(makeShadow(), makeLive({ nullPriceIds: ["coin-007", "coin-008", "coin-009"] }));
  assert.equal(report.fieldGate.liveNullPriceCount, 3);
  assert.equal(report.checks.liveFieldOk, false);
  assert.equal(report.verdict, "fail");
  assert.ok(report.failReasons.some((s) => s.includes("live 字段门禁")), report.failReasons.join(";"));
  assert.equal(status, 1);
});

const failed = results.filter(([, s]) => s === "FAIL");
console.log(`\ncompare-shadow: ${results.length - failed.length} PASS / ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
