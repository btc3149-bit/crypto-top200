# 配置导出清单（W4-11 灾备：配置导出部分）

> 工作包：W4-11（P1，第四期）「灾备三件套」之配置导出件；对应发现 F4-12。
> 建立日期：2026-11-13。拉取方式：只读 API + 仓库文件抄录，全程未做任何写操作、未改任何线上配置。
> **红线：本文件只记名称、类型与元数据，永不记任何 Secret / token / ping URL 的值或片段。** 唯一例外为 `BOARD_READ_MODE`（其取值口径已在仓库注释中公开，且本轮实测结论为「未设置」，见 §1）。
> 数据来源标注：每节注明「API 实测（2026-11-13）」或「仓库抄录」；两者不一致时以 API 实测为准并注明差异。

---

## 1. Cloudflare Pages 项目 `crypto-top200`（API 实测，2026-11-13）

拉取命令（只读）：

```text
python3 ~/workspace/custom-connectors/custom.cloudflare/bin/cf_api.py GET /accounts/e6eae7d19e653edfedb12f4bb5e0227d/pages/projects/crypto-top200
```

结果：**成功**。关键字段抄录：

| 项 | 值 |
|---|---|
| 项目名 | `crypto-top200` |
| 项目 ID | `8781594c-5bd4-493d-a0a7-c0ce9beaedb4` |
| 子域 | `crypto-top200.pages.dev` |
| 域名清单（`domains`） | `crypto-top200.pages.dev`、`top200.oppcal.com`（自定义域在位） |
| 生产分支（`production_branch`） | `main` |
| 创建时间 | 2026-11-10T08:46:27Z |
| `uses_functions` | `true` |
| 构建配置 | `destination_dir = public`；`web_analytics_tag` / `web_analytics_token` 均为 `null`（与「WA 走手动 beacon 注入、非控制台建站注入」的既有口径一致） |
| 当前生产部署 ID（canonical / latest） | `869d5437-76c9-46d1-81c4-56a337e1bf36`（拉取时点值，重建时以当时 API 为准） |

### 1.1 环境变量与 Secret 清单（只记名与类型）

**Production 环境：**

| 名称 | 类型 | 备注 |
|---|---|---|
| `COINGECKO_API_KEY` | `secret_text` | API 按设计不返回其值，本文件亦不记值；台账编号 K2，见 `ops/security/key-ledger.md` |
| `BOARD_READ_MODE` | **未设置** | Production 的 `env_vars` 中不存在此键。后果：`functions/api/board.js` 按代码缺省取 `legacy`（`board.js:744`，缺省 `legacy`），与当前 G1 影子期应处形态一致。注意此结论与 F4-13 的表述互补：该变量既不在 `wrangler.toml` 正文、也不在 Pages 环境配置中，切换它必须新增配置并重新部署 |
| KV 绑定 `BOARD_KV` | kv_namespace 绑定 | namespace id `ad1b72702c5c4f229999bea5b118d1bc`（与仓库 `wrangler.toml` 一致） |
| `compatibility_date` | `2026-11-01` | `compatibility_flags` 为空；`fail_open = true`；`usage_model = standard` |

**Preview 环境：**

| 名称 | 类型 | 备注 |
|---|---|---|
| （无环境变量） | —— | `env_vars` 为空对象：Preview 未配 CoinGecko key，与二期定版「Preview 零 key、走 fixture」口径（key-ledger K2p）一致 |
| KV 绑定 `BOARD_KV` | kv_namespace 绑定 | namespace id 同 Production：`ad1b72702c5c4f229999bea5b118d1bc` |
| `compatibility_date` | `2026-11-01` | 其余字段与 Production 同口径 |

> 重建提示：从零重建 Pages 项目时，须重建上述绑定与 Secret（值经保险箱流程重新注入，不在本文件范围）；`BOARD_READ_MODE` 在 G1/G2 阶段保持未设置（=legacy），G2/G3 切换时按门禁决策另行设置。

