# 值班手册（单一值班入口，W4-26）

> **出事了先看这一页。** 本页只做索引与速览：先在本页定位「现在是什么坏了、该看哪个健康入口、处置正文在哪份文件」，再跳到对应文档执行。本页不复制各文档正文；正文口径以被指向的文件为准，两处不一致时以被指向文件为准并回头修订本页。
> 适用站点：https://top200.oppcal.com（Cloudflare Pages 项目 `crypto-top200`）。适用人：值班助手与站长。落盘：2026-11-13（W4-26，覆盖 F4-42）。

## 1. 站点结构速览（一句话）

访客打开 Pages 上的静态站（`public/index.html`，200 行榜单静态注入），页面经 Pages Function `functions/api/board.js` 取行情：现行 legacy 形态下 Function 直连 CoinGecko 并缓存 120 秒，新抓取链形态下由独立的 fetcher Worker（`workers/fetcher/`，Cron 每 10 分钟）抓 CoinGecko 写入 KV `BOARD_KV`、Function 只读 KV 组装——两种形态共用同一把 CoinGecko Demo key 与同一份名单数据（源 `data/coins.json`）。

补充定位（细节见 `README.md` 的「包里有什么」与 `docs/fetcher-runbook.md` 开头）：

| 部件 | 是什么 | 权威文件 |
|---|---|---|
| Pages + 静态站 | 项目 `crypto-top200`，部署目录 `public/` | `wrangler.toml`、`README.md` |
| Pages Functions | `/api/board`（行情组装）、`/api/health`（健康判定） | `functions/api/board.js`、`functions/api/health.js` |
| fetcher Worker | 项目 `crypto-top200-fetcher`，唯一抓取方（G1 影子期写 shadow 键） | `workers/fetcher/README.md`、`docs/fetcher-runbook.md` |
| KV | 命名空间 `BOARD_KV`，键：current / shadow / health / sourceState | `shared/board-schema.js`（`KV_KEYS`） |
| CoinGecko | 唯一行情源，Demo 档 10,000 credits/月，全账号 1 把 key | `ops/security/key-ledger.md` |

## 2. 健康入口清单（先看哪个、看什么）

| 入口 | 看什么 | 正常判据 | 配置 / 判读正文 |
|---|---|---|---|
| `GET https://top200.oppcal.com/api/health` | 全站健康总判：数据新鲜度 + 完整度，状态码即结论 | 200 = age ≤900 秒且 coverage returned == expected == 200；503 = 任一不满足；HEAD 与 GET 同状态（无 body） | `functions/api/health.js`；口径对照见 `ops/probe-config.md` 的「UptimeRobot 监控」M4 行 |
| `GET https://top200.oppcal.com/api/board` | 行情本体：`mode`（live / stale / snapshot）、`coverage`、`updatedAt` | `mode=live` 且 coverage 满额；stale / snapshot 即降级，先分清是上游、额度还是抓取链问题 | `scripts/probe.sh` 断言组；降级处置见 `docs/fetcher-runbook.md` |
| UptimeRobot M1（首页存活） | 首页 `GET /` 是否 200 | UP = 站点 / 部署整体可达 | `ops/probe-config.md` 的「UptimeRobot 监控（M1–M4）」表 |
| UptimeRobot M2（接口正向断言） | `/api/board` 响应含 `"mode":"live"` | UP = 接口活着且处于 live 形态（查不了 coverage 数值，数值由 HC1 兜底） | 同上（含 keyword 定版说明） |
| UptimeRobot M3（接口负向断言） | `/api/board` 响应是否出现 `<!DOCTYPE` | UP = 未回吐 HTML 错误页（状态码可能仍是 200，只有此断言能抓住） | 同上 |
| UptimeRobot M4（新鲜度） | `/api/health` 是否 200（间隔 300 秒探测） | UP = 新鲜度与完整度同时达标（判定在 health.js 内） | 同上（含「落地状态」与 M4 的 HEAD 坑记录） |
| healthchecks HC1（定时全量探针） | 每小时跑 `scripts/probe.sh` 全量断言（含新鲜度时间差）是否报到且成功 | period 1h / grace 15 分钟内有 success ping；缺席 = 调度挂了，`/fail` ping = 断言真失败 | `ops/probe-config.md` 的「healthchecks.io 检查（HC1–HC3）」表与「落地状态」 |
| healthchecks HC2（部署后检查） | 每次部署后冒烟结果是否报到（事件型，不看缺席） | 部署冒烟通过后有 success 记录；冒烟失败对应 fail | 同上；ping 客户端为 `scripts/hc_ping.sh`，接线在 `scripts/deploy.sh` 尾部 |
| healthchecks HC3（2026-11-21 复核守夜） | 一次性复核任务当天是否报到（cron `0 9 21 11 *`、Asia/Shanghai、grace 6 小时） | 2026-11-21 复核完成并留痕后有 success ping；到期未报到即告警 | 同上；复核清单见 `ops/checklists.md` 的「④ 选定复核点」与 `ops/reviews/2026-11-21-review.md` |
| 本地探针（人工） | 与外部探针同组断言 + 结果留痕 | `bash scripts/probe.sh https://top200.oppcal.com` 全量 pass，结果追加 `ops/probe-log.jsonl` | `README.md` 的「冒烟与探针」；`scripts/probe.mjs` 为 fetcher 侧故障判读 |

