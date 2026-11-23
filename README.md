# 币圈市值前 200 预估排名站（crypto-top200）

线上地址：https://top200.oppcal.com （Cloudflare Pages 项目名定版：`crypto-top200`）

本站是研究报告《市值前 200 加密货币下一轮牛市高点预估排名》的在线版：**全表币数见 `data/coins.json` 的 `meta.counts`**（原表 B 的 43 个锚定类资产已剔除，并经两轮市值顺延补位，详见 `CHANGELOG-补位.md`、`CHANGELOG-补位2.md`；README 不再写死币数，以 meta.counts 为准）。数据基准：老币为 CoinGecko 口径 **2026-11-08 日收盘快照**，补位币为 **2026-11-10 CoinGecko 实盘核验**。预估窗口为 2029 年 9 月下旬 ~ 10 月中旬的历史周期情景推演区间。

页面打开后由 `functions/api/board.js` 服务端代理 CoinGecko 实时行情（缓存 120 秒），倍数空间按现价自动重算；接口不可用时页面回退到快照数据并标注「快照模式」。

> ⚠️ 本站不构成投资建议。预估是历史周期情景推演，不是预测。页面顶部已内置风险提示，请勿删除。

## 硬红线（任何改动不得触碰）

- **不删风险提示**：页首风险条与页脚免责声明必须保留（预估倍数排名 ≠ 推荐排名）。
- **零广告、零返佣、零引流**：不加广告位、不加交易所返佣/注册链接、不做社群引流；同时不得出现收费荐币、代客理财、承诺收益话术。
- **只动 `crypto-top200` 这一个项目**：部署、Secret、回滚等一切 Cloudflare 操作只针对本项目，不触碰账号下其他域名与应用。
- **密钥硬规则**：任何 API key / Token 只存保险箱或平台 Secret，禁止写入仓库任何文件、禁止发到聊天、禁止出现在截图里；台账只记元数据（见 `ops/security/key-ledger.md`），轮换按 `ops/security/rotation-playbook.md` 执行。

## 包里有什么

| 文件 | 作用 |
|---|---|
| `public/index.html` | 网页本体（无需任何构建步骤） |
| `public/data/coins.json` | 预估数据（网页实际读取这一份）——**构建产物，勿手改**，由 `scripts/build.py` 从源生成，同目录 `DO_NOT_EDIT.md` 有说明 |
| `data/coins.json` | 预估数据**唯一可编辑源**（单一事实源定版）；`public/` 副本与它哈希不一致时部署门禁直接中止 |
| `functions/api/board.js` | 行情代理：服务端拉 CoinGecko 实时价格并缓存 120 秒 |
| `wrangler.toml` | Pages 项目配置（项目名 `crypto-top200`） |
| `package.json` | 锁定 wrangler 版本（当前 4.159.0）与部署/冒烟命令脚本 |
| `scripts/deploy.sh` | 唯一部署入口：数据一致性门禁 → Wrangler 直推 → 部署后冒烟 |
| `scripts/smoke.sh` | 部署冒烟断言（断言 JSON 契约，不只看状态码） |
| `scripts/probe.sh` | 本地健康探针：冒烟同组断言 + 数据新鲜度，结果追加到 `ops/probe-log.jsonl` |
| `scripts/*.py` | 从研究报告重新生成数据的脚本（一般用不到） |
| `CHANGELOG.md` | 每次生产部署一行记录 |
| `UPGRADE_PLAN.md` | 2026-11-10 全面审计与升级方案（本轮施工依据） |

## 部署（唯一方法：受限 API Token + Wrangler 直推）

前提（一次性）：在 Cloudflare 控制台创建一枚**受限 API Token**（仅授 Account → Cloudflare Pages → Edit 一项权限、限定本人账号、90 天到期），经安全通道交付保管，部署环境以环境变量 `CLOUDFLARE_API_TOKEN` 方式使用。Token 不写进任何仓库文件。本地首次使用先装依赖：

```bash
npm install
```

正式部署两步走（先预览、冒烟通过后才上生产）：

```bash
npm run deploy:preview   # 部署到 preview 分支，脚本会自动对预览地址跑冒烟
npm run deploy           # 部署到生产（main 分支），脚本会自动对 https://top200.oppcal.com 跑冒烟
```

