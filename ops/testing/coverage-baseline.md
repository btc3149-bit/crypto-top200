# 测试覆盖率基线（W4-27 / F4-43 首份）

- 日期：2026-11-13（基线分支 b552973 + 本包新增测试）
- 工具：`scripts/coverage-report.mjs`（本包新增，常驻）
- 方法：**NODE_V8_COVERAGE**（Node 内置 V8 精确覆盖，零依赖、0 元）。逐个子进程
  跑全部 Node 套件并收集 V8 覆盖条目，按源文件 pathname 归并、多套件取并集
  （任一套件跑到即算覆盖；字符级 count 取最小包含范围内的最大值）。
  未走回退路线（NODE_V8_COVERAGE 产出正常）。
- 套件范围：tests/ 下 7 个 Node 套件（board、board-v2、board-fetcher、
  fetcher-branches、snapshot-verify、本包新增 contract-real-data 与
  frontend-dom）；tests/test_render_snapshot.py 为 Python 套件，不在 V8
  口径内。public/index.html 内联脚本不在三处源文件口径内，不计入本表。
- 口径近似（与 c8 的差异）：行分母 = 被任一 V8 范围触及的非空行（含注释行，
  若落在函数范围内）；函数分母 = V8 functions 条目按（函数名+起始偏移）
  去重、排除整文件根条目。从未被套件加载的文件行分母以其全部非空行计。
- 已知注意：board 系列测试以 query 参数破缓存多次导入 board.js，原生
  `node --test --experimental-test-coverage` 只归因单个实例、数字严重偏低
  （单跑 board.test 时其报告 board.js 仅 15.34% 且把实际执行过的 getIds/
  fetchUpstream 列为未覆盖，与断言通过矛盾），故本基线不采用该口径；
  本工具按 pathname 归并全部实例条目取并集，为套件级真实覆盖。

## 基线数字

| 文件 | 行覆盖 | 函数覆盖 | 备注 |
|---|---|---|---|
| functions/api/board.js | 513/721（71.2%） | 27/27（100.0%） | |
| functions/api/health.js | 0/128（0.0%） | — | 未被任何套件加载（即 F4-06 的零测试现状） |
| shared/board-schema.js | 242/254（95.3%） | 13/13（100.0%） | |
| workers/fetcher/src/coins-list.js | 5/5（100.0%） | 0/0（—） | 数据模块，无函数 |
| workers/fetcher/src/index.js | 315/351（89.7%） | 13/13（100.0%） | |
| workers/fetcher/src/providers/coingecko.js | 102/136（75.0%） | 6/6（100.0%） | |
| workers/fetcher/src/providers/coinpaprika.js | 40/63（63.5%） | 3/3（100.0%） | |
| workers/fetcher/src/source-state.js | 96/121（79.3%） | 6/6（100.0%） | |

分组小计：functions/ 行 60.4%（513/849，含 health.js 全量分母）；workers/fetcher/src/ 行 82.5%（558/676）；shared/ 行 95.3%（242/254）。
**合计：行 1313/1779（73.8%），函数 68/68（100.0%）。**

## 读数说明

- 函数覆盖 100% 仅表示每个函数至少被进入过一次；行/分支盲区看行覆盖列，
  最低为 coinpaprika.js 63.5%、board.js 71.2%、coingecko.js 75.0%。
- health.js 0% 是预期内的已知缺口（F4-06，归 W4-06 处理），本基线如实留痕。
- 本次采集时套件退出码：frontend-dom 为 1（仅 F4-07 详情市值预期红，其余
  5/6 绿）；contract-real-data 默认模式为 0（rows 段 PENDING-W322 跳过）；
  其余 Node 套件均为 0。覆盖并集不因个别套件预期红而失真（红套件在失败
  断言前的执行路径同样计入）。

## 复跑

```bash
node scripts/coverage-report.mjs            # 打印报告（默认不拦截套件红）
node scripts/coverage-report.mjs --strict   # 套件非零退出时本脚本亦非零
```
