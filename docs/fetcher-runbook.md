# fetcher 运维要点（W2-01/W2-02 摘要）
- 数据流：Cron fetcher（唯一抓取）→ KV BOARD_KV `v1:board:current` → Pages Function 只读组装契约 v2。
- 手动补抓：POST /run + x-manual-token（见 workers/fetcher/README.md）。
- 额度：定版节奏月耗约 5,760 credits；health.quota.quotaMode 自动降频 normal→saving(>8500 预估)→critical(>9500)。
- 429：按 Retry-After 跳过 K 个 run（health.skipRunsRemaining），跳过不计连续失败。
- 故障判读：scripts/probe.mjs（consecutiveFailures≥3 / staleAgeSec>1800 / 组合规则）。
- 回滚：Pages 侧置 BOARD_READ_MODE=legacy 即回旧路径（应急 ≤24h）；fetcher 侧关 Cron 即停抓。

## 故障处置（W4-26 补齐，2026-11-13）

> 通用约定：每类故障处置后均须留痕——在 `ops/incidents/` 建事件页（起止时间、主告警 ID、根因、处置），并只向站长转达一条汇总（故障性质＋影响＋是否已恢复），口径见 `ops/checklists.md` 的「③ 告警转达」。下文三节统一按「现象与识别信号 / 处置步骤 / 责任人 / 恢复目标 / 关联发现编号」书写。

### CoinGecko 额度击穿

**现象与识别信号**

- `/api/board` 转入 stale：`mode` 长时间非 `live`、数据年龄持续变大，最终可达 stale 6 小时硬上限后回退静态快照。
- 健康口径显示额度临界：fetcher health 的 `quotaMode=critical`（预估月耗 >9500 时自动降频，抓取间隔升至 1,800 秒）；`/api/health` 因新鲜度超阈值（age >900 秒）返回 503、UptimeRobot M4 告警。
- 上游直接报错：CoinGecko 返回 HTTP 429 或额度类错误（fetcher 日志 / health 中可见 429 与 `skipRunsRemaining` 跳过计数；偶发 429 先按上文「429」一行处理，本节指月度额度击穿、非单次限流）。

**处置步骤**

1. 确认总账水位：先核对两路合计再下结论——fetcher 侧查 health 的 `quota.creditsUsedEst` 与投影值（该数只算 fetcher 自己），legacy 侧按回源次数估算其消耗（legacy 路径当前无自动记账，估算口径与缺口见 F4-02）；两路合计对照 Demo 档月上限 10,000 credits，确认是真击穿还是单路误判。
2. 接受新鲜度降级：确认击穿后不做无效重试、不提频、不靠手动补抓硬顶（补抓同样烧同一把 key 的额度）；让自动降频与 stale / 快照兜底按既定逻辑运行，站点以降级新鲜度继续服务，等月度额度重置。
3. 付费档只谈不买：默认不购买任何付费档；只有站长明确批准后才可谈 CoinGecko 付费档（Analyst 档约 $103.2/月，未经批准不得采用，见 PHASE4_REVIEW.md 第四节不做清单第 5 条）。助手只提供总账数字与降级影响供决策，不自行升档。
4. 记录事件：在 `ops/incidents/` 建事件页，记击穿确认时间、两路水位估算、降级起止与站长决策（降级等重置 / 批准付费档 / 其他）。

**责任人**

- 助手：核查总账水位、确认击穿、维护降级状态、记录事件、向站长汇总。
- 站长：是否购买付费档的唯一决策人；其余处置不需要站长逐项批准。

**恢复目标**

- 下月额度重置后自动恢复定版抓取节奏（markets 10 分钟 + global 30 分钟），无需人工切换；恢复后复跑探针确认 `/api/board` 回 `mode=live`、`/api/health` 回 200，并关闭事件页。
- 关联发现编号：F4-41（本节主对应）、F4-02、F4-16。

### KV 坏数据

**现象与识别信号**

- 覆盖或字段异常：`/api/board` 的 `coverage` 不满（returned < expected）或关键字段异常（如价格 / 市值 / rank 大面积为 null——注意现行覆盖率只数 id、不验字段，字段级退化可能在 coverage 200/200 时已发生，判读须抽查字段，见 F4-08）。
- 影子比对失败：`scripts/compare-shadow.mjs` 比对不通过（覆盖率、价差中位数 / P95、missingIds 任一超阈值），或 fetcher health 的 `consecutiveFailures` 异常升高。

**处置步骤**

1. 先分清形态再动手（两种形态处置完全不同，不要混用）：
   - 当前影子形态（G1，`BOARD_TARGET_KEY=shadow`）：坏数据只写在 shadow 键（`v1:board:shadow`），线上用户读的是 legacy 路径，无用户影响——不要为影子坏数据动生产。定位是哪一轮 run、哪些字段坏（查 fetcher health 与该轮日志），然后等下一轮成功抓取自然覆盖 shadow 键；下一轮仍坏则暂停以该影子数据作 G2 决策依据，人工核查数据源与抓取逻辑后再恢复观察。
   - G3 后形态（KV 只读已上线、`BOARD_READ_MODE=kv`）：坏数据即生产数据事故，按下条模式回滚处置。