`scripts/deploy.sh` 内部流程（现行口径，F7-55 于 2026-11-23 按 deploy.sh 实现重写）：**测试门禁（最前置，F6-01）**：先跑全量测试（`npm test`），未全绿即中止 → **脏工作区门禁（F6-01）**：工作区有未提交改动默认中止 → **模式门禁（F6-06）**：production 的 `wrangler.toml` `[vars]` 中 `BOARD_READ_MODE` 必须为 `kv` → 工具链预检（W4-17：Node 主版本须在 `package.json` engines 范围 22–24、`.nvmrc` 定版 24；`package-lock.json` 的 wrangler 版本须与 `package.json` 的 pin 一致，不一致即中止）→ 数据门禁（只验不改：两份 coins.json 哈希一致 + `scripts/check_meta.py` 复验 meta v2 + fetcher 副本 dataHash 与 `coins-list.js` 名单一致性（W4-10），不一致即中止，同步是 build.py 的职责）→ **安全头门禁（W2-18）**：`node ops/headers/gen-headers.mjs --check --variant=on` 校验 `public/_headers` 与当前 `index.html` 的生成结果一致，不一致即中止（先重新生成、禁止手改 `_headers`）→ 用 `package.json` 锁定的 wrangler 版本执行 `wrangler pages deploy public --project-name crypto-top200`（preview 加 `--branch preview`，production 加 `--branch main`）→ 对对应地址执行 `scripts/smoke.sh`，其后还有部署后安全头冒烟段（smoke-headers，F6-27：线上子集 S1/S2/S4/S6，结果落 deploy-log，非零时以非零码收尾）；生产部署冒烟通过后自动复跑 `scripts/probe.sh` 全量断言（W4-17：未全过只告警不改判，结果留痕 `ops/probe-log.jsonl`）。冒烟失败时脚本非零退出并提示「部署已上线但冒烟失败，需人工处理/回滚」。**绕过留痕口径（F6-01/F6-26，现行）**：任一 `DEPLOY_SKIP_*` / `DEPLOY_ALLOW_*` 绕过都必须同时给出 `DEPLOY_SKIP_REASON`（无理由一律拒绝），且自动追加记录到 `ops/deploy-log.jsonl`；旧口径「`DEPLOY_SKIP_META_CHECK=1` 单次生效并须在 CHANGELOG 注明」已废止。

**preview 的定位（W4-17 定版，回应 F4-19）**：preview 按 §20.3 定版不注入 CoinGecko key（全账号仅 1 把，此决策不变），其 `/api/board` 必然呈 stale/503——preview 只用于**静态与 UI 冒烟**（首页、隐私页、静态注入渲染、响应头），**不验行情新鲜度、冒烟结论不可迁移到生产数据面**。生产保障由 deploy.sh 的部署前门禁（工具链/数据/名单/安全头）+ 部署后 smoke 与 probe 全量断言承接。fetcher 无 preview 形态，其变更只走影子链与 G1→G2→G3 门禁验证。

手动单独冒烟：

```bash
npm run smoke                              # 对生产地址
bash scripts/smoke.sh https://preview.crypto-top200.pages.dev preview   # preview 只跑静态/UI 子集、不验 /api/board（F7-04）
```

## 已废弃：控制台拖放部署（不要再用）

**已废弃：控制台拖放不编译 functions/，会导致 /api/board 失效（2026-11-10 审计结论）**。首次上线用的就是拖放直传：`functions/api/board.js` 被当成静态文件，`/api/board` 返回的是首页 HTML（HTTP 200），前端静默回退快照——故障被降级设计伪装成了「可用」。此后任何一次拖放更新都会让故障永久持续。部署只走上面的 Wrangler 直推，没有第二种方法。旧的 `dist-upload/` 与 `upload.zip` 拖放产物已移入项目外的归档目录，不要再生成这类拍平目录/zip 包。

## 换数据再部署

**只改源 `data/coins.json`**（优先经 `scripts/build.py` 从研究报告重建，见下方「数据管线」；紧急小修可手改源，但须补跑校验）。`public/data/coins.json` 是构建产物，禁止手改。流程：

```bash
python3 scripts/build.py --emit   # 只校验 + 把源拷贝为产物（本地、无网络、秒级）
npx wrangler pages dev public     # 本地预览（不要双击 index.html：file:// 下 fetch 会被浏览器拦截，只能看静态壳）
npm run deploy:preview            # 预览冒烟通过后再上生产
```

细则：

- 改预估区间改 `estLo` / `estHi`（预估下限/上限，美元）。
- 增删币种：新增条目必须带正确的 `coingeckoId`（在 coingecko.com 搜币名，网址里 `/en/coins/` 后面那段就是 id），否则该币没有实时价；易混 id 的权威登记见 `scripts/overrides.json`。
- 部署后脚本自动冒烟。

## 数据管线（build.py 单入口）

数据只许一条路生成：研究报告（`research_notes/` 三份）→ `scripts/build.py` → `data/coins.json`（源）+ `public/data/coins.json`（产物）。

```bash
python3 scripts/build.py            # 全量构建：parse→resolve→merge→validate(G1–G10)→audit→emit，产构建报告
python3 scripts/build.py --emit     # 只校验（check_meta）+拷贝：改完源后出产物/预览用，秒级
python3 scripts/build.py --offline  # 离线构建（跳过在线审计，构建报告标红，产物禁止直接上生产）
```

