# 回滚演练记录（W4-12）— 2026-11-13

- 执行者：W4-12 工作包（分支 `wt/w412`，基线 commit `b552973`）
- 产物：`scripts/rollback.sh`（deployment / mode 两条路径）+ 本记录
- 纪律：全程只动 **preview**（部署、配置）；对 production 零写操作（证据见 §6）。全程 0 元。
- 通道：所有 API 调用经 `custom.cloudflare` 连接的 `cf_api.py`（运行时注入代用凭证，令牌值未打印、未落盘）；部署经 `scripts/deploy.sh preview`，其 `CLOUDFLARE_API_TOKEN` 由同一连接的代用值在子进程环境内注入（不打印、不落盘）。
- 时间口径：下表均为 UTC（2026-11-13），耗时为实测墙钟。

## 1. 演练步骤与计时

| # | 步骤 | 起止 / 耗时 | 结果 |
|---|------|-----------|------|
| 0 | 演练开始 | 02:51:17Z | — |
| 1 | 部署 #1 首次尝试 | 17.9s | 失败：本 shell 环境无 `CLOUDFLARE_API_TOKEN`，wrangler 拒绝执行（部署未发生）。改用代用值子进程注入后解决 |
| 2 | 部署 #1（内容 A＝仓库原样） | 12.9s，rc=0 | 成功，部署 `796b31c5`（02:52:04Z）；冒烟全 PASS（含 /api/board 200/200）；别名首页 sha256 = `4e33685e…`（记为 A 指纹） |
| 3 | 部署 #2 首次尝试（标记加在 index.html） | 0.2s | 被 W2-18 门禁中止：改 index.html 使 `_headers` 哈希对账失败。临时改动已还原，改用独立标记文件 |
| 4 | 部署 #2（内容 B＝A + `public/w412-drill-marker.txt`） | 11.4s，rc=0 | 成功，部署 `37ec5b74`（02:52:33Z）；别名实时抓取标记文件返回 200 且响应体与标记内容逐字一致（B 在线证据）。标记文件本地随即删除 |
| 5 | **部署回滚**：`ROLLBACK_CONFIRM=1 rollback.sh deployment --env preview` | **1.4s** | 脚本正确选出目标＝上一个部署 `796b31c5` 并发出 POST；**API 拒绝**（见 §2），preview 未发生任何变更 |
| 6 | 回滚后轮询验证 | 137.7s（40 次轮询） | 标记始终 200——与 API 拒绝一致（预期内，非回滚生效） |
| 7 | **等效恢复**：重部署内容 A | 15.9s，rc=0 | 部署 `cb1ff624`（02:55:48Z）；别名首页 sha256 立即回到 A 指纹；标记文件在别名仍 200（边缘缓存，见 §4） |
| 8 | mode 首跑（修复前脚本） | 2.6s，rc=1 | PATCH 成功但紧接着的 GET 读到旧值，脚本误判失败——实测存在读后写传播延迟；据此给脚本回读加了 6 次重试 |
| 9 | **mode 正式跑**：`rollback.sh mode legacy --env preview` | **2.8s，rc=0** | PATCH + 回读一致；原值＝未设置（缺省 legacy），演练后已恢复未设置（见 §5） |
| 10 | 部署 #4（mode=legacy 配置后的首个新部署） | 14.8s，rc=0 | 部署 `e13b5c33`（02:58:01Z）；其 API 快照 `env_vars` 仍为 `{}`——首个异常信号 |
| 11 | **kv 功能探针**：`mode kv` → 部署 #5 → 抓 /api/board；再 `mode legacy` → 部署 #6 → 抓 /api/board | 探针全程约 54s（部署 13.8s + 14.0s，含两次带重试的 mode 设置） | kv 配置下新部署的 /api/board 仍为 legacy 应答形态（`source=coingecko`、无 `contractVersion/freshness/fetch`）；恢复 legacy 后形态不变（`mode=live`）。结论见 §3 |
| 12 | 收尾恢复与复核 | 演练主体结束 02:58:09Z；最终复核 02:59:58Z | preview `BOARD_READ_MODE` 已删回未设置并多读一致；production 复核无变化（§6） |

