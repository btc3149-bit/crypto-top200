# 第八期修复施工碎片 · Paprika/fetcher 路（批 0 + 批 4 + F8-29 部分）

- 分支：p8-paprika（worktree ~/workspace/phase8-wt/paprika）；未部署、未 push、未 merge。
- 基线：HEAD 5d97da6，全量 22 套件全绿。完工：23 套件全绿（新增 1 套件）。
- Paprika 备源保持关闭（PAPRIKA_ENABLED=false，线上 source=coingecko 不变）。

## 四计数修复后实测（2026-11-23T08:44Z 实时拉取复跑）

数据：Paprika /v1/coins 目录 62,744 条、/v1/tickers 前 2,000 条（limit=5000 实返 2000，与 F6-53 口径一致）；工具：`node scripts/verify-paprika-identity.mjs --coins-file <当日目录> --tickers-file <当日 tickers>`（含登记册一致性校验，输出 OK）。

| 计数 | 值 | 说明 |
|---|---|---|
| mapped | 196/200 | 4 空：hash-2、celium、genius-3、nxm |
| identityValid | 196 | 登记册全名口径，无一不符 |
| activeUsable | 195 | yzy-yzy is_active=false（已下线） |
| tickerHit | 179 | 缺 17 条均为 rank 2268–6728 的目录内活跃条目、不在免费 tickers 前 2000；另含 htx 登记例外 1 条（见 F8-02） |
| 门禁 | threshold=188，ok=false | tickerHit 差 9 条 → **保持关闭**（脚本 exit 1 为预期） |

口径变化说明（F8-02/F8-21 引入）：tickerHit 新增前置条件——市值交叉合理性通过或命中已登记例外；其余三项定义不变。本次实测四计数与第七期定版逐项相同（196/196/195/179）：三条改指主条目后主条目本身均在 tickers 前 2000 且市值量级正常，原 -token 条目此前亦计入 tickerHit，故总数不变；变化的是「-token 条目今后会被 plausibility 拦下」这一门禁能力，已固化回归用例。

## 逐条处置

### F8-01（P1）已修 — 身份登记册
- 设计：`scripts/verify-paprika-identity.mjs --write-registry` 经全名复核（symbol 全等 + 规范化 name/别名，shared 口径）生成登记册 `workers/fetcher/src/paprika-registry.js`（196 条入仓，含 cgId/paprikaId、两侧 name/symbol、CG 快照市值、Paprika rank，生成时间 2026-11-23T08:42Z）。
- 运行时：`coinpaprika.fetchGateStats` 把登记册传入 `countPaprikaGateStats`；运行时 coin 只有 {id, paprikaId} 时，身份判定以登记册中经复核的 CG 侧 name/symbol 与**实时目录条目**做全名比对，不再拿条目与自身比对；paprikaId 不在册（registry_missing）或 cgId 不符（registry_cg_mismatch）即拦下。
- 自动化强制：`tests/paprika-gate.test.mjs` 新增登记册新鲜度用例——登记册与 coins-list.js + data/coins.json 逐条比对（diffPaprikaRegistry），不一致套件红；部署门禁跑全量测试，等效强制。verify 脚本普通模式也校验在仓登记册一致性。
- 硬验收：F7-01 三旧错配值（pump-pumpbtc / sky-skycoin / skr-saakuru-labs）以运行时形态喂入 + 登记册 → identityValid=0、tickerHit=0（registry_missing×3）；对照组不传登记册旧口径 3/3 全过，证明拦截来源是登记册。已固化回归用例。

### F8-02（P1）已修 — 主条目改指 + 市值合理性校验 + htx 例外
- 映射改指（2026-11-23T08:40Z 目录/tickers 实测）：cosmos→atom-cosmos（主条目 rank 108、市值 $465.1M；原 -token rank 1107、$2.63M）、litecoin→ltc-litecoin（rank 30、$3,068.3M；原 rank 424、$30.2M）、zcash→zec-zcash（rank 11、$12,954.4M；原 rank 235、$94.8M）。三主条目均 is_active 且在 tickers 前 2000，无需留空。
- 同步：先改事实源 coins-list.js，再以结构化脚本同步三份 coins.json 的 paprikaId 列（仅此 3 行变化）、按 check_meta 口径 A 重算 meta.dataHash（sha256:8306ad4e…），三份 md5 逐字节一致（bb54810a…），check_meta 8/8 pass。注：public/data/coins.json 属任务书明列的「三份 coins.json」同步范围。
- 门禁合理性校验：`countPaprikaGateStats` 在 tickerHit 前加 plausibility 阶段——Paprika ticker 市值 / CG 参考市值（登记册 cgSnapshotMcapUsd）< 0.05 即拦（-token 实测比值 0.36%/0.75%/0.47%，主条目 63%/77%/65%，阈值两侧均留一个数量级余量）。回归用例固化：三条 -token 身份本身通过（同名规范化）但 tickerHit 被 plausibility 拦下 3 条、主条目放行。
- htx 处置（二选一取「登记为例外」）：Paprika 侧唯一活跃条目、市值 $1,382,000 vs CG 快照 $1,370,000,000（比值约 0.001，2026-11-23 实测），无更优可选——登记于 shared 的 PAPRIKA_PLAUSIBILITY_EXCEPTIONS（附 reason/evidence），命中时计 tickerHit 并在 stats.plausibilityExceptions 留痕、verify 脚本输出单独一行，不静默放行。

### F8-16 已修 — mapped 走定版接口
- `countPaprikaGateStats` 的 mapped 改经 `isValidPaprikaId`（畸形串记 paprika_id_malformed 失败、不计数）；fetcher index.js 的 paprikaMappedCount 改用 board-schema 的 `countValidPaprikaMappings`。畸形串（"not in directory!!"）回归用例已加。board-schema.js 未改动。