告警投递口径（只设 1 个邮箱、两家同口径、恢复通知必看）见 `ops/probe-config.md` 的「告警收敛（两家平台同口径）」；收到告警后的动作顺序见 `ops/checklists.md` 的「③ 告警转达」。

## 3. 常见故障 → 处置文档索引（只给路径，不复制正文）

| 故障 | 先看 | 处置正文 |
|---|---|---|
| 首页打不开 / 全站不可达 | M1、`/api/health` | `ops/checklists.md` 的「③ 告警转达」；若管理面同时失效，转「Cloudflare 账号不可用」行 |
| `/api/board` 非 live（stale / snapshot）或 M2/M4 告警 | `/api/board` 的 `mode` 与 `updatedAt`、`/api/health` | `docs/fetcher-runbook.md`（故障判读行与「故障处置」各节，先分上游 / 额度 / 抓取链） |
| CoinGecko 额度击穿（429 / 额度报错、`quotaMode=critical`） | fetcher health 的 `quota` 字段 | `docs/fetcher-runbook.md` 的「CoinGecko 额度击穿」 |
| KV 坏数据（coverage / 字段异常、影子比对失败） | `scripts/compare-shadow.mjs` 输出、fetcher health | `docs/fetcher-runbook.md` 的「KV 坏数据」（先分影子形态 / G3 后形态） |
| Cloudflare 账号不可用（控制台 / API 全面失败） | 首页与 `/api/health` 是否仍可用（分清管理面与服务面） | `docs/fetcher-runbook.md` 的「Cloudflare 账号不可用」（含灾备未完成的如实标注） |
| 部署后冒烟失败 | `scripts/deploy.sh` 输出、`scripts/smoke.sh` 断言项 | `README.md` 的「部署（唯一方法）」与「回滚方法」；部署后清单见 `ops/checklists.md` 的「① 部署后」 |
| 抓取链异常（fetcher 连续失败 / 影子断档） | fetcher health（`consecutiveFailures` / `staleAgeSec`） | `docs/fetcher-runbook.md` 开头故障判读行（`scripts/probe.mjs` 规则）；手动补抓见 `workers/fetcher/README.md` |
| 名单异常（疑似下架、排名漂移、进出候选） | 周检报告 `ops/weekly/<年>-W<周>.md` | `scripts/weekly_check.py`（手动运行，只产报告、不自动跑）；数据更新清单见 `ops/checklists.md` 的「② 数据更新」 |
| 报告回链失效（首页 REPORT_URL 死链） | 周检报告外链检查行（W4-26 起，周检含此一行） | 控制点 `scripts/pipeline_config.py` 的 `REPORT_URL`（全站唯一控制点，只在此一处改） |
| 密钥到期 / 需轮换 / 疑似暴露 | `ops/security/key-ledger.md` 台账状态行 | `ops/security/rotation-playbook.md`（按对应密钥的剧本节执行） |
| 安全头 / CSP 异常（如新页面样式被拦） | `ops/headers/gen-headers.mjs --check` 结果 | 生成器与模板在 `ops/headers/`；部署门禁口径见 `scripts/deploy.sh` 的 W2-18 门禁段 |

每次处置后：在 `ops/incidents/` 建事件页并按 `ops/checklists.md` 的「③ 告警转达」收尾（只向站长转达一条汇总）。

## 4. 部署与回滚入口

- 唯一部署入口：`scripts/deploy.sh`（`bash scripts/deploy.sh preview` 先预览冒烟、`bash scripts/deploy.sh production` 再上生产；含数据一致性、安全头、fetcher 数据三道门禁）。禁止控制台拖放部署，理由与废弃说明见 `README.md` 的「已废弃：控制台拖放部署」。
- 冒烟单独跑：`bash scripts/smoke.sh <基址>`（口径见 `README.md` 的「冒烟与探针」）；部署后必走清单见 `ops/checklists.md` 的「① 部署后」。
- fetcher 单独部署：不与 Pages 连推，命令与同步要求见 `scripts/deploy.sh` 的 W2-01 门禁注释与 `workers/fetcher/README.md`。
- 回滚入口：Pages 侧控制台一键回滚 / 用上一个 tag 产物重推，步骤见 `README.md` 的「回滚方法」；数据链模式回滚（`BOARD_READ_MODE=legacy`）的口径、性质（部署操作而非开关）与时限目标见 `docs/fetcher-runbook.md` 的「KV 坏数据」——回滚怎么做以这两处为准，本页不另定口径。

