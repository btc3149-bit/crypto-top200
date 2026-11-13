# W4-07 compare-shadow v2 试跑记录（准备版）

- 分支：`prep/w404-w407`（基线 `b552973`），只备不部署、未触碰生产。
- 新文件：`scripts/compare-shadow-v2.mjs`。**原 `scripts/compare-shadow.mjs` 零改动**（明早 G1 结算仍用原版）。
- 日期：2026-11-13（实跑时刻 2026-11-13T02:53Z ≈ 10:53 CST）。

## v2 针对 F4-09 四缺口的补强

| F4-09 缺口 | v2 处理 |
|---|---|
| top20SameSet 只算不用 | 纳入 `checks.top20SameSet` 判据，不一致即 fail 并写入 `failReasons` |
| compared 数量无下限 | 新增下限（默认 `--min-compared 188` = 200×94%，与覆盖率门禁同口径），低于下限判 fail 并注明实际值/下限 |
| 两次抓取未按 fetchRunId 对齐 | 三方互验：`shadow.fetchRunId` ↔ `health.lastRunId` ↔ live 运行标识（`live.fetch.fetchRunId`，契约 v2）。live 为 legacy 契约（无 fetchRunId）或 ID 不一致时 `alignment.status="unaligned"`、报告明写「未对齐」及原因，结论降级为 `conditional`（退出码 2），即使数值判据全过也不得称 pass |
| 「≥400 次运行」靠人工计数 | `runGate` 自动计数：以 `health.quota.creditsUsedEst`（或 shadow `fetchMeta.quota` 同一计数器）按单 run 成本区间 [4/3, 2] 反推累计 run 区间，门禁取保守下界，输出 `countedRuns / shortfall / met`；另给出可直接核实的 runId 集合与时窗应到槽位数交叉核对，误差口径写在 `caveats`（估算非精确计数，不冒充精确值） |

退出码：0=pass（数值全过且已对齐）；1=fail 或读取错误；2=conditional（数值全过但未对齐）。`g1Ready = (verdict==pass && runGate.met)`。

## 实跑（线上只读数据）

读法与原版一致、纯只读：KV 两键（`v1:board:shadow`、`v1:meta:health`）经 Cloudflare API 只读导出为本地文件，live 为对 `https://top200.oppcal.com/api/board` 的一次 GET。**不写 KV、不触发 fetcher 抓取、不消耗 CoinGecko 额度**（原版脚本本身即此读法，故可实跑）。

命令：

```
node scripts/compare-shadow-v2.mjs --shadow /tmp/shadow-blob.json \
  --health /tmp/kv-health.json --window-start 2026-11-11T00:20:00Z
```

（`--window-start` 为 G1 启动时刻 2026-11-11 08:20 CST 的 UTC 写法，仅用于时窗槽位交叉核对。）

结果摘要（退出码 **2**）：

- 数值判据全过：compared=200（≥188）、价差中位数 0.1559%（≤0.3%）、P95 0.424%（≤1.5%）、shadow 覆盖 200/200、missingIds 一致、top20SameSet=true。
- 对齐：**未对齐**——`shadow.fetchRunId = health.lastRunId = 20261113T0250Z-7cb4`（shadow↔health 一致），但 live 侧为 legacy 契约、无 fetchRunId（`liveRunId=null`），无法按 run 对齐；时间差 134s 仅作参考。故 `verdict=conditional`、`pass=false`。
- 运行门禁：creditsUsedEst=606 → 累计 run 估算区间 [303, 454]，保守计数 **303**，距 400 还差 **97**，`runGate.met=false`，`g1Ready=false`。交叉核对：时窗应到槽位 304，与保守计数 303 仅差 1（差异可由窗口外 G0 手动 run 与失败 run 不计 credits 解释），两估算器互相印证。
- 同场对照：原版 v1 对同一份 shadow 数据输出 `pass=true`（退出 0）——正是 F4-09 指出的问题形态：未对齐、运行数未达标的情况下原版仍给干净通过；v2 正确降级。

## 合成分支验证（本地桩 server，不碰线上）

以 shadow blob 构造同源 live 响应，逐项验证 v2 分支：

| 用例 | 构造 | 结果 |
|---|---|---|
| 对齐 | live.fetch.fetchRunId = shadow.fetchRunId、价格市值同源 | verdict=pass，退出 0 |
| ID 不一致 | live fetchRunId 改为异值 | verdict=conditional，退出 2 |
| 样本下限 | live 只含 100 个币（compared=100 < 188） | verdict=fail，退出 1，failReasons 明示下限判据 |
| top20 判据 | 把 top20 外一币市值抬至第一（集合变化） | verdict=fail，退出 1，failReasons 明示 top20SameSet |

## 试跑中发现的真实口径问题（供 G1 结算注意）

1. **KV 读最终一致性延迟**：曾先后两次导出得到 `shadow=…T0250Z` 而 `health.lastRunId` 仍为上一 run `…T0240Z`（credits 604 vs blob 内 606），约 1–2 分钟后复读收敛为一致（0250 / 606）。结算取数时 shadow 与 health 两键导出须间隔复读确认同 run 再比对，否则会误判「shadow 与 health 不一致」。v2 的 `shadowMatchesHealth` 字段就是为暴露此问题而设。
2. **credits 区间宽度来自 F4-01**：单 run 成本上界取 2 是因为现行（未修复版）fetcher 在 F4-01 下 global 每 run 重抓；W4-01 修复部署后成本回归 4/3，区间将收窄。结算报告引用 run 数时应同时给出区间 [303, 454] 与保守值 303，不要只引单点。
3. **精确计数仍缺数据源**：health/blob 均无单调递增 run 序号，自动计数只能估算。若 G2 决策要求精确 ≥400 证据，须在 fetcher 侧补 run 序号字段（属后续工作包，不在本准备分支范围）。

## 结论

v2 四项补强均已实现并经实跑 + 合成用例双重验证；对当前线上数据的如实结论是：数值一致性全过、但**未对齐（legacy 无 run 标识）且运行数保守估算未达 400**，`g1Ready=false`——与 G1 尚在观察期（2026-11-14 才结算）的事实一致。本文件不构成 G1 结算结论，结算仍按原计划用原版脚本 + 本 v2 交叉复核进行。