### F8-18 已修（定性：函数级残余成立，构造实测双计 → 已去重）
- `countPaprikaGateStats` 以 seenPaprikaIds 去重：重复 paprikaId 只计一次，重复项记 stage=duplicate 失败。回归用例：两币同 paprikaId → mapped=1、tickerHit=1。

### F8-21 已修 — 门槛单一事实源
- 阈值与判定收敛到 shared/paprika-identity.js：PAPRIKA_GATE_RATIO（= board-schema COVERAGE_RATIO 0.94）、paprikaGateThreshold、evaluatePaprikaGate；source-state.js 改为转出（既有 import 路径兼容）。
- verify-paprika-coverage.mjs 废除 197/195 口径：阈值引用 paprikaGateThreshold（200→188），首行结论改为 `RESULT: COVERAGE_BELOW_THRESHOLD scope=coverage-only notEnablementDecision=true …`，正文带非启用判定声明，不再出现可被误读为可启用的 PASS；覆盖未达线 exit 1。当日实跑：validQuoteHit=179 → COVERAGE_BELOW_THRESHOLD，与 preflight 结论同向。

### F8-20 已修 — runbook 同步
- docs/fetcher-runbook.md Paprika 状态段已按修复后实测改准：mapped=196/200、四项门禁 ≥188 口径、四计数实测值、保持关闭、登记册再生成要求、coverage 脚本非启用判定声明。

### F8-14 已修 — invalidFields 落点
- coingecko.js fetchMarkets 不再丢弃 invalidFields（随结果返回）；coinpaprika.js 既有返回由 fetcher index.js 经 noteInvalidFields 读入。主抓 + CG 探针均汇总进 health.invalidFields（分源计数 {coingecko, coinpaprika}，未抓源为 null），total>0 时打 invalid_fields_cleaned 结构化日志。用例：CG 字符串价 → health.invalidFields.coingecko.price=1、coinpaprika=null。

### F8-15 已修 — paprikaGate 未测态可区分
- 消费者盘点：health.paprikaGate 的仓库内读者只有 fetcher 自身与测试（functions/、scripts/ 无读取），故形状可安全扩展（既有字段保留、新增字段向后兼容）。
- 实测完成：{measured:true, reason:null, 四计数, threshold, total, ok, checkedAt}；未执行（mappedBelowGate）：{measured:false, reason:"preflight_skipped_mapped_below_gate", mapped, identityValid:null, activeUsable:null, tickerHit:null, ok:false}；抛错：reason:"preflight_failed"，余同。不再零填充。非候选 run 维持 paprikaGate=null（不适用，与「未测」区分）。三态用例齐备（正常/未执行/失败）。

### F8-17 已修 — preflight 失败记账
- fetchGateStats 新增 onAttempt 回调，每次 Paprika 调用**发出时**回调；index.js 在 finally 中按实际发生次数 ledgerCall(false, n)。用例：tickers 返 500 → 目录+tickers 2 次调用均已发生，health.quota.attemptsTotal=4（Paprika 2 + CG markets 1 + CG global 1），与 mock 计数一致。

### F8-29（本路部分）已修 — verify 两脚本离线套件
- 两脚本重构为纯函数导出 + main 守卫（import 不触发网络）：identity 侧 buildRegistryEntries/checkRegistryConsistency/summarizeGate/renderRegistryModule；coverage 侧 computeCoverage/coverageVerdict/resolveDay。
- 新套件 tests/paprika-verify-scripts.test.mjs（6 例全离线，fixture 注入、无真实 API），已追加登记 tests/suites-manifest.json（仅追加一条）。
- tests/paprika-gate.test.mjs:5 过期头注释（「待协调人登记进 run-tests.sh」）已修正为已登记现状。

## 关键设计决策

1. 登记册放 workers/fetcher/src/paprika-registry.js（.js 而非 .json）：Workers 与 Node 测试均可直接 import，无 JSON import assertion 兼容问题；生成器在 verify-identity 脚本内（renderRegistryModule），手改禁止已在文件头标注。
2. plausibility 参考市值用登记册内的 CG 快照市值（2026-11-08/10 快照）：比值阈值 5% 对价格漂移有约一个数量级余量；快照更新（重跑 build）时须同步重生成登记册，新鲜度用例会因 cgSnapshotMcapUsd 不一致而红，属预期强制。
3. evaluatePaprikaGate 实现迁入 shared 后 source-state 仅转出：避免改动 index.js 与既有测试的 import 路径，同时达成单一事实源。
4. F8-15 形状选择：保留 null 表示「非候选/不适用」（既有测试与监控口径），未测态用对象 + measured:false 表达，与实测 0 严格区分。

## 提交清单（分支 p8-paprika）

- 8dc890f F8-02 映射改指 + 三份 coins.json 同步
- 64ba595 F8-01/F8-02/F8-16/F8-18/F8-21 登记册与门禁重构
- 5d63068 F8-21/F8-20 coverage 脚本同源 + runbook
- f165ebb F8-14/F8-15/F8-16/F8-17 fetcher 记账与可观测
- 274ae74 F8-29 离线套件 + manifest 登记
- （本文件提交）

## 验证

- ./scripts/run-tests.sh 全量：**23/23 套件通过**（基线 22 + 新增 paprika-verify-scripts）。
- 当日实跑：verify-paprika-identity（含登记册一致性 OK、四计数如上表）；verify-paprika-coverage 实跑输出新格式结论（COVERAGE_BELOW_THRESHOLD、validQuoteHit=179、gateThreshold=188）。