**总耗时**：演练全程 02:51:17Z → 02:59:58Z ≈ **8.7 分钟**（含两次失败尝试与全部探针），在 ≤15 分钟目标内。但按路径拆开的达标结论不同，见 §2/§3——不能只看总时长报达标。

## 2. 路径一：deployment 部署回滚 —— preview 被平台拒绝（未达项，平台限制）

- 脚本侧全部环节实测正确：列表查询（`env=preview&per_page=25`）、当前/上一个选择、目标 id 与创建时间打印、`ROLLBACK_CONFIRM=1` 确认门（未带时退出码 3 且不执行）、POST 发出、错误原文透传。
- Cloudflare API 对 preview 部署的 rollback 返回：
  `{"code": 8000040, "message": "You cannot rollback to a preview deployment. You can only rollback to past production deployments."}`
- 结论：**rollback API 是 production 专用**，preview 无法用它回滚，与脚本实现无关。脚本已针对 8000040 输出明确提示与等效恢复指引。
- preview 的等效恢复（本演练实测）：把上一版内容重新部署一遍，15.9s 后别名首页恢复 A 指纹。
- production 侧的同 API 回滚能力有既往实证（非本演练结果）：2026-11-10 `CONSTRUCTION_P0.md` 第 5 项——API rollback 到 `70a735d5` 复现故障态、再 rollback 回 `d43eb23f` 恢复，两次均 success 且列表核对一致。本次脚本从发出请求到收到 API 响应为 1.4s，脚本侧开销可忽略；production 回滚总时长预计仍为秒级，≤15 分钟目标对该路径成立，但**有待 G3 前在 production 低峰期再做一次带计时的正式演练确认**（本包纪律禁止动 production，未做）。
- 附带实测的 API 怪癖：deployments 列表 `per_page` 上限 25，超过返回 8000024（脚本已按 25 + `env=` 服务端过滤实现，客户端再过滤一层）。

## 3. 路径二：mode 模式回滚 —— API 层通、端到端不生效（未达项，管线口径）

先行的语义探针（preview，演练正式步骤之前）：

- PATCH `deployment_configs` 的 `env_vars` 是**按 key 合并**语义：只带 `BOARD_READ_MODE` 一个 key 不会动其它变量；给 key 传 `null` 可删除该 key。脚本据此只 PATCH 单 key、绝不回传 secret 值，并在 PATCH 后回读逐项核对原有 key 名。
- 项目配置存在**读后写传播延迟**：PATCH 成功后立即 GET 可能读到旧值（实测最多第 3 次重试才一致，约 10 秒量级）；脚本回读已带 6 次重试并在本演练中实测生效。

正式结论（功能探针 #11 的硬证据）：

- API 层：`rollback.sh mode` 可把 preview 的 `BOARD_READ_MODE` 设为任意目标值并回读一致，耗时 2.8s。**这一层是通的。**
- 端到端：**不生效**。把配置改成 `kv` 后新建的部署，其 `env_vars` 快照仍为 `{}`，且 `/api/board` 仍按缺省 legacy 应答（形态与 legacy 对照组无差异）。即本项目 **Wrangler 直推管线下，API 改的项目级 env 不会被新部署携带到 Function 运行时**；当前在线部署不热切换更无从谈起。
- 因此：G3 的模式回滚**不能**只靠本脚本完成，必须在部署时注入变量（例如 `wrangler.toml` 的 `[vars]` 写入 `BOARD_READ_MODE` 后跑 `deploy.sh`，或等效的部署期注入）。本包改动范围不含 wrangler.toml/deploy.sh，此结论作为未达项上报协调者裁决；`rollback.sh` 的 mode 子命令保留为配置层工具，脚本内已加醒目警告，不得单独作为模式切换完成依据。
- 演练后 preview 配置已恢复原状：`BOARD_READ_MODE` 删除为未设置（与演练前一致），多次回读均为 `{}`。