---

## 2. fetcher Worker 与 KV（仓库抄录；Worker 侧配置未经 API 复核）

来源：`workers/fetcher/wrangler.toml`、`shared/board-schema.js`、`docs/fetcher-runbook.md`。本轮令牌为 Pages 范围，未对 Worker 配置做 API 拉取，以下以仓库为准，重建时以部署实测复核。

| 项 | 值 |
|---|---|
| Worker 名 | `crypto-top200-fetcher` |
| 入口 | `workers/fetcher/src/index.js`；`compatibility_date = 2026-11-01` |
| Cron 节奏 | `*/10 * * * *`（每 10 分钟；`wrangler.toml` 的 `[triggers]` 块在位）。注：同文件头部注释仍保留 G0 形态的历史说明（「暂不注册 triggers」），与文件后段已注册的 triggers 块不一致——以 triggers 块与 2026-11-11 G1 启用记录（commit `8ff88ac`）为准，注释为陈旧文本 |
| 明文变量（`[vars]`，非 Secret，可抄录） | `PAPRIKA_ENABLED = "false"`、`BOARD_SOURCE = "auto"`、`BOARD_TARGET_KEY = "shadow"`（影子期写 shadow 键） |
| Secret 清单（只记名） | `COINGECKO_API_KEY`（fetcher 侧第二注入点，台账 K2f，与 Pages 侧同值共池）、`MANUAL_RUN_TOKEN`（`POST /run` 手动补抓鉴权，台账 K3）；值均经 `wrangler secret put` 注入，不在仓库 |
| KV 绑定 | `BOARD_KV` → namespace id `ad1b72702c5c4f229999bea5b118d1bc`（与 Pages 侧共用同一命名空间，禁止另建） |
| KV 键清单（`shared/board-schema.js`） | `v1:board:current`、`v1:board:shadow`、`v1:meta:health`、`v1:config:source-state`；另有 `v1:board:current:prev` / `v1:board:shadow:prev` 两个 prev 键已在 schema 与 W4-10 代码中定义，但**代码未部署**（commit `b552973` 标注待 G1 结算放行），线上尚不可据此回滚 |

Pages 侧 KV 绑定另见 §1.1（API 实测与仓库一致）。

---

## 3. 监控配置（API 实测，2026-11-13）

告警联系人细节不在本文件全量复制：统一引用 `ops/probe-config.md` 的「落地状态」与「告警收敛」两节（其中已记录联系人 ID 与邮箱）。

### 3.1 UptimeRobot（M1–M4）

拉取命令（只读）：`ur_api.py call getMonitors alert_contacts=1`、`ur_api.py call getAlertContacts`。结果：**成功**，四监控状态均为 UP（`status = 2`）。

| ID | 监控 ID | 类型 | 对象路径 | 间隔 | 告警联系人 |
|---|---|---|---|---|---|
| M1 首页存活 | `804645009` | HTTP（type 1） | `/` | 300 秒 | 已配置（联系人 ID `9028550`，gmail 域名；全量见 probe-config） |
| M2 接口正向断言 | `804645065` | Keyword（type 2），keyword `"mode":"live"`、不存在即告警（`keyword_type = 2`） | `/api/board` | 300 秒 | 同上 |
| M3 接口负向断言 | `804645066` | Keyword（type 2），keyword `<!DOCTYPE`、存在即告警（`keyword_type = 1`） | `/api/board` | 300 秒 | 同上 |
| M4 新鲜度 | `804645067` | HTTP（type 1） | `/api/health` | 300 秒 | 同上 |

### 3.2 healthchecks.io（HC1–HC3）

拉取命令（只读）：`hc_api.py checks`（ping URL 由助手脚本按设计脱敏，不出现在输出与本文件）。结果：**成功**。