## 5. 凭据位置索引（只记位置，绝不记值）

> 红线：本表只记「在哪」，任何凭据的值、片段、ping URL 全文一律不入本页、不入仓库任何文件。台账（只记元数据）见 `ops/security/key-ledger.md`，轮换步骤见 `ops/security/rotation-playbook.md`。

| 凭据 | 存放位置（只记位置） | 备注 |
|---|---|---|
| Cloudflare 受限 API Token | 安全保险箱自定义连接 `custom.cloudflare`；部署时以环境变量 `CLOUDFLARE_API_TOKEN` 注入 | 权限仅 Account → Pages → Edit；到期与续期见台账 K1 与轮换剧本 §20.4 |
| CoinGecko Demo key（Pages 侧） | Pages Secret `COINGECKO_API_KEY`（项目 `crypto-top200`，Production） | 与 fetcher 侧是同一把 key 的两个独立注入点；改后须重新部署才生效 |
| CoinGecko Demo key（fetcher 侧） | fetcher Worker Secret `COINGECKO_API_KEY`（项目 `crypto-top200-fetcher`） | 注入方式见 `workers/fetcher/wrangler.toml` 尾部注释 |
| CoinGecko key（构建 / 周检时用） | 运行时环境变量 `COINGECKO_API_KEY`（不落盘） | 使用点：`scripts/build.py`、`scripts/weekly_check.py` |
| fetcher 手动补抓 token | fetcher Worker Secret `MANUAL_RUN_TOKEN` | 调用方式见 `workers/fetcher/README.md`；轮换口径见 PHASE4_REVIEW.md 的 F4-26 |
| UptimeRobot Main API Key | 安全保险箱自定义连接 `custom.uptimerobot` | 监控经 API 维护；监控 ID 清单见 `ops/probe-config.md` |
| healthchecks.io 完整访问 API key | 安全保险箱自定义连接 `custom.healthchecks` | 检查清单见 `ops/probe-config.md` |
| healthchecks ping URL（HC1–HC3） | 不落盘：运行时经 API 现查现用；HC2 的部署环境路径为环境变量 `HEALTHCHECKS_DEPLOY_PING_URL`（见 `scripts/hc_ping.sh`） | 等同密钥：永不写入仓库、日志或聊天；未设置时 HC2 记 `skipped-no-url` 降级运行 |
| 告警邮箱 | 两家平台告警联系人与本地探针环境变量 `PROBE_ALERT_EMAIL`（地址本体不入本页） | 口径见 `ops/probe-config.md` 的「告警收敛」 |

## 6. 升级给站长的条件（出现任一即停手汇总，先报站长再行动）

- 需要花钱：购买 / 升档任何付费项（CoinGecko 付费档、付费监控、Workers Paid 等）——一律先经站长明确批准，默认不买（见 `docs/fetcher-runbook.md` 的「CoinGecko 额度击穿」与 PHASE4_REVIEW.md 第四节）。
- 抓取链门禁决策：G1 结算结论、是否进 G2 金丝雀、是否 G3 切换、影子证据是否作废重累计——均为站长拍板点，助手只交核查材料。
- 账号层事项：Cloudflare / CoinGecko / 监控两家的账号恢复、注册、身份验证，只能由站长本人操作；账号不可用且需启动重建时，是否重建由站长决策（见 `docs/fetcher-runbook.md` 的「Cloudflare 账号不可用」）。
- 凭据层事项：任何密钥的新建、轮换、吊销需要站长在对应控制台配合或确认时；疑似密钥暴露时先按 `ops/security/rotation-playbook.md` 步骤 0 执行并立即报告站长。
- 数据治理决策：名单进出（移入 / 移出候选的最终处置）、预估口径与快照基准变更——周检与助手只给候选与证据，不自行改名单。
- 影响面升级：全站不可用超过 1 小时未恢复、新鲜度降级预计跨月（额度击穿等重置）、或同一根因 24 小时内二次发生——处置可继续，但须即时向站长汇总现状与预计恢复口径，不等恢复后才报。
- 本页与被指向文档均无覆盖的新故障类型：先在 `ops/incidents/` 记录现象与已查证据，再报站长定处置方向，不临场发明流程。