- 门禁 G1–G10 任一不过：非零退出、不写产物、报错带报告行号/币名。阈值单点定义在 `scripts/pipeline_config.py`（AUDIT_BAND 等），别处出现比值字面量视为违规。
- emit 之后管线自动执行 `render-snapshot` 步（`scripts/render_snapshot.py`）：以同一份 `data/coins.json` 为快照源，把 200 行榜单静态注入 `public/index.html` 的 SNAPSHOT 标记区（JS 成功后整表替换、失败时保留快照，W2-17）；标记缺失/条数不符即中止，研究报告回链由 `pipeline_config.py` 的 `REPORT_URL` 一处控制（空 = 两落点不渲染）。
- id 人工核定只登记在 `scripts/overrides.json`（build.py 与周检共读）；XTZ/SHFL 拆分数据在 `scripts/fixtures/xtz_shfl_split.json`。
- 构建报告落 `ops/build-reports/`：**人工签核后才可 commit + 打 tag + 部署**；未签核产物禁止上生产。
- 旧脚本（parse_report/map_ids/build_coins_json、merge_refill*、migrate_meta_v2）已退役归档于 `scripts/archive/`，勿再运行。

## 回滚方法

- **控制台一键回滚**：Cloudflare 控制台 → Workers & Pages → `crypto-top200` → Deployments → 选中上一个正常的生产部署 → Rollback，即时生效。
- **API / 命令行**：用同一枚受限 Token 调用 Pages 部署 API 回滚到指定部署，或把 Git 里上一个 tag 的产物用 `scripts/deploy.sh production` 重新推一遍。
- **模式回滚（`BOARD_READ_MODE`，W4-12 定版口径，与上面的部署回滚是两回事）**：真实路径 = 在 `wrangler.toml` 的 `[vars]` 注入目标 `BOARD_READ_MODE` 后跑 `scripts/deploy.sh` 重新部署。**经 API 改 Pages 项目级 env 不会被 Wrangler 直推部署携带**（2026-11-13 演练实测），`scripts/rollback.sh` 的 mode 子命令只改 API 配置层、**不得单独作为模式回滚的完成依据**。证据见 `ops/disaster-recovery/rollback-drill-2026-11-13.md`。
- 回滚后跑一次 `npm run smoke` 确认接口与页面恢复。

## 冒烟与探针

- 冒烟（`scripts/smoke.sh <基址>`）：断言 ① `/api/board` 返回 200 且 Content-Type 为 JSON；② body 含 `coins`、`updatedAt`、`coverage`；③ body 不含 `<!DOCTYPE html`（负向断言，专防 HTML 冒充接口）；④ `coverage.returned` 不低于 `/data/coins.json` 币数的 94%；⑤ 首页 200 且含「市值前 200 币种」；⑥ `/data/coins.json` 200 且可解析。任一失败非零退出。
- 探针（`scripts/probe.sh <基址>`）：同一组断言外加新鲜度判定（`updatedAt` 距今 ≤15 分钟为 pass；stale 且年龄 ≤3600 秒为 warn；snapshot 模式为 fail），每次运行把一行 JSON 结果追加到 `ops/probe-log.jsonl`。告警邮箱已于 2026-11-10 接入（U3）：`PROBE_ALERT_EMAIL` 指向站长邮箱、外部探针（UptimeRobot + healthchecks.io）的告警联系人同为该邮箱，配置与触发演练记录见 `ops/probe-config.md`；两家服务的账号注册须站长本人完成（指引在该文件内）。

## CoinGecko API key（Secret 方式）

可选但推荐：到 CoinGecko 申请免费 Demo key，用 Secret 方式写入（不要写进任何文件、不要用普通明文环境变量）：

```bash
npx wrangler pages secret put COINGECKO_API_KEY --project-name crypto-top200
```

改 Secret 后必须重新部署才生效。注意：CoinGecko Demo 档**全账号仅 1 把 key**——Preview 环境不配 key、改走 fixture 样例数据（W2-20 定版）；轮换流程：新建 → 替换并重新部署 → 在 CoinGecko 后台吊销旧 key，剧本全文见 `ops/security/rotation-playbook.md`。

## 本地预览（可选）

```bash
npx wrangler pages dev public
```

浏览器打开它给的本地地址，效果与线上一致（含实时行情）。

## 费用与免费额度

- Cloudflare Pages 免费版：静态请求不限量，个人站足够。
- Pages Functions（行情代理）走 Workers 免费额度：每天 10 万次请求；本站有 120 秒服务端缓存，实际打到 CoinGecko 的次数很少，正常访问量远用不完。
- CoinGecko 公共接口免费；配 Demo key 后额度为自己名下可计量的 10,000 次/月。

## 运维节奏