| ID | 检查名 | 周期 / 计划 | 宽限（grace） | 状态（拉取时点） |
|---|---|---|---|---|
| HC1 定时全量探针 | `HC1-top200-probe-hourly` | period 3600 秒（1 小时） | 900 秒（15 分钟） | `up`；最近 ping 2026-11-13T01:58:25Z |
| HC2 部署后检查 | `HC2-top200-deploy` | period 7,776,000 秒（90 天，占位型，不靠缺席判定） | 86,400 秒（24 小时） | `up`；最近 ping 2026-11-12T12:15:48Z |
| HC3 2026-11-21 复核守夜 | `HC3-2026-11-21-review` | cron `0 9 21 11 *`、时区 `Asia/Shanghai` | 21,600 秒（6 小时） | `new`（从未 ping，符合一次性未来检查的预期） |

附带发现：账号下另有一个注册自带的默认检查 `My First Check`（period 86400 秒、grace 3600 秒、状态 `new`、从未 ping），不属于 HC1–HC3 体系，无告警作用；是否删除待站长顺手处置时决定，本轮只登记不动。

---

## 4. DNS 导出尝试（API 只读实测，2026-11-13）

尝试命令（只读）：

```text
python3 ~/workspace/custom-connectors/custom.cloudflare/bin/cf_api.py GET "/zones?name=oppcal.com"
python3 ~/workspace/custom-connectors/custom.cloudflare/bin/cf_api.py GET "/zones/<zone_id>/dns_records?per_page=100"
```

结果：**两次均成功**（与施工前「令牌是 Pages 范围、大概率被拒」的预判不符，如实更正）：zone 查询返回的 `permissions` 列表实际包含 `#dns_records:read`、`#zone:read` 等只读权限，即当前令牌的实际可读范围大于其连接文档所述的 Pages 范围。本轮仅做了只读拉取，未尝试任何 Zone 写操作；令牌权限口径的更正建议同步到连接文档与密钥台账（K1 的权限描述），待协调者处置。

Zone 元数据：`oppcal.com`，zone ID `86c60e08c84a03f2b33a47074a1dd446`，状态 `active`，类型 `full`，Cloudflare 名称服务器 `keira.ns.cloudflare.com` / `yew.ns.cloudflare.com`（原注册商 Spaceship）。

DNS 记录清单（只记类型、主机名、代理与 TTL，不记记录值）：

| 类型 | 主机名 | 代理 | TTL |
|---|---|---|---|
| A | `oppcal.com` | 否（DNS only） | 300 |
| A | `www.oppcal.com` | 否（DNS only） | 300 |
| CNAME | `top200.oppcal.com` | 是（Proxied） | Auto（API 返回 1） |

全区共 3 条记录，无 TXT / MX 等含密钥或验证语义的记录。重建要点：`top200.oppcal.com` 的 CNAME 指向 Pages 项目（目标主机名以重建时 Pages 项目的自定义域绑定流程为准）；根域与 `www` 的两条 A 记录与本站无直接关系，重建本站时不要误删。

---

## 5. git 远端选型（站长已定：GitHub 私有仓，2026-11-13 批准按推荐执行）

现状（2026-11-13 实查）：`git remote -v` 为空；仓库仅存于本机 VM，共 43 个 commit（评审时 40 个，其后新增 3 个）、主分支 `master` 外有若干施工 worktree 分支。F4-12 定性不变：VM 丢失 = 源码、文档、运维知识同时丢失。

0 元候选（免费档均可建私有仓，容量对本仓量级均无压力）：

| 候选 | 要点 | 注意 |
|---|---|---|
| GitHub 私有仓 | 免费账号可建不限量私有仓；生态与文档最熟；站长已有 Google 邮箱体系，注册成本最低 | 仓库须保持 Private；推送凭据（SSH key / token）须走保险箱流程，不入仓库 |
| GitLab（gitlab.com）私有项目 | 免费档含私有项目与基础 CI 额度 | 免费档有存储与计算分钟上限，本仓纯托管不受影响 |
| Codeberg 私有仓 | 非营利、免费、无商业追踪 | 平台定位偏开源协作，私有仓为受限用途，长期纯私有托管的适配性须站长确认后再选 |