## 4. 验证方法学的两个坑（后续演练/验收注意）

1. **逐部署 URL 不可作内容证据**：本项目 preview 的 `<deployment_id>.crypto-top200.pages.dev` 实测对所有路径（含首页、/data/coins.json）都返回 404，不论该部署是否为最新。内容证据只能取别名实时响应体/哈希与 API 部署对象。本演练早期曾把「D1 逐部署 URL 标记 404」误记为内容证据，已作废，B 在线证据以别名实时响应体逐字比对为准。
2. **别名静态资源有边缘缓存滞后**：内容 A 重部署后，标记 `.txt` 在别名仍被 `CF-Cache-Status: HIT` 以 200 返回，响应头 `Cache-Control: public, s-maxage=604800`（7 天）。回滚验收应查首页/API 这类短缓存路径（首页 `s-maxage=60`，本演练中即时翻转）或带版本路径，不要用静态资源存在性判断回滚是否生效。

## 5. preview 配置变更台账（本演练全部 preview 写操作）

- 部署（均经 `deploy.sh preview`）：`796b31c5`、`37ec5b74`、`cb1ff624`、`e13b5c33`，及 kv 探针的两次部署（共 6 次），冒烟均 PASS。
- 配置 PATCH（均只针对 preview 的 `BOARD_READ_MODE`，外加语义探针的一次性 `W412_PROBE` 键，探针后即删除）：最终状态＝未设置，与演练前一致。

## 6. production 未动证据

- 本包对 production 的写操作：**零**。所有 deploy 均带 preview 参数（wrangler 日志逐条为 branch=preview + 别名 preview.crypto-top200.pages.dev）；所有 PATCH 均只写 `deployment_configs.preview`；唯一的 rollback POST 目标是 preview 部署且被平台拒绝。
- 复核：演练前 production 最新部署 `869d5437`（2026-11-12T12:15:32Z），env key 仅 `COINGECKO_API_KEY`；最终复核时 production env key 仍仅此一把。
- 说明：最终复核时 production 出现一条新部署 `75a71b9a`（2026-11-13T02:57:38Z）——经查其触发元数据为 branch=main、commit `d9b91c4e`「集成修正（W4-13）…」，是并行 W4-13 工作包的部署，**不是本包所为**，在此留痕以免误读。

## 7. 未达项汇总

| 项 | 状态 | 原因 |
|----|------|------|
| preview 部署回滚端到端翻转 | 未达 | 平台限制 8000040：rollback API 仅 production 可用；preview 等效恢复＝重部署上一版内容（实测 15.9s） |
| production 部署回滚计时演练 | 未做 | 本包纪律禁动 production；仅有 2026-11-10 既往实证 + 本次脚本侧 1.4s 开销，建议 G3 前补一次正式计时演练 |
| mode 切换端到端生效 | 未达 | Wrangler 直推管线不携带 API 设置的项目级 env（快照与功能探针双证据）；须改部署期注入，待协调者裁决 |
| mode API 层设置 + 回读（含传播延迟重试） | 达标 | 2.8s，rc=0 |
| 防误触（ROLLBACK_CONFIRM / ALLOW_PROD_MODE_ROLLBACK / 取值校验） | 达标 | 退出码 3/1 行为实测，production mode 无放行变量时在任何写操作前拒绝 |

## 8. 与方案（W4-12）的偏差

- 方案验收要求「演练覆盖 kv→legacy 与部署回滚两条路径」：kv→legacy 的**配置层**动作已完整演练（kv 设置、探针、legacy 恢复、删回未设置），但端到端生效被管线口径否证（§3）；部署回滚在 preview 被平台否证（§2）。两处均如实记为未达，未用等效证据冒充达标；等效路径（重部署恢复）另行计时留证。
- 演练记录按任务要求写本文件，未写入 `ops/signoffs.md`（任务纪律）。