**总原则：触发式介入**——只在部署后、数据更新时、探针告警经站长转达时、站长选定的复核时间点介入，不做长期盯盘。以下四触发点清单为 W2-15 定版（`ops/checklists.md`），每项含动作与完成判据；勾完即存档，证据文件指针写在对应留痕里。

### ① 部署后（每次生产部署必走，≤15 分钟）

- [ ] probe.sh 全量断言通过，结果追加 `ops/probe-log.jsonl`
- [ ] HC2 success ping 已发出（部署管线自动，人工抽查 healthchecks 日志页有记录；未配置 ping URL 时 `scripts/hc_ping.sh` 打印 `skipped-no-url`，记为降级运行，不算本项失败）
- [ ] 外部探针未处于 pause（部署中若 pause 过 M1–M4，此时恢复）
- [ ] 若本次部署含数据/函数变更：抽查 `/api/board` 条数＝200、`mode` 字段、新鲜度各一项
- [ ] 若含静态文件变更：抽查 canonical/OG/favicon 抓取（与 W2-16 验收项共用）

### ② 数据更新（名单/快照/口径变更时）

- [ ] 名单 diff 核对：新增/退出币种清单与变更原因（顺延补位、去重规则）逐条对上
- [ ] 稳定币/锚定类计数＝0、总数＝200、无重复（三项数字写进留痕，不写「已核对」空话）
- [ ] 快照时间与新鲜度阈值复核；构建注入（W2-17）标记区计数＝200
- [ ] probe.sh 复跑通过

### ③ 告警转达（收到 DOWN/缺席告警时）

- [ ] 先自检复现（自定义域打开首页＋`/api/board`），区分真故障/误报/上游（CoinGecko）故障
- [ ] 建 `ops/incidents/` 事件页：起止时间、主告警 ID、根因、处置
- [ ] 只向用户转达一条汇总（故障性质＋影响＋是否已恢复），不逐条转发每封告警邮件
- [ ] 恢复通知（UP）到达后关事件页；无恢复通知则人工确认恢复并注明

### ④ 选定复核点（下一次已定 2026-11-21，模板见 `ops/reviews/2026-11-21-review.md`）

- [ ] 按模板全项执行并成文 `ops/reviews/2026-11-21-review.md`
- [ ] HC3 success ping 发出（W2-13），HC3 随即停用/删除或改期到下一个用户选定日期——**没有用户新选日期时不得自行滚动生成下一个复核点**（遵守「不默认长期盯盘」约定）

### 常设例行（非触发）

- **名单周检（手动/半自动，不设常驻定时任务）**：运行 `python3 scripts/weekly_check.py` 产出 `ops/weekly/<年>-W<周>.md` 并更新 `ops/weekly/state.json`，报告与 state 一并 commit。周检只读、只产报告，永不写 coins.json、永不触发部署；移入候选只给行情与占位行，不自动给预估。
- **月审 SOP**：每月一次逐条复审 `scripts/overrides.json` 的 active 条目（打开 evidenceUrl 核对 id 仍正确 → 更新 verifiedAt/reviewDue 并记入当周周报 D 节）+ 处置积压人工队列；月审结论附在当月最后一周报告尾部，不另起文件。事件急查（大盘单日 ±20%、构建比值异常、探针告警涉币、下架/迁移新闻）可单次运行周检并在报告头标 `event-triggered`。
- **季度体检**：清单见 `ops/quarterly/2027-Q1-checklist.md`（含 Token/key 有效期、回滚演练、tail 演练、合规自查）。

## 数据与口径说明

- 实时行情：CoinGecko（经 `functions/api/board.js` 代理，缓存 120 秒；上游故障时自动回退最近缓存并标注）。
- 预估数据：全表币数见 `data/coins.json` 的 `meta.counts`。构成：原报告表 A 158 条为基础，剔除原表 B 43 个锚定类（稳定币/黄金代币/代币化基金/包装资产等），第一轮按市值顺延补入 43 个非锚定币（其中 19 个与原表尾部重复、已按补位数据更新不重复计数，实际新增 24 个），第二轮再顺延补入 18 个，凑满现行全表。原表 A 第 157 行 XTZ/SHFL 合并行已拆为两条。
- 数据日期：老币价格/市值为 CoinGecko 口径 2026-11-08 日收盘（与 CoinMarketCap 交叉核对；101–200 名的 ATH 部分为聚合口径约值）；补位币为 2026-11-10 CoinGecko 实盘核验，前端在「报告现排名」列以「11-10核验」标记。
- CoinGecko ID 映射已在 2026-11-10 逐一在线核定。易混项（人工核定的 id 覆盖）的权威登记见 [`scripts/overrides.json`](scripts/overrides.json)（含每条的理由、证据链接与复审到期日）；README 不再自带第二份易混清单，消除双源。