2. （仅 G3 后形态）模式回滚：把 `BOARD_READ_MODE` 改回 `legacy`。注意这是一次部署操作、不是开关切换——该变量只写在 `wrangler.toml` 注释 / Pages 环境配置侧，改值须重新部署才生效（见 F4-13），按 `scripts/deploy.sh production` 部署并跑冒烟确认已回 legacy 口径。**2026-11-13 W4-12 演练实测修正**：经 API 改 Pages 项目级 env（deployment_configs）**不会**被 Wrangler 直推的新部署携带（实测部署快照 env 为空、改 kv 后新部署仍按 legacy 应答）——真正的模式切换必须在部署时注入：在 `wrangler.toml` 的 `[vars]` 写明 `BOARD_READ_MODE` 后跑 deploy.sh；`scripts/rollback.sh` 的 mode 子命令只改 API 配置层，**不得单独作为切换/回滚的完成依据**（证据见 `ops/disaster-recovery/rollback-drill-2026-11-13.md`）。
3. 关于「回滚到上一版数据」：该能力依赖 W4-10 的 KV prev 键（写入前把现键复制为上一版）——**该能力尚未上线、属待建**，当前 KV 只有 current / shadow / health / sourceState 四键，坏数据覆盖后没有上一版可回退，不得按「可一键回滚上一版」处置或对外如此表述。W4-10 上线后本节须同步改写。
4. 回滚或覆盖恢复后复核：`/api/board` 条数与字段抽查正常、`/api/health` 回 200，再在事件页记录坏数据轮次与影响窗。

**责任人**

- 助手：识别与定位坏数据、执行模式回滚部署（G3 后形态）、复核恢复、记录事件。
- 站长：影子形态下是否暂停 / 重置 G1 证据累计、G3 后是否保持 legacy 观察，由站长拍板（属 G1→G2→G3 门禁决策，助手不自行切换）。

**恢复目标**

- G3 后形态：≤15 分钟切回 legacy 口径（与 F4-13 的回滚目标对齐；该目标为定版目标，回滚演练计时由 W4-12 证明，未演练前按目标执行、不当作已验证时长表述）。
- 影子形态：无用户影响，无恢复时限压力；以「下一轮成功抓取覆盖坏数据」为恢复点。
- 关联发现编号：F4-41（本节主对应）、F4-27、F4-13、F4-08。

### Cloudflare 账号不可用

**现象与识别信号**

- Cloudflare 控制台与 API 全面失败：控制台无法登录或操作、Wrangler / API Token 调用全面报错、部署与 Secret / 配置变更全部不可用；同时区分「账号不可用」与「单点故障」——若站点本身仍可访问、仅管理面失效，按本节处置；若仅某一监控或单一 API 报错，先按对应单点故障排查，不要直接升级为账号事故。

**处置步骤**

1. 先确认站点存量服务状态：已部署产物仍在 Cloudflare 边缘运行——Pages 静态页与已注入的榜单快照继续可访问，`/api/board` 在其缓存 / stale / 快照兜底范围内继续服务。先用 `/api/health` 与首页实测确认「管理面挂了、服务面还在」，并把这一结论先汇总给站长，避免误判为全站宕机。
2. 冻结变更：账号不可用期间不尝试部署、回滚或改配置（也无从执行）；不新建替代账号、不把站点临时迁往其他平台，等账号侧恢复或站长另行决策。
3. 如需重建，按灾备路径走：从 git 仓库与 `ops/` 下的额度 / 配置记录重建站点与配置——**该重建路径依赖 W4-11 灾备三件套（git 远端 + Cloudflare 侧配置导出 + 恢复演练），目前尚未完成、RTO 未演练**：截至本节落盘时 git 无远端、Cloudflare 侧配置（DNS、自定义域、Pages / Worker Secret 清单、监控配置）无完整导出件，不得把「可按记录重建」表述为已具备的能力。现阶段能做的只是清点本机仓库与 `ops/` 现有记录、列出缺失项清单，交站长决策。
4. 账号恢复后收尾：逐项复核 Pages 项目、fetcher Worker、KV、Secret 在位情况与监控（M1–M4 / HC1–HC3）状态，跑一次全量探针，并在事件页记录账号不可用时段与复核结果。

**责任人**

- 站长：账号持有人——账号恢复、身份验证、与 Cloudflare 支持的沟通只能由站长本人进行；是否启动重建、何时启动，由站长决策。
- 助手：确认服务面存量状态、清点可重建材料与缺失项、账号恢复后逐项复核与记录。

**恢复目标**

- 以 W4-11 灾备演练的实测值为准；在 W4-11 完成并演练之前，现估 2–4 小时为未验证估计（源自 F4-12），不得当作已承诺的 RTO 对外或对站长表述；若账号本身持续不可用，RTO 无上限，以站长与 Cloudflare 侧的恢复进度为准。
- 关联发现编号：F4-41（本节主对应）、F4-12。