**推荐排序：GitHub 私有仓 ＞ GitLab 私有项目 ＞ Codeberg。** 理由：本仓需求只是异地副本 + 可克隆重建，托管方的熟悉度与长期可用性优先于功能差异。

**状态（2026-11-13 更新）：站长已批准按推荐执行（GitHub 私有仓）。助手本地准备已完成**：①仓库完整性 `git fsck --full` 通过（仅 dangling 对象，无损坏）；②§5.1 步骤 1 的本地等效验证已做——经 file:// 全新克隆（走对象传输）约 1 秒完成，克隆内 HEAD 与源一致（`49b3d45`）、全 refs 69 个 commit、24 个 tag、12 个分支齐全、克隆内 fsck 干净；③推送通道定为仓库 **Deploy key**（单仓最小权限）：本机已有 SSH 密钥对（`~/.ssh/id_ed25519`），公钥由助手在交办时提供给站长粘贴（公钥非秘密，不入本文件）。**远端尚未建成，只剩站长一步**：

> 站长一步（约 3 分钟）：①登录或注册 github.com；②New repository——名称 `crypto-top200`、选 **Private**、不勾选 README/.gitignore/license（保持空仓）→ Create；③该仓库 Settings → Deploy keys → Add deploy key——Title 填 `top200-vm`、Key 粘贴助手提供的公钥、**勾选 Allow write access** → Add key；④把仓库地址（形如 `git@github.com:<用户名>/crypto-top200.git`）告诉助手。

站长一步完成后，助手执行顺序：①加 remote 并推送 `master`、全部施工分支与全部 tag；②从远端全新克隆复核 commit/tag 数与 fsck；③按 §5.1 完成剩余重建演练步骤并把实测 RTO 回填本文件。

### 5.1 从零重建演练计划（待执行，目标 RTO ≤ 2 小时）

口径：RTO 目标 **≤2h**（F4-12 的未演练估计为 2–4h；演练以实测为准，实测值记录在案，不达标则修订目标或补齐缺口件）。演练在 preview / 临时项目上做，不动生产。

1. 从远端全新克隆到干净目录，核对 commit 与 tag 完整（计时开始）。
2. 按 §1 重建 Pages 项目配置：绑定 KV（或新建命名空间后回填 id）、注入 Production Secret（值经保险箱流程）、确认 `BOARD_READ_MODE` 缺省形态。
3. 按 §2 部署 fetcher Worker：注入两枚 Secret、确认 Cron 注册、`BOARD_TARGET_KEY` 按演练口径设置。
4. 自定义域与 DNS 按 §4 清单恢复（演练时只核对清单可执行性，不实际改生产 DNS）。
5. 部署 preview 并跑冒烟（`smoke-headers` + `probe.sh` 全量断言对 preview 口径执行）。
6. 按 §3 清单逐项核对监控（M1–M4 / HC1–HC3）在位且参数一致（演练不新建监控，只验证清单足以指导重建）。
7. 记录实测 RTO、各步耗时与缺口，回填本节并在 `ops/signoffs.md` 留痕（计时结束）。

前置缺口（演练前须知）：若 Cloudflare 账号本身不可用，本计划无法执行，RTO 无上限（与 `docs/fetcher-runbook.md`「Cloudflare 账号不可用」一节同口径）；监控两家的账号恢复依赖站长本人，本计划只覆盖配置重建、不覆盖账号找回。

**演练进度（2026-11-13）**：步骤 1 已以本地等效方式验证通过（见 §5 状态）；步骤 2/3/6 的清单可执行性已由本文件 §1–§3 的实测抄录支撑。实地重建（preview/临时项目）待远端建成后随推送一并完成并计时回填——**整体 RTO 仍未实测，不得按已达标表述**。
