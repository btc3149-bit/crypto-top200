# W4-04 部署门禁接测试（准备版）验证证据

- 分支：`prep/w404-w407`（基线 `b552973`），本分支**只备不部署**：未运行 `scripts/deploy.sh`、未执行任何 wrangler deploy、未触碰生产。
- 日期：2026-11-13（本地验证，Asia/Shanghai）。
- 交付物：
  - `scripts/run-tests.sh`（新）：一条命令串跑全部 6 套测试（node 与 python 混合），任一失败即非零退出并在汇总中点名失败套件；全绿时输出用例总数。
  - `package.json`：`scripts` 新增 `"test": "bash scripts/run-tests.sh"`（仅此一处改动）。
  - `scripts/deploy.sh`：在数据门禁（b）之前插入 W4-04 测试门禁段，以 `# >>> W4-04 测试门禁（开始）` / `# <<< W4-04 测试门禁（结束）>>>` 标记自成一段，激活 rebase 到新版 deploy.sh 时整段搬移即可；fail-closed（测试失败即 `exit 1`，不产生部署）；留痕绕过 `DEPLOY_SKIP_TESTS=1` 仿 `DEPLOY_SKIP_META_CHECK` 写法（打印警告并要求在 CHANGELOG 注明原因）；通过时打印门禁耗时。

## 套件清单（6 套，与任务口径一致）

| 套件名（run-tests.sh） | 命令 | 本轮自报用例数 |
|---|---|---|
| board | `node tests/board.test.mjs` | 7 |
| board-v2 | `node tests/board-v2.test.mjs` | 12 |
| board-fetcher | `node tests/board-fetcher.test.mjs` | 8 |
| fetcher-branches | `node tests/fetcher-branches.test.mjs` | 21 |
| snapshot-verify | `node tests/snapshot-verify.mjs` | 5 |
| render-snapshot | `python3 tests/test_render_snapshot.py` | 8 |
| **合计** | | **61** |

run-tests.sh 对每套捕获退出码并解析其自报「X/Y」计数汇总；6 套全执行（不因先失败跳过后续），末尾统一裁决。

## 验证 1：全绿 + 稳定性连跑 3 次（flaky 检查）

在 worktree 内连续执行 3 次 `bash scripts/run-tests.sh`：

| 轮次 | 退出码 | 用例总数 | 总耗时 | 结论 |
|---|---|---|---|---|
| 1 | 0 | 61/61 通过（6 套） | 2s | PASS |
| 2 | 0 | 61/61 通过（6 套） | 1s | PASS |
| 3 | 0 | 61/61 通过（6 套） | 2s | PASS |

3 次全绿、无 flaky。另 `npm test` 实测退出 0、同样 61/61（package.json 的 test script 接线有效）。

## 验证 2：人为改坏一条测试 → run-tests.sh 非零退出并点名套件

方法：把 worktree 复制到临时目录 `/tmp/broken-copy`（不动 worktree 本身），在副本中把 `tests/board.test.mjs` 一处断言期望值改坏（`body.source` 期望由 `coingecko` 改为 `broken-deliberate`），运行副本的 `scripts/run-tests.sh`。

结果：

- 退出码 **1**；
- 汇总输出：`用例总数：60/61 通过（6 套）`、`失败套件：board`、`结论：FAIL（fail-closed）`；
- 其余 5 套仍全部执行并通过——失败定位明确且不掩盖其他套件状态。

## 验证 3：deploy.sh 语法 + 门禁段 fail-closed 逻辑（抽出单测，未真部署）

- `bash -n scripts/deploy.sh` 通过；`bash -n scripts/run-tests.sh` 通过；`node --check scripts/compare-shadow-v2.mjs` 通过。
- 用 `sed` 按 W4-04 起止标记把门禁段从 deploy.sh 中单独抽出到临时目录，以桩 `scripts/run-tests.sh` 驱动三用例：

| 用例 | 条件 | 结果 | 期望 |
|---|---|---|---|
| A | 桩测试失败（exit 1） | 门禁段退出 **1**，stderr 打印「W4-04 测试门禁未通过，部署中止，未产生任何部署」 | fail-closed ✔ |
| B | 桩测试全过（exit 0） | 门禁段退出 **0**，打印「W4-04 测试门禁通过（耗时 0s）」 | 放行 ✔ |
| C | `DEPLOY_SKIP_TESTS=1` + 失败桩 | 门禁段退出 **0**，打印留痕警告（要求在 CHANGELOG 注明绕过原因） | 绕过通道 ✔ |

说明：deploy.sh 在 `set -euo pipefail` 下运行，门禁段用 `if ! bash scripts/run-tests.sh` 承接失败、不会被 `set -e` 提前截断，失败路径的非零退出由段内 `exit 1` 保证（用例 A 已实证）。

## 验收对照（W4-04 方案验收标准）

- 「人为制造一处测试失败时 deploy.sh 退出非零且不产生部署」：以验证 2 + 验证 3 用例 A 组合证明（runner 层与门禁段层分别实证；本准备分支按纪律未真跑 deploy.sh 全流程，激活时在 preview 演练一次即为全流程证明）。
- 「测试全过时部署流程与现有一致」：门禁段只在最前面新增一段，后续数据/安全头/fetcher 三道既有门禁与部署/冒烟段落零改动（见 git diff，deploy.sh 仅新增该段）。
- 「门禁耗时计入部署时长」：门禁通过时打印耗时；run-tests.sh 自身打印总耗时（本轮约 1–2s）。
- 「flaky 须先跑 3 次全绿再接入」：验证 1 已满足（3/3 全绿后才落此证据）。

## 未决/注意

- 本分支基线 deploy.sh 为旧版；激活时需把 W4-04 标记段整段 rebase 到含其他门禁改动的新版 deploy.sh 的数据门禁之前，并按方案要求先做一次 preview 部署演练再接生产。
- `DEPLOY_SKIP_TESTS=1` 为留痕绕过通道，使用时必须在 CHANGELOG 注明原因（本准备分支按纪律未改 CHANGELOG）。
