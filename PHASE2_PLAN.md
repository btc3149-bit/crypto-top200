# 币圈市值前 200 预估排名站 · 第二期全面优化升级方案

> **文档性质**：在一期方案（`UPGRADE_PLAN.md`）与 P0 施工实录（`CONSTRUCTION_P0.md`）基础上，对标行业最高标准商业软件做的第二期全面优化升级方案。用户已授权：本方案完成后直接由施工团队按批次施工，故全部工作包细化到「改哪个文件、验收怎么勾验」的执行级别。本轮只出方案，不动代码、不部署。
> **审计日期**：2026-11-10 ｜ **审计对象**：`~/workspace/cloudflare-top200-site/` 全部源码、脚本、文档与线上实查（https://top200.oppcal.com 及 `/api/board` 实时响应）。
> **审计方法**：协调者通读一期方案、P0 施工实录、两份补位变更记录与 README，并实查线上接口与仓库状态；五位专业子审计并行分工（数据可靠性 / 产品·UX·性能 / 数据治理 / 可观测·SEO / 安全合规），外部额度与条款以各厂商官方口径于 2026-11-10 复核（逐处在各章注明来源与日期）。
> **阅读指引**：本总纲（§0–§6）是结论、总表、批次与用户事项；其后五章为各工作包的完整设计定版（目标设计 / 实施步骤 / 验收标准 / 工作量级 / 成本 / 风险与回滚），施工时以工作包编号（W2-xx）为唯一索引。

---

## 0. 结论先行

### 0.1 总体判断

一期 P0 已把三个死穴中的两个半解掉：部署管线正规化（Wrangler 直推 + 受限 Token + 冒烟/回滚演练）、接口正确性与状态诚实化（board.js 故障矩阵 7/7、前端三态绑定）、实时行情转 live（Demo key 注入后 `/api/board` 实测 mode=live、200/200 全覆盖）。**第二期要解决的不再是"能不能用"，而是"能不能长期、低成本、可维护地用"**，剩余的结构性问题有四个：

| # | 结构性问题 | 证据 | 二期解法 |
|---|---|---|---|
| T1 | **抓取架构仍在烧额度**：访客触发 + per-colo 120s 缓存抓取，单 colo 即约 43,200 次/月，是 Demo 额度（10,000 credits/月）的 4 倍以上，多 colo 再成倍放大。现在 live 只是"还没烧完"，不是"可持续" | 一期 §2.1 测算 + 本期复核 CoinGecko 官方计费口径（1 次成功调用 = 1 credit、失败不扣，2026-11-10） | W2-01 Cron 唯一抓取 → KV → Function 只读，定版节奏 markets 10 分钟 + global 30 分钟，月耗 5,760 credits（57.6%） |
| T2 | **数据生产仍是手工作坊**：一期 §2.8 对旧管线 7 项指控本期逐行复核，5 项仍成立（绝对路径、静默跳行、审计失败报成功、写死常量、无 schema 校验）；两份 coins.json 副本靠门禁维持、meta 无 schemaVersion 与报告哈希 | `scripts/` 逐行复核（见 W2-11 伤情对照表） | W2-10 单一事实源定版（data/）+ meta v2 → W2-12 override 登记落值 → W2-11 一条命令可复现构建 |
| T3 | **信任呈现还有明账未还**：方法论文案承诺的 ATH † 标记代码从未输出，现 105/200 币（52.5%）的 ATH 是约值或未核实却被当精确值呈现；研究报告站内无回链；全站无 SEO 基础件与静态内容（200 行数据对爬虫不可见） | 前端逐行核查（athFlag 分布 verified 95 / approx 69 / unverified 36） | W2-04a 标记先行（独立小包）、W2-16 SEO 基础包、W2-17 静态注入 + 回链 |
| T4 | **守夜机制仍未闭环**：探针只有本地脚本、无外部常驻检查、无邮件告警；CoinGecko key 曾在聊天/截图中出现（免费档、最坏被蹭额度，但应按事件处理）；Cloudflare Token 约 2027-02-08 到期尚无续期剧本落点 | `ops/probe-log.jsonl` 记录停留在 key 注入前；P0 报告遗留项 1/2 | W2-13 外部探针组合 + 告警（唯一前置 U3）、W2-20 密钥轮换剧本（key 立即轮换 + Token 续期定版） |

另有一处**条款级新发现**（影响一期 P1-5 的原结论）：CoinPaprika 免费层 2026-11-10 复核其官方定价页，仅限 Personal use、公开展示需 Enterprise 档。故备源定版为**默认关闭**：映射与熔断状态机照建，但启用开关须站长书面确认本站为个人非商业运营后才打开（见 §6 条件事项 U8）；不确认则备源不启用、降级链以 KV 滞后 + 快照兜底收尾。这一条是本期相对一期最重要的结论修正。

### 0.2 二期开工基线（与一期基线的差异，均为实查）

| 项 | 一期基线（2026-11-10 审计时） | 二期基线（当前实查） |
|---|---|---|
| 线上行情 | 接口失效、快照模式 | **mode=live**，coverage 200/200，契约含 source/mode/updatedAt/servedAt/stale/staleAgeSec/coverage/global（global 尚缺 asOf） |
| 数据 | 201 条（表 A 158 + 表 B 43 锚定类） | **200 条全部可预估**（锚定类清零，两轮顺延补位完成），132,049 B，athFlag 95/69/36 |
| 前端 | 230 行 / 13,835 B，无三态、无移动端裁剪 | 266 行 / 19,549 B，三态绑定、移动端核心 6 列、44px 点击域已落地；行展开/ATH 标记/自选/表头排序/中文搜索/分页均未做 |
| 部署 | 拖放直传、无 Git | Wrangler 直推 + 受限 Token（ hsurr 通道）、Git 仓库 + tag 至 `v1.2.0-refill200`、deploy.sh 门禁 + smoke.sh 六断言、回滚演练已完成 |
| 密钥 | 无 key、匿名被拦截 | CoinGecko Demo key 已注入 Pages Secret（生产）；Cloudflare Token 90 天期、约 2027-02-08 到期；Preview 环境未配独立 key |
| 可观测 | 全无 | 本地 probe.sh + ops/probe-log.jsonl 已有；外部探针、邮件告警、Web Analytics、隐私页均无 |
| SEO | head 仅 title | 仍为零（无 description/canonical/OG/favicon/robots/sitemap/JSON-LD），`public/` 下无 `_headers` |

### 0.3 成本总览

- **必选支出：0 元**。21 个工作包全部在免费额度内落地（Cloudflare 免费计划、CoinGecko Demo、UptimeRobot Free + healthchecks.io Free 组合、Git 本地仓库）。
- **被论证否决的付费项**：CoinGecko 付费层（架构改对后免费额度只用 57.6%）、UptimeRobot Solo（$12–13/月，仅作探针组合失效时的回退项，不预付）、CoinPaprika 付费档（免费层条款问题不是付费能解决的——公开展示需 Enterprise，与本站体量不匹配）。
- **人力**：全部由 agent 代办施工；需要用户亲自处理的只有 §6 的 3 项提供/确认 + 1 项条件确认 + 2 处可能的施工中触发式点按协助（各约 1–5 分钟）。

---

## 1. 工作包总表（21 个）

工作量口径与一期一致：S ≤1 天、M = 2–5 天、L > 1 周（agent 单人投入，含自测与演练，不含观察期）。

| 编号 | 工作包 | 量级 | 估时 | 成本 | 前置依赖 | 章节 |
|---|---|---|---|---|---|---|
| W2-01 | 抓取架构改造：Cron Worker 唯一抓取 → KV 单 blob → Function 只读 | M | 3–4 天 | 0 | 施工首步先验受限 Token 对 KV/Worker 的权限（见 §5 风险 R1） | 二章 |
| W2-02 | 新鲜度契约 v2 与降级链定版（global.asOf、抓取元信息、状态机文案） | S–M | 1.5–2 天 | 0 | W2-01（同文件串行） | 二章 |
| W2-03 | 备源 CoinPaprika 接入（Worker 层映射 + 整表熔断；**默认关闭**，启用须 U8 确认） | M | 3–5 天 | 0 | W2-01；启用另须 U8 | 二章 |
| W2-04 | 行展开详情 + ATH 可信度标记（04a 标记先行 S / 04b 展开 M） | M | 约 3 天 | 0 | 无（04a 可最先行） | 三章 |
| W2-05 | 表格交互三件套：表头排序（定案、删下拉）、中文名搜索、计数与空状态 | M | 3–4 天 | 0 | W2-08 的 render 地基（同批串行，见 §2） | 三章 |
| W2-06 | Watchlist 自选（localStorage，红线不变） | M | 约 2 天 | 0 | W2-08 分页语义就位后 | 三章 |
| W2-07 | Hash 单币直达分享（`#SYMBOL` 定位展开 + 标题随币） | S | 约 1 天 | 0 | W2-04b、W2-08 | 三章 |
| W2-08 | 分页渲染 + INP/LCP 治理与测量基线（先建基线再动工） | M | 3–5 天 | 0 | 测量子项须在一切前端改造之前 | 三章 |
| W2-09 | 可访问性补齐 + 倍数视觉分层 | M | 约 2 天 | 0 | 语义部分随批 3 首批；视觉分层随 W2-05 同批 | 三章 |
| W2-10 | 单一事实源定版（data/ 为源） + meta v2（schemaVersion/dataHash/报告哈希） | M | 约 2 天 | 0 | 无（治理链起点） | 四章 |
| W2-11 | 可复现构建管线 build.py（一条命令、校验门禁、旧脚本退役） | M | 约 4 天 | 0 | W2-10、W2-12 登记落值 | 四章 |
| W2-12 | 名单周检脚本 + override 登记表（13 条现行 + 2 条退役迁入） | M | 约 3 天 | 0 | W2-10；自动周跑须用户另行批准（见 §6 注） | 四章 |
| W2-13 | 外部探针 + 邮件告警（UptimeRobot Free + healthchecks.io Free 组合、/api/health、DMS） | M | 2–3 天 | 0 | 告警投递须 U3 邮箱；探针本体可先建 | 五章 |
| W2-14 | Web Analytics 启用 + 隐私说明页（/privacy） | S | ≤1 天 | 0 | **U7 文案签收为硬门禁**；开关大概率须用户点按 | 五章 |
| W2-15 | 运营节奏与季度体检清单定版（P2-4 tail 演练在此收口） | S | ≤1 天 | 0 | 无 | 五章 |
| W2-16 | SEO/分享基础包（description/canonical/OG+图/favicon/robots/sitemap/JSON-LD/noscript） | M | 1.5–2 天 | 0 | 无 | 五章 |
| W2-17 | 构建期静态注入 200 行榜单 + 研究报告回链（**合并取代一期 P2-8**） | M | 2–3 天 | 0 | W2-11；回链渲染须 U4（未确认则整段不渲染） | 五章 |
| W2-18 | 安全响应头与 CSP（_headers 定版 + 内联脚本 hash 自动生成 + API 头代码内自带） | M | 2–3 天 | 0 | 与 W2-14 开关状态同发版（WA-OFF/WA-ON 两变体） | 六章 |
| W2-19 | 接口滥用收口（Sec-Fetch-Site 软校验 + Zone 限流规则 1 条） | S | ≤1 天 + 7 天观察 | 0 | 限流阈值须 W2-01 上线后按一周实测峰值校准 | 六章 |
| W2-20 | 密钥轮换剧本定版与立即动作（CoinGecko key 立即轮换、Preview 改 fixture、Token 续期剧本） | M | 约 2 天 | 0 | 无（事件驱动，建议最先行） | 六章 |
| W2-21 | 合规自查机制化（季度清单、署名数据驱动验收、话术限定词排查） | S | ≤1 天 + 0.5 天/季 | 0 | 署名联动验收与 W2-03 呼应 | 六章 |

**总量**：约 **47 个 agent 工作日**（按各包估时中点合计，四舍五入；串行口径）。按 §2 批次并行推进（治理链、数据链、前端列车、表面运营四线），日历约 **5–6 周**。全部成本 0 元。

---

## 2. 施工批次与依赖（总顺序）

> 通用发版门（每批每包共用，沿用 P0 纪律）：本地自测 → 预览部署 → smoke 六断言 + 本包验收标准 → 生产部署 → CHANGELOG 一行 + git tag → 探针观察。前端六包同改 `public/index.html` 一个文件，**禁止并行改同一文件**，必须按下述列车顺序串行合入。

- **批 0 · 立即项（开工第一周，与批 1 并行）**
  - W2-20 的 CoinGecko key 立即轮换子项（事件驱动，越早越好；剧本余部随批 4 收尾）；
  - W2-13 探针本体搭建（无告警形态先行，U3 到位后补投递与演练）；
  - W2-08 的**测量基线子项**（Lighthouse 基线必须在任何前端改造前测得，否则无从验收）；
  - W2-01 施工首步的**权限核查**：受限 Token 仅 Pages Edit，预计不足以创建 KV 命名空间与 Worker——先验权，不足时按 W2-01 的站长手动清单处理（见 §5-R1）。
- **批 1 · 数据治理链（串行）**：W2-10（单源 + meta v2）→ W2-12（override 登记落值、周检脚本）→ W2-11（build.py 管线收编全部生成路径）。此链是 W2-17 静态注入与后续一切数据变更的地基，必须先于批 4 的 W2-17。
- **批 2 · 数据链路**：W2-01（Cron+KV）→ W2-02（契约 v2，与 W2-01 同文件串行）→ W2-03（备源映射与状态机，默认关闭）→ W2-19 限流规则（W2-01 上线一周、按实测峰值校准阈值后启用，含 7 天观察期）。
- **批 3 · 前端列车（单文件串行，顺序为 UX 章定版）**：① W2-04a（ATH 标记）+ W2-09 语义部分 → ② W2-08（render 地基：分页、计算缓存、防抖含 IME 守卫，此批后 render 逻辑冻结）→ ③ W2-05（表头排序/中文搜索/计数）+ W2-09 视觉分层 → ④ W2-04b（行展开）+ W2-06（自选）→ ⑤ W2-07（hash 直达）。
- **批 4 · 表面与运营**：W2-16（SEO 基础包）→ W2-17（静态注入 + 回链，依赖批 1 的管线）→ W2-14（Web Analytics + 隐私页，U7 签收后）与 W2-18（CSP，须与 W2-14 的实际开关状态同发版切换 WA-OFF/WA-ON 变体）→ W2-15（运营清单定版）+ W2-21（合规机制化）+ W2-20 剧本余部收尾。
- **跨批观察项**：W2-13 告警演练（U3 到位后一周内完成）、W2-19 限流 7 天观察、W2-01 上线后额度日报观察一周（确认月耗曲线 ≤ 5,760 预算线）。

---

## 3. 相比一期 P1/P2 的调整对照（每项附理由）

| # | 一期条目 | 二期处置 | 理由（均为本期复核新证据） |
|---|---|---|---|
| A1 | P1-1 抓取节奏（示例每 10 分钟，未定版 global 频率） | 定版 markets 10 分钟 + global 30 分钟，月耗 5,760/10,000 credits | 2026-11-10 复核官方口径：credits 与 calls 等价、失败不扣费；5 分钟节奏测算占 93.6%–100.8%，无任何故障余量 |
| A2 | P1-1 KV 写入形态未细化 | 单 blob 单键 `v1:board:current` + 状态小键 | KV 免费层仅 1,000 写/天；单 blob 写约 ≤170/天且 markets 与 global 原子可见 |
| A3 | P1-5 备源 CoinPaprika「第一备源、可直接接」 | **默认关闭**，启用须 U8 书面确认个人非商业运营 | 官方定价页复核：免费层仅 Personal use，公开展示需 Enterprise；条款风险不是技术问题 |
| A4 | P1-5 熔断参数以请求次数计 | 按 Cron run 数/时间重标定（连败 3 run≈30 分钟切换、静默 60 分钟、回切须连续 3 次成功且覆盖 ≥98%） | 抓取者从访客请求变为定时任务，原参数失去物理意义 |
| A5 | P1-6 新鲜度契约（已有大半） | 并入 W2-02，新增 global.asOf 与抓取元信息 | P0 已落地 source/coverage/staleAgeSec；两端点分频后 global 与 markets 时间天然不同，共用 updatedAt 即误导 |
| A6 | P1-2 数据治理地基（整包） | 只剩 W2-10 两件（单源 + meta v2） | Git 化、CHANGELOG、发布 tag 已由 P0 施工顺带完成（tag 至 v1.2.0-refill200），不应重复立项 |
| A7 | P1-2/§2.6 单源首选 `public/data/` | **改定 `data/` 为源** | deploy.sh 现行门禁与 README 已以 data/ 为准，顺现状收敛零迁移；public/ 是部署产物目录，不宜放唯一源 |
| A8 | P1-3 管线校验（文件哈希一致） | meta 新增 `dataHash`（仅 coins 数组规范化哈希） | generatedAt 每次构建必变，不剔除 meta 则文件哈希永不稳定、双目标校验无从谈起 |
| A9 | §2.8 旧脚本 7 项指控 | 复核结论：5 项仍成立、2 项随补位脚本部分变化；另新发现 merge 脚本 OVERRIDES 为死代码空壳、curl 全线无 `-f` | 逐行复核落到文件名行号（W2-11 对照表）；比值阈值统一为单点定义 `AUDIT_BAND=(0.35, 2.8)`，0.2–5 随 map_ids 退役废止 |
| A10 | §2.7 override 约 6 条 | 实盘 **13 条现行 + 2 条退役** | BCAP/SATUSD 已随表 B 退出（新增 status 字段留溯源）、BCG 现行符号已改 BC、补位批 7 条此前只活在 README 里（文档与代码双源），本期补录并消双源 |
| A11 | P1-4 周检含合约地址逐币检测 | 砍掉，改以 id 消失 + symbol/name 变更为迁移代理信号 | 逐币合约核查需约 200 次调用/周，免费层不划算；周检总量实测约 27 次/月（额度 0.27%），定版用 Demo key |
| A12 | P1-4 周检自动跑批 | 只交付脚本，**是否每周自动运行须用户另行批准** | 尊重用户「不默认长期盯盘」既定边界，方案不预设常驻自动任务 |
| A13 | P1-7 行展开 + ATH 标记（同包） | 拆分：04a 标记独立先行（S） | 标记是正在发生的呈现违约（105 币需标记，一期口径 94/158 已过时），优先级高于体验增强；36 个 unverified 币 athPrice 全为 null，规则按特例写死 |
| A14 | P1-8 排序「表头与下拉二选一」未定案 | **定案表头点击胜出、下拉整体删除**（含删除时须同步清理的 3 处写操作坑位清单） | 工具栏还要新增计数行与自选开关，移动端养不起两个排序控件；双控件必然双状态源 |
| A15 | P1-8 中文别名（默认进数据） | 改放前端内联 `ALIASES`（以 coingeckoId 为键），不进 coins.json | 别名是呈现资产，进数据管线会污染单一事实源与校验门禁；Top 30 只给编制方法不写死译名，防以讹传讹 |
| A16 | P1-9 Watchlist 量级 S | 上调为 M | 本期把「只看自选 ∩ 搜索 ∩ 分页」叠加语义、三类坏值兜底、隐私模式降级写成硬验收项，走查工时约等于编码工时 |
| A17 | P1-10 JSON 瘦身目标 ≤65 KB（靠裁 *Raw） | 如实分账：紧凑序列化 ≈106 KB → 删两 Raw ≈93.6 KB，缺口约 28 KB 须靠管线短键名/位置数组；前端只做双形态解码配合 | 本地实算证伪原路径；且 *Raw 非纯冗余（WFI 的 Raw 是「未披露」的语义载体），裁前先定 null 呈现约定；另列不可裁字段清单防误删 |
| A18 | P1-10 LCP 治理含 fetch 并行等 | 保留，另增中文 IME 组字守卫（防抖细化） | 拼音输入中间态逐键渲染会对中文站造成高频闪烁，一期未提 |
| A19 | P2-8 首屏直出前 20 行（条件项） | **被 W2-17 全量静态注入合并取代**，仅保留「LCP 退化 >0.3s 降级前 50 行」回退条款 | 前 20 行是全量注入的子集，双路渲染易错位；全量 200 行 + JS 整表替换更干净 |
| A20 | P0-3/P1 探针：UptimeRobot 免费档单厂商 | **UptimeRobot Free + healthchecks.io Free 组合** | 免费档 heartbeat 已移入付费 Solo、keyword 断言算不了新鲜度时间差；新鲜度改走 /api/health 状态语义 + DMS ping |
| A21 | P1-14 Web Analytics「控制台一键开启」 | 必须走 Pages 项目 Metrics 开关（非 Zone 级入口，后者有公开实测的静默零数据坑）；受限 Token 大概率无权开启，预设用户 Dashboard 点按（约 1 分钟） | 实施路径复核纠正；验收以 HTML 出现 beacon 注入 + 仪表盘有数据为准 |
| A22 | P1-11 报告回链（占位等待） | 并入 W2-17；`REPORT_URL` 为空时回链整段不渲染 | 杜绝死链与占位字上生产 |
| A23 | P1-12 可访问性（按一期清单实施） | 先实测核查再定案：现文件 aria/role/label 命中为 0，但默认 outline 未被移除、对比度一期已验全过 → 做规范化焦点环 + 语义补齐，不动色板；aria-live 只给 statusBanner 一处 | 避免按过时清单重做已合格项；防多处 live 区域读屏双读 |
| A24 | P1-16 Hash 分享 | 保留，后置到批 3 末位（依赖展开与分页） | symbol 200/200 无重复已实测，可作路由键；依赖关系本期才明确 |
| A25 | P2-1 CSP 按 `_headers` 一把梭 | 头下发拆三处：静态走 `_headers`、**`/api/board` 必须在 Function 代码内自带头组**（官方证实 `_headers` 不作用于 Functions 响应）；HSTS 只经 _headers 以裸值下发、不带 includeSubDomains/preload；CSP 须与 Web Analytics 开关同发版（WA-OFF/WA-ON 两变体，禁止预先放行 beacon 域）；Rocket Loader 必须关闭（会改写内联脚本字节使 hash 失效） | 一期原样实施会让 API 侧安全头静默缺失；preload 实质不可逆；beacon 预先放行等于未启用先开洞 |
| A26 | P2-2 双环境各一 key | **前提不成立**：Demo 档（及 $35 Basic 档）全账号仅 1 把 key → Preview 改零 key 走 fixture 数据 | CoinGecko 官方定价页复核（2026-11-10）；K2 轮换定版双路径（先试增发、预期走原地换钥 + KV 快照兜底的分钟级切换） |
| A27 | P2-2 轮换为半年节奏事项 | CoinGecko key **升为本期立即轮换**（批 0） | 该 key 曾出现在聊天与截图中，按已暴露事件处理，不等半年节奏 |
| A28 | P2-4 函数结构化日志（单列） | 不单列，残余（tail 演练）收口于 W2-15 季度体检 Q5 | P0 已落地结构化 console.error；剩余只有演练动作，无独立工程量 |
| A29 | P2-5 倍数视觉分层 | 并入 W2-09，口径改为「当前显示倍数中点」 | 快照实测中点 ≥10× 仅 FIL 1 币、<1× 为 0，两档实为 live 模式准备；验收预期按此管理，图例强制回指风险提示防误读为推荐 |
| A30 | P1-15 运营节奏文档化 | 细化为 W2-15 可勾验清单 + 2026-11-21 复核模板 + 季度体检逐项表，留痕统一进 `ops/` | 原条目只有原则、无清单与留痕规范 |
| A31 | §5.1 接口滥用（软校验 + 限流） | W2-19 砍 Referer 校验、Sec-Fetch 只拦 `cross-site`；限流定版免费层 1 条规则、仅 Path 表达式、动作必须 Block（Challenge 会让 fetch 型 API 无声故障）、阈值初始 30 次/10 秒/IP 且 W2-01 后按实测校准 | W2-01 后滥用代价结构已变（只读 KV），信号重叠项砍掉；限流参数按官方免费层口径复核定版 |

---

## 4. 本期明确不做清单

沿用一期 §9 全部结论（二期复核后仍成立，不重复论证）：迁框架/构建链、虚拟滚动、SSR/第三方预渲染服务、Service Worker/PWA、D1/Durable Objects、用户账号系统与云端自选同步、持仓/成本价录入、201 个独立币种页、迁 Git 集成管线、大陆境内镜像/ICP 路线、CoinGecko 付费层、Google Analytics 类带 Cookie 统计、`_worker.js` 挽救拖放、`<tr>` 的 content-visibility 魔改、图片/字体优化专项。

二期新增不做项：

| 不做项 | 理由 |
|---|---|
| 浅色模式（一期 P2-6） | 前端列车本期已满载（六包串行）；浅色需全量对比度重验且不解决任何现存问题，留三期候选 |
| 拼音搜索（一期 P2-7） | 无搜索落空率数据（统计尚未启用），触发条件未满足；待 W2-14 数据积累约一季后评估 |
| 第二备源 CMC Basic（一期 P2-9） | 第一备源（Paprika）尚未启用满一季，触发条件未满足；且备源启用本身还卡在 U8 条款确认 |
| CoinPaprika 商业使用/付费档 | 免费层仅 Personal use、公开展示需 Enterprise；本站若未来商业化，须先单独谈数据源授权，与本期无关 |
| UptimeRobot 付费 Solo | 免费组合（UptimeRobot Free + healthchecks.io Free）已覆盖断言与 DMS 需求；Solo 仅作组合失效时的回退项，不预付 |
| Pages Functions 上套用 `_headers` 管 API 头 | 平台不支持（已证实），API 头在代码内自带，不做无用功 |
| 告警通道扩展（短信/电话/IM 机器人） | 邮件是唯一不依赖 agent 在线的可靠通道；其余通道引入账号与费用复杂度，与「探针守夜、触发式介入」的既定运营模式不匹配 |

---

## 5. 风险总表（跨包）

| # | 风险 | 影响 | 缓解（所在工作包） |
|---|---|---|---|
| R1 | 受限 Token 仅 Pages Edit，预计无权创建 KV 命名空间 / 部署 Worker | W2-01 施工第一步即卡住 | 先验权；不足时站长按清单在控制台手动建 KV 与 Worker 占位（约 5 分钟）或为 Token 补 Workers/KV 权限后再继续；此为施工中触发式协助，非方案决策项（W2-01） |
| R2 | CSP 与内联脚本 hash 不匹配 → 全站白屏 | 批 4 最高危变更 | hash 由构建/部署脚本自动计算生成 _headers，预览环境先行验证 + 冒烟新增 CSP 断言，异常一键回滚上一部署（W2-18） |
| R3 | Cron+KV 切换期数据口径短暂不一致 | 切换窗口内新鲜度标注波动 | 双读比对灰度（KV 与旧路径并行一周期、比对一致才切读），旧路径保留至观察期结束可回切（W2-01） |
| R4 | CoinGecko key 原地轮换的切换瞬间 | 分钟级上游 401 | 切换窗口由 KV 最后成功 blob + 快照兜底覆盖；新 key 先经本地探针验活才动生产（W2-20） |
| R5 | 备源条款理解偏差 | 若本站性质被认定为商业/公开展示，Paprika 免费层不可用 | W2-03 默认关闭是结构性隔离：未确认前开关物理关闭，启用决定权与责任在站长书面确认（§6-U8） |
| R6 | 前端单文件多人并行改动互相覆盖 | 批 3 返工 | 列车式串行合入 + 每批 git tag；render 地基在批 3-② 后冻结，后续包只在冻结接口上开发（§2） |
| R7 | Cloudflare Token 约 2027-02-08 到期未续 → 部署通道中断 | 到期后无法部署/回滚 | 续期提醒落点定 2027-02-01（跟踪项 + 日历各一），剧本含「先建新、验权、再吊旧」的无中断顺序（W2-20） |

---

## 6. 需要用户决策或提供的事项（全案仅此一节需要站长动手）

| # | 事项 | 需要用户做什么 | 预计耗时 | 不提供时的降级处理（定版） |
|---|---|---|---|---|
| U3 | **告警邮箱（提供）** | 给一个日常能收到的邮箱作探针告警主通道（建议就用账号邮箱） | 1 分钟 | **探针照常先建**（W2-13 不整体顺延），只差告警投递：检查结果仅在 agent 介入时可见，时效无保证，残余风险留痕于 ops 记录；邮箱到位后一周内补投递配置与触发演练 |
| U7 | **隐私说明页（过目签收）** | 过目 agent 起草的《隐私说明》文案（W2-14 附稿）并确认 | 约 3 分钟 | **写死部署门禁：未签收则 Web Analytics 不得启用**，W2-14 只交付隐私页与启用剧本，统计顺延；不影响其余工作包 |
| U4 | **研究报告回链 URL（确认）** | 确认研究报告托管页的公开链接，供 W2-17 站内回链 | 1 分钟 | `REPORT_URL` 配置为空 → 回链区块**整段不渲染**（无死链、无占位字），信任链该环顺延至确认后再开 |
| U8（条件事项，非阻塞） | **备源启用确认** | 若希望启用 CoinPaprika 备源：书面确认本站为个人非商业运营（免费层条款要求）；不启用则无需任何动作 | 约 2 分钟（仅启用时） | 默认即降级形态：W2-03 的映射与熔断状态机照常建成，**启用开关保持关闭**，主源故障时降级链走 KV 滞后 + 快照兜底；本站一旦商业化，备源须先谈授权、不得直接开开关 |

另有两处**施工中可能触发的一次性手动协助**（非决策项，agent 会先自行尝试、确需时才喊站长，并附图文清单）：① W2-01 验权不足时，在控制台建 KV 命名空间/Worker 占位或给 Token 补权限（约 5 分钟，见 §5-R1）；② W2-14 的 Web Analytics 开关大概率须站长在 Dashboard 点按一次（约 1 分钟）。

**一处纪律声明**（沿用用户既定偏好）：W2-12 名单周检在本期只交付脚本与首期人工跑批结果；是否设为每周自动运行，须用户另行明确批准，本方案不预设、不默认开启。2026-11-21 的一次性复核安排不变（清单模板见 W2-15）。

除以上事项外，第二期全部施工（写代码、部署、演练、文档、跑批）均由 agent 代办，用户零操作。

---

*—— 总纲完 —— 以下五章为各工作包设计定版原文（施工依据），章节与工作包对应：第二章 = W2-01～W2-03（数据可靠性）；第三章 = W2-04～W2-09（产品/UX/性能）；第四章 = W2-10～W2-12（数据治理）；第五章 = W2-13～W2-17（可观测/SEO）；第六章 = W2-18～W2-21（安全合规）。*

---


---

# 第二章 · 数据可靠性（W2-01 ～ W2-03）

# 第二期 · 数据可靠性工作包（W2-01 ～ W2-03）

> 项目：crypto-top200（Cloudflare Pages，https://top200.oppcal.com ）
> 基线：2026-11-10 一期 P0 已上线状态（/api/board mode=live、覆盖率门禁 94%、stale 硬上限 6h、429 熔断读 Retry-After、Cache API 120s + 内存回退）。一期已定约束继续有效：不上 D1、不上 Durable Objects。
> 本文为设计定版，不含代码；所有「改哪个文件 / 新建什么」均标注到文件级，施工 agent 照单执行即可。
> 外部事实核查日期：2026-11-10（下文逐处注明来源）。

## 本章结论（先行）

1. **架构换代是必选项，不是优化项**：现「访客触发 × 按 colo 分片缓存」在单 colo、120s TTL 下即约 43,200 次上游调用/月（2 端点 × 21,600 个 TTL 窗口），多 colo 成倍，早已超过 CoinGecko Demo 档 10,000 credits/月；带 key 只是把「被限流」变成「月底额度耗尽」。第二期统一改为 **Cron 定时 Worker 全球唯一抓取 → KV 单 blob → Pages Function 只读**，上游调用量与访客数、colo 数彻底解耦。
2. **额度复核结论：站长口径成立，且 credits 与 calls 等价**。CoinGecko 官方口径（coingecko.com/en/api 页 FAQ，2026-11-10 核查）：「1 call = 1 credit. Calling any endpoint will only count as 1 call」；官方多篇对比文重申 flat 模型——每次**成功** REST 调用恒扣 1 credit，不按端点、分页、返回条数加倍，失败的 4xx/5xx 不扣 credit（但计入每分钟速率限制）。Demo 档 10,000 credits/月、100 calls/min 经官方定价页及多家 2026-10 二次核查一致确认，口径仍成立。故 /coins/markets 与 /global **各为 1 credit/次成功调用**，下文按 calls 直接核算 credits，无需换算系数。
3. **定版抓取节奏：markets 每 10 分钟、global 每 30 分钟**，月耗 5,760 credits（30 天月，57.6%），31 天月 5,952，均留 ≥40% 余量给重试、探针与人工调试。一期若按 5 分钟节奏设想则必然超额（见 W2-01 匹配表），本期据此下调并给出理由（§W2-01 调整说明）。
4. **CoinPaprika 免费层条款比一期设想更严**：官方定价页（coinpaprika.com/api/pricing，2026-11-10 实际打开核查）确认免费层为 **Personal use only**，且付费 Starter（$99/月）～Ultimate 也仅 **Internal commercial**，「向自己的用户展示 / 再分发」需 **Enterprise** 合同。本站是公开网站，严格按条款，公开展示 Paprika 数据不在免费层、也不在自助付费层授权内。定版对策：Paprika 熔断切换默认 **关闭（feature flag）**，须站长书面确认本站为个人非商业运营后才可启用；若转商业，备用链只剩静态快照或另谈 Enterprise（W2-03）。

---

## W2-01 抓取架构改造：Cron 唯一抓取 → KV 单 blob → Function 只读

### 目标设计

#### 1. 目标架构

```
Cron */10 * * * *  ──►  Worker: crypto-top200-fetcher（独立 Worker，全球单实例调度）
                          │  单次运行 = 一个 fetchRun：
                          │   ├─ GET CoinGecko /coins/markets（每 run 必抓，1 credit）
                          │   ├─ GET CoinGecko /global（仅当距上次成功 ≥30min 时抓，1 credit）
                          │   └─ 覆盖率/完整性校验通过才写 KV（失败绝不覆写）
                          ▼
                     KV namespace: BOARD_KV
                          └─ 键 v1:board:current（单 blob，含行情+global+抓取元信息）
                          ▲
Pages Function /api/board ─┘  只读：KV get → 组装契约 v2 → 返回
                          兜底顺序：Cache API（存原始 blob）→ 内存 last-good → 静态快照
访客请求 ──► 永远不触发上游抓取；上游调用量与流量无关
```

设计要点：

- **单 Cron、单写入者**：只注册一条 Cron 触发器 `*/10 * * * *`；global 是否到期由 Worker 内部按 blob 内 `globalUpdatedAt` 判断（距今 ≥30 分钟才抓）。不用两条 Cron，避免两个调度并发写同一 blob 的竞态；单写入者使 KV 无需任何锁。
- **只在成功时写**：markets 覆盖率 ≥94%（沿用一期门禁，returned/expected ≥ 0.94）且结构校验通过，才 `put` 新 blob；任一失败保留旧 blob 原样（天然即「最后成功数据」），仅更新健康计数（见 W2-02）。
- **整 run 原子性**：markets 与 global 解耦（沿用 P0 allSettled 精神）：markets 成功、global 失败时，仍写 blob，global 段沿用上一 blob 的值及其原 `asOf`，不因 global 失败丢弃整轮行情。

#### 2. 额度量化匹配表（CoinGecko Demo：10,000 credits/月，1 成功调用 = 1 credit）

核算口径：30 天月 = 43,200 分钟；markets 返回 200 币用单次调用（`per_page=250`，一次取回 200 币，施工首步须实测确认当前 board.js 的请求形态亦为单次/页；若现实现分 2 页，则下表 markets 数字 ×2，定版节奏自动降为 markets 每 20 分钟，其余结论不变——此核查列入实施步骤 1）。失败调用不扣 credit，故「重试」的 credit 成本仅为最终那次成功调用本身；重试预算主要约束的是**尝试次数与速率**，以及严防「成功后重复抓取」这类双扣。

| 方案 | markets 频率 | global 频率 | markets credits/月 | global credits/月 | 合计/月 | 占额度 | 判定 |
|---|---|---|---|---|---|---|---|
| 现架构（单 colo） | 访客触发 120s TTL | 同 | — | — | ≈43,200（多 colo 成倍） | ≥432% | 不可持续，现状态 |
| A 每 2 分钟全量 | 2 min | 2 min | 21,600 | 21,600 | 43,200 | 432% | ✗ |
| B 每 5 分钟全量 | 5 min | 5 min | 8,640 | 8,640 | 17,280 | 173% | ✗ |
| C 5min / 30min | 5 min | 30 min | 8,640 | 1,440 | 10,080 | 100.8% | ✗ 无任何重试余量 |
| D 5min / 60min | 5 min | 60 min | 8,640 | 720 | 9,360 | 93.6% | ✗ 余量 6.4%，一次故障恢复潮即破月 |
| E 6min / 30min | 6 min | 30 min | 7,200 | 1,440 | 8,640 | 86.4% | △ 可运行但余量 <14%，不作定版 |
| **F 定版 10min / 30min** | **10 min** | **30 min** | **4,320** | **1,440** | **5,760** | **57.6%** | **✓ 定版** |
| G 降级省额 15min / 60min | 15 min | 60 min | 2,880 | 720 | 3,600 | 36.0% | 额度告警时自动降入（见下） |

定版 F 的月度预算切分（硬顶 10,000）：

| 用途 | 预算 credits/月 | 说明 |
|---|---|---|
| 计划抓取（方案 F） | 5,760（31 天月 5,952） | markets 4,320 + global 1,440 |
| 重试预算（上限 15%） | 1,500 | 规则：每 run 对单个端点至多重试 1 次、仅对 5xx/网络错误/超时重试；429 不立即重试，按 Retry-After 跳过后续 run（见下）；实现「熔断跳过」后实际消耗远低于此上限，此数为熔断失效时的熔断丝 |
| 探针与人工调试 | 500 | 含 W2-03 回切探针（每 30 分钟 1 次 markets，仅熔断期启用，熔断满月最坏 1,440——超此项时自动从重试预算借支且触发降级方案 G）、上线验收、手动触发 |
| 不可动用安全垫 | ≥2,240 | 吸收 31 天月差、时钟边界、误配置双跑（如灰度期影子抓取须计入此垫并限时 ≤7 天） |

额度自保护（Worker 内实现，非靠人盯）：

- Worker 在 blob meta 中维护自然月累计估算 `quota.creditsUsedEst`（每次成功调用 +1，每月 1 日首个 run 重置；注明是本地估算，与官方后台可能有小差，以官方为准）。
- 预估当月用量（已用 + 当前节奏 × 剩余天数）**>8,500** 时，自动降入方案 G（markets 15min / global 60min，靠 run 内跳过实现：15min 节奏 = 每 3 个 10min run 抓 2 次的等价逻辑改为「距上次 markets 成功 <15min 则跳过」）并在 health 中置 `quotaMode: "saving"`；**>9,500** 时 markets 降为 30min、global 停抓（global 置 null 走 W2-02 解耦口径），health 置 `quotaMode: "critical"`。
- 429 处理：读 `Retry-After`（沿用一期逻辑，移至 Worker），将其换算为「跳过接下来 K 个 run」，K 写 health；429 期间不写 blob、不重试，避免速率限制滚雪球。

> 调整说明（对一期）：一期 §2 的新鲜度设想以分钟级（2–5 分钟）刷新为前提。按复核后的 flat 计费，5 分钟节奏即使 global 分频也达 93.6%–100.8%，没有重试与灰度空间，与「Demo 免费档长期运行」的目标冲突。本站是预估排名/周期分析站，非交易终端，且 CoinGecko Demo 档自身数据缓存约 60 秒、CoinPaprika 免费层刷新间隔长达 10 分钟——10 分钟抓取不构成用户可感知的信息损失。故二期把定版节奏定为 10/30 分钟，换取 42% 额度余量与熔断探针空间；前端文案不得再宣称「实时/分钟级」，统一按 W2-02 的「更新于 HH:MM」口径表述。

#### 3. KV 键设计

Namespace：新建 `BOARD_KV`（ wrangler `kv namespace create BOARD_KV` ），同一 namespace id 同时绑给抓取 Worker（写）与 Pages 项目（读）。

| 键名 | 写者 / 频率 | 内容 | TTL |
|---|---|---|---|
| `v1:board:current` | fetcher / 每成功 run 1 次 | 主 blob（结构见下） | **不设 expirationTtl**（过期即丢最后成功数据，与 stale 链冲突） |
| `v1:meta:health` | fetcher / 状态变化时 + 至多每小时心跳 1 次 | 健康/探针快照（W2-02 §3），供 /api/board 组装与外部探针直读 | 不设 |
| `v1:config:source-state` | fetcher / 仅状态机迁移时（W2-03） | 熔断状态、activeProvider、静默期截止、连续成功计数 | 不设 |
| `v1:board:shadow` | fetcher / 仅灰度期（W2-01 步骤 6–7，结束即删） | 影子 blob，与 current 同结构，用于双读比对 | 灰度结束手动 delete |

版本前缀 `v1:` 规则：blob 内 `schemaVersion` 与键前缀同步升版；升 `v2:` 时新旧键并行写 7 天、Function 按「先 v2 后 v1」读，稳定后停写 v1。禁止无前缀裸键。

主 blob 值结构（JSON，单值写入；200 币全量约数百 KB 级，远低于 KV 单值 25MB 上限，施工时实测并记录实际字节数）：

```json
{
  "schemaVersion": 1,
  "source": "coingecko",
  "fetchRunId": "20261110T0810Z-3f9a",
  "fetchedAt": "2026-11-10T08:10:03.412Z",
  "marketsUpdatedAt": "2026-11-10T08:10:03.412Z",
  "fetchMeta": {
    "durationMs": 1830,
    "upstreamStatus": { "markets": 200, "global": 200 },
    "attempts": { "markets": 1, "global": 1 },
    "quota": { "month": "2026-11", "creditsUsedEst": 3211, "quotaMode": "normal" }
  },
  "coverage": { "expected": 200, "returned": 200, "missingIds": [] },
  "rows": [ { "id": "bitcoin", "price": 0, "marketCap": 0, "change24hPct": 0, "…": "与现有 board 行结构同构，由归一化层产出，W2-03 双源共用" } ],
  "global": { "totalMarketCapUsd": 0, "volume24hUsd": 0, "btcDominancePct": 0, "asOf": "2026-11-10T08:10:03.412Z" }
}
```

单 blob 而非分键的理由（对一期可能设想的 markets/global 分键的调整）：Cloudflare KV 免费层写入额度为 **1,000 次/天**（官方 limits，2026-11-10 经多源核查一致；读 100,000 次/天、存储 1GB）。定版节奏下单 blob 写 144 次/天 + health ≤24 次/天 + 状态键偶发 ≈ **≤170 次/天（17%）**；若 markets/global/meta 三键每 run 各写，分频下仍约 340 次/天，灰度双写再翻倍逼近上限。单 blob 同时保证 markets 与 global 同 run 原子可见，读者永不读到半新半旧的拼接。

#### 4. KV 最终一致性对新鲜度的影响（定版口径）

事实：Workers KV 为最终一致，官方口径为写入「在其他全球位置可能需要 60 秒或更久才可见」，且读侧 `cacheTtl` 默认 60 秒（最低 30 秒）；写入位置本地通常立即可见但不保证（Cloudflare 官方文档，2026-11-10 核查同口径）。

影响与对策（写进实现，不靠运气）：

- **新鲜度一律以 blob 内 `fetchedAt` 计算**（`staleAgeSec = servedAt − fetchedAt`），不用 KV 写入时间、不用 Function 本地缓存时间。传播延迟 ≤60s+ 自然被 staleAge 覆盖，W2-02 的 live 阈值（15 分钟）已含 ≥60 秒传播预算 + 60 秒上游缓存预算。
- Function 读 KV 时显式传 `cacheTtl: 60`（不调低：调低至 30 仅省 ≤30 秒却增加中心回源读；KV 读免费额度 100k/天靠 Cache API 挡，见下）。由此最坏新鲜度附加延迟 = 抓取周期 10min + 传播/读缓存约 2min，已在 W2-02 分级阈值中预留。
- **负缓存注意**：键不存在的结果也会被缓存——首次上线若 Function 先于 fetcher 首写被访问，`current` 的「不存在」可能在部分 colo 延续约 60 秒。上线顺序定版为：先部署 fetcher 并手动触发首抓成功，再给 Pages 绑 KV 切读（步骤顺序不可颠倒）。
- 双读比对（灰度期）必须容忍 90 秒传播窗：比对脚本以 `fetchRunId` 对齐同一 run 再比数值，禁止以「写入后立即读不到/读到旧 run」判故障。

#### 5. 抓取 Worker 部署形态与同仓管理

目录（与 Pages 项目同仓 `crypto-top200/`，单仓多 wrangler 配置）：

```
crypto-top200/
├─ wrangler.toml                 # 既有 Pages 项目（新增 [[kv_namespaces]] 只读绑定，步骤 4）
├─ functions/api/board.js        # 改造为只读（步骤 8）
├─ data/coins.json                 # 既有 200 币主表（W2-03 增加 paprikaId 字段）
├─ public/data/coins.json          # 既有副本，deploy.sh 已做一致性门禁
├─ shared/
│  └─ board-schema.js            # 新建：blob 结构定义、归一化行结构、覆盖率校验（fetcher 与 Function 共用，杜绝两处口径漂移）
└─ workers/
   └─ fetcher/
      ├─ wrangler.toml           # 新建：独立 Worker 配置（要点见下）
      ├─ src/index.js            # 新建：scheduled() 抓取主逻辑 + fetch() 仅供手动触发/健康（带密钥校验）
      └─ coins.json              # 构建期由 deploy.sh 从 data/coins.json 复制并纳入一致性门禁（由两份扩为三份）
```

`workers/fetcher/wrangler.toml` 要点：

```toml
name = "crypto-top200-fetcher"
main = "src/index.js"
compatibility_date = "2026-11-01"   # 施工时填当期稳定值并锁定
[triggers]
crons = ["*/10 * * * *"]
[[kv_namespaces]]
binding = "BOARD_KV"
id = "<与 Pages 侧同一 namespace id>"
[vars]
PAPRIKA_ENABLED = "false"
BOARD_SOURCE = "auto"
```

- Secret：`COINGECKO_API_KEY` 以 `wrangler secret put` 注入 **fetcher Worker**（与 Pages Secret 是两处独立注入，值同为站长现有 Demo key，经安全流程由站长提供，禁止写入仓库/文档明文）。
- **权限前置（施工第一步先验，勿假设）**：一期存入的受限 API Token 仅有「Account · Cloudflare Pages · Edit」范围，预期**不足以**创建 KV namespace、部署 Worker、改 Cron。施工 agent 先用该 token 试调 KV/Workers 只读接口验证；不足时停工并给出站长手动清单（控制台创建 namespace + 绑定，或另发一枚含 Workers Scripts Edit + Workers KV Storage Edit 的受限 token 经保险箱交付），不得索要 Global API Key、不得扩大到其他项目。此项为本工作包唯一预期人工卡点。
- 手动触发入口：fetcher 的 `fetch()` 仅接受 `POST /run` 且校验自定义请求头密钥（值走 Worker Secret `MANUAL_RUN_TOKEN`），供灰度/验收/故障恢复手动补抓；其余路径 404。此调用同样计入探针预算。
- Cron 免费额度：Workers 免费计划含 Cron Triggers（账户级上限 5 条），本设计只用 1 条；Workers 免费 100,000 请求/天与 Pages Functions 共享账户额度，Cron 每日仅 144 次运行，可忽略。抓取单 run 子请求数 = 2（markets+global）+ 偶发重试 1，远低于免费单次调用 50 子请求上限。

#### 6. Function 只读化改造点（functions/api/board.js）

删除：一切 CoinGecko 上游 fetch、Pages 侧 `COINGECKO_API_KEY` 读取、429 熔断与 Retry-After 解析、allSettled 双端点并发（这些逻辑迁至 fetcher，Function 不再需要）。

保留并改造：

| 既有能力 | 去留 | 改造说明 |
|---|---|---|
| 覆盖率门禁 94% | 保留（防御纵深） | 改为**校验 blob**：读到的 blob 若 `coverage.returned/expected < 0.94` 视为坏 blob，不组装行情，降级至内存/快照并记结构化错误（正常永不触发，因 fetcher 写前已门禁） |
| stale 计算与 6h 硬上限 | 保留 | 按契约 v2（W2-02）以 blob `fetchedAt` 计算 |
| Cache API 120s | **保留，角色变更** | 由「挡上游额度」变为「挡 KV 读 + Function 调用」：缓存对象改为 **KV 原始 blob**（键仍为 /api/board 内部键），命中后由 Function 每次重新组装信封、重算 `servedAt/staleAgeSec`——禁止缓存组装好的最终 JSON，否则 staleAge 被冻结 120s、文案时间错误。KV 读由此被压至每 colo 每 120s 至多 1 次，100k/天免费读额度足够 |
| 内存回退 | 保留 | isolate 内保存最近一次成功读到的 blob；KV get 抛错/返回 null（且非首次部署场景）时用内存 blob 组装并标 `servedFrom: "memory"` |
| 结构化 console.error、onRequestGet + 405 | 保留 | 错误码新增 `KV_MISS`、`KV_ERROR`、`BLOB_INVALID` |
| 静态快照兜底 | 保留 | 仍为最终级（W2-02 L3），快照更新流程不变（部署时更新） |

改造后 Function 预期由 495 行显著瘦身（目标 ≤260 行，验收项），且**代码中不得出现任何 `api.coingecko.com` / `api.coinpaprika.com` 字符串**（验收用 grep 断言）——只读化以此为硬证据。

#### 7. 灰度切换步骤与回滚点

| 阶段 | 动作 | 观察期 | 回滚点 |
|---|---|---|---|
| G0 备料 | 建 namespace、部署 fetcher（Cron 先禁用：wrangler 配置暂不带 triggers 或用 `BOARD_FETCH_DISABLED=1`）、手动触发 3 次抓取写 `v1:board:shadow` 验证 blob 结构/大小/耗时 | — | 删 Worker 即净回滚，线上零影响 **R0** |
| G1 影子跑 | 启用 Cron 写 shadow（仍不写 current、不切读）；影子抓取计入额度安全垫，限时 ≤7 天；定时脚本（每小时）按 fetchRunId 对齐，比对 shadow 与线上 /api/board：覆盖率、逐币价差中位数与 P95、市值排序前 20 一致性 | ≥72h 且 ≥400 个 run，比对全过（阈值见验收） | 关 Cron 即停，线上零影响 **R1** |
| G2 切 current + 双读 | fetcher 改写 `v1:board:current`（shadow 继续双写 48h 后停）；Pages 绑 KV；Function 上线「双读模式」（环境变量 `BOARD_READ_MODE=dual`）：读 KV 组装但仍以旧路径结果对外返回，差异仅记日志 | ≥48h，日志差异率 <0.5%（容忍 90s 传播窗与旧路径自身 TTL 造成的 run 错位，比对仍按时间就近对齐） | 置 `BOARD_READ_MODE=legacy` 即回旧路径 **R2** |
| G3 切读 | `BOARD_READ_MODE=kv`，Function 对外返回 KV 组装结果；旧抓取代码保留在 Function 中但入口短路（不执行、不耗额度），保留 7 天 | ≥7 天，紧盯 W2-02 health 与额度估算 | 置回 `legacy` 并重新启用旧路径（注意：旧路径一启用即恢复按 colo 烧额度，仅作短时应急，>24h 须站长确认）**R3** |
| G4 下线 | 删除 Function 内旧抓取代码与短路开关、删除 Pages 侧 `COINGECKO_API_KEY` Secret（fetcher 侧保留）、删 shadow 键、deploy.sh 门禁扩为三份 coins.json 定版 | — | 回滚 = 按 git 历史恢复上一版 Function 并由站长重注入 Pages Secret；故 G4 须在 G3 稳定 ≥7 天后单独执行、单独提交 **R4** |

每阶段独立提交、独立部署，部署后记录 Pages 部署 id 与 fetcher 版本 id 于施工日志，任一回滚点按 id 可精确还原。

### 实施步骤

1. 施工前核查（半天内）：① 实测现 board.js 对 /coins/markets 的调用形态（单次 per_page=250 还是分页）并记录，若分页则按目标设计注记调整节奏参数 `MARKETS_INTERVAL_MIN`；② 用现有受限 token 验证 KV/Workers 权限，不足则按目标设计 §5 出站长手动清单并停工待办；③ 在 CoinGecko 控制台截图留存当前月已用 credits 作为基线（与本地估算对账起点）。
2. 新建 KV namespace `BOARD_KV`，记录 namespace id（Pages 与 fetcher 共用，禁止各建一个）。
3. 新建 `shared/board-schema.js`：导出 blob 结构校验 `validateBlob()`、覆盖率计算、归一化行构造 `normalizeCgMarkets()`（自现 board.js 抽取现有字段映射，保持行结构与线上完全同构）。
4. 改 `wrangler.toml`（Pages）：新增 `[[kv_namespaces]] binding="BOARD_KV"`（id 同步骤 2）；Function 侧仅 get，代码评审 + 步骤 8 的 grep 断言保证不出现 put/delete。
5. 新建 `workers/fetcher/`（wrangler.toml、src/index.js、coins.json 占位）：实现 scheduled() 主流程——读 current blob → 判断 global 是否到期 → allSettled 抓 markets/global → markets 覆盖率 ≥94% 才组装新 blob（global 失败沿用旧段）→ put current → 更新 health（W2-02 字段）→ quota 估算与自动降频（目标设计 §2）；429 按 Retry-After 置跳过计数；全局 try/catch 保证任何异常不覆写 blob 且必写 health 失败计数。注入 Worker Secret `COINGECKO_API_KEY`、`MANUAL_RUN_TOKEN`（安全流程）。
6. 改 `deploy.sh`：coins.json 一致性门禁由两份扩为三份（新增 workers/fetcher/coins.json 复制+diff）；新增 fetcher 部署目标（`wrangler deploy -c workers/fetcher/wrangler.toml`），与 Pages 部署分开命令、分开确认，禁止一条脚本连推两处不设停顿。
7. 执行灰度 G0→G1：影子比对脚本新建 `scripts/compare-shadow.mjs`（本地/CI 运行，按 fetchRunId 对齐输出价差统计），跑满观察期并留存报告。
8. 改造 `functions/api/board.js` 为只读版（按目标设计 §6 表逐项），实现 `BOARD_READ_MODE` 三态（legacy/dual/kv）；执行 G2 双读观察。
9. 执行 G3 切读；观察 7 天内每日核对一次：线上 staleAge 分布、health、额度估算 vs CoinGecko 后台实际用量（偏差 >10% 即查因）。
10. 执行 G4 下线旧路径；同步更新站点运维 README：新数据流图、手动补抓方法、额度告警处置（切方案 G/扩容选项）。

### 验收标准

- [ ] 额度：切读后连续 7 天，CoinGecko 后台实际 credits 消耗折算月化 ≤6,500（计划 5,760 + 探针/重试浮动），且与 blob 内 `creditsUsedEst` 偏差 ≤10%。
- [ ] 解耦：压测/自然流量下，访客请求数翻倍时上游调用数不变（以 fetcher 日志 run 数 = 144±2/天 为据）；Function 源码 grep 无 `coingecko`/`coinpaprika` 域名、无 `COINGECKO_API_KEY` 引用（G4 后）。
- [ ] KV 写量：任一日 BOARD_KV 写入 ≤250 次（Cloudflare 后台 KV 指标），读量 ≤30,000 次/日（含 Cache API 拦截后的实际量）。
- [ ] 灰度比对：G1 报告中影子与线上逐币价差中位数 ≤0.3%、P95 ≤1.5%（同 run 对齐；超限须归因到上游自身抖动并留记录），覆盖率每 run 均 ≥94%，missingIds 与线上一致率 100%。
- [ ] 故障演练：手动令 fetcher 连续失败 3 次（临时置错误 key 于 staging 或用禁用开关），线上仍返回最后成功 blob 且 stale 标记按 W2-02 正确升级，无 5xx、无空表。
- [ ] 回滚演练：G3 后实际执行一次 R3 回切（置 legacy 10 分钟再切回 kv），全程前端无报错、数据无倒退到快照。
- [ ] board.js 行数 ≤260 行；手动触发入口无密钥访问返回 404/401 且不触发抓取。

### 工作量级

**M（3–4 天）**：fetcher 本体约 1.5 天，Function 只读化 0.5 天，灰度比对与观察脚本 0.5 天，上线切换与演练 0.5 天，权限卡点等待不计入（站长手动项约 10 分钟）。观察期（G1 72h、G3 7 天）为日历时间、非投入时间。

### 成本

免费：KV / Workers Cron / Pages 均在免费层内（写 ≤170/天 vs 上限 1,000，读经 Cache API 拦截后远低于 100,000/天，Cron 1 条 vs 账户上限 5 条）。不采纳付费项的论证：Workers Paid（$5/月）的主要增益（CPU 30s、KV 写 100 万/月）在本量级用不到；CoinGecko Basic（$35/月，年付 $29/月）仅在未来要求 ≤5 分钟新鲜度时才需立项——届时 5 分钟节奏月耗 10,080 已超 Demo，付费档 100,000 credits 可直接覆盖，属产品决策而非本期可靠性必需。

### 风险与回滚

| 风险 | 影响 | 缓解 | 回滚 |
|---|---|---|---|
| 受限 token 权限不足，KV/Worker 无法创建 | 施工卡点 | 步骤 1 先验、手动清单兜底 | 未动线上，无回滚概念 |
| KV 传播延迟致个别 colo 短时读旧 blob | 新鲜度多滞后 ≤约 2 分钟 | staleAge 以 fetchedAt 计、阈值预留预算（W2-02） | 属设计内行为，无回滚 |
| Cron 调度静默停摆（如 Worker 部署事故） | 数据逐渐变 stale | W2-02 health 探针 + 连续失败可判读；手动 /run 补抓 | Function 侧 stale 链兜底至快照；R3 回切旧路径应急 ≤24h |
| 灰度期影子+线上双抓烧额度 | 月底额度紧张 | 影子期 ≤7 天计入安全垫；quotaMode 自动降频 | 随时停 Cron（R1）即止损 |
| 单 blob 损坏/写坏 | 全表不可用 | 写前 validateBlob、Function 读后二次校验、内存+快照双兜底 | fetcher 下一 run（≤10min）自愈；或手动 /run 立即补抓 |

---

## W2-02 新鲜度契约 v2 与降级链定版

### 目标设计

#### 1. 契约 v2：在现契约上只增不改

现契约 `{source, mode, updatedAt, servedAt, stale, staleAgeSec, coverage{expected,returned,missingIds}, global{...}|null}` 字段全部保留、语义不变（前端零破坏）；v2 新增如下，`contractVersion: 2` 显式标注：

```json
{
  "contractVersion": 2,
  "source": "coingecko | coinpaprika | snapshot",
  "mode": "live | delayed | stale | snapshot",
  "updatedAt": "= blob.marketsUpdatedAt（行情口径时间，沿用现语义）",
  "servedAt": "Function 本次组装时刻 ISO",
  "stale": false,
  "staleAgeSec": 0,
  "freshness": {
    "level": "L0|L1|L2|L3",
    "fetchedAt": "blob.fetchedAt（新鲜度唯一计算基准）",
    "nextExpectedFetchAt": "fetchedAt + 当前节奏（normal 10min / saving 15min / critical 30min）",
    "servedFrom": "kv | cache | memory | snapshot",
    "consecutiveFailures": 0
  },
  "fetch": {
    "fetchRunId": "与 blob 同值，贯穿日志/前端报错反馈",
    "durationMs": 1830,
    "upstreamStatus": { "markets": 200, "global": 200 },
    "attempts": { "markets": 1, "global": 1 }
  },
  "coverage": { "expected": 200, "returned": 200, "missingIds": [] },
  "global": {
    "totalMarketCapUsd": 0, "volume24hUsd": 0, "btcDominancePct": 0,
    "asOf": "该 global 数据自身的抓取时刻 ISO（本次新增，缺此前的最大契约缺口）",
    "stale": false
  }
}
```

关键语义定版：

- **`global.asOf` 独立于 `updatedAt`**：global 30 分钟一抓、markets 10 分钟一抓，两者新鲜度天然不同；前端 global 区块的时间标注必须用 `global.asOf`，严禁用 updatedAt 冒充。global 沿用旧值（某 run 未抓或抓失败）时 asOf 保持其真实旧时刻，`global.stale` 按其自身年龄判定（阈值见 §2 备注）。
- **`global: null` 条件收窄**：仅当从未成功抓到 global（冷启动且首抓 global 失败）或 global 年龄 >6h 时置 null；其余一律给最后成功值 + 真实 asOf（与 P0 解耦口径一致：global 缺失不得拖垮行情主体）。
- **`fetch.*` 为排障字段**：前端不展示（fetchRunId 可放页脚小字/控制台，供用户报错时回传）；`upstreamStatus` 记录的是**产出本 blob 那一 run**的上游状态，不是请求时刻状态——文档与代码注释须写明，防止误读为实时探针。
- **HTTP 行为不变**：四级降级均返回 200 + 契约字段表达状态（前端已按 mode/stale 渲染，维持可用性）；**探针判活不看 /api/board 的状态码，看 §3 的 health 字段**。405 等既有行为保留。

#### 2. 降级链状态机（四级，与一期 §2.5 分级口径衔接）

一期口径锚点：stale 硬上限 6h、超限不得再以「过期行情」面目展示、须落快照。本期把阈值按新抓取节奏（10min）重新标定，6h 锚点不变：

| 级别 | mode | 触发条件（staleAgeSec = servedAt − blob.fetchedAt） | 等价故障图景 | 前端文案映射（定版，施工照抄） |
|---|---|---|---|---|
| **L0 正常** | `live`，stale=false | age ≤ 900s（15min：1 个抓取周期 + 传播/缓存预算约 2min + 缓冲 3min） | 抓取正常 | 状态点绿；文案「更新于 {HH:MM}」；不出现「实时」字样（10 分钟节奏名实相符） |
| **L1 滞后** | `delayed`，stale=true | 900s < age ≤ 1,800s（30min） | 连续失败 1–2 个 run，或 KV 传播异常 | 状态点黄；横幅弱提示「数据更新延迟，显示 {HH:MM} 的行情，系统自动重试中」；表格正常可用，不遮罩 |
| **L2 过期** | `stale`，stale=true | 1,800s < age ≤ 21,600s（6h，一期硬上限） | 连续失败 ≥3 个 run、上游持续故障或已切备用源仍失败 | 状态点橙；横幅强提示「行情数据已过期（截至 {HH:MM}），预估排名仅供参考，请勿据此交易」；价格数字降饱和度呈现（沿用一期 §2.5 既定样式） |
| **L3 快照** | `snapshot`，stale=true，source=`snapshot` | age > 21,600s（6h），**或** KV 无 blob 且内存无 last-good（冷启动无数据） | 抓取链中断超 6h / 整体事故 | 状态点红；全页顶部横幅「实时行情暂时中断，当前显示 {快照日期} 的离线快照」；快照日期取快照文件元数据，禁止显示今天日期冒充新鲜 |

状态机规则：

- **纯时间驱动、无人工干预**：级别只由 staleAgeSec 决定，Function 每次组装时计算，不在 KV 中存「当前级别」（存量状态必然与各 colo 传播延迟打架）。源切换（W2-03）只改变 source 与 fetchedAt 的产生方式，不改变本状态机。
- **回升即时**：任一新 blob 落地（fetchedAt 更新），下一请求自动回到按新 age 计算的级别，不设回升迟滞（新鲜数据无抖动之虞）；唯一例外是数据源回切迟滞，在 W2-03 状态机内，不在本机内。
- **global 子状态独立**：`global.stale` 阈值单独定为 age(asOf) > 3,600s（1h：2 个 global 周期 + 预算）；global 进 stale 只标 global 区块（小字「总市值数据更新于 {HH:MM}」），不拉低整表级别；global 置 null 时区块显示占位「—」与小字「全球数据暂缺」，不显示 0。
- **时钟纪律**：fetchedAt 由 fetcher 写入（Worker 时钟），servedAt 由 Function 生成，两者同属 Cloudflare 平台时钟；前端展示时间一律以契约字段为准，禁止用浏览器本地时间推算 stale（用户设备时钟不可信）。若算得 staleAgeSec < −60s（异常时钟漂移），钳制为 0 并记 `CLOCK_SKEW` 日志。

#### 3. Cron 连续失败行为与探针可判读字段

行为定版（fetcher 侧）：

1. **永不覆写**：任何失败（网络、429、5xx、覆盖率 <94%、结构校验不过）一律不写 `v1:board:current`；最后成功 blob 即降级链的弹药，6h 内靠它逐级降级、6h 后由 Function 落快照。
2. **失败计数落盘**：每次 run 结束（含失败）更新 `v1:meta:health`（成功 run 顺带把完整 health 嵌进 blob meta，health 键主要承载「失败也在累积」的信息——因为失败时没有新 blob 可嵌）。health 写入失败不得反过来影响主流程（try/catch 吞掉并记日志，下一 run 再试）。
3. **N 次分级动作**（节奏 10min，N 与时间的换算写死在表内，防误读）：

| 连续失败 N | 约时长 | fetcher 行为 | 对外信号 |
|---|---|---|---|
| 1–2 | ≤20min | 照常下个 run 重试（5xx/超时每 run 额外即时重试 1 次；429 按 Retry-After 跳过 K 个 run，跳过的 run 不计入 N） | health.status=`degraded`；前端大概率仍 L0/L1，用户无感或弱提示 |
| 3–5 | 30–50min | 行为不变（Cron 节奏固定，不做指数退避——退避只会拉长恢复时间且额度成本为零等待）；若失败原因为覆盖率不足，记 missingIds 明细备查 | health.status=`failing`；前端进入 L2 后文案如实展示 |
| ≥6 | ≥1h | 仍不放弃、仍不覆写；在 health 置 `alert: true`（预留给未来告警通道消费，本期不新建告警系统，仅保证字段可判读） | health.status=`down`；探针据此判故障 |
| 任一成功 | — | consecutiveFailures 清零、status 回 `ok`、正常写 blob | 自动回升 L0 |

4. **探针设计**：不新建独立端点，探针 = 读 /api/board 契约中的 `freshness.*` + `fetch.*`（经 Function 组装，天然含 health 摘要），判读规则定版如下（外部探针/站长巡检脚本按此实现，三选二满足即判异常以避免单点误报）：
   - `freshness.consecutiveFailures ≥ 3`；
   - `staleAgeSec > 1,800`；
   - `fetch.upstreamStatus.markets` 最近值非 200 且 `consecutiveFailures ≥ 1`（此条单独不判异常，仅与前两条组合）。
   另在 health 键中提供机器可读全量：`{updatedAt, lastRunId, lastRunAt, lastSuccessAt, consecutiveFailures, lastError:{stage: "markets|global|validate|kv-put", code, message 截断 200 字}, lastUpstreamStatus, quota:{creditsUsedEst, quotaMode}, sourceState:{...W2-03}}`。**health 与 fetch 字段绝不包含任何 key/令牌片段**（验收 grep）。

### 实施步骤

1. 改 `shared/board-schema.js`（W2-01 步骤 3 同一文件）：blob 结构增加 `fetchMeta/global.asOf/health 摘要` 的生产与校验；`validateBlob()` 对缺 asOf 的旧 blob 给出兼容判定（灰度期容忍，G4 后移除容忍）。
2. 改 fetcher `workers/fetcher/src/index.js`：实现 health 键的读-改-写（run 开始读计数、结束写回）、N 次分级字段、429 跳过计数；global 抓取/沿用时正确维护 asOf 与 global.stale 原料（asOf 本身）。
3. 改 `functions/api/board.js`（与 W2-01 步骤 8 同一次改造）：组装契约 v2——新增 contractVersion/freshness/fetch 三组字段、global.asOf 透传、按 §2 表计算 level/mode/stale、servedFrom 标注（kv/cache/memory/snapshot 按实际命中层）、时钟钳制。
4. 改前端（站点主页面脚本，文件以仓库现状为准，施工时定位渲染 /api/board 的模块）：按 §2 文案表逐级映射——状态点颜色、四级横幅文案、global 区块改用 asOf 标注、L3 显示快照日期；保留旧字段读取作回退（契约只增不改，旧前端在新后端下不报错，反之亦然，灰度顺序因此可任意）。
5. 新建 `scripts/probe.mjs`：按 §3 判读规则拉 /api/board 输出 PASS/FAIL 与关键字段，供站长巡检与上线验收；不落任何调度（本期不建自动告警，符合「只在选定时间复核」的既定协作口径，字段备好即可）。
6. 文档：在仓库 README 契约章节落 v2 全文（含 §2 阈值表与文案表），标注 v1 字段废弃计划为「不废弃」（只增不改长期有效）。

### 验收标准

- [ ] 契约快照测试：对同一 blob，构造 age = 899s / 901s / 1,799s / 1,801s / 21,599s / 21,601s 六个时刻组装，level/mode/stale 与 §2 表逐格一致；无 blob 时落 L3。
- [ ] global 解耦：构造 markets 新、global asOf 为 2h 前的 blob，整表仍 L0、global.stale=true、global 非 null 且时间标注为 asOf；global asOf 为 7h 前时 global=null 且整表级别不受影响。
- [ ] 文案比对：四级文案与 §2 表逐字一致（含 L2 风险提示句、L3 快照日期取自快照元数据）；页面任何状态下不出现「实时」二字。
- [ ] 失败计数演练：staging 连续制造 3 次失败，health 中 consecutiveFailures=3、status=`failing`、lastError.stage 正确，且 current blob 字节与演练前完全一致（哈希比对）；随后一次成功自动清零。
- [ ] 探针：probe.mjs 在正常时输出 PASS；人为置 age>1,800s（停 Cron 35min 或 staging 注入旧 blob）后输出 FAIL 并指出命中规则。
- [ ] 安全：/api/board 响应与 health 相关输出 grep 无 `x-cg`、key 片段、令牌字段名。
- [ ] 兼容：旧版前端（git 上一版）对接 v2 后端渲染无报错（本地联调截图留档）。

### 工作量级

**S–M（1.5–2 天）**：以后端字段与状态机为主（1 天）、前端文案映射（0.5 天）、探针脚本与测试（0.5 天）。与 W2-01 步骤 3/8 有文件交叠，须在 W2-01 骨架就绪后串行施工，不可并行改同一文件。

### 成本

免费：无新增服务；health 键写入 ≤24 次/天 + 失败期每 run 1 次（最坏全天故障 144 次/天），与主 blob 合计仍远低于 KV 免费写上限 1,000/天。不引入告警 SaaS（字段预留，本期不消费）。

### 风险与回滚

| 风险 | 影响 | 缓解 | 回滚 |
|---|---|---|---|
| 前后端版本错位（先上后端 v2 / 先上前端文案） | 渲染异常 | 只增不改 + 前端旧字段回退，任意顺序可上（验收含旧前端联调） | 回滚任一端至上一部署 id 即可，不需两端同步回滚 |
| 阈值标定不当（如 L1 过敏频繁亮黄） | 用户信任损耗 | 阈值集中为 fetcher/Function 各一处常量（`FRESHNESS_THRESHOLDS`），上线首周按 health 数据复盘一次，调参只改常量单独提交 | 常量级回滚 |
| health 读-改-写在手动 /run 与 Cron 撞车时丢计数 | 探针偶发误判 | 单写入者原则下撞车概率极低；计数仅作判读参考、三选二规则容忍单点噪声 | 无需回滚，下一 run 自修正 |
| 快照日期元数据缺失致 L3 文案错误 | 事故时误导用户 | 步骤 4 要求 L3 文案日期取不到时降级为「离线快照」不带日期，并列入验收 | 前端单文件回滚 |

---

## W2-03 备用数据源 CoinPaprika 接入（抓取 Worker 层）

### 目标设计

#### 0. 条款复核与启用前置（2026-11-10 官方口径，本节为全包前置门）

来源：CoinPaprika 官方定价页 https://coinpaprika.com/api/pricing（2026-11-10 实际打开全文核查）及官网 API 页同日搜索结果，多源一致：

| 项 | 免费层（Free）当日口径 |
|---|---|
| 价格 / 密钥 | $0，无需 key、无需注册（`api.coinpaprika.com/v1`） |
| 额度 | 20,000 calls/月 **per IP**；速率 10 req/s per IP（全档统一）；超限返回 429 或 402 |
| 资产覆盖 | 仅 2,000 个资产（全库 61k+）；本表 200 币须逐一验证落在其中（§2 覆盖率门槛正源于此） |
| 刷新间隔 | 数据更新 within 10 min（付费自助档 3 min，Enterprise 1 min）——与定版 10 分钟抓取节奏恰好同频，抓更快无收益 |
| 计费模型 | 1 HTTP 请求 = 1 call，无 credits、无倍率 |
| 许可 | **Personal use only**；Starter $99/月起为 Internal commercial；**「向自己的用户展示 / 再分发」需 Enterprise（定制合同）**；付费自助档并不解除此限 |
| 署名 | **全档（含付费）均须展示「Powered by CoinPaprika」**（API 条款） |

**对策定版（按严格程度排序，施工顺序不可跳级）：**

1. **默认关闭**：`PAPRIKA_ENABLED=false` 为出厂值；代码合入、映射表备好、状态机就绪，但不实际对外供数。
2. **启用条件**：站长确认本站为个人非商业运营（无广告、无付费、无商业引流）并记录在仓库决策日志后，方可置 true——个人非商业公开访问与「Personal use」的边界仍属条款灰区，决策日志须同时记录「已知悉灰区、接受风险、故障期临时启用、恢复即回切」四点，禁止以「只是备用、量小」为由默认无风险。
3. **若本站转商业**：Paprika 备用链立即停用，降级链终点只剩静态快照；或向 Paprika 谈 Enterprise 授权后再议。**不采纳**「买 Starter $99 即可商用展示」的误读——官方口径已明确 Starter 仅内部商用。
4. 额度侧的附带风险：20,000/月按 **per IP** 计，而 Cloudflare Workers 出口 IP 为共享/轮换池——既可能与他人共享同一出口被连带限流，也可能轮换导致计数口径不可预测。此为不可控项，状态机按「Paprika 侧 429/402 视为该源不可用」处理（见 §3），不试图规避 per-IP 计数（任何规避手段均违反条款精神，禁止）。

#### 1. 接入点：抓取 Worker 层（定版）及理由

接入点唯一：`workers/fetcher/` 内新增 provider 适配器，与 CoinGecko 适配器并列；Pages Function 与前端**永不直连 Paprika**。理由：

- **整表切换的原子性只有单写入者能保证**：Function 层接入则每个 colo 独立判断、独立切换，同一时刻不同用户会看到不同源的数据，且单表内 A 源缺币用 B 源补齐的「拼盘」在 colo 粒度根本拦不住；Worker 层单点决策 → 单 blob 单 source，拼盘在结构上不可能（§4）。
- **额度与条款集中管控**：Paprika 的 per-IP 额度、署名切换、启用开关都只需在一处生效/审计；Function 层接入会把备用源调用量重新与访客数挂钩，重蹈 W2-01 要根治的覆辙。
- **归一化一次完成**：双源字段差异（§5）在 fetcher 内归一为同一内部行结构，下游（KV/Function/前端除署名外）对数据源无感知，切换无前端发版依赖（署名除外，§6 预埋）。

#### 2. id 映射方案（paprikaId）

Paprika id 形态为 `{symbol小写}-{name slug}`，如 `btc-bitcoin`、`eth-ethereum`（官方文档与示例，2026-11-10 核查）；与 CoinGecko id（如 `bitcoin`）不同构，必须显式映射，禁止运行时用 symbol 猜（同 symbol 多币必然错配）。

数据落点：`data/coins.json` 每币新增字段 `paprikaId`（字符串或 null），三份 coins.json 门禁（W2-01 步骤 6）自动覆盖；fetcher 只读此字段，映射缺失的币在 Paprika 模式下直接计入 missingIds。

生成与人工核定流程：

1. 新建 `scripts/gen-paprika-map.mjs`：拉 `GET /v1/coins`（1 call，返回全库元数据含 id/symbol/name/rank/is_active）与本地 200 币表做候选匹配，规则按优先级：① symbol 全等 + name 归一化（小写、去空格/连字符）全等 → 高置信候选；② symbol 全等 + name slug 与 CoinGecko id 后缀相似 → 中置信；③ 其余 → 无候选。产出待核定表 `paprika-map-review.csv`（币、CG id、候选 paprikaId、置信度、Paprika 侧 rank）。
2. 人工核定（站长或施工 agent 逐项过，**不可全自动采信**）：重点审同 symbol 多候选（如多链同名币、仿盘币）——以 Paprika 侧 rank 与市值量级、官网 slug 双重确认；每个币在审查表中勾选确认后，才把 paprikaId 写入 coins.json；拿不准的置 null 并记录原因，不猜。
3. 防错抽检：脚本再拉 `GET /v1/tickers`（1 call）按已写映射取价，与同日 CoinGecko 价做偏差抽检，单币偏差 >5% 的逐一复核映射是否错位（错位币价格量级往往差出数量级，此检极灵敏）；复核不过回步骤 2。
4. 维护规则：coins.json 每次增删币，deploy.sh 门禁新增检查「每币 paprikaId 非空或显式 null 且附原因注释位」；每季度或 Paprika 报错率上升时重跑步骤 3 抽检（Paprika id 理论稳定，但下线/改名币需清理）。

覆盖率门槛实测方法（启用前必须实测达标，非估算）：

- 实测脚本 `scripts/verify-paprika-coverage.mjs`：单次 `GET /v1/tickers?quotes=USD`（1 call 返回其前 2,000 资产全量 tickers）→ 本地按 200 个 paprikaId 交集计数 → 输出命中数、缺失清单、每币 `last_updated` 新鲜度、与 CoinGecko 同刻价差分布。
- **门槛：命中 ≥197/200（98.5%）且缺失币均有书面归因（如已下线、免费层 2,000 外）**，才允许 `PAPRIKA_ENABLED=true`；195–196 命中为黄区，须站长知情确认；<195 禁止启用，备用链维持快照。此门槛严于整表发布门禁 94%：因为切换后 Paprika 即唯一源，映射缺口是系统性（永久缺）的而非抖动性的。
- 实测节奏：启用前连续 3 天各跑 1 次（共 3 calls），三日均达标才算过；结果存 `docs/paprika-coverage-<日期>.md` 留档。

#### 3. 整表熔断切换状态机（沿用一期 §2.2 口径，按 Cron 节奏重标定）

一期 §2.2 口径锚点（保留）：失败判定须含覆盖率维度而非仅 HTTP 状态；切换须整表；回切须迟滞防抖。本期把「请求次数」参数全部换算为「Cron run 数 / 时间」（节奏 10min）：

状态与迁移（状态存 `v1:config:source-state`，fetcher 每 run 读-判-写；`activeProvider` 决定本 run 抓谁）：

| 状态 | 含义 | 迁移条件 |
|---|---|---|
| `CG_PRIMARY` | 正常态，只抓 CG | CG 出现 run 级失败（定义见下）累计达阈值 → `CG_DEGRADED` 计数；直接触发条件命中 → `PAPRIKA_ACTIVE` |
| `CG_DEGRADED` | CG 连续失败计数中（1–2 个 run），仍只抓 CG、不预抓 Paprika（省额度、且 L0/L1 链有 30min 容忍窗） | 下一 run 成功 → 回 `CG_PRIMARY` 清零；连续失败达 **3 个 run（约 30min）** → 切 `PAPRIKA_ACTIVE` |
| `PAPRIKA_ACTIVE` | 整表抓 Paprika 写 blob（source=`coinpaprika`）；CG 转入探针模式 | 静默期 + 回切条件全满足 → `CG_PRIMARY`；Paprika 自身连续失败时不写 blob，走 W2-02 降级链（无第三源可切，禁止切回已判故障的 CG 除非探针已连续成功） |
| `BOTH_DOWN`（逻辑态，不单独落状态值） | Paprika 连续失败 ≥3 run 且 CG 探针未恢复 | 表现为 source-state 仍 `PAPRIKA_ACTIVE` + health.status=`down`；任一侧探针/抓取成功即按各自规则恢复 |

参数定版：

- **run 级失败定义**（任一）：HTTP 非 200（含 429/5xx）；或 markets 覆盖率 <94%；或结构校验不过；或超时（单端点 10s）。429 带 Retry-After >30min 的，**不等 3 个 run，直接切**（继续撞限流只会延长故障）。
- **切换阈值**：CG 连续 run 级失败 **3 次 ≈ 30 分钟**（对齐 L1 上限：用户开始强感知前完成切换）。另加额度触发：health 中 quotaMode=`critical`（W2-01，预计耗尽）时直接切 Paprika（若已启用）以保命脉。
- **静默期（最小驻留）**：切入 `PAPRIKA_ACTIVE` 后 **60 分钟（6 个 run）内禁止回切**，探针照跑但结果只累积不触发迁移，防临界抖动来回翻。
- **CG 探针**：Paprika 态下每 **30 分钟**（每第 3 个 run）以 markets 单端点探 CG 1 次（1 credit；满月最坏 1,440 credits，已在 W2-01 预算中预留借支规则）；global 不探（回切后首个正常 run 自然补抓）。
- **回切迟滞**：静默期已过 **且** CG 探针连续成功 **3 次**（跨度 ≥60min，加上静默期，回切最早发生在切入后约 2h）**且** 探针次覆盖率 ≥98%（严于 94% 发布门禁：要证明 CG 不只是活了、而是全了）→ 回 `CG_PRIMARY`，清零计数，回切后首个 CG run 成功写 blob 才算恢复完成（该 run 若失败，直接回 `PAPRIKA_ACTIVE` 且静默期减半为 30min——刚回切即失败说明探针成功为假象）。
- **Paprika 侧失败判定**：同 run 级失败定义（tickers 单调用覆盖率 = 命中映射数/200 <94% 即失败）；Paprika 额度型错误（402/429 且提示月额度）直接判该源当月不可用，状态机锁定 Paprika 至次月或人工解除（health 置 `paprikaQuotaExhausted: true`），避免每 run 空撞。
- **人工覆盖**：`BOARD_SOURCE` 环境变量三值——`auto`（状态机）/`coingecko`（强制 CG，状态机只记账不迁移）/`coinpaprika`（强制 Paprika，仍受 §0 启用前置约束：PAPRIKA_ENABLED=false 时此值无效并告警日志）。人工切换走改变量重新部署 fetcher，是有意保留的摩擦（防误触）。

#### 4. 「永不拼盘」执行约束（结构性保证，非君子协定）

1. blob 只有一个 `source` 字段、一组 `rows`；构建函数签名定版为 `buildBlob(providerResult)`，入参只能是**单一** provider 适配器的单次完整结果，类型上不存在合并两个结果的入口。
2. 写前断言：`rows` 每行内部字段 `_src` 必须全等于 blob.source 且 fetchRunId 全同——fetcher 内部保留 `_src` 仅作断言、组装对外 rows 时剥除；断言不过抛错、不写 KV、记 health。施工交付时须含一条单元测试：人为构造混合结果喂 buildBlob，必须被拒。
3. Function 与前端**不做任何缺币补齐**：missingIds 就如实上报、前端如实留空/标缺，禁止从另一源、内存旧值或快照中抠单币填入当前表（内存/快照只能**整表**顶替，即 W2-02 的 servedFrom 切换，粒度永远是整表）。
4. global 同理：global 段与 rows 必须同源同 run 家族——Paprika 态下 global 抓失败时沿用**上一 Paprika blob** 的 global（同源旧值），严禁用 CG 的 global 拼接；跨源沿用视为拼盘，同罪。

#### 5. 字段映射与数据口径差（归一化层）

| 内部字段 | CoinGecko /coins/markets + /global | CoinPaprika /v1/tickers + /v1/global |
|---|---|---|
| 价格 | `current_price` | `quotes.USD.price` |
| 市值 / 排名 | `market_cap` / `market_cap_rank` | `quotes.USD.market_cap` / `rank` |
| 24h 量 / 涨跌 | `total_volume` / `price_change_percentage_24h` | `quotes.USD.volume_24h` / `quotes.USD.percent_change_24h` |
| 流通量 | `circulating_supply` | `circulating_supply` |
| 数据时刻 | 响应级（run 时刻） | 每币 `last_updated`（取全表最新值作 asOf 参考） |
| global | `data.total_market_cap.usd` 等 | `market_cap_usd`、`volume_24h_usd`、`bitcoin_dominance` |

口径差须知（写入 README，前端无感但排障必备）：两源聚合交易所集合与加权方法不同，同一币价差常态 0.1%–1%、小币更大；切换日用户会看到全表价格「跳变」一次，属源切换的固有现象，W2-02 文案之外，Paprika 态额外在来源行标注「备用数据源，口径略有差异」（§6）。CG 独有而 Paprika 无对应或口径不同的字段（如 sparkline、ath 相关）一律置 null 并由前端既有空值逻辑隐藏，**禁止用旧源残值填充**（与 §4 互为表里）。

工程风险提示（实测门）：Paprika `/v1/tickers` 一次返回前 2,000 资产全量，载荷约数 MB，免费 Workers 单次 CPU 10ms（不含网络等待）下 JSON 解析+过滤 200 条存在超限可能。定版路径：fetcher 内流式/分块解析或先 `JSON.parse` 后 Map 查映射（O(n) 单遍），并在灰度期实测 CPU 与耗时；若实测超限，依次升级缓解：① 仅解析必要字段的轻量扫描实现；② 仍不过则 Paprika 态抓取节奏降为 20min（载荷不变、均摊不降 CPU，此条无效须划掉——正解只有③）；③ Workers Paid $5/月（CPU 升至 30s 默认）——**此为本工作包唯一可能付费点**，以实测报告为立项依据，未实测不得预先购买。此风险不阻塞 CG 主链上线（Paprika 默认关闭）。

#### 6. 署名前端配合点

- 前端页脚来源行由契约 `source` 驱动（预埋三态，W2-02 施工时一并交付，避免切源当天改前端）：
  - `coingecko` → 「数据来源：CoinGecko」（沿用现状）；
  - `coinpaprika` → 「**Powered by CoinPaprika**」（条款原文措辞，逐字使用）+ 小字「备用数据源，口径略有差异」；
  - `snapshot` → 「离线快照 · 数据来源见快照日期说明」。
- 链接：两源署名各链其官网（具体 URL 施工时从两站官网页脚复制，不臆测）；切换由前端读字段自动完成，不发版。
- 注意 CoinGecko Demo 档同样要求署名（Attribution required，定价页口径）——现状来源行须在 W2-02 验收时一并确认合规存在，缺失则补。

### 实施步骤

1. 条款门：站长就 §0 对策 2 出确认（或明确暂不启用，仅备代码）；结论记入仓库 `docs/decisions/` 决策日志。未确认前步骤 2–6 照常施工，`PAPRIKA_ENABLED` 保持 false。
2. 生成映射：新建并运行 `scripts/gen-paprika-map.mjs` 产出审查表 → 人工核定（§2 步骤 2）→ 写入 `data/coins.json` 的 `paprikaId` → 跑偏差抽检（§2 步骤 3）→ 三份 coins.json 同步过门禁。
3. 覆盖率实测：新建 `scripts/verify-paprika-coverage.mjs`，连续 3 天实测留档，达 ≥197/200 门槛（§2）。
4. fetcher 内新建 `workers/fetcher/src/providers/coinpaprika.js`：实现 `fetchMarkets()`（GET /v1/tickers?quotes=USD → 按映射过滤 → 归一化行）、`fetchGlobal()`（GET /v1/global → 归一化 + asOf），超时/状态码/402-429 分类按 §3 失败定义回报；与既有 coingecko.js 适配器同接口（W2-01 施工时若未抽适配器接口，本步先抽接口再加实现，保证 buildBlob 单入口）。
5. 状态机：在 fetcher 主流程接入 `v1:config:source-state` 读写与 §3 全部参数（参数集中为常量对象 `SOURCE_SWITCH`：failThreshold=3、cooldownMin=60、probeEveryRuns=3、probeSuccessNeeded=3、probeCoverageMin=0.98、publishCoverageMin=0.94）；实现人工覆盖变量与 Paprika 额度锁定字段；buildBlob 断言与单元测试（§4.2）。
6. 前端署名三态（与 W2-02 步骤 4 同批）：来源行读 source 切换文案与链接，Paprika 态显示口径差异小字。
7. 演练（staging 或生产低峰手动触发）：置 `BOARD_SOURCE=coinpaprika` 强制跑 3 个 run 验证整表切换、署名、global 同源；再模拟 CG 连续失败走自动切换与回切全流程（可缩短常量加速演练，演练后恢复定版常量并单独提交确认）；演练全程抓 /api/board 契约存档。
8. 启用决策复核：三项材料齐备（决策日志、覆盖率三日报、演练存档）后，由站长置 `PAPRIKA_ENABLED=true`（改 fetcher 变量重新部署）；未齐备则维持关闭，备用链终点为快照——此状态不算施工未完成，算「备而不用」交付。

### 验收标准

- [ ] 映射质量：coins.json 中 paprikaId 非空率 ≥197/200；抽检 20 币（含全部同 symbol 多候选币）人工复核映射正确率 100%；价格偏差抽检 >5% 的币均有复核结论留档。
- [ ] 覆盖率：verify 脚本连续 3 天输出命中 ≥197/200，报告文件留档于 docs/。
- [ ] 整表性：强制 Paprika 模式下连续 3 个 blob 的 source 均为 coinpaprika、rows 的 `_src` 断言零失败、global 与 rows 同源；混合结果单元测试被 buildBlob 拒绝（测试输出留档）。
- [ ] 状态机演练：CG 人为连败 3 run 后自动切 Paprika（以 source-state 与 blob.source 变化为据，时间误差 ≤1 个 run）；静默期内 CG 探针成功不回切；满足连续 3 探针成功 + 覆盖率 ≥98% 后回切；回切首 run 失败能再次切回且静默期为 30min。
- [ ] 永不拼盘抽查：任取 Paprika 态 blob，逐币与同刻 Paprika 原始 tickers 比对一致、与 CG 值不一致属正常口径差；missingIds 中的币在表中为空缺而非被 CG 值填充。
- [ ] 署名：三种 source 下页脚文案逐字正确（尤其「Powered by CoinPaprika」），链接可达；PAPRIKA_ENABLED=false 时强制变量无法启用 Paprika 且日志有告警。
- [ ] 额度：Paprika 演练期调用数可计数（tickers+global 每 run 2 calls）；按 10min 节奏满月推算 ≤8,640 calls < 20,000 上限（per-IP 口径风险已在 health 中以 429/402 观测字段留痕）。
- [ ] CPU 实测：Paprika 单 run 的 fetcher CPU 时间与耗时记录在演练报告中；若超免费层限值，报告给出 Paid 立项建议与实测数据（不预先购买）。

### 工作量级

**M（3–5 天）**：映射生成+人工核定 1 天（核定为细活不可压缩）、适配器 1 天、状态机与断言 1 天、演练与留档 1 天、前端署名 0.5 天。其中条款确认与覆盖率 3 日实测为日历等待，不计投入。

### 成本

免费（默认路径）：Paprika 免费层 $0、无 key；调用量满月推算 8,640 < 20,000。明确不买：Starter $99/月——其许可仅「内部商用」，对本站公开展示场景不解除授权问题，花钱不解决问题（官方口径见 §0）；Enterprise 为定制报价，仅在转商业且仍要用 Paprika 时另行立项。条件付费：Workers Paid $5/月仅当 §5 的 CPU 实测超限时立项，附实测数据再决策。

### 风险与回滚

| 风险 | 影响 | 缓解 | 回滚 |
|---|---|---|---|
| 条款灰区（个人非商业公开展示） | 合规风险，极端情形被要求停用 | §0 四点对策：默认关闭、书面确认、故障期临时用、转商业即停 | 置 `PAPRIKA_ENABLED=false` 重新部署 fetcher 即时停用（≤1 次部署），已展示数据无需追溯处理 |
| per-IP 额度被共享出口连带消耗/轮换不可控 | Paprika 态下突发 429/402 | 失败定义含 402、额度锁定字段防空撞；W2-02 降级链托底至快照 | 状态机自动落 BOTH_DOWN 表现，快照兜底；人工置 BOARD_SOURCE=coingecko 待 CG 恢复 |
| 映射错位（同 symbol 仿盘） | 个别币价格离谱，伤可信度 | 人工核定 + >5% 偏差抽检 + 覆盖率门实测三重门 | 单币 paprikaId 置 null 重新部署（该币在 Paprika 态计 missing，整表不切走） |
| tickers 大载荷解析超 CPU | Paprika run 失败 | §5 实测门与缓解阶梯；失败即计 run 级失败，不写坏 blob | Paprika 保持关闭不影响主链；已启用时状态机按 BOTH_DOWN 托底 |
| 双源来回抖动（CG 临界故障） | 用户见价格反复跳变 | 静默期 60min + 探针三连胜 + 回切首败惩罚（静默期减半规则防假恢复） | 人工 `BOARD_SOURCE` 锁定一侧止抖，事后复盘常量 |

---

## 附：本章对一期设计的调整汇总（索引，正文见各节）

| # | 一期设想 | 二期定版 | 理由 |
|---|---|---|---|
| 1 | 分钟级（2–5min）刷新新鲜度 | markets 10min / global 30min | flat 计费下 5min 节奏占额度 93.6%–100.8%，无重试/灰度余量（W2-01 表 C/D） |
| 2 | Cache API 为挡上游额度的主防线 | Cache API 改挡 KV 读，缓存对象为原始 blob、信封逐请求重算 | 额度防线已前移至 Cron 唯一抓取；缓存成品 JSON 会冻结 staleAge 造成文案错误（W2-01 §6） |
| 3 | KV 多键分存（markets/global 分离）可能设想 | 单 blob 单键 + health/状态小键 | KV 免费写 1,000/天约束 + 原子可见（W2-01 §3） |
| 4 | Paprika 免费层可直接作公开备用源 | 默认关闭，站长确认个人非商业后才可启用；付费 Starter 亦不解公开展示授权 | 2026-11-10 官方定价页：免费层 Personal only、展示/再分发需 Enterprise（W2-03 §0） |
| 5 | 熔断参数以请求次数计（一期 §2.2） | 全部重标定为 Cron run 数/时间（3 run≈30min 切、60min 静默、探针三连胜回切） | 决策点已由每请求变为每 run（W2-03 §3） |
| 6 | global 与行情共用 updatedAt 表达时间 | 新增 global.asOf 独立标注、独立 stale 判定 | 两端点分频后时间天然不同，混用即误导（W2-02 §1） |

*外部事实来源（均 2026-11-10 核查）：CoinGecko 官方站 coingecko.com/en/api（FAQ「1 call = 1 credit」）与定价口径、CoinGecko 官方对比文（flat 模型、失败不扣 credit）；CoinPaprika 官方定价页 coinpaprika.com/api/pricing（全文打开核查）与官方文档（id 形态、/v1/tickers、/v1/global）；Cloudflare 官方文档口径（KV 最终一致 60s+、cacheTtl 默认 60s、KV 免费层读 100k/天写 1k/天、Cron 免费含 5 条/账户）。*


---

# 第三章 · 产品 / UX / 性能（W2-04 ～ W2-09）

# 第二期 · 产品/UX 与前端性能工作包（W2-04 ～ W2-09）

> 对象：`public/index.html`（单文件，19,549 B，CSS/JS 全内联、零外链）+ 数据 `public/data/coins.json`（200 币 × 23 字段，132,049 B，gzip ≈23.5 KB）；站 https://top200.oppcal.com 。
> 性质：只做设计、细化到可直接施工；本文所有现状数字均于 2026-11-10 通读现行 `index.html`（266 行）与 `functions/api/board.js` 后实测/逐行核对，不是沿用一期旧数。
> 红线（全包共同）：Watchlist 只用 localStorage、不做云同步、不做持仓/成本录入；不引入框架/构建链；不做虚拟滚动；单文件形态优先（内联总量 >50–80 KB 才考虑拆分；本期全部增量合计预估 +6～9 KB，远低于阈值，**不拆分**）。

## 0. 结论先行（对一期设计的 7 处调整，理由详见各包）

1. **排序控件二选一已定：表头点击排序胜出，下拉 `sortSel` 整体删除**（W2-05）。一期只写了"二选一"未定案；二期定案依据是工具栏在本期还要新增计数行与"只看自选"开关，移动端横向空间不够养两个排序控件，且双控件必然出现状态不同步（下拉说按倍数、表头 `aria-sort` 说按市值）。删除时必须同步删 `applyBoardState()` 里对 `optMult/optMcap/optPrice` 的三处写操作，否则元素不存在会抛错中断 `render()`——这是本包最容易踩的施工坑，写进实施步骤第 1 条。
2. **ATH 标记从"展开区的一部分"拆为独立先行项 W2-04a**（W2-04）。一期把它放在 §1.4 展开区里整体 M；实测分布已变：200 币中 verified 95 / approx 69 / unverified 36（**105 币、52.5% 需要标记**，一期 158 币口径是 94 币），且方法论文案已经承诺了 † 却未输出，属正在发生的呈现违约，与展开区这种体验增强不是一个优先级。04a 只有"ATH 单元格渲染 + 图例"两处改动，量级 S，随第一批先行上线止血；展开区 04b 随后。
3. **中文别名不进 coins.json，改为 index.html 内联 `ALIASES` 表（按 `coingeckoId` 键）**（W2-05）。一期写"币种加中文别名字段"默认进数据管线；二期改判：别名是前端呈现资产、不是研究数据，进 coins.json 会污染生成管线校验与单一事实源，且每次改别名都要走数据发布流程。内联 30 条约 +1.2 KB，代价可接受；代价是别名表与币种名单的对应关系靠人工纪律维护，缓解办法写在包内（以 id 为键、币下线时别名成孤儿也无害、季度随名单复核一并核）。
4. **倍数视觉分层的阈值口径改为"当前显示倍数的中点"，并明示两个极端层在快照口径下近乎为空**（W2-09）。实测快照倍数中点分布：≥10× 仅 1 币（FIL 10.8×）、8–10× 16 币、5–8× 95 币、3–5× 68 币、最低 1.5×、中点 <1× 为 0、高端 `multHi<1` 亦为 0。若不说明，施工与验收都会误判"图层没生效"。两层是为 **live 模式**准备的：现价跌深则倍数中点可冲过 10×，现价涨过预估中点则跌入 <1×（语义是"现价已高于 2029 预估中点"，是强风险信号）。图例必须写明图层跟随当前显示口径（实时/缓存/快照与状态机一致）。
5. **P2-8「首屏直出前 20 行」明确归 W2-17 静态注入一并处理，W2-08 只保留条件触发判定，不在本期写任何直出行代码**（W2-08 给出触发阈值与判定责任人）。理由：直出需要生成步骤，与"无构建链"红线冲突；在 W2-08 里手写 20 行静态 HTML 会制造与 coins.json 双源分叉，且静态行还要承载星标/展开/hash 高亮等后续状态，返工面比收益大。先用分页 + 瘦身 + 派生缓存把能拿的收益拿完，实测仍不达标再触发。
6. **JSON 瘦身 ≤65 KB 目标：仅裁 `*Raw` 达不到，须如实分账**（W2-08）。实测：现文件 132,049 B 含大量格式化空白，紧凑序列化后 ≈106.0 KB；再删两个 `*Raw` 字段 ≈93.6 KB（gzip ≈19.9 KB）；距 ≤65 KB 还差约 28 KB，必须靠生成管线做短键名/位置数组编码才能达标——那是管线包的活，前端在本包只交付"双形态解码器"配合点。另注意 `*Raw` 不是纯冗余：WFI 的 `snapshotMcapRaw="未披露"`、`impliedMcapRaw="未披露"` 承载了数值字段为 null 的语义，裁剪前必须先定好 null 的前端呈现约定（见 W2-08 步骤），否则瘦身会把"未披露"误显成"—"。
7. **渲染地基先行：W2-08 的派生缓存 + `rowHTML()` 拆分必须排在 W2-05/04b/06 之前施工**（见文末合并顺序）。现 `render()` 是一个 200 行全量 `innerHTML` 拼接函数，五个包都要改它；若各包各自改，冲突与回归不可控。先由 W2-08 把"每币派生值预计算 + 单行模板函数化"落地，后续包只往行模板里加自己的单元格/按钮。

### 0.1 前端消费形状速查（施工前必读，以现行代码为准）

- 静态数据 `fetch("data/coins.json")` → `data.coins[]`，每币 23 字段：`table（全为 "A"，前端从未消费）/ estRank / rankNow（6 币为 null）/ rankNote（7 条非 null）/ name / symbol（200 个互不重复，已验）/ coingeckoId（互不重复）/ snapshotPrice / snapshotMcapUsd（仅 WFI 为 null）/ snapshotMcapRaw / athPrice（36 币为 null，与 unverified 完全重合）/ athDate（35 币为 null；HTX 例外：有日期 2024-12-03、无价格）/ athFlag（verified 95 / approx 69 / unverified 36）/ estLo / estHi / multLo / multHi（快照倍数，前端目前未消费）/ impliedMcapLoUsd / impliedMcapHiUsd（仅 WFI 为 null）/ impliedMcapRaw / confidence（高 4 / 中 39 / 低 157）/ reason（平均 30 字、最长 87 字）/ dataDate（2026-11-08 共 139 币、2026-11-10 共 61 币）`。
- 实时数据 `fetch("/api/board")` → `BOARD = { mode: live|stale|snapshot, updatedAt（毫秒 epoch 数值）, servedAt, stale, staleAgeSec, coverage{expected,returned,missingIds}, global{totalMcapUsd,btcDominance,totalMcapChange24h}|null, coins: { [coingeckoId]: {price,mcapUsd,rank,change24h} }, snapshotDate, count }`。前端经 `live(c)` 按 `coingeckoId` 取单币，`effPrice/effMcap` 在缺失时回退快照值，`liveMult(c)` 用有效价格现算倍数区间与中点。**本期六个包均不得改变这份契约**；新功能需要的值（距 ATH 跌幅、倍数中点等）一律在前端由既有字段派生。
- 现行 `render()` 行为：每次调用依次 `applyBoardState()`（三态文案/列题/统计卡）→ `computeLiveRanks()`（比较器内反复调用 `liveMult()` 做除法与对象分配）→ 按搜索子串（仅 name/symbol 小写 `includes`）+ 置信度过滤 → 4 种下拉排序之一 → `tbody.innerHTML` 全量重建（桌面 12 列 × 200 行）。`$("q").oninput = render` 无防抖。初始 HTML 默认快照口径，`init()` 先拉 coins 渲染、再异步 `loadBoard()` 覆盖——这个"先静态后实时"的两段式对 LCP 友好，本期保留不动。

---

## W2-04 行展开详情 + ATH 可信度标记

### 目标设计

拆为两个可独立上线的子项：

**W2-04a ATH 可信度标记（先行止血，量级 S）**

渲染规则（写死，作用于 ATH 单元格与展开区 ATH 行，两处一致）：

| `athFlag` | 数量 | ATH 单元格显示 | 无障碍文本 |
|---|---|---|---|
| `verified` | 95 | `fmtPrice(athPrice)` + 日期小字（现状不变） | 无附加 |
| `approx` | 69 | 价格后上标 `†`，如 `4.85†`，日期照常 | `title="聚合口径约值"`，上标元素带 `aria-label="约值"`，读屏读作"约值" |
| `unverified` | 36 | **不再显示"—"**：显示文字徽标 `未核实`（`.badge` 变体，灰底描边）；这 36 币 `athPrice` 全部为 null，本就无价格可显。HTX 特例（有 `athDate` 无价格）：显示 `未核实` + 日期小字，不臆造价格 | 徽标自带文字，无需附加 |

图例（新增，缺一不可两处）：
- 表格下方、方法论上方加一行图例：`† 聚合口径约值，不作估算主锚；「未核实」= ATH 未经可靠来源核实，表中不显示数值。`图例带 `id="athLegend"`，方法论文案中原有"ATH 带 † / 约值者为聚合口径约数"一句改为与图例同文并锚链到图例——上线后文案承诺与实现一致，呈现违约关闭。
- 展开区 ATH 行内重复短图例（用户可能不滚动到表尾）。

**W2-04b 行展开详情（量级 M，依赖 W2-08 派生缓存先行）**

展开区字段清单（每项注明来源字段、格式、null 处理；全部取自既有 coins.json / BOARD，不新增接口）：

| # | 展开区条目 | 来源 | 格式与 null 处理 |
|---|---|---|---|
| 1 | 隐含市值区间（2029 预估价 × 稀释后流通量） | `impliedMcapLoUsd/HiUsd` | `fmtMcap(lo) – fmtMcap(hi)`；双 null（仅 WFI）显示 `未披露` |
| 2 | 快照价 + 快照市值 | `snapshotPrice` / `snapshotMcapUsd` + `dataDate` | 价 `fmtPrice`，市值 `fmtMcap`；市值 null（仅 WFI）显示 `未披露`；标题带该币自己的基准日：`快照（2026-11-08）` 或 `核验（2026-11-10）`，按 `dataDate` 逐币渲染，不得写死全表同一天 |
| 3 | 快照倍数 | `multLo/multHi`（前端首次消费） | `lo–hi×`，与当前实时/缓存倍数并排时标注口径，避免用户把两个倍数混读 |
| 4 | 报告现排名说明 | `rankNow` + `rankNote` | `rankNow` 非 null 显示数字；为 null 的 6 币（ARB/JUP/AERO/WLFI/PI/SKY）显示 `rankNote` 原文（如"—（CMC口径55）"）；M 特例（`rankNow=51` 且有 note）显示 `51（注：51（CMC口径44））` 嫌重复，定为正文显 `51`、注以小字另行显 `rankNote` 原文 |
| 5 | ATH 全信息 | `athPrice/athDate/athFlag` | 按 04a 规则 + 可信度文字：`已核实 / 约值（聚合口径）/ 未核实` 三档全称 |
| 6 | 2029 预估区间 | `estLo/estHi` | 与主表同值，移动端展开区是其第二落点（主表已有，桌面冗余展示可接受） |
| 7 | 完整核心依据 | `reason` | 全文不截断（主表桌面列已显全文、移动端主表隐藏此列，展开区是移动端唯一落点） |
| 8 | 置信度 | `confidence` | 全称 + W2-09 的非颜色标记（"低 · 谨慎"） |
| 9 | CoinGecko 个币页 | `coingeckoId` | 外链 `https://www.coingecko.com/en/coins/` + `coingeckoId` 拼接（id 即个币页 slug，如 `filecoin`），文案 `在 CoinGecko 查看 {symbol} ↗`，`target="_blank" rel="noopener"`（与页脚既有外链同规格） |

实现方式（定案）：
- **同行下详情行**，不用模板复用/全局详情面板：主行后插入 `<tr class="detail-row"><td colspan="12">…</td></tr>`（`colspan` 取桌面列数 12；移动端隐藏列是 `display:none` 的单元格，`colspan` 仍按 DOM 列数计，不需按断点改）。不用 `<template>` 元素另建一套（单文件、200 行规模下收益为负）；详情 HTML 由单一函数 `detailHTML(c)` 按需生成。
- 展开触发：币种单元格内、币名前放一个独立小按钮 `<button class="exp" aria-expanded="false" aria-controls="d-{coingeckoId}">▸</button>`，与 W2-06 的星标按钮并列但**互不嵌套、互不冒泡触发**。整行点击展开**不做**（与星标、外链、文本选择全面冲突）。
- **展开不触发整表重绘的技术要点**：① 展开状态存 `Set expandedIds`（存 `coingeckoId`，不用行号/下标，排序后不错位）；② 切换处理函数只做三件事——增删该主行后的兄弟详情行、翻转该按钮 `aria-expanded` 与 ▸/▾、更新 `expandedIds`，**绝不调用 `render()`**；③ `render()` 重绘时（如刷新行情、改筛选）遍历结果集，对 `expandedIds` 命中的行在生成时连带输出详情行，使展开态跨重绘存活；详情内含的快照类字段为静态值，含"当前倍数"类动态值时随本次 `render()` 的派生缓存取值，重绘即更新，不单独维护；④ 详情行生成走字符串拼接并入同一次 `innerHTML`，不逐行 `appendChild` 造成多次布局。
- 移动端：详情行内容单列纵排（定义列表 `<dl>` 网格，桌面两列、≤640px 一列）；主表移动端隐藏的"核心依据/ATH/报告排名"在详情区完整可达，关闭 P0 移动端裁剪留下的信息缺口。

键盘可达性：
- 展开按钮是原生 `<button>`，Tab 可达，Enter/Space 切换，焦点全程留在按钮上（不自动跳入详情区）；收起后焦点不丢失（详情行是兄弟节点，删除它不影响按钮焦点）。
- 详情行内仅 CoinGecko 外链可 Tab；收起状态详情行 `display:none`，其内链接自动退出 Tab 序，无需 `tabindex` 管理。
- Esc 收起：按钮或详情区内按 Esc 时收起并把焦点送回按钮（增强项，列入验收但允许降级为仅按钮处 Esc 生效）。
- `:focus-visible` 焦点环样式归 W2-09 统一提供，本包只保证用原生可聚焦元素、不自绘 div 按钮。

### 实施步骤

04a（独立提交、独立发版）：
1. ATH 单元格渲染函数抽小函数 `athCellHTML(c)`：按上表三档分支；`approx` 输出上标元素，`unverified` 输出文字徽标（HTX 分支：徽标 + 日期）。
2. 表尾加图例行；方法论原句改为锚链图例的同文表述。
3. CSS 新增 `.ath-flag`（上标，`--dim` 色、不断行）与 `.badge.unverified` 两个小类，合计 <0.4 KB。

04b（在 W2-08 地基之后施工）：
4. 定义 `expandedIds:Set` 与 `detailHTML(c)`（按字段清单表逐项拼 `<dl>`；所有文本走既有 `esc()`）。
5. `rowHTML(c)`（W2-08 已拆出）币种单元格加展开按钮；`render()` 输出时对已展开币连带输出详情行。
6. 事件委托：在 `tbody` 上挂一个 `click` 委托处理展开按钮（不用 200 个内联 `onclick`），按 `data-exp` 属性取 id 后调切换函数。
7. CSS：`.detail-row td` 背景 `--chip`、内边距、`<dl>` 网格；展开/收起无动画（或仅在 W2-09 `prefers-reduced-motion` 约束下加 ≤150ms 高度无关的淡入，默认不加）。

### 验收标准

- 04a：全表逐币核对——69 个 approx 币 ATH 带 †、36 个 unverified 币显"未核实"徽标（HTX 带日期）、95 个 verified 无标记；图例存在且方法论文案与实现一致；快照/实时两种模式下标记都在（ATH 是静态字段，与行情模式无关）。
- 04b：随机抽 10 币（含 WFI、ARB、M 三个特例币）逐项核对展开区与 coins.json 原值一致，null 呈现符合清单表；展开/收起任意行时其余行 DOM 不重建（用 DevTools 节点计数或给相邻行打标记验证）；排序/筛选/刷新行情后已展开币保持展开且内容口径更新；键盘全程可展开/收起且焦点可见、不丢失；375px 下详情区单列无横滚，移动端可读到完整 reason。

### 工作量级

04a：**S**（约半天）；04b：**M**（2–3 天，含特例币核对与无障碍走查）。合计 M。

### 成本

0 元。无新增请求、无新增资源。

### 风险与回滚

- 风险：`colspan` 在后续若增删主表列（如 W2-06 星标不新增列、W2-05 不增列，已确认均不改列数）会静默错位——在 `detailHTML` 注释中写死"colspan 须与主表列数同步，当前 12"并列入文末冲突提示。详情行字符串拼接若漏 `esc()` 会引入 XSS 面（reason/rankNote 均为站内数据，风险低但纪律不变：全字段走 `esc()`，外链 URL 只拼白名单来源的 `coingeckoId` 且经 `esc()`）。
- 回滚：04a/04b 各自独立提交；04b 出问题单独回退其提交，04a 标记不受影响（两者只共用 ATH 单元格小函数，回退 04b 时保留该函数）。

---

## W2-05 表格交互三件套（表头排序 / 中文名搜索 / 计数与空状态）

### 目标设计

**① 表头点击排序（定案：删下拉，只留表头）**

取舍理由（结论）：二选一选表头。下拉的唯一优势是移动端不占横向空间，但本期移动端只显 6 列、其中 4 列可排序，表头按钮在 375px 下可点（字号 13px、点击域靠 `padding` 保 ≥36px 高，表头行高本就受 sticky 布局约束，此为已知妥协，验收含真机点按）；而双控件并存必然双状态源，P0 刚用"标注强绑定"治过同类病，不再引入。删下拉还给工具栏腾出 W2-06 开关的位置。

排序规格：
- 状态单一源：`sortState = { key, dir }`，默认 `{ key:"rank", dir:"asc" }`（等价现行"报告预估排名"默认视图的实际呈现：live 态按实时排名、快照态按 `estRank`——沿用现行第一列显示口径，即排序键 `rank` 映射到当前显示的排名值，不新造概念）。
- 可排序列（6 个，其余列不可点、不加按钮样式）：预估排名 `rank`（asc 默认）、现价 `price`（desc 默认）、24h `change24h`（desc 默认）、市值 `mcap`（desc 默认）、距 ATH 跌幅 `athDrop`（**新派生**，asc 默认即"跌得最深在前"，公式 `(effPrice-athPrice)/athPrice`，结果为负百分比；`athPrice` 为 null 的 36 币显示 `—`；**距 ATH 不新增主表列**——主表 ATH 列旁不另起列，跌幅在展开区与排序结果中体现？此处定案：**新增一列会击穿移动端 6 列与 colspan 12 的既有格局，成本外溢；距 ATH 跌幅只做排序键 + 展开区字段补一行，不进主表列**。排序时不可比币（null）恒排末尾，与方向无关）、倍数 `mult`（desc 默认，取中点，与实时排名口径一致）。
- 24h 排序键的模式约束：snapshot 模式下全币 `change24h` 无数据（BOARD.coins 为空），该表头按钮置 `disabled` 并加 `title="快照模式下无 24h 数据"`；stale/live 可用，缺失币排末尾。此约束要在表头渲染时按 `boardMode()` 判定——`applyBoardState()` 已有三态分支，顺路处理，不另设状态。
- 呈现与语义：可排序 `<th>` 内放 `<button class="th-sort">`，按钮内含列名 + 方向箭头（当前列显 ▲/▼，非当前列不显箭头但保留 hover 提示）；`aria-sort` 打在 `<th>` 上（`ascending/descending`，非当前排序列移除该属性），按钮 `aria-label="按现价排序，当前降序"` 类文案随状态更新。键盘：按钮原生可聚焦，Enter/Space 触发，与鼠标同逻辑。
- 排序稳定性：比较器最后一级恒以 `estRank` 升序兜底，保证同值行顺序确定、翻方向不乱序。

**② 中文名搜索（别名内联方案）**

- 数据放哪（定案）：`index.html` 脚本内新增常量 `ALIASES = { [coingeckoId]: ["比特币","大饼"], … }`，键用 `coingeckoId`（改名/改符号不断链），值是字符串数组（正式中文名 + 常用俗称各算一条）。**不进 coins.json、不新增 fetch**。搜索时在 W2-08 的派生缓存里把别名拼进每币的 `_searchBlob`（`name + symbol + aliases` 全小写拼接串），匹配仍是一次 `includes`，零额外热路径成本。
- 匹配规则升级（与别名同批）：查询串做 `trim + toLowerCase + 去内部空格` 归一化；支持子串命中 name/symbol/任一别名；拼音全拼**本期不做**（一期已列 P2，维持）。
- Top 30 清单编制方法（清单由施工时按此法产出，不在本文写死译名以免以讹传讹）：
  1. 候选池 = `rankNow` 前 40 名 ∪ `estRank` 前 20 名 ∪ 中文社区高频迷因/老牌币（DOGE/SHIB/PEPE/WIF/BONK/FIL/ETC/LTC/BCH 等以搜索常识补入），去重后约 45 个候选；
  2. 每候选查两个独立来源定名：优先 CoinGecko 中文页与币安中文站的币种中文名，两源一致直接采用；不一致时采用中文财经媒体（PANews/金色财经类）更高频者，并在表内注释来源；
  3. 俗称单列一条：仅收录已成通用语的（如 BTC="大饼"、DOGE="狗狗币"本身即通用名），不收录调侃性临时梗；
  4. 从候选按 `rankNow` 优先截前 30 上线，其余候选留注释待扩；
  5. 上线前验收抽查：30 条逐条过一遍"搜中文名只命中目标币、无误命中他币子串"（如"币安币"含"币"字不得因此命中全表——匹配是整串 `includes` 查询串，风险方向是反过来的：查询"币"会命中所有带"币"别名的币，此为预期行为，与搜英文子串同理，不算误命中）。
- 维护方式：别名表头部注释写明编制日期与来源口径；与 W2-07 名单季度复核同批顺手核（币被移出 200 时其别名成无害孤儿，不阻塞；新入币若属高频中文名币种，复核时补入）；改别名只改 index.html、走前端发版，不触发数据管线。

**③ 排序项增补结论**：纳入 24h 涨跌（带模式约束，见上）与距 ATH 跌幅（仅排序键 + 展开区呈现，不新增主表列，理由见上）；**不纳入**报告现排名排序（价值低且 6 币无值）、预估区间排序（区间无单一序义，中点排序与倍数中点排序等价重复）。

**④ 计数行与空状态**

- 计数行：工具栏与表格之间新增 `<div id="resultMeta">`（普通文本，**不设 aria-live**，理由见 W2-09：只播状态不播计数）。文案模板写死：
  - 无筛选：`共 200 条`（总数读 `COINS.length`，不写死 200）；
  - 有任一筛选/搜索/仅自选：`共 200 条 · 当前显示 {N} 条`，且 N 与分页状态联动时改 W2-08 口径（`当前显示 {shown}/{N} 条（共 200 条）`，见 W2-08）；
  - 排序非默认时计数行尾加 `· 按{列名}{升/降}序`，让截图分享时口径自明。
- 空状态（tbody 内单行，`colspan=12`，居中）：
  - 通用无结果：标题 `没有符合条件的币种`，副文 `试试缩短关键词，或清除筛选`，按钮 `清除搜索与筛选`（一键重置 q/confSel/watchOnly 三者并 `render()`，按钮原生 `<button>` 可聚焦）；
  - 仅自选为空走 W2-06 的专属引导文案，不共用此模板（判定顺序：watchOnly 且自选集为空 → W2-06 文案；否则通用）。

### 实施步骤

1. **先删后建**：删除 `sortSel` 的 HTML 与 `$("sortSel").onchange` 绑定；删除 `applyBoardState()` 中对 `optMult/optMcap/optPrice` 的三行写操作（三态分支各一份，共 3 处，删漏一处即在该模式下抛错）；同函数内列题切换逻辑保留（列题仍随三态变）。
2. 表头改造：6 个可排序 `<th>` 改为内嵌按钮结构，加 `scope="col"`（与 W2-09 合并提交亦可，但属性在本步一并写好，避免二次改同一行）；不可排序列只加 `scope` 不加按钮。
3. 引入 `sortState` 与统一比较器（读 W2-08 派生缓存字段，含新派生 `_athDrop`）；`render()` 内删除旧 4 分支 `if(sort===…)` 逻辑改走比较器。
4. `ALIASES` 常量与 `_searchBlob` 拼接（依赖 W2-08 缓存结构，若本包先行则临时在 `match()` 内查表，上线后随 W2-08 收编——为避免返工，**建议本包排在 W2-08 之后**，见文末顺序）；搜索归一化函数 `normQ()`。
5. 计数行元素与文案模板函数 `metaText()`；空状态行模板与清除按钮（事件委托处理）。
6. 展开区（W2-04b）字段清单补一行"距 ATH"：`-XX.X%`（null 显 `未核实/无 ATH 数据`，与 athFlag 联动文案）——若 04b 已先上线，本步为其增补提交。

### 验收标准

- 点任一可排序表头：方向箭头、`aria-sort`、实际行序三者一致；再点同列翻向；换列时按该列默认方向；同值行顺序稳定（截图对比两遍渲染一致）。
- snapshot 模式下 24h 表头按钮禁用且有原因提示；live 模式可用且无数据币沉底。
- 搜「狗狗币」「大饼」「doge」「DOGE」「 Doge 」（带空格）均命中目标币；Top 30 别名逐条验收命中且仅命中目标币（整串口径）。
- 任一筛选组合下计数行数字与 tbody 实际行数（排除详情行）一致；构造空结果出现空状态而非空白表，点"清除"后恢复全表 200 条；键盘可完成全部排序操作。

### 工作量级

**M**（3–4 天；其中别名清单双源核名约半天到一天，属内容工时不属编码）。

### 成本

0 元。

### 风险与回滚

- 最大风险是步骤 1 的删漏（`optMult` 等引用残留）在某个行情模式下才触发，测试必须覆盖 live/stale/snapshot 三态各进一次 `applyBoardState()`（用桩 BOARD 数据本地演练，沿用 P0 的桩 DOM 演练法）。
- 别名误核风险：双源一致才上线、俗称从严，错一条只是搜不到/多命中，不伤数据可信度本体；发现即改前端发版。
- 回滚：本包为独立提交；回退后下拉排序恢复（旧代码整段保留在 git 历史中），`ALIASES` 与计数行可单独保留（它们不依赖排序改造）——提交时把"删下拉+表头排序""别名+计数+空状态"拆两个提交，支持部分回滚。

---

## W2-06 Watchlist 自选（localStorage）

### 目标设计

- 切换位置与点击域：星标按钮放在币种单元格内、展开按钮（W2-04b）之后、币名之前，顺序为 `▸ ☆ 币名 SYM`（展开是信息动作、星标是收藏动作、币名是阅读主体，此序与视觉重量递增一致）。按钮内容 `☆`（未选）/`★`（已选，已选态 `--acc` 色填充 + `aria-pressed="true"`，**状态不只靠颜色**：字形本身空心/实心即是形状编码）。点击域：按钮盒模型定为 `min-width:44px;min-height:44px`（移动端与桌面端统一，不再为桌面缩小——表格行高本就约 37px，44px 会撑高行高约 7px，接受此代价，换取全端一致可点性；在 CSS 注释中写明此取舍）。按钮与展开按钮之间留 ≥4px 间隔防误触。星标点击**只翻转收藏态，绝不触发展开、绝不调用整表 `render()`**（同 W2-04 的局部更新纪律：只改该按钮字形/`aria-pressed`、更新内存 Set、写 storage、更新工具栏计数；若当前正开着"只看自选"且取消收藏，则该行需即时移除——此情形允许对该单行做局部删除（含其详情行），仍不整表重绘）。
- localStorage key 版本化设计（写死）：
  - 自选：`top200.watchlist.v1` → JSON 数组，元素为 `coingeckoId` 字符串（不用 symbol：符号可被项目方更换、id 是全站唯一键且与 BOARD 映射同键）。写入时机：每次切换防抖 100ms 合并写（连续点星不逐次写盘）。
  - 预留：`top200.ui.v1`（对象，将来存排序偏好等 UI 态）本期**只定名不启用**，避免半成品键散落。
  - 版本策略：读时若 `v1` 解析出的结构不合规走兜底（见下）；未来结构变更发 `v2` 键并在读路径做 `v1→v2` 一次性迁移、迁移后删旧键。本期代码只实现 `v1` 读写 + 结构校验，不预写迁移框架。
- 叠加语义（写死，防实现走样）：筛选管线顺序为 `搜索（q）∧ 置信度（conf）∧ 仅自选（watchOnly）→ 排序 → 分页`，三者是 AND 关系，无优先级覆盖。工具栏开关为切换按钮 `<button id="watchToggle" aria-pressed="false">只看自选（N）</button>`，N 为当前自选总数（随增删即时更新，不受筛选影响）。计数行（W2-05）在 watchOnly 开启时文案含"仅自选"字样（模板已预留）。watchOnly 开启时若某已收藏币被搜索词排除，不给特殊提示，计数如实减少——语义与电商"只看收藏 ∩ 搜索"一致，不另教育用户。
- 空自选引导（watchOnly 开启且自选集为空时，tbody 专属空状态，判定优先于 W2-05 通用空状态）：主文 `还没有自选币种`，副文 `点币种名前的 ☆，即可把关注的币收进自选，回到这里只看它们`，按钮 `查看全部币种`（动作：关 watchOnly 并 `render()`，**不清空搜索/筛选**，只关这一层）。watchOnly 关闭时空自选不展示任何引导（不打扰未用此功能的人）。
- 数据损坏兜底（写死流程）：读取包在 `try/catch`；解析后逐项校验（必须是数组、元素为字符串、且存在于当前 `COINS` 的 id 集合内、去重），不合规元素静默丢弃；整体解析失败（如被其他程序写坏、手改成对象）→ 视为空集、**不报错不弹任何提示**、下次写入时以合法值覆盖。若 `localStorage` 本身不可用（隐私模式禁写等）：启动时做一次试写探测，不可用则全程降级为内存 Set（刷新即失），星标功能表面照常，**不向用户报错**（可在副标题区不加任何字——降级无感是定案，理由：报错的伤害大于刷新丢失的伤害，且隐私模式用户多半知情）。
- 红线复述：只存 id 数组；不存价格、不存数量、不做任何云端请求；页脚/方法论不因此产生"账户"类文案。

### 实施步骤

1. 状态层：`watchSet:Set<coingeckoId>` + `loadWatch()/saveWatch()`（含校验与试写探测），在 `init()` 拉到 COINS 后、首次 `render()` 前完成加载（id 校验依赖 COINS 到位）。
2. 行模板：`rowHTML(c)` 币种单元格按 `▸ ☆ 名` 顺序加星标按钮，`data-star="{id}"`，初始字形/`aria-pressed` 由 `watchSet` 决定（分页/筛选重绘后状态正确回填的唯一来源是 Set，不是 DOM 残留）。
3. 事件委托与工具栏计数同步、watchOnly 开关接入筛选管线（与 W2-05 的 `render()` 过滤链合并实现，一次改对）。
4. 空自选空状态模板与判定顺序接入 W2-05 空状态分支。
5. CSS：`.star` 44px 点击域、已选态样式、与 `.exp` 并排布局（币种单元格改 `display:flex;align-items:center;gap:4px` 时注意桌面端币名+符号的基线对齐需回归目检）。

### 验收标准

- 收藏 3 币 → 刷新页面仍在且星形为实心；开"只看自选"只剩 3 行且计数行文案含"仅自选（3/200 口径正确）"；再叠加搜索词只剩交集；关开关恢复。
- 在"只看自选"视图内取消一币收藏，该行即时消失、计数同步 −1，不出现整表闪烁重排（目检 + DOM 标记验证非整表重绘）。
- 手工把 `top200.watchlist.v1` 改成坏 JSON / 含不存在 id 的数组 / 对象三种坏值，页面均正常打开、自选按兜底规则呈现、无控制台未捕获异常。
- 隐私模式（或禁用 storage）下星标可点、会话内有效、无报错弹窗。
- 星标按钮键盘可达、可切换，`aria-pressed` 与视觉一致；375px 下星标与展开按钮不误触（真机/模拟点按抽查）。

### 工作量级

**M**（约 2 天；编码约 1 天，叠加语义与损坏兜底的用例走查约 1 天。较一期 S 的估计上调，原因是本期把"只看自选 ∩ 搜索 ∩ 分页"的叠加验收与三类坏值兜底写成了硬验收项）。

### 成本

0 元。localStorage 占用 <1 KB（≤200 个 id）。

### 风险与回滚

- 风险：币种单元格改 flex 后桌面/移动两端对齐回归（中低，用目检清单控制）；localStorage 在个别 WebView（如微信内置浏览器）跨次访问不持久——属环境限制，文案不承诺"永久保存"，引导副文不写"永久"字样。
- 回滚：独立提交；回退后星标与开关消失，用户已存的 `v1` 键留在其浏览器中无害（不读即不存在），将来恢复功能可继续沿用同键。

---

## W2-07 Hash 单币直达分享（#SYMBOL）

### 目标设计

- 路由格式（写死）：`https://top200.oppcal.com/#FIL`，hash 内容 = `symbol` 大写原样（symbol 全表唯一，已验 200/200 无重复，作路由键安全）。解析规则：`location.hash` 去 `#` → `decodeURIComponent`（包 try/catch，坏编码静默回退）→ `trim().toUpperCase()` → 先按 `symbol` 精确匹配，未中再按 `coingeckoId` 小写精确匹配（容忍有人粘贴 CoinGecko 风格 id）；仍未中 → 静默回退（见下）。
- 命中后的动作链（顺序写死）：① 清除会藏匿目标的视图状态——搜索词清空、置信度回"全部"、watchOnly 关闭、分页切全显（W2-08 的自动全显条件之一），排序**不动**（目标行在任何排序下都存在，只需定位，不必改用户排序观感；但实时排名口径下目标行位置随行情变，定位以渲染后 DOM 为准）；② `render()` 后在 `requestAnimationFrame` 回调里对目标行 `scrollIntoView({block:"center"})`（等布局落定再滚，避免滚到半成品位置）；③ 自动展开该币详情（调 W2-04b 的同一展开函数，不另写展开逻辑）；④ 高亮：目标主行加 `.flash` 类（背景 `--chip` 提亮 + 左侧 3px `--acc` 边），持续保留至用户下一次交互（滚动/点击/输入任一）才移除——不用定时淡出，分享接收方可能切走再切回，定时消失会丢目标；⑤ `document.title` 按规则切换（见下）。
- `document.title` 规则（写死模板）：命中时 `{symbol} {name} · 预估排名第 {estRank} 位 | 市值前200币种 · 下一轮牛市预估排名`，例：`FIL Filecoin · 预估排名第 1 位 | 市值前200币种 · 下一轮牛市预估排名`。用 `estRank`（静态、与分享语境"报告排名"一致），不用实时排名（打开瞬间行情未回、且随行情漂移会让标题与分享者所见不符）。hash 被清除或命中失效（hashchange 到空/未知）时恢复默认标题（即 HTML 里现行 `<title>` 全文，代码中存为常量 `DEFAULT_TITLE`）。
- 与展开的联动（双向，但克制）：用户在页内手动展开某币时，用 `history.replaceState` 把 hash 静默更新为 `#SYMBOL`（不新增历史条目、不触发滚动），使"此刻复制地址栏即可分享当前币"成立；手动收起且 hash 正指向该币时，`replaceState` 清 hash 并恢复标题。`replaceState` 不触发 `hashchange`，无事件回环；但地址栏监听方（用户手动改 hash）走 `hashchange` 监听重新执行动作链。**回环防护**：`hashchange` 处理函数先比对"目标币是否已展开且已高亮"，是则跳过重复滚动。
- 不存在 hash 的静默回退（写死）：未知符号、空 hash、纯锚点样式（如 `#method`，本站无页内锚点，同样按未知处理）→ **零 UI 变化**：不弹错、不改筛选、不滚动、标题保持默认、全表照常。仅在 URL 本就带 hash 且未命中时，控制台 `console.info` 一行供代办排障（用户无感）。
- 时机与依赖：解析必须发生在 `init()` 拿到 COINS 且首次 `render()` 之后（hash 逻辑挂在 init 尾部）；BOARD 未回来不阻塞定位（展开区动态字段随后续 `render()` 自行更新）。**硬依赖 W2-04b**（自动展开）；若 04b 未上线而本包先行（不建议），降级为仅定位+高亮+标题，代码里以 `typeof detailHTML==="function"` 判存——验收口径按完整版，排期上本包置于 04b 之后（见文末顺序）。

### 实施步骤

1. 常量与解析：`DEFAULT_TITLE`、`parseHashTarget()`（返回 coin 或 null，全程不把 hash 原文写入任何 `innerHTML`——只做查表键，杜绝反射型 XSS 面）。
2. `applyHashTarget(c)`：清视图状态 → `render()` → rAF 滚动 → 展开 → 高亮 → 改标题，五步按目标设计顺序实现。
3. `hashchange` 监听 + 展开/收起处的 `replaceState` 联动（与 W2-04b 切换函数同提交修改，避免两处各写一半）。
4. 移动端注意：`scrollIntoView` 在 iOS Safari 会连带页面横向滚动容器处理——表格容器在 ≤640px 已无横滚（P0 裁剪），桌面端目标行在横滚容器内时需同时把 `.tablewrap` 的 `scrollLeft` 复位为 0，保证币名列可见（桌面币种列非 sticky，横滚残留会只见倍数不见币名，属 P0 遗留场景，本步顺手复位）。

### 验收标准

- 新标签打开 `/#FIL`、`/ #wif`（小写）、`/#filecoin`（id 形式）三种写法均直达：目标行居中、高亮、已展开、标题为 FIL 模板文案。
- 打开 `/#NOTACOIN` 与 `/#` ：页面与无 hash 访问完全一致（截图比对），无报错、无滚动。
- 带 hash 打开时若本地存有会藏匿目标的筛选状态（如 watchOnly 开且目标未收藏），目标仍被定位展示（视图状态按规则清除）。
- 页内展开 BTC → 地址栏变 `#BTC` 且页面不跳动；复制该地址新开标签直达 BTC；浏览器后退不被 hash 改写劫持（replaceState 无新增条目，后退直接离站/回上一页，符合预期并在验收中实测）。
- 命中币在分页默认视图中排位 >50（如 BTC，`estRank` 177）时仍能定位（验证自动全显生效）。

### 工作量级

**S**（约 1 天，前提是 W2-04b 与 W2-08 分页已就位；若需自带降级分支则 +半天）。

### 成本

0 元。

### 风险与回滚

- 风险：微信内置浏览器对 hash 的处理（打开即截断/改写）属环境行为，站内不可控，验收在普通浏览器口径下完成，分享文案不承诺所有 App 内一致；`replaceState` 在个别 WebView 可能抛错，调用包 try/catch，失败仅失去地址栏联动、功能本体不受影响。
- 回滚：独立提交，回退后 hash 被浏览器默认忽略（无锚点元素），页面退回无直达状态，无残留副作用。

---

## W2-08 分页渲染 + INP/LCP 治理与测量基线

### 目标设计

**先测量、后动刀（本包第一原则）**：一期所有 CWV 数字都是目标值、无一条实测。本包第一阶段只建基线不改代码，基线文档落盘后才开始优化施工；每个后续批次（见文末顺序）上线后按同一口径复测，数字进同一张表。

**① 分页渲染（默认前 50 + 显示全部）**

- 状态：`showAllManual`（布尔，默认 false）；有效展示上限 `effectiveLimit = (q 非空 || conf 非空 || watchOnly 开 || showAllManual || hashTarget 存在) ? Infinity : 50`——即任务定的"搜索/筛选自动全显"，hash 直达同理（W2-07 依赖此条）。
- 呈现：截断时表格下方（`.tablewrap` 外）显条状按钮 `显示全部（还有 {N-50} 条）`；全显后按钮变 `收起为前 50 条`（仅在无筛选的默认态出现收起，筛选态全显是自动行为不给收起，避免用户困惑）。计数行（W2-05）文案随之分工：截断态 `共 200 条 · 当前显示前 50 条`，全显态 `当前显示 {N} 条（共 200 条）`。
- 渲染实现：仍是一次 `innerHTML`（截断态只拼 50 行 + 已展开详情行）；"显示全部"是状态翻转后一次全量重绘，不做增量追加拼接（200 行重绘在派生缓存就位后成本可控，增量拼接的复杂度不值）。
- 排序/筛选变化时 `showAllManual` 复位为 false（除自动全显条件外），防"上次展开的 200 行"在新视图里无预期延续。

**② 渲染计算缓存（派生值预计算，本包地基，后续四包共用）**

- 时机：COINS 加载后算静态派生；每次 BOARD 替换（`loadBoard()` 成功/失败置 BOARD 后）重算动态派生。用单调计数器 `boardVer` 标记版本，`render()` 只读缓存不现算。
- 每币缓存对象 `c._d`（下划线前缀标记派生、非数据字段）：`{ price, mcap, chg, multLo, multHi, multMid, liveRank, athDrop, searchBlob }`。其中 `athDrop` 按 W2-05 公式、null 规则同前；`searchBlob` 在 ALIASES 就位后拼别名（W2-05 排在本包之后，缓存结构在此预留字段、拼接逻辑随 W2-05 提交补入）。
- 改造点写死：`computeLiveRanks()` 比较器只读 `_d.multMid`；所有排序比较器只读 `_d` 字段，**热路径零除法、零对象分配**（现行 `liveMult()` 在比较器内逐次建对象的问题在此关闭）；`liveMult()/effPrice()/effMcap()` 保留为缓存构建期的计算来源，渲染期不再调用。

**③ 输入防抖**

- 搜索框：`input` 事件 → 清旧定时器 → 150ms 后以 `requestAnimationFrame` 调 `render()`（防抖 + 帧合批双层）。取 150ms 的依据：低于 100ms 对连打中文的节流效果不足、高于 250ms 用户感知"跟不上手"，150ms 与一期方案 §3.2 定值一致，沿用不另议。
- **中文 IME 守卫（新增，一期未提）**：监听 `compositionstart/end`，组字期间（`isComposing`）不触发渲染，`compositionend` 后立即走一次防抖路径——否则拼音中间态（如 "gougou" 未上屏）会逐键闪烁结果集，对中文站是高频真实场景。
- 离散控件（置信度 select、表头排序、星标、只看自选、刷新）不防抖、即时响应；刷新按钮的重复点击由 BOARD 请求本身兜底（现行无 in-flight 合并，前端侧加"请求中禁用按钮至返回"的简单守卫即可，本期只做禁用守卫，不改 board.js）。

**④ JSON 瘦身——前端配合点（产出归生成管线包，本包只定配合契约）**

实测分账（2026-11-10 本地实算，施工谈判以此为准）：现文件 132,049 B（带缩进排版）→ 紧凑序列化 ≈106.0 KB → 再删 `snapshotMcapRaw + impliedMcapRaw` ≈93.6 KB（gzip ≈19.9 KB，现 gzip ≈23.5 KB）。**结论：删 `*Raw` 只贡献约 12 KB，≤65 KB 目标必须叠加短键名或位置数组编码（管线侧工作量），前端配合如下三点**：
1. **双形态解码器**：`init()` 拿到数据后先判 `meta.schemaVersion`（或条目形态：对象=现行形态、数组=位置形态），若为管线新形态则在加载期一次性解码为现行规范对象数组，之后全站代码只见规范对象。解码成本 200 条可忽略；现行形态直通。管线未交付新形态前，解码器只走直通分支，不阻塞本包其余项上线。
2. **null 语义约定（裁 `*Raw` 的前置条件）**：`*Raw` 不是纯格式化冗余——WFI 的两个 Raw 值均为"未披露"，是数值 null 的语义载体。约定写死：管线裁 Raw 后，前端对 `snapshotMcapUsd/implied*` 为 null 一律呈现"未披露"（而非通用"—"），W2-04b 字段清单已按此口径编写；其余格式化（`$6.4亿` 类）由既有 `fmtMcap` 现算复现，与 Raw 文案抽查比对（抽 20 币比对现算结果与旧 Raw 的数量级/单位一致，允许小数位呈现差异、不允许单位错位）。
3. **不可裁字段清单（前端立场，防管线误删）**：`multLo/multHi`（W2-04b 快照倍数要用）、`athFlag/athDate`（W2-04a）、`rankNote`（W2-04b）、`impliedMcapLo/HiUsd`（W2-04b）、`dataDate`（逐币基准日）均不可裁；可裁候选仅 `*Raw` 两字段 + `table`（全 "A" 且前端零消费，省约 2.4 KB）。首屏传输总账目标维持一期口径：HTML+coins+board 的 gzip 合计 ≤90 KB（现约 7.2 + 23.5 + board 约数 KB，已在目标内——瘦身的主要收益是解析与弱网容错，不是达标压力，此判断写明防过度施工）。

**⑤ CLS 治理**

- 全站数字 `font-variant-numeric: tabular-nums`（`table` 与 `.stat .v` 两处），消除价格/市值到位前后的位数跳动与列内不对齐（与 W2-09 同提交亦可，归属在本包，防两包重复改同一行 CSS 时按文末顺序后者合并）。
- 统计卡：`.stat .v` 加 `min-height: 28px` 且四卡等高（grid 拉伸），快照态"—"与实时态数值切换不改卡高；`#stTime` 的 15px 特例字号保留但同样 min-height 兜底。
- 状态横幅 `.status-banner` 加 `min-height: 42px`，三态文案长短不一（stale 带时间最长）不引起下方内容位移；徽章 `#liveBadge` 加 `min-width: 76px; text-align:center` 预留三态最长文案宽。
- 表体：coins 到达前 tbody 放一行占位（`数据加载中…`，行高与一行数据近似）；分页截断↔全显切换的高度变化是用户主动操作触发，不计 CLS（CWV 口径本就排除 500ms 内用户交互引发的位移，此处仅备注防验收误判）。

**⑥ LCP 治理（本包范围内）**：维持现行两段式（coins 先渲染、board 后覆盖，不改串行/并行结构——board 本就不阻塞首屏，改并行只会争抢 coins 的带宽）；瘦身（管线侧）+ 分页（首屏 DOM 从 200 行降至 50 行，LCP 候选元素所在表头区渲染更快）是本包的两项实质手段。**P2-8 首屏直出前 20 行的归属结论：不在本包做，归 W2-17 静态注入一并处理，本包只保留下列触发判定**——触发条件（同时满足才启动）：(a) 本包基线 + 瘦身落地后复测，移动端 Lighthouse 中位数 LCP 仍 >2.5s（不及格）或 >2.4s 且归因分析显示 LCP 元素等待 coins.json 渲染（Performance 面板中表格区绘制明显晚于 HTML 到达）；(b) W2-17 的生成管线已就位、能保证直出行与 coins.json 同源生成（手写静态行永远不触发）。判定责任：每批次复测时由执行 agent 在基线表里勾选 (a)，管线就位由 W2-17 开工单确认 (b)，两者齐备自动立项，无需用户再决策。

**⑦ 测量基线方案（第一阶段，纯测量零改码）**

- 实验室口径（定版）：Lighthouse 移动端预设（Moto G Power 模拟、Slow 4G、4× CPU 节流），对生产域 `https://top200.oppcal.com/` 连测 **3 次取中位数**，记录 LCP/CLS/TBT/INP 不可得则以 TBT + 手工交互录制代偿（Lighthouse 实验室测不出 INP 是工具事实，基线表里明示，不拿 TBT 冒充 INP）；桌面端同法 3 次中位数作附表。PageSpeed Insights 与本地 Lighthouse 各跑一轮，差异 >20% 时以本地为准并备注（PSI 机房位置与本站受众网络差异大）。
- 真机型谱（最低集）：中端安卓一台（近三年中端机型、Chrome、真实 4G 或 Fast 4G 节流）、iPhone 一台（Safari）、桌面 Chrome。真机只做三项人工核：首屏可读时间体感录屏、搜索连打 6 字是否粘滞（INP 体感）、展开/排序点按跟手度；结论记入基线表定性栏，不强求真机 CWV 数字。
- 场景固定：测前清缓存冷测 + 二访热测各一组；board 处于 live 态时测（stale/snapshot 态另记一行参考，不混入主基线）；测试时间避开整点批量任务时段并记录时间与网络环境，保证跨批次可比。
- RUM 回填流程（W2-14 Web Analytics 启用后执行）：启用满 28 天（或样本量先达标的口径，取先到者并在表中注明）→ 拉取按设备分档的 LCP/INP/CLS p75 → 与实验室基线并排入同一张基线表（新增"字段数据"列组，不覆盖实验室列）→ 若 p75 与实验室中位数偏差 >30%，以字段数据为后续验收口径并复盘实验室参数（机型/网络档位）是否失真。回填完成前，所有"达标"结论只对实验室口径成立，对外汇报必须带此限定。
- 基线表落盘位置建议：`ops/perf-baseline.md`（仓库内，随版本管理），字段：日期/批次/代码版本（git tag）/口径/三指标中位数/真机定性/RUM 列（待回填）。**本包验收以"基线表存在且首行完整"为前置门，未建基线不得开始优化施工。**

### 实施步骤

1. 阶段一（零改码）：按 ⑦ 跑基线并落盘 `ops/perf-baseline.md`；同时本地实算瘦身体积账（本文数字复核一遍后写入基线表附注）。
2. 阶段二：派生缓存 `_d` 改造（含 `computeLiveRanks` 与各比较器收编）→ `rowHTML(c)` 单行模板拆分（为 W2-04b/05/06 预留单元格挂点，函数签名此步定死，后续包只扩不改签名）。
3. 阶段三：分页状态与"显示全部/收起"条、计数行联动口径（与 W2-05 的 `metaText()` 合并实现，二选一处落码，归属按文末顺序在 W2-05 提交中完成亦可，但口径以本文为准）。
4. 阶段四：搜索防抖 150ms + rAF 合批 + IME 组字守卫；刷新按钮请求中禁用守卫。
5. 阶段五：CLS 三件（tabular-nums、统计卡/横幅/徽章尺寸预留、tbody 占位行）。
6. 阶段六：双形态解码器骨架（直通分支）上线；待管线交付瘦身数据后另行切换并做 Raw 文案抽查比对（独立小发版，不与其它项捆绑）。
7. 每阶段上线后按基线口径复测并追加基线表一行。

### 验收标准

- 基线：`ops/perf-baseline.md` 存在，含实验室双口径（PSI+本地）与真机型谱定性记录，INP 实验室不可得一事有明示。
- 功能：默认态只渲染 50 行 + 详情行（如有展开）；点"显示全部"得 200 行且计数一致；输入搜索词/选置信度/开仅自选任一即自动全显且无"显示全部"按钮残留；清空筛选后回到前 50 截断态。
- INP 代理验收：中端安卓（或 4× CPU 节流桌面代偿）连续输入 6 个字符，Performance 录制中 `render` 相关长任务无 >50ms 单个任务、按键回显无肉眼粘滞；IME 组字过程中结果集不闪烁、上屏后一次更新。
- CLS/LCP：同口径复测中位数 CLS ≤0.1（目标 0.05）、LCP ≤2.5s（目标 2.0s）；未达标时须在基线表中给出归因与是否触发 P2-8/W2-17 的判定勾选，不许只报数字不给结论。
- 派生缓存：桩 DOM 演练下 live/stale/snapshot 三态各渲染一遍，价格/倍数/排名与改造前逐币一致（回归比对 200 币全字段）。

### 工作量级

**M**（3–5 天；阶段一测量约 1 天，阶段二地基改造约 1–2 天，其余阶段约 1–2 天）。

### 成本

0 元（Lighthouse/PageSpeed/真机均为既有资源；Web Analytics 免费档归 W2-14）。

### 风险与回滚

- 派生缓存改造是全期回归风险最高点（算错一个字段全表皆错）：以"改造前后 200 币渲染结果逐币 diff"为硬门，diff 非空即不上线；改造拆独立提交，出错整体回退至旧 `render()` 路径（旧函数在 git 历史中完整保留）。
- 分页改变"Ctrl+F 页内查找"行为（未渲染行搜不到）：属已知取舍，靠搜索框自动全显缓解，不另做提示文案（一期已定调：分页而非虚拟滚动的代价清单内含此项）。
- 解码器双形态若管线形态定义中途变更，前端按"未知形态即直通失败 → 回退提示数据加载失败"处理？定案：解码失败时不白屏，`console.error` 留痕且页面保留快照提示条与方法论等静态内容，表格区显"数据加载失败，请刷新"行（现行 `init()` 无此兜底，本步顺手补上，属健壮性净增）。

---

## W2-09 可访问性补齐 + 倍数视觉分层

### 目标设计

**① 语义现状核查（先读后断，结论基于 2026-11-10 通读现行 index.html 全文）**

核查方法：全文检索 `aria` / `role=` / `<label` / `scope=` / `tabindex` / `:focus` —— **命中数全为 0**。逐项现状：

| 项 | 现状（属实） | 判定 |
|---|---|---|
| 文档语言 | `<html lang="zh-CN">` 已有 | ✅ 不动 |
| 控件标签 | `#q` 仅 placeholder 充名；`#confSel/#sortSel` 无 label 无 aria-label，读屏只读出选项值 | ❌ 本包补 |
| 表格语义 | 有 `<thead>`，但 `th` 无 `scope`、表无 `caption`、无 `aria-sort` | ❌ 本包补（aria-sort 随 W2-05 落地） |
| 状态播报 | 徽章/横幅状态变化无 `aria-live`，读屏用户不知行情已变快照 | ❌ 本包补 |
| 焦点可见 | 无 `:focus-visible` 自定义样式，也**未移除**浏览器默认 outline——键盘焦点靠默认轮廓勉强可见，但在深色底上默认轮廓对比弱、且各浏览器表现不一 | ⚠️ 本包统一焦点环（不是从零抢救，是规范化） |
| 对比度 | 一期已按 WCAG 公式逐项验算全过 AA（正文 16.3:1、次要 5.66–5.97:1、红 5.03:1、绿 7.38:1、黄 9.84:1），本期复核色板未变 | ✅ **不动色板**，任何人不得以"优化对比"为名改色 |
| 颜色编码 | 置信度文字本身是"高/中/低"汉字，含义不靠颜色独传；但"低"用 `--dim` 灰与 `.sym` 辅助小字同色同级，**显著性与风险等级倒挂**（最该警惕的最不起眼） | ❌ 本包补非颜色标记 |
| 动画 | 全站零动画，`prefers-reduced-motion` 当前天然满足 | ✅ 本包立约束防未来回归 |

**② 补齐规格（写死）**

- 标签：`#q`、置信度 select 各加视觉隐藏的 `<label for>`（文案分别为"搜索币种"、"按置信度筛选"）；W2-05 删 sortSel 后不涉及它；W2-06 的"只看自选"、W2-04 的展开、星标均为原生 button 且有可见文字或 `aria-label`（星标：`aria-label="收藏 {name}"` + `aria-pressed`；展开：`aria-label="展开 {name} 详情"` + `aria-expanded/controls`，与各包定义一致，此处总账登记防漏）。
- 表格：全部 `th` 加 `scope="col"`；表加视觉隐藏 `<caption>`："市值前 200 币种下一轮牛市预估排名表，行情状态见页首状态横幅"；排序 `aria-sort` 归 W2-05 实现，本包验收时一并走查。
- `aria-live` 只播状态（定案范围）：给 `#liveBadge` 与 `#statusBanner` 的共同父级处理会重复播报，定为**只给 `#statusBanner` 加 `role="status" aria-live="polite" aria-atomic="true"`**，徽章不加（两者同源同变，播一处即可，防读屏双读）。播报内容就是横幅既有三态文案（"实时行情 · 更新于…"/"缓存行情：数据截至…"/"快照模式：当前为…快照数据"），不新增播报文案、不播任何数字变化；计数行、价格、倍数一律不进 live 区。初次加载的快照默认态不算"变化"，读屏在页面标题后可自行读到横幅，不做额外处理。
- 焦点环：全局 `:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; border-radius: 4px }`，覆盖 a/button/input/select 与 W2-05 表头排序按钮、W2-04/06 的行内小按钮；鼠标点击不显环（`:focus-visible` 语义自带），键盘 Tab 全程可见。
- 置信度"低"非颜色标记：低置信单元格文案由 `低` 改为 `低 · 谨慎`（文字后缀，桌面/移动都显；列宽实测可容纳，13px 下约多 3 字宽，验收含目检不折行）；同时 `.conf-低` 字重改 400→600 使其不弱于辅助小字。**高/中不加后缀**（避免全列噪音）；展开区置信度行同步此文案。此项与风险沟通目标一致：低置信=高不确定，必须比"中"更显眼而非更灰。
- 视觉隐藏工具类 `.sr-only` 本包引入（labels/caption 共用），写法用标准 clip 方案，全站只此一份。

**③ 倍数视觉分层（与置信度同包，因同属"非颜色编码"改造）**

- 分层口径（写死）：按**当前显示倍数的中点**（live 态为实时中点、快照态为快照中点，与排名/排序同源，取 W2-08 的 `_d.multMid`），分三档：
  - `multMid ≥ 10`：**强档**——倍数单元格字重 700 + 区间前加标记符 `▲`（如 `▲ 10.2–15.3×`），标记符 `aria-hidden` 并给单元格加 `aria-label` 全称（如"倍数 10.2 至 15.3 倍，高倍数"）？单元格 aria-label 会覆盖读屏原文案，定为：标记符后加 `.sr-only` 文本"（高倍数）"供读屏，视觉用户看 ▲ 与粗体；
  - `multMid < 1`：**警示档**——字重 400、颜色 `--dim` + 区间前加标记符 `▼` + sr 文本"（预估低于现价）"，详情区同步加一行说明 `当前价格已高于 2029 预估中点`；不用红色（红色已专属"快照/下跌"语义，避免一色多义）；
  - 其余：现状呈现，不加任何标记（中间大多数保持干净，两档才有信号价值）。
- 分布事实（验收预期管理，写进图例旁注与验收标准）：快照口径下强档仅 1 币（FIL）、警示档 0 币，属正常——两档随 live 价格波动激活/消退（币价跌深进强档、涨过预估进警示档）。**验收不得以"快照下看不到两档"判失败**，须用桩 BOARD 构造极端价格验两档渲染。
- 图例：表尾图例区（与 W2-04a 的 ATH 图例同区、分行）：`▲ 倍数中点 ≥10×（高倍数，归零风险通常也最高，见页首风险提示）；▼ 倍数中点 <1×（现价已高于预估中点）。倍数分层随当前行情口径（实时/缓存/快照）变化。`——图例必须回指风险提示，防"▲=推荐"的误读，这是本功能的产品红线：强档在视觉上更醒目，文案必须同时声明它不是推荐信号（方法论已有"排名越靠前通常归零概率越高"，图例与之呼应）。

**④ `prefers-reduced-motion` 约束（立规，本期无动画可改）**：全站现无动画/过渡。本期新增的一切动效候选（W2-07 的高亮如做淡入、展开如做过渡）一律默认不加；将来若加，必须写在 `@media (prefers-reduced-motion: no-preference)` 内，reduce 档保持瞬时切换。此条写入 CSS 注释与验收清单，作为长期约束而非本期工时。

### 实施步骤

1. CSS：新增 `.sr-only`、`:focus-visible` 全局环、`tabular-nums` 若未随 W2-08 落地则在此补（两包只许一处落码，按文末顺序先到者为准、后者验收时核对存在性）；`.conf-低` 字重与文案改动在渲染处改字符串（置信度单元格模板一处）。
2. HTML 语义：labels、caption、`scope`（与 W2-05 表头改造同批落码时合并，本包负责验收总账）、statusBanner 的 live 属性。
3. 倍数分层：渲染倍数单元格处按 `_d.multMid` 分档输出标记符 + sr 文本；图例行与 W2-04a 图例同区追加；W2-04b 详情区警示档说明行。
4. 走查：键盘全流程（切筛选→搜索→表头排序→展开→星标→只看自选→刷新）焦点环逐步可见；读屏（NVDA/VoiceOver 任一）验状态切换播报一次且仅一次、无数字播报；axe DevTools 或 Lighthouse a11y 项跑一遍记档。

### 验收标准

- 全文检索 `aria-live` 只出现在 statusBanner 一处；三态切换时读屏播报对应横幅文案恰一次；搜索打字过程中读屏不播计数/价格。
- 所有表单控件有可编程名称（axe/Lighthouse 无 `label` 类 critical）；键盘走完主流程焦点环全程可见；`th scope` 与 caption 存在且正确。
- 置信度"低"行显 `低 · 谨慎` 且字重不弱于"中"；桩数据下倍数强档（▲+粗体+sr 文本）与警示档（▼+sr 文本+详情说明）各至少渲染一例并截图存档；真实快照数据下图例存在、强档为 FIL 一例（实时口径下档位随价变，以验收时口径为准并记录）。
- axe/Lighthouse accessibility 无 critical；色板变量零改动（git diff 核对 `:root` 未动）。

### 工作量级

**M**（约 2 天；改造本身约半天到一天，读屏/键盘/桩数据走查占另一半——本包价值大半在验证，不许压缩走查工时）。

### 成本

0 元。

### 风险与回滚

- 风险：`低 · 谨慎` 文案变长在 ≤640px 核心 6 列下可能挤压置信度列（定版目检项，必要时移动端缩为 `低·谨慎` 去空格，不改语义）；倍数强档被误读为推荐——靠图例回指风险提示 + 方法论既有声明对冲，产品文案层面已尽责，不因此取消分层（可读性收益明确）。
- 回滚：本包多为属性/文案/CSS 增补，独立提交可整包回退；其中倍数分层与置信度文案可单独回退而不影响语义补齐（提交时分开：语义补齐一个提交、视觉分层一个提交）。

---

## 附：前端单文件冲突提示与合并发版顺序（全期总账）

### 谁改了 index.html

**六个工作包全部改 `public/index.html`**（本站前端只有这一个文件，此外零文件增删；`coins.json` 本期不由前端包改动，瘦身形态归生成管线包、前端仅在 W2-08 加解码器）。热点函数/区域的争用如下，施工排期必须按此避让：

| 热点 | 争用方 | 处置 |
|---|---|---|
| `render()` 主流程 | W2-08（缓存/分页）、W2-05（过滤/排序/计数）、W2-06（watchOnly 过滤）、W2-07（定位前清状态） | W2-08 先落地"派生缓存 + `rowHTML()`"地基并定死签名，后续包按顺序只在既有管线上挂自己的环节，禁止再重写主流程 |
| 行模板（币种单元格） | W2-04b（展开按钮+详情行）、W2-06（星标）、W2-09（置信度文案/倍数标记在同行其他单元格） | 04b 与 06 在同一批次内连续施工、一次定好 `▸ ☆ 名` 布局，避免两次改同一单元格 |
| ATH 单元格 | W2-04a（标记）、W2-05（距 ATH 派生用同字段，不改呈现） | 04a 先行独立，05 只读不改 |
| 工具栏 HTML | W2-05（删 sortSel、计数行）、W2-06（只看自选开关） | 同批次顺序施工，计数行口径一次写全（含仅自选文案槽位） |
| `applyBoardState()` | W2-05（删 opt* 引用、24h 排序键模式约束） | 仅 W2-05 动此函数，其余包禁止顺手改 |
| CSS 区 | 全部六包 | 每包只追加自己的类，类名前缀按包区分（`.ath-/.detail-/.th-sort/.star/.flash/.sr-only` 等），`:root` 变量与既有类零改动（W2-09 已明令不动色板；`tabular-nums` 只许 W2-08 或 W2-09 一处落码） |
| 全局状态变量 | W2-05 `sortState`、W2-06 `watchSet/watchOnly`、W2-07 hash、W2-08 `showAllManual/_d/boardVer`、W2-04b `expandedIds` | 统一在脚本顶部状态区声明（随各自提交追加），命名不得复用现存 `COINS/BOARD` |

### 建议合并发版顺序（5 批，每批一次预览→冒烟→生产，批内按序提交、禁止并行改 index.html）

1. **批 1（止血与地基测量）**：W2-08 阶段一（测量基线，零改码，可与下行并行准备）→ **W2-04a**（ATH 标记+图例，独立小发版先行，关呈现违约）→ W2-09 语义补齐提交（labels/caption/focus/live，不含视觉分层）。本批三项互不争用同一代码行，可快发。
2. **批 2（渲染地基）**：W2-08 阶段二～五（派生缓存、`rowHTML`、分页、防抖、CLS）。单独成批、单独发版，发版门禁 = 200 币逐币 diff 回归 + 基线复测。此批之后 `render()` 形态冻结。
3. **批 3（表格交互）**：W2-05（删下拉+表头排序、别名、计数、空状态）→ W2-09 视觉分层提交（置信度文案、倍数两档、图例行，与 05 的图例区相邻追加）。同批原因是二者同改表头/图例/计数区，一次回归走完。
4. **批 4（行级功能）**：W2-04b（展开详情）→ W2-06（自选）。同批连续施工定死币种单元格布局；04b 的展开机制是 06 局部更新纪律的样板，06 复用同一套"不整表重绘"模式。
5. **批 5（分享直达）**：W2-07（依赖 04b 展开 + 08 分页自动全显，两者已就位，本批只做解析/定位/标题/联动）。单独小发版收尾。

W2-08 阶段六（瘦身数据切换）不绑任何批次：生成管线交付新形态数据后独立小发版切换，前置 Raw 文案抽查比对。每批上线后按 W2-08 基线口径复测一行入表；W2-14 启用后另行执行 RUM 回填，不阻塞以上五批。


---

# 第四章 · 数据治理（W2-10 ～ W2-12）

# 第二期 · 数据治理工作包（W2-10 ～ W2-12）

> 定位：币圈前 200 预估站（crypto-top200，https://top200.oppcal.com）第二期数据治理施工设计，细化到可直接施工。
> 审计基线：2026-11-10 只读通读 `scripts/` 全部 8 个脚本、`data/coins.json`（含 meta）、`README.md`、`UPGRADE_PLAN.md` §2.6/§2.7/§2.8、`functions/api/board.js` 与 `public/index.html` 的数据消费点。仓库当前 HEAD `1f7484a`，tag 到 `v1.2.0-refill200`。
> 本文件只做设计，不改任何项目文件。

## 结论先行（本节定版摘要）

1. **单一事实源定版：`data/coins.json` 为唯一可编辑源，`public/data/coins.json` 为构建产物，禁止手改。** 理由见 W2-10 §1——deploy.sh 现行门禁（L31–41）已经以 data/ 为准、README L25 已称 data/ 为「主文件」，选 data/ 是顺现状收敛、零迁移成本；选 public/ 直编则要同时推翻门禁语义、README 口径与 board.js 的取数注释，三处一起改、收益为零。
2. **deploy.sh 门禁由「静默 cp 覆盖」改为「不一致即中止」**：现行 L33–36 不一致时自动以 data/ 覆盖 public/，会把「改错副本」悄悄合法化，与单一事实源的立法目的相悖；同步动作收归 build.py，deploy.sh 只验哈希。
3. **meta 升 v2**：`schemaVersion: 2`、`generatedAt` 由构建脚本自动写 UTC ISO 8601（禁止字面量）、`sourceReports[]` 带逐份 sha256、`generator{script,version}`、全部计数由数据计算。旧字段保留一个版本周期做兼容——经核查前端与 board.js **当前根本不读 meta**（见 W2-10 §4），兼容风险实际为零，保留期纯为外部引用与人工查阅留缓冲。
4. **一期 §2.8 对旧三件套的 7 项指控：5 项仍成立、2 项已随补位脚本部分变化、无一项在旧三件套本体上被修复。** 逐条行号对照见 W2-11 §6 伤情表。补位脚本（merge_refill*.py）自带了行数断言与 /coins/list 下载，质量明显高于旧三件套，build.py 以补位脚本为骨架吸收，不以旧三件套为骨架。
5. **比值阈值统一为单点定义 `AUDIT_BAND = (0.35, 2.8)`**：map_ids.py 的 0.2–5（L53）随其退役而废止；落在带外但名字高度吻合的候选一律进人工队列，永不自动放宽。
6. **override 全量盘点为 13 条现行 + 2 条已退役**（非一期所记 6 条）：原 6 条中 BCAP、SATUSD 已随表 B 剔除退出当前 200 表（登记为 retired 保留溯源），BCG 在现行 coins.json 中符号已是 `BC`、id `bc-token`（登记须以现行符号为准并注报告原符号）；补位批 7 条（BR/XCN/B/SUPER/SN64/S/AWE）全部在现行表中、一期未登记，本期补录。
7. **周检额度成本可忽略**：每周约 5 次 CoinGecko 调用、每月含月审约 30 次，占 Demo key 10,000 次/月额度的 0.3%；用 Demo key（agent 环境从安全保管处取用、不进仓库、不复用 Pages Secret 的注入路径），不用匿名（共享 IP 限流不可控）。
8. **红线（贯穿三包）**：周检移入候选只给行情与占位行，**不自动给预估**；预估的新增/修改只走研究修订 → build.py 重建一条路。周检脚本永远只读线上与上游，只产报告，永不写 coins.json、永不触发部署。

---

## W2-10 单一事实源定版 + meta v2

**工作量级：M（约 2 天）**

### 1. 目标设计

#### 1.1 定版结论：data/ 为源，构建拷贝

| 候选 | 评估 | 结论 |
|---|---|---|
| A. `data/coins.json` 为源，build.py 构建时拷贝到 `public/data/` | deploy.sh L31–41 现行语义即「以 data/ 为准」；README L24–25 已定义 data/ 为主文件、public/ 为「网页实际读取这一份」；`public/` 整体是 Wrangler 的部署产物目录（`wrangler pages deploy public`，deploy.sh L46），把唯一事实源放在部署产物目录里，语义上是「改出货区」；源与产物分目录，Git diff 一眼可辨哪边是人改的 | ✅ **定版** |
| B. `public/data/coins.json` 直编，废除 data/ | 前端相对路径 `fetch("data/coins.json")`（index.html L253）与 board.js 同站取 `/data/coins.json`（board.js L138）确实只认 public/ 一份；但要同时改 deploy.sh 门禁、README 两处口径，且从此「源」与 functions/、index.html 同处部署目录，误删/误传风险更高；唯一收益是少一次拷贝，而拷贝由脚本完成、成本为零 | ❌ 否决 |

**配套规则（写死，进 README 与 build.py 头注释）：**

- 人工编辑、研究修订、周检后的人工处置，**只动 `data/coins.json`**（且优先经 build.py 生成，手改仅限紧急小修且须补跑校验，见 W2-11）。
- `public/data/coins.json` 文件头无法加注释（JSON），以同目录新增 `public/data/DO_NOT_EDIT.md` 一行说明「构建产物，源在 data/，由 build.py 生成」替代；该文件随构建产出，不手写。
- Git 层防线：两份都入库（public/ 必须入库，部署直推仓库树）；PR/提交自查项「public/data/coins.json 的变更必须伴随 data/ 的同哈希变更」由 deploy.sh 门禁兜底（§1.2），不依赖自觉。

#### 1.2 deploy.sh 门禁改造（L31–41 整段替换）

现行逻辑：不一致 → `cp data/coins.json public/data/coins.json` 静默同步 → 再 cmp → 通过。问题：改错 public/ 副本会被无声覆盖、改错 data/ 会被无声放大，两种错误都查无实据。

改造后（伪代码级，施工照此实现）：

```bash
# (b) 数据一致性门禁（v2）：只验不改。不一致即中止，同步是 build.py 的职责。
SRC_HASH="$(sha256sum data/coins.json | cut -d' ' -f1)"
OUT_HASH="$(sha256sum public/data/coins.json | cut -d' ' -f1)"
if [ "$SRC_HASH" != "$OUT_HASH" ]; then
  echo "[deploy] 错误：public/data/coins.json 与源 data/coins.json 哈希不一致。" >&2
  echo "[deploy] 请先运行 python3 scripts/build.py --emit（或完整构建）生成产物，禁止手改 public/ 副本。" >&2
  exit 1
fi
# 与 meta 内嵌 dataHash 对账（防「两份一起被手改成另一份错数据」）
python3 scripts/check_meta.py data/coins.json || exit 1   # 校验 schemaVersion、dataHash==coins 规范化哈希、counts 与实际一致
echo "[deploy] 数据门禁通过 sha256=$SRC_HASH"
```

- `--commit-dirty=true`（L46）保留不动。
- 紧急通道：确需绕过 meta 对账（如 meta 字段人工勘误）时用环境变量 `DEPLOY_SKIP_META_CHECK=1` 单次生效，脚本须把该事实 echo 到部署输出、并要求部署者在 CHANGELOG 该行注明——留痕的绕过，不是后门。

#### 1.3 本地双击预览体验的影响处理

现状事实（施工前须知，非缺陷）：README L70 的现行指引是「双击 `public/index.html` 看排版」——但 index.html 用 `fetch("data/coins.json")`（L253）取数，`file://` 下 fetch 本就被浏览器拦截，该指引实际只能看静态壳；真实预览一直靠 `npx wrangler pages dev public`（README L93–99）。

定版后处理（三条，全部写进 README 修订项）：

1. README 删除/修正「双击看排版」指引，统一为：改完 data/ → `python3 scripts/build.py --emit`（只校验+拷贝，不联网）→ `npx wrangler pages dev public` 预览。
2. build.py `--emit` 必须快（本地、无网络、<2 秒），使「改源 → 出产物 → 预览」链路体感与旧双副本手改一致，不因单源化变慢。
3. 不引入任何前端构建步骤（与 UPGRADE_PLAN §4.4「不引入框架/构建链」结论一致），index.html 仍是单文件直读 public/data/coins.json，前端代码零改动即可消费新产物。

#### 1.4 meta v2 完整字段设计

现行 meta（实测）：`generatedAt`（仅日期，且在 merge_refill.py L173、merge_refill2.py 中均为字面量 `"2026-11-10"`）、`source`（三份报告揉成一段散文，merge_refill2.py 用字符串拼接续写，已不可解析）、`estimateWindow`、`totalCoins/tableA/tableB`、`note`（整段变更史散文，含已过时的「全表共 182 个」中间态表述）。无 schemaVersion、无 sha256、无 generator。

v2 定版（字段名、类型、生成规则写死）：

```jsonc
{
  "meta": {
    "schemaVersion": 2,
    "generatedAt": "2026-11-10T09:32:14+00:00",        // 见生成规则 R1
    "dataHash": "sha256:<64hex>",                       // 见生成规则 R2
    "estimateWindow": "2029 年 9 月下旬 ~ 10 月中旬（下一轮牛市高点推算窗口）",  // 沿用，人工维护常量
    "sourceReports": [                                  // 数组，逐份登记；替代散文 source
      { "title": "市值前 200 加密货币下一轮牛市高点预估排名", "date": "2026-11-10",
        "path": "research_notes/top-200-coins-next-bull-run-estimates-20261110-0737/report.md",
        "sha256": "8d512b5198298c3001dcb35a542b8890bd82f51680578e1a2014338cc1933c97" },
      { "title": "市值前 200 预估榜单补位研究", "date": "2026-11-10",
        "path": "research_notes/top-200-refill-43-non-stablecoins-20261110-0856/report.md",
        "sha256": "f7bc7d1a2d11c741d3c03de29f0e11f2bf8fde3a6df3aa94fab23f9771afe511" },
      { "title": "市值预估榜单第二轮补位研究", "date": "2026-11-10",
        "path": "research_notes/top-200-refill-round2-to-200-20261110-0906/report.md",
        "sha256": "456574bf6dc5f750d6d2da87d1cdc2e29967980ff81e35192733f1bc610bd64b" }
    ],
    "generator": { "script": "scripts/build.py", "version": "2.0.0", "python": "3.x" },
    "counts": {                                         // 全部由数据计算，见 R3
      "totalCoins": 200, "tableA": 200, "tableB": 0,
      "byAthFlag": { "verified": 95, "approx": 69, "unverified": 36 },
      "byDataDate": { "2026-11-08": 139, "2026-11-10": 61 },
      "withRankNote": 7
    },
    "note": "……"                                        // 保留：仅写「当前状态」一句话，变更史移交 CHANGELOG，禁止再当日志续写
    // —— 兼容字段（见 §1.5）：source（由 sourceReports 自动拼串生成）、totalCoins/tableA/tableB 平铺镜像 counts
  },
  "coins": [ /* 200 × 23 字段，结构不变 */ ]
}
```

生成规则（build.py 强制实现，check_meta.py 同规则复验）：

- **R1 generatedAt**：`datetime.now(timezone.utc).isoformat(timespec="seconds")`，构建时自动生成；代码与数据中**禁止出现字面量日期冒充 generatedAt**（check_meta 以「与构建报告落盘时间差 ≤ 构建时长」抽查，人工重跑 --emit 时刷新属预期行为）。
- **R2 dataHash**：只对 `coins` 数组做规范化哈希——`json.dumps(coins, ensure_ascii=False, sort_keys=True, separators=(",",":"))` 的 sha256。**刻意不含 meta**：否则 generatedAt 每次变、文件哈希必变，「双目标哈希一致」（W2-11）与「与上一版 diff 仅预期变更」都无从谈起。文件级 sha256 另由 build 报告记录，两者分工：dataHash 回答「数据变没变」，文件哈希回答「产物一不一致」。
- **R3 counts**：`totalCoins=len(coins)`、`tableA/tableB` 按 `table` 字段计数、`byAthFlag/byDataDate` 用 Counter 现算——**任何计数禁止字面量**（直指 build_coins_json.py L48 写死 158/43 的旧伤）。check_meta.py 独立重算并比对，不一致即部署中止。
- **R4 sourceReports.sha256**：构建时对 path 所指文件现算现填；报告文件不在场（干净克隆无 research_notes 时）则该条 sha256 填 `null` 并在构建报告中报警 `report-missing`，不阻断构建（研究底稿不入库是既定现状），但**已有非空 sha256 与现算不符时必须阻断**——那意味着底稿被改而数据未重建。
- **R5 note 瘦身**：v2 首次构建时，把现行 note 中的历史叙述截断为现状一句话（全表 200 个不重复可预估币、锚定类清零、双 dataDate 口径），历史全文已在 CHANGELOG-补位*.md 与 git 历史中留存，不丢信息。

### 2. 实施步骤

1. 写 `scripts/check_meta.py`（纯标准库）：入参一个 coins.json 路径，按 R1–R4 复验 meta v2，输出逐项 pass/fail，任一 fail 退出码 1。先行交付，它同时是 W2-11 的复用件。
2. 写 meta 迁移小脚本 `scripts/migrate_meta_v2.py`（一次性，迁移后随旧脚本一并归档，见 W2-11 §5）：读现行 coins.json → 按 §1.4 生成 v2 meta（sha256 用上表实测值作迁移输入、脚本现算复核）→ 写回 data/ 并拷贝 public/ → 跑 check_meta 通过。
3. 改 deploy.sh L31–41 为 §1.2 门禁（保留其余段落不动），本地演练三场景：一致放行 / 只改 public/ 中止 / 只改 data/ 未 emit 中止。
4. 同步修订 README：L24–25 文件表（public/ 标注「构建产物，勿手改」）、L64–70「换数据再部署」整节（改为 build.py 流程 + §1.3 预览法）、L117、L119 的过时数字（182 → 200）与易混清单（改为指向 overrides.json，见 W2-12）——README 不再自带第二份易混清单，消除双源。
5. CHANGELOG.md 追加一行、打 tag `v1.3.0-meta-v2`，走 preview → smoke → production 既有流程部署一次（meta 是纯增字段，前端零改动，属低风险部署）。

### 3. 验收标准

- 线上 `/data/coins.json` 的 meta 含 schemaVersion=2、带时区 generatedAt、三条 sourceReports 且 sha256 与 research_notes 现算值逐一相等、generator 在位；用 check_meta.py 对线上抓回的文件复验全 pass。
- 打开线上 coins.json 能回答：一期 §2.6 验收四问（哪个 schema、哪份报告、何时生成、比上一版改了什么——最后一问由 dataHash + CHANGELOG 对照回答）。
- deploy.sh 三场景演练结果留档（ops 或施工报告）：静默覆盖行为已消失，不一致必中止且提示指向 build.py。
- 回滚演练：以 tag `v1.2.0-refill200` 产物重推 preview 并 smoke 通过（meta v1 文件同样能过旧前端，证明兼容方向成立）。

### 4. 前端 / README 消费 meta 的配合点与向后兼容

实测消费现状（2026-11-10）：`public/index.html` 只取 `data.coins`（L253–255），**不读 meta 任何字段**；`functions/api/board.js` 只取 `coins[].coingeckoId`（L138–153）。因此：

- **前端零改动**即可消费 v2；本期不安排前端读 meta（页脚展示 generatedAt/dataHash 前 8 位是可选增益，列入二期 backlog，不在本包工时内，避免为展示改动引入渲染风险）。
- **board.js 零改动**；但其 L11–12 注释自称 coins.json 为「唯一数据源」——单源定版后该注释与事实一致，无需改。
- **向后兼容策略**：v2 保留 `source`（由 sourceReports 按「《title》（date）+ …」规则自动拼串，与现行散文格式同构）、`estimateWindow`、`note` 与平铺 `totalCoins/tableA/tableB`（值镜像 counts，由脚本生成、禁止手写）。保留期：**至下一数据大版本（schemaVersion 3）或 2027-03-31 先到者**，到期由届时构建脚本删平铺镜像与 source；coins 数组 23 字段本期一个不动，`table` 字段保留（全 A 亦不删，为 counts 与未来分表留口）。
- README 是实际的人肉消费方：其 L5、L117 的「182 个」已与现行 200 脱节——本包步骤 4 一并修正，并立规矩：README 中的币数只许引用「见 coins.json meta.counts」，不再写死数字（防第三次脱节）。

### 5. 成本

- 费用 0（纯本地脚本与一次常规部署）。
- 人力：agent 约 2 天（check_meta + 迁移 + deploy.sh 改造 + README 修订 + 演练）；用户 0 配合项（部署走既有授权通道）。

### 6. 风险与回滚

- 风险：迁移脚本写坏 meta → coins 数组逐字节不变是硬约束（迁移前后断言 `coins` 段 dataHash 相等，R2 口径），不相等即弃迁移产物。
- 风险：deploy.sh 新门禁误拦正常部署 → 上线前三场景演练（步骤 3）先行；保留 `DEPLOY_SKIP_META_CHECK=1` 留痕通道一版，下一版删除。
- 回滚：git revert 迁移提交 + 以 `v1.2.0-refill200` 重走 deploy.sh（旧门禁版本随 revert 回来），≤10 分钟；线上侧 meta 回 v1 对前端无影响（前端不读 meta），无用户可见变化。

---

## W2-11 可复现构建管线（build.py）

**工作量级：M（约 4 天，偏大 M——含伤情复核、双 merge 逻辑吸收与干净环境验收）**

### 1. 目标设计

#### 1.1 一条命令入口

```bash
python3 scripts/build.py --reports <主报告.md> [--refill <补位.md>] [--refill2 <二轮补位.md>] [--offline] [--emit-only]
# 产物：data/coins.json（源位）+ public/data/coins.json（拷贝）+ build/build-report-<UTC时间戳>.md（构建报告）
# 退出码：0 成功；1 校验门禁失败；2 输入/环境错误（文件缺失、网络审计不可达且未加 --offline）
```

阶段划分（单文件 build.py 内分函数，不拆多文件——仓库规模下单文件更易审计；共享常量抽 `scripts/pipeline_config.py` 供 build.py 与 W2-12 周检共用，见 §1.3）：

| 阶段 | 职责 | 吸收自 |
|---|---|---|
| parse | 解析主报告表 A/B、补位表、二轮补位表为中间记录 | parse_report.py 全量 + merge_refill.py L30–81 解析段 + merge_refill2.py 解析段（两套表格式不同，分三个 parser 函数，禁止强行统一） |
| resolve | CoinGecko id 解析：/coins/list 下载（脚本内，带缓存落 build/）→ 候选打分 → overrides.json 优先 → 未决进人工队列 | map_ids.py + 两 merge 的 pick_id（逻辑同构，合并为一） |
| merge | 表 B 剔除、补位去重（symbol/规范化 name/id 三重）、XTZ/SHFL 拆分、全表按倍数中点重排 estRank | merge_refill.py L83–172 + merge_refill2.py L135–236 |
| validate | §1.4 全部入门禁，不过不出产物 | 新写（旧管线无此阶段） |
| audit | 在线核价比值审计（全量 200 id 一次 markets 调用） | build_coins_json.py L56–78，修 exit(0) 旧伤 |
| emit | 写 meta v2（调 W2-10 规则）、双目标写出、哈希对账、生成构建报告 | 新写 |

XTZ/SHFL 拆分（parse_report.py L59–77 字面量）：迁入 `scripts/fixtures/xtz_shfl_split.json` 数据文件并注明来源（报告第 157 行合并行 + 拆分依据），代码只读 fixture——消除「数据写在代码里」的双源头，fixture 随 Git 版本化、可 diff。

#### 1.2 路径与中间产物

- 全部路径相对仓库根：`ROOT = Path(__file__).resolve().parent.parent`；报告路径一律命令行参数传入，**代码内禁止出现 `/home/hatch` 字面量**（验收含 grep 门禁，见 §3）。
- 中间产物落 `build/`：`build/coins_raw.json`、`build/cg_list.json`（带抓取时间戳，24h 内复用免重复下载）、`build/cg_markets.json`、`build/id_pass1.json`、`build/id_audit.json`、构建报告。`.gitignore` 现行已有 `build/` 一行（实测 L6），无需改；**禁用 /tmp**（验收含 grep）。
- 网络获取统一走一个 `fetch_json()`：`curl -fsS`（带 `-f`，修 map_ids.py L9 无 `-f`、错误 JSON 当数据用的旧伤）、超时 60s、429/5xx 最多重试 2 次（间隔 5/15s）、响应非预期类型立即报错退出码 2 并打印上游原文前 200 字符。

#### 1.3 阈值单点定义

`scripts/pipeline_config.py`（唯一定义处，build.py 与 weekly_check.py 共同 import，代码其他位置出现比值数字字面量视为违规，验收 grep）：

```python
AUDIT_BAND = (0.35, 2.8)      # 在线核价：live/snapshot 比值合格带。吸收 build_coins_json.py:74 与 merge_refill*.py:125/184（三处同值）
# map_ids.py:53 的 0.2–5 随 map_ids.py 退役废止：候选筛选与终审共用 AUDIT_BAND；
# 名字精确吻合但比值在带外的候选 → unresolved 人工队列，禁止任何自动放宽通道。
EXPECTED_TOTAL = 200          # 终表行数断言（配置化，替代散落的 43/18/182/200 字面量断言）
```

#### 1.4 校验门禁清单（任一不过：非零退出、不写产物、报错含行号/币名）

报错格式统一：`FAIL [<门禁名>] <来源文件>:<行号或币 symbol> <说明>`；解析类错误必须带**报告原文行号**（parser 须全程保留行号，现旧脚本丢行号是「指出行号」做不到的根因，施工时先补这层）。

| # | 门禁 | 规则 | 旧伤对应 |
|---|---|---|---|
| G1 | 行数断言 | 每张源表解析行数 == 该表声明预期（参数/配置给出：主表 A、补位 43、二轮正式 18+备选 4）；终表 == EXPECTED_TOTAL | parse 静默跳行 |
| G2 | 列数严格 | 任一行列数不符 → 立即失败并给行号，**禁止 skip-continue** | parse_report.py:57,111 |
| G3 | 字段 schema | 逐币校验 23 字段齐全与类型（手写校验器，不引 jsonschema 依赖——仓库零依赖现状不破）；`confidence ∈ {高,中,低}`、`dataDate` 为 YYYY-MM-DD | 无 schema 校验 |
| G4 | 值域 | `estLo ≤ estHi`、`multLo ≤ multHi`、`impliedMcapLo ≤ impliedMcapHi`、`snapshotPrice > 0`；二轮补位的倍数漂移断言（merge_refill2.py L117 的 0.35 容差）以命名常量 `MULT_DRIFT_TOL = 0.35` 保留 | — |
| G5 | id 门禁 | `coingeckoId` 非空、全表唯一、symbol 唯一（大小写不敏感）；任一未决 → 失败并列出未决清单（未决只许经 overrides.json 或修报告解决） | build_coins_json.py:41–42 只打印 |
| G6 | athFlag 枚举 | `∈ {verified, approx, unverified}`，且 verified 必须有 athPrice、unverified 允许 athPrice 为 null 但必须有 reason 注记 | — |
| G7 | 在线核价审计 | 全量 id 一次 markets 调用；返回数 < 请求数 → 失败；逐币比值出 AUDIT_BAND → 失败并列币（`--offline` 时整段跳过且构建报告标红「未做在线审计」，产物 meta 不受影响但**禁止带未审计产物走生产部署**——deploy.sh 不验此项，靠构建报告人工签核把关，见 §1.5） | build_coins_json.py:65 exit(0) |
| G8 | override 一致性 | coins 中每条与 overrides.json 现行条目冲突的 id（同 symbol 不同 id）→ 失败；override 条目指向不存在的 symbol → 警告（可能已退役，须人工确认转 retired） | OVERRIDES 双源 |
| G9 | meta 自洽 | emit 前以 check_meta.py 同规则自检（counts 重算、dataHash、sourceReports sha256） | meta 写死 |
| G10 | 双目标哈希 | 写出后 sha256(data 版) == sha256(public 版)，不等 → 失败并删除 public 产物防误部署 | 旧 build 只写 data 一份 |

#### 1.5 构建报告与部署衔接

`build/build-report-<时间戳>.md`（同时复制一份到 `ops/build-reports/` 入库归档——build/ 被 gitignore，报告须换地存档）：含输入报告及 sha256、generator 版本、各门禁结果、**增/删/改清单**（与上一版 data/coins.json 按 symbol diff：新增币、删除币、逐币字段级变更行 `BTC: estHi 142000→145000 (source: 主报告)`）、未决/警告项、在线审计 flagged 清单、override 到期警告（W2-12 接入点）、双目标 sha256、dataHash 及与上一版 dataHash 对比。

流程衔接（写死）：`build.py 成功 ≠ 可部署`。人工（agent）读构建报告 → 增删改与预期一致 → 在报告尾部签核行落名与日期 → commit（data/、public/、ops/build-reports/ 报告、CHANGELOG 一行、tag）→ deploy.sh preview → smoke → production。构建报告未签核的提交禁止打 tag、禁止生产部署（流程纪律，README 明文）。

### 2. 实施步骤

1. 先补测试夹具：留存现行三份报告的解析金标（现行 coins.json 即金标产物）——build.py 重构后须能从三份报告重建出与现行版 dataHash 相同或 diff 仅 generatedAt/预期项的产物，这是全部重构的安全网，先于动代码落地。
2. 写 `pipeline_config.py` + build.py 的 parse/resolve/merge 三段（吸收 merge 脚本逻辑，逐段与金标对账）。
3. 写 validate/audit/emit 与构建报告生成；接入 check_meta.py（W2-10）与 overrides.json（W2-12，两包接口在此对齐：build.py 只读 overrides.json 的 active 条目）。
4. 旧脚本退役归档（见 §5），README「数据管线」一节改写为 build.py 单入口。
5. 干净环境复现验收（见 §4）+ 破坏性验收（删行/改坏 id 各一次）后，首次用新管线走一遍 preview 部署。

### 3. 验收标准

- §4 干净环境复现通过；破坏性测试：删报告一行 → 退出码 1 且报错含行号；把一个 id 改坏 → G5/G7 拦截且指名 symbol；两测结果留档。
- `grep -rn "/home/hatch\|/tmp/" scripts/build.py scripts/pipeline_config.py` 零命中；`grep -rn "0\.35\|2\.8\|0\.2" scripts/*.py` 只命中 pipeline_config.py 一处定义（G4 的 MULT_DRIFT_TOL 同文件、异名异义、注释分明，不算违规）。
- 构建报告样例经人工签核流程完整走通一次并归档 ops/build-reports/。

### 4. 干净环境复现验收方法

```bash
git clone <本地仓库> /tmp/repro-check && cd /tmp/repro-check   # /tmp 仅作验收沙盒，不作管线中间产物
# 断网前预置：research_notes 三份报告按 meta.sourceReports 的 path 摆放到位（或 --reports 指向既有目录）
python3 scripts/build.py --reports … --refill … --refill2 …    # 在线全流程
python3 scripts/build.py … --offline                            # 离线流程（用 build/ 缓存的 cg_list 重跑亦须可复现）
# 判定：新产物 coins 数组 dataHash == 现行生产版 dataHash，或 diff 清单与构建报告声明完全一致
```

另加一测：清空 build/ 后 `--offline` 应以退出码 2 明确报「缺 cg_list 缓存」，而不是崩溃栈或静默产出。

### 5. 一次性脚本归档退役

- `merge_refill.py`、`merge_refill2.py`：逻辑被 build.py 吸收且金标对账通过后，移入 `scripts/archive/2026-11-10-refill/`（保留文件、加 README 一行「已退役，逻辑见 build.py merge 段，勿再运行——其 ROOT/REFILL 绝对路径与 /tmp 产物路径均为历史状态」）。不删除：两次补位的解析怪招（如 merge_refill2.py 的隐含市值推导）是数据溯源的一部分。
- 旧三件套 `parse_report.py`、`map_ids.py`、`build_coins_json.py`：同批移入 `scripts/archive/2026-11-10-legacy-pipeline/`，同等标注。`deploy.sh / smoke.sh / probe.sh` 为现行运维脚本，**不退役**（仅 deploy.sh 按 W2-10 改门禁段）。
- 归档判据写死：金标对账通过 + 一次新管线 preview 部署成功，两条齐备才移；移后 `scripts/` 顶层只剩 build.py、pipeline_config.py、check_meta.py、weekly_check.py、overrides.json、deploy/smoke/probe。

### 6. 旧脚本伤情对照表（一期 §2.8 指控逐条复核，2026-11-10 实测）

| # | 一期指控 | 复核结论 | 现行证据（文件:行号） |
|---|---|---|---|
| 1 | 报告路径写死绝对路径 | **仍成立**（且已扩散到补位脚本） | parse_report.py:5（SRC）、build_coins_json.py:52（输出路径）、merge_refill.py:16–17（ROOT/REFILL）、merge_refill2.py:19–20（ROOT/REPORT）均为 `/home/hatch/...` 字面量 |
| 2 | 中间产物写 /tmp、下载步骤不在脚本内 | **旧三件套仍成立；补位脚本已变化** | /tmp：parse_report.py:6、map_ids.py:5–6,30,60、build_coins_json.py:5–6,78、merge_refill.py:99,192、merge_refill2.py:261。下载缺失仅指 map_ids.py 依赖的 /tmp/cg_list.json 无人生成；merge 两脚本已内嵌 curl 下载 /coins/list（merge_refill.py:98、merge_refill2.py 约 L158），该半句指控对补位批不成立 |
| 3 | 列数不符静默跳行、退出码 0 | **仍成立（旧三件套）；补位脚本部分缓解** | parse_report.py:56–57 与 110–111：stderr 打印后 continue，无行数终检，退出码 0。merge_refill.py:40–41、merge_refill2.py:48 同为 continue 跳行，但有总数 assert 兜底（merge_refill.py:81 `==43`、merge_refill2.py:78,110），丢行会以 assert 形式暴露——仍无行号、仍非结构化报错 |
| 4 | 在线审计失败 sys.exit(0) | **仍成立**（全仓仅此一处，未修） | build_coins_json.py:64–65：markets 返回非 list 时打印后 `sys.exit(0)`。补位脚本无在线终审段落，不涉及 |
| 5 | 缺 id 只打印不拦截 | **旧管线与一轮补位仍成立；二轮补位已部分修复** | build_coins_json.py:41–42 只 print 后照常写出（可带 null id 发布）；merge_refill.py 同样只 print unresolved（约 L186–190）且 refill_record 可写入 None id。二轮 merge_refill2.py:224–226 以 `len(ids)==200` 且唯一 assert 事实上拦截了 null id——属已随补位脚本变化 |
| 6 | 158/43 写死常量 | **旧管线仍成立；补位脚本已改数据计算、但留下新字面量** | build_coins_json.py:48 `tableA:158, tableB:43` 字面量（totalCoins 已是 len()）。merge_refill.py:176 已改为 len(merged) 计算；merge_refill2.py 则散布 182/18/22/200 字面量 assert（L78,110,138,155,224）——是阶段预期值而非 meta 撒谎，build.py 收进 EXPECTED_TOTAL 配置统一管理 |
| 7 | 无 schema 校验 | **仍成立**（全线） | 全仓无 jsonschema 或等价字段校验；最接近者仅 merge_refill2.py:117（倍数漂移）、224–226（计数/唯一）数条 ad-hoc assert，不成体系。现行 coins.json 实测自洽（200 币 id 无空无重、estLo≤estHi 全过、athFlag 分布 95/69/36）——是人工核定之功，非管线之功 |

附带新发现（非一期指控，本期顺手修）：① curl 均无 `-f`（map_ids.py:9、build_coins_json.py:58），限流错误 JSON 会被当数据解析；② merge 两脚本 `OVERRIDES = {}`（merge_refill.py:20、merge_refill2.py:23）是死代码空壳——真实补位 override 从未走代码，而是自动匹配命中后被 README L119 人工记录，这正是 W2-12 必须以「现行 coins.json 实际 id」为准盘点、不能只抄代码常量的原因；③ XTZ/SHFL 字面量拆分（parse_report.py:59–77）仍与报告双源，处理见 §1.1 fixture 化。

### 7. 成本

- 费用 0（CoinGecko 调用走 Demo key 既有额度，构建每次在线审计 1 次 markets + 1 次 list 下载/周级缓存，量级忽略）。
- 人力：agent 约 4 天；用户 0 配合项。

### 8. 风险与回滚

- 风险：重构解析逻辑与金标不一致 → 金标对账先行（步骤 1），对不上不归档旧脚本、不切换入口；新旧管线并行期以旧产物为准。
- 风险：build.py 单文件膨胀难维护 → 阶段函数隔离 + pipeline_config 外置；超过 ~900 行时下一期再拆包，本期不预先过度工程。
- 回滚：旧脚本只是移入 archive/，任一步失败可原样移回、`git revert` 归档提交即恢复旧流程；线上数据不受影响（构建产物未经签核与 deploy 门禁不会上线）。

---

## W2-12 名单周检 + override 登记

**工作量级：M（约 3 天：overrides.json 盘点迁移 1 天 + weekly_check.py 1.5 天 + 首跑与模板定版 0.5 天）**

### 1. 目标设计

#### 1.1 scripts/overrides.json 结构定版

```jsonc
{
  "version": 1,
  "entries": [
    { "symbol": "TEL", "coingeckoId": "telcoin-2", "type": "dead-contract-successor",
      "reason": "CoinGecko 上 telcoin 为已废弃旧合约，现行合约为 telcoin-2（2026-11-10 在线核价比值 0.97）",
      "evidenceUrl": "https://www.coingecko.com/en/coins/telcoin-2",
      "verifiedAt": "2026-11-10", "reviewDue": "2027-02-08", "status": "active" }
    // …
  ]
}
```

- 字段在任务书七字段 `{symbol, coingeckoId, type, reason, evidenceUrl, verifiedAt, reviewDue}` 基础上**只加一个 `status ∈ {active, retired}`**：BCAP/SATUSD 两条已退出当前名单，删之则溯源断裂，留之则必须能与现行条目区分——这是加字段的唯一理由，施工不得再自行扩字段。
- `type` 枚举定版：`dead-contract-successor`（旧合约废弃）、`symbol-mismatch`（报告符号 ≠ CoinGecko 符号）、`id-suffix-collision`（同名多 id 取 -2/-3 者）、`manual-resolution`（自动匹配无法定夺的人工核定）。枚举外新值须先改本设计或在登记时经人工批准并回写枚举说明。
- `evidenceUrl` 定版规则：默认填 CoinGecko 币页 `https://www.coingecko.com/en/coins/<coingeckoId>`；涉及旧合约废弃/迁移的，优先填项目方迁移公告或 CoinGecko 旧币页，施工落值时逐条打开验活，死链换源。
- `reviewDue = verifiedAt + 90 天` 由登记脚本/人工计算写实值，禁止留空。
- README L119 的人工易混清单在本包落地后**删除并改为链接 overrides.json**（消除代码/文档双源的文档侧）；代码侧 OVERRIDES 常量随 W2-11 被 build.py 改为只读 overrides.json，一并消除。

#### 1.2 现有 override 全量盘点（迁移清单，以代码 + README + 现行 coins.json 三方对照为准）

现行有效 13 条（verifiedAt 均为 2026-11-10 本次核定日，reviewDue 一律 2027-02-08；evidenceUrl 按 §1.1 规则生成、施工时逐条验活）：

| # | symbol（现行表） | coingeckoId | type | 来源 | 备注 |
|---|---|---|---|---|---|
| 1 | TEL | telcoin-2 | dead-contract-successor | build_coins_json.py:9 | `telcoin` 为废弃旧合约 |
| 2 | BC（报告原符号 BCG） | bc-token | symbol-mismatch | build_coins_json.py:11、README L119 | **盘点关键点**：现行 coins.json 中该币 symbol 已为 `BC`、name=BCGame Coin；登记以 BC 为准，reason 中注明报告原符号 BCG 与 CoinGecko 符号 BC |
| 3 | PRL | pearl-2 | symbol-mismatch | build_coins_json.py:12 | CoinGecko 符号为 PEARL |
| 4 | WFI | wefi | manual-resolution | build_coins_json.py:10 | 比值 1.000 人工核定 |
| 5 | BR | bedrock-token | id-suffix-collision | README L119（补位批） | 代码 OVERRIDES 为空壳，此条以 coins.json 实际 id 为准 |
| 6 | XCN | chain-2 | id-suffix-collision | README L119 | Onyxcoin |
| 7 | B | build-on | manual-resolution | README L119 | BUILDon，单字母符号高碰撞 |
| 8 | SUPER | superfarm | manual-resolution | README L119 | SuperVerse 改名遗留 id |
| 9 | SN64 | chutes | manual-resolution | README L119 | 符号与 id 无字面关联 |
| 10 | S | sonic-3 | id-suffix-collision | README L119 | Sonic，单字母符号高碰撞 |
| 11 | AWE | stp-network | manual-resolution | README L119 | AWE Network 前身 STP，id 未随改名 |
| 12 | （二轮补位批复核项） | — | — | merge_refill2 全程 OVERRIDES={} | 二轮 18 币施工记录无人工 override 声明；迁移施工时须逐币复核其 id 是否属「自动匹配恰好蒙对」——凡 name/symbol 与 id 非直观对应者（如经施工复核确认的）按 manual-resolution 补登；无异常则在迁移报告中明示「二轮批复核无新增」留痕，禁止默认跳过 |
| 13 | XTZ/SHFL 拆分 | —（非 id override） | — | parse_report.py:59–77 | 不入 overrides.json（非 id 映射），随 W2-11 fixture 化处理，此处仅交叉索引防漏 |

已退役 2 条（status=retired，保留 reason 与退役注记「2026-11-10 随表 B 锚定类剔除退出名单」）：BCAP → blockchain-capital（build_coins_json.py:13）、SATUSD → satoshi-stablecoin（build_coins_json.py:14）。退役条目不参与构建 G8 门禁的「指向不存在 symbol」警告，周检不查活。

> 注：第 5–11 条须在迁移施工时以现行 coins.json 逐条回验（实测现行值：BR=bedrock-token、XCN=chain-2、B=build-on、SUPER=superfarm、SN64=chutes、S=sonic-3、AWE=stp-network，与 README 一致，2026-11-10 本审计已核）。

#### 1.3 周检脚本 scripts/weekly_check.py 设计（只读、只产报告）

输入：现行 data/coins.json、overrides.json、上周状态文件 `ops/weekly/state.json`（连续周计数必须跨周持久化且入库——build/ 被 gitignore 不可用，此为状态放 ops/ 的理由）。
输出：`ops/weekly/<YYYY>-W<ww>.md` diff 报告（模板见 §1.5）+ 更新 state.json。**永不写 coins.json、永不调 deploy.sh。**

检测项（口径写死）：

| # | 检测 | 口径 | 产出分级 |
|---|---|---|---|
| C1 | 进出差集 | 拉 CoinGecko 市值前 250（/coins/markets per_page=250 一页）为基准集。与名单比：名单内币跌出 250 → 记 `watch-out` 并累计连续周数，**连续 2 周 → 候选移出**；非名单币进入前 200 → 记 `watch-in`，**连续 2 周 → 候选移入**（仅行情+占位，见红线） | 候选清单 |
| C2 | 排名漂移 | 基准集内实时 rank 与 coins.json `rankNow` 差绝对值 > 50 → 标记人工看（rankNow 为 2026-11 快照口径，漂移榜会随时间变长——报告中只报本周围绕异动，不报全量噪音：仅列「上周未标记、本周新越线」者，老标记在附表计数） | 人工队列 |
| C3 | id 存活 | /coins/list 全量与存量 200 id 比对：id 消失 → 疑似下架/迁移，**最高优先级告警**（board.js 靠 id 取价，id 消失即该行实时价静默冻结） | 告警 |
| C4 | symbol/name 变更 | 以 markets 返回的 200 币 symbol/name 与存档逐一比对（不另调接口，从 C1/C5 的返回里取）；不一致 → 疑似改名/合约变更，进人工队列并附新旧值 | 人工队列 |
| C5 | 比值异常 | 全量 200 id 一次 markets 调用，live/snapshotPrice 比值出 AUDIT_BAND（import pipeline_config，与构建同源）→ 标记；此即旧 build 在线审计的周检化 | 人工队列 |
| C6 | 多源偏离 | 第二源（定版：CoinCap v2 /assets 按 id 映射 slug 查价，免费无 key；映射不上的币跳过并计数，不算失败）与 CoinGecko 现价偏离 > 20% → 人工队列 | 人工队列 |
| C7 | override 到期 | entries 中 active 且 reviewDue < 报告日 → 到期清单；构建报告侧的同款报警见 §1.6 | 到期清单 |
| C8 | 合约地址变化 | **本期不做自动检测**（一期 §2.7 提及）：CoinGecko 免费层逐币 /coins/{id} 拉合约地址为 200 次调用/周，额度与工时都不划算；以 C3+C4（id 消失、symbol/name 变更）为迁移的代理信号，人工队列处置时顺手核合约。此为对一期设计的明确收敛，理由记录在此 | — |

#### 1.4 CoinGecko 额度成本测算

| 调用 | 端点 | 频次 | 月量 |
|---|---|---|---|
| 前 250 基准集 | GET /coins/markets?per_page=250&page=1 | 1/周 | ≈4 |
| 全量 id 行情（C4/C5 复用） | GET /coins/markets?ids=<200 个> | 1/周 | ≈4 |
| id 存量 | GET /coins/list | 1/周 | ≈4 |
| 第二源比价 | CoinCap（非 CoinGecko，不计额度） | 1/周 | 0 |
| 月审深查（逐 override 打开币页核对、候选币详情） | /coins/{id} 等 | ≈15/月 | ≈15 |
| **合计** | | | **≈27 次/月，占 Demo 额度 10,000 次/月的 0.27%** |

结论：**用 Demo key**（调用带 `x-cg-demo-api-key` 头，key 由 agent 环境从既有安全保管处取用，禁止写入仓库/脚本/state）；不用匿名——匿名共享 IP 限流（约 5–15 次/分钟且与他人共享）会让 /coins/list 这类大响应调用稳定性不可控，而 Demo key 成本为零、额度富余两个數量级。周检在 agent 环境运行，不经 Pages、不碰线上 Secret 的注入通道，两条 key 通路互不干扰。失败策略：任一调用 429 → 本周报告标 `incomplete` 并注明缺项，下周自然重试，**不做同周高频重试**（防额度与封禁风险）。

#### 1.5 diff 报告模板（ops/weekly/<YYYY>-W<ww>.md）

```markdown
# 名单周检 YYYY-Www（运行：<ISO 时间> · 执行：weekly_check.py v<x> · 数据：CoinGecko Demo）
## 结论（先行，≤5 行：有无告警 / 候选进 / 候选出 / 人工队列数 / override 到期数）
## A. 告警（id 消失等，逐条：symbol、id、上周状态、建议动作）
## B. 进出候选（表：symbol | 现实时排名 | 连续周数 | 处置状态；移入候选注记「仅占位，无预估」）
## C. 人工队列（排名漂移新越线 / symbol·name 变更 / 比值出带 / 多源偏离>20%，逐条附证据数值）
## D. Override（到期清单 / 本周已复审登记）
## E. 运行元信息（各端点调用次数、incomplete 缺项、state.json 变更摘要）
```

存档纪律：报告与 state.json 每次运行一并 commit（message 形如 `chore(weekly): 2026-W47 名单周检`），只增不改历史周报；月审在当月最后一周报告尾部加「月审结论」节，不另起文件。

#### 1.6 执行环境、节奏与报警接入点

- **节奏**：周检——每周一次，agent 环境手动/半自动运行（运行时点不写死具体钟点，避开整点上游拥挤即可）；月审——每月一次，人工逐条复审 override（打开 evidenceUrl 核 id 仍正确 → 更新 verifiedAt/reviewDue 并记入周报 D 节）+ 处置积压人工队列；事件急查——触发条件写死：大盘单日 ±20%、C5 比值异常在构建时被报、用户转达探针告警涉及具体币、或有币被主流媒体报下架/迁移时，单次运行 weekly_check.py 并在报告头标 `event-triggered`。
- **排期边界（重要）**：本包只交付脚本与首跑；**是否设为每周自动 cron 由用户另行批准**——用户既定偏好为不默认长期盯盘，未获批准前周检以「agent 在复核时间点/被唤起时运行」为准，不擅自建常驻定时任务。
- **override 超 90 天报警双接入点**：① weekly_check.py C7（周报 D 节 + 结论行计数）；② build.py 构建报告「警告」节——emit 时读 overrides.json，active 条目 reviewDue 已过 → 警告（只警告不阻断：过期是复审纪律问题，不是数据错误；但同一条目连续两次构建仍过期 → 升级为构建报告结论行标红，仍不阻断，处置权在人工）。

### 2. 实施步骤

1. 按 §1.2 盘点表落 `scripts/overrides.json`（13 active + 2 retired，二轮批按表内 #12 复核后定稿），逐条 evidenceUrl 浏览器验活；写 overrides 校验小段并入 check_meta.py 或独立 `--check-overrides` 模式（字段齐全、枚举合法、reviewDue−verifiedAt ≤ 90 天、active 条目的 id 与 coins.json 现行值一致）。
2. README L119 清单删除改链接；build.py 的 OVERRIDES 读取改为 overrides.json（与 W2-11 步骤 3 同批联调，G8 门禁对账）。
3. 写 weekly_check.py（C1–C7）+ state.json 初版（以 2026-11-10 名单为第 0 周基准）+ 报告模板。
4. 首跑：产出第一份周报（基准周，进出连续计数从 1 起算属预期，报告中注明），人工抽 10 币复核 id 与排名正确性。
5. 月审 SOP 一页写入 README「运维节奏」节（与既有「触发式介入」口径合并，不新开长期盯盘承诺）。

### 3. 验收标准

- overrides.json 校验全 pass；active 13 条 id 与现行 coins.json 逐条相等；随机抽 5 条打开 evidenceUrl，页面币与登记 symbol/id 一致。
- 首份周报按模板产出并入库，结论行五要素齐全；人为演练：将 state.json 中某币 watch-out 连续周数置 1 后重跑，该币若仍在 250 外须出现在候选移出（演练在副本上做，不污染正式 state）。
- 把一条 override 的 reviewDue 改为已过期（副本演练）→ 周报 D 节与 build 构建报告警告节同时出现该条。
- 周检全程对 coins.json 与线上零写操作（脚本无 deploy/写源代码路径，grep 自证）。

### 4. 成本

- 费用 0（Demo key 既有额度，月耗 0.27%；CoinCap 免费）。
- 人力：agent 约 3 天（首期）；此后周检单次运行+读报告约 10 分钟、月审每次约 30–45 分钟（agent 代办，用户只看结论行）。

### 5. 风险与回滚

- 风险：自动差集误报（排名在 200/250 边界抖动）→ 连续 2 周规则就是为此设，周报只给候选不给动作，误报成本仅一行报告。
- 风险：overrides.json 登记错误 id → 比旧常量更危险（单点权威）；以迁移时三方对照 + G8 构建门禁 + 月审三层兜底；登记文件每次变更走 commit 可回滚。
- 风险：/coins/list 口径变化（CoinGecko 调整免费层）→ C3 缺项标 incomplete 不误报下架（id 消失告警须以下一周复跑或人工打开币页确认后才升级处置，写进 SOP）。
- 回滚：overrides.json 与 weekly 文件均为新增，停用即删/停跑，不影响构建与线上（build.py 在 overrides.json 缺失时应报错而非回退旧常量——防双源复活，此为定版行为）。

---

## 附：三包依赖与建议施工顺序

W2-10（check_meta + meta v2）→ W2-12 的 overrides.json 落值（W2-11 的 G8 依赖它）→ W2-11（build.py 吸收全部接口，最后归档旧脚本）。总计 M+M+M，串行约 9 个工作日；三包均为数据层改造，不触碰 board.js 与前端渲染，线上风险集中在 W2-10 的一次 meta 部署，已有 preview+smoke 流程兜底。


---

# 第五章 · 可观测运营与 SEO / 分享（W2-13 ～ W2-17）

# 第二期 · 04 可观测运营与 SEO/分享工作包（W2-13 ～ W2-17）

> 站点：https://top200.oppcal.com ｜ Cloudflare Pages 项目：`crypto-top200`
> 状态：设计定版，可直接施工；本文只做设计，不含任何已执行变更。
> 外部服务口径核查日期：**2026-11-10**（来源见各包内注明；价格/免费档以施工当日厂商 pricing 页复核为准，厂商 2026 年内已多次改版）。
> 全局约束（五包共同遵守）：对外链接一律只用自定义域 `top200.oppcal.com`，`*.pages.dev` 仅作运维预览、不得写入任何对外文案/canonical/OG/sitemap；不引入 Google Analytics 等带 Cookie 统计；不做境内镜像；不引入微信 JS-SDK。

## 结论先行（总览）

| 包 | 一句话结论 | 量级 | 成本 |
|---|---|---|---|
| W2-13 探针+告警 | **不用单厂商**：UptimeRobot Free（可用性+keyword）＋ healthchecks.io Free（dead man's switch）组合 $0 补齐；纯 UptimeRobot Free 不够——heartbeat 已移出免费档、新鲜度时间差 keyword 算不了 | M | $0 |
| W2-14 统计+隐私 | 从 **Pages 项目 Metrics 开关**启用（不是 Zone 级 Web Analytics 入口，二者混淆是已知静默失效坑）；隐私页独立落 `/privacy`；U7 未签收则统计不启用，写死为部署门禁 | S | $0 |
| W2-15 运营节奏 | 四触发点+2026-11-21 复核+季度体检全部改为可勾验清单并留痕 `ops/`；**一期 P2-4 的 tail 日志演练残余项确认在此收口，不单列工作包** | S | $0 |
| W2-16 SEO/分享 | 一次补齐 canonical/OG/favicon/robots/sitemap/JSON-LD 等静态项，全部零运行时依赖；微信卡片只承诺 best-effort，验收以 X/通用 OG 调试为准 | M | $0 |
| W2-17 静态注入+回链 | 构建期注入全 200 行快照 `<tr>`，**合并并取代一期 P2-8（首屏直出前 20 行）**；报告回链主落副标题区，U4 未确认时整段不渲染、不留死链 | M | $0 |

**对一期设计的主要调整（详见文末汇总）**：① 探针由「单选 UptimeRobot」改组合方案；② 新鲜度检查改走 `/api/health` 状态码语义（目标态）＋定时探针 ping（过渡态），不再指望 keyword 做时间判断；③ P2-8 被 W2-17 取代；④ tail 演练并入 W2-15 季度体检；⑤ pages.dev 双份内容仅靠 canonical 不够，但不做全量重定向（会毁预览流程），残余风险明示接受。

---

## W2-13 外部探针 + 邮件告警接入

### 目标设计

**选型复核（2026-11-10 核查）**

| 项 | UptimeRobot Free 现行口径 | 对本项目够不够 |
|---|---|---|
| 监控数 / 间隔 | 50 个监控、5 分钟间隔、无需绑卡、保留 3 个月（来源：UptimeRobot pricing 页 2026-10-20 抓取的定价复盘，notifier.so 2026-10 更新；多家 2026-11 对比站一致） | ✅ 本项目仅需 4–5 个监控，50 个绰绰有余；5 分钟意味着最坏发现延迟 ≈5 分钟＋告警投递，对「不长期盯盘、探针守夜」的定位可接受 |
| 监控类型 | 免费档仅 HTTP / keyword / ping / port（同上） | ⚠️ 见下两行 |
| keyword 断言 | keyword 监控支持双向：`ALERT_EXISTS`（出现即告警）与 `ALERT_NOT_EXISTS`（消失即告警），单监控只能绑 1 个 keyword（来源：UptimeRobot 帮助中心《Create Your First Monitor》2026-09-29 更新；v3 API 字段复盘 2026-10） | ✅ 正向＋负向各建一个监控即可覆盖；注意 keyword 只匹配服务端返回的原始响应体，不执行 JS——正因如此断言对象应选 `/api/board` 的 JSON 与首页静态 HTML（W2-17 注入后首页才有可断言的静态文本，见衔接说明） |
| heartbeat（dead man's switch） | **免费档已无 heartbeat**，与 API 监控、SSL/DNS 监控、maintenance windows、Webhook/Slack 一并移入 Solo 起付费档（Solo 10 监控 $13/月、年付 $12/月，2026-10 口径） | ❌ 这是与一期假设最大的出入：部署后检查、定时任务的「没来 ping 即告警」在免费档做不了 |
| 商业使用 | 2026-05-26 条款更新后 Free 恢复允许商业使用（条款 2026-06-24 修订），pricing 页「hobby/non-profit」只是营销文案；新增 Fair Use Policy，禁止多账号绕限额 | ✅ 单账号正常使用无碍，施工时截图存档条款页 |
| 告警通道 | 免费档含邮件告警＋5 个集成（Google Chat/Discord/Pushover/Pushbullet/Splunk）；无 Slack/Webhook | ✅ 本项目只要邮件，够用 |

**备选比较**

| 方案 | 组成 | 间隔 | heartbeat | 成本 | 取舍 |
|---|---|---|---|---|---|
| **A（主选）组合** | UptimeRobot Free（可用性/keyword）＋ healthchecks.io Free（dead man's switch） | 5 分钟 / 按 ping 周期 | ✅ healthchecks.io Hobbyist 免费 20 个 checks、每 check 100 条日志（来源：healthchecks.io pricing，2026-11-06/08 多站复核一致；Business $20/月 100 checks，本项目用不上） | $0 | 两个控制台，但各自都是该品类最稳的免费档；healthchecks.io 开源（BSD-3）可自托管兜底，厂商风险低 |
| B 单厂商 | Better Stack Free：10 个监控、3 分钟间隔、1 个状态页、免费档含 heartbeat（多站口径为 10 monitors＋10 heartbeats，来源：Better Stack pricing 复盘 2026-09/11） | 3 分钟 | ✅ | $0（付费 Responder $29–34/人/月，本项目用不上） | 一个控制台、间隔更短；但监控数上限紧（本项目够用）、产品面大迭代快、免费档定位个人项目，长期口径稳定性弱于 A |
| C 全付费 | UptimeRobot Solo（$12–13/月）单厂商全包 | 60 秒 | ✅ | ≈$144–156/年 | 能力最全，但为 heartbeat＋维护窗口付整年费用，与本站 $0 运营基线不符，**不选**；仅当 A/B 任一免费档再缩水时按此回退 |

**三条检查的精确配置**（检查对象一律自定义域；断言字符串施工第一步须与 `scripts/probe.sh` 现行断言原文逐字对齐，下表为语义规格，不得自创字符串）

| ID | 类型/厂商 | 对象 | 配置 | 失败语义 |
|---|---|---|---|---|
| M1 首页存活 | UptimeRobot HTTP | `GET https://top200.oppcal.com/` | 期望 200；间隔 5 分钟 | 站点/部署整体不可用 |
| M2 接口正向断言 | UptimeRobot Keyword | `GET https://top200.oppcal.com/api/board` | keyword＝probe.sh 正向断言原文（预期形如 `"mode":"live"` 及/或 200 条计数标记，施工时抄录），`Alert when: Keyword Not Exists` | 函数在但返回降级/空数据/结构变更（200 但内容坏） |
| M3 接口负向断言 | UptimeRobot Keyword | 同 M2 URL（独立监控，免费档单监控单 keyword，必须分开建） | keyword＝`<!DOCTYPE`（大小写按 probe.sh 原文，含 `<!doctype` 变体的取舍以 probe.sh 为准），`Alert when: Keyword Exists` | 函数异常时回吐 HTML 错误页而非 JSON——状态码可能仍是 200，只有负向断言能抓住 |
| M4 新鲜度 | 见下「新鲜度实现」 | `GET https://top200.oppcal.com/api/health`（目标态） | UptimeRobot HTTP，期望 200，非 200 即告警 | 数据陈旧 |

**新鲜度实现（本包关键设计，给两态、目标态为准）**：keyword 监控只能做字符串存在性判断，**无法解析 `updatedAt` 做时间差运算**，任何「用 keyword 查新鲜度」的写法都是假的，不采用。
- **目标态（随 W2-13 一并交付一个极小函数改动）**：新增/复用健康端点 `/api/health`，服务端判定：`now − board.updatedAt ≤ 新鲜度阈值`（阈值与 probe.sh 现行新鲜度阈值同值，施工时抄录，不新定）且条数＝200 时返回 `200 {"ok":true,...}`，否则返回 `503`。新鲜度由此变成状态码语义，M4 普通 HTTP 监控即可，延迟 ≤5 分钟。此端点只读、无敏感字段、响应不缓存（`Cache-Control: no-store`）。
- **过渡态（/api/health 未上线前）**：新鲜度由「定时探针＋dead man's switch」间接覆盖（见下），延迟放宽到 ≤1 小时＋宽限，并在 `ops/` 留痕标注为已知降级；不得对外宣称新鲜度是 5 分钟级。

**Dead man's switch 设计（healthchecks.io，免费 20 checks 中用 3 个）**

| ID | Check | 周期/宽限 | Ping 方式 | 缺席/失败语义 |
|---|---|---|---|---|
| HC1 定时全量探针 | 每 1 小时 | period 1h、grace 15 分钟 | 定时任务（GitHub Actions cron 或等价调度）跑 `scripts/probe.sh` 全量断言（含新鲜度时间差判定），成功 ping `/<uuid>`、任一断言失败 ping `/<uuid>/fail` 并附前 10 行日志（healthchecks.io 支持 ping body 存日志） | 两用：probe.sh 挂了（缺席）与断言真失败（/fail 立即告警）都能报，恰好补上 UptimeRobot 算不了的新鲜度 |
| HC2 部署后检查 | 事件型 | 不用周期缺席判定（部署是不定期事件，设周期必误报）：创建 check 后**暂停周期告警或设超长 period（如 90 天）仅作占位**，只用显式信号——部署管线在 probe 通过时 ping success、失败时 ping `/fail` | 部署脚本尾部 `curl` ping（URL 只存部署环境变量/保险箱，不进仓库明文、不进日志） | 部署后检查真失败时立即告警；「部署了但没人跑检查」这一类靠部署管线本身强制串联 probe 步骤防堵，不靠缺席判定（设计上如实承认此边界） |
| HC3 2026-11-21 复核 | 一次性 cron 型 | healthchecks.io 支持 cron 表达式＋时区：`0 9 21 11 *`、时区 Asia/Shanghai、grace 6 小时 | 复核任务（W2-15 清单）执行完成并留痕后 ping success；若当天另行取消复核，须手动 ping 或删除该 check 并留痕 | 到期未复核 → 当日下午即告警，避免「选定复核点」被静默错过；复核完成后删除/停用 HC3 |

ping URL 等同密钥：只存保险箱与调度器 secrets，`ops/` 文档只记 check 名称与 ID，不记完整 URL。

**告警收敛**
- 联系人只设 1 个：U3 邮箱（UptimeRobot 与 healthchecks.io 各设同一邮箱）；不启 SMS/语音（免费档无含短信额度，且夜间电话不符合本站运营强度）。
- 防抖：UptimeRobot 免费档无 maintenance windows、无高级确认策略——部署窗口内误报用「部署前 pause M1–M4、部署+probe 通过后 resume」的手动流程替代（写进 W2-15 部署后清单），不得靠忽略告警代替；healthchecks.io 侧 HC1 grace 15 分钟即天然防抖。
- 每起告警必须有恢复通知：两边均开启 UP/recovery 邮件；无恢复邮件的 DOWN 视为未闭环，次日运营动作中核对。
- 告警内容模板（在两边平台的告警标题/描述字段内配置，邮件正文须自带）：监控 ID（M1–M4/HC1–HC3）、对象 URL、断言原文与期望（exists/not-exists/状态码）、首次失败时间（Asia/Shanghai）、连续失败次数、最近一次 probe 日志链接/路径提示（`ops/probe-log.jsonl` 与 healthchecks 日志页）；healthchecks.io 的 /fail ping body 携带 probe 失败断言原文，实现「告警即带细节」。
- 同根因合并：一期故障只回一条主告警线程——运营规则写死：收到多条同时间窗告警时以 M4/HC1 为主线回复，其余在事件留痕中关联，不逐条转发用户（与 README「告警转达」触发点衔接）。

**U3 未提供时的降级（结论：先建探针、告警后补，不整体顺延）**
- 理由：监控的历史曲线与断言验证价值从建成日起累积（免费档仅保留 3 个月），整体顺延等于把验证期白白推后；而告警只是监控的一个联系人字段，补设是 ≤15 分钟的配置动作。
- 降级形态：账号由用户本人在注册环节当场提供一个邮箱完成注册（该邮箱即技术联系人）；监控全部建成并运行，告警联系人先只挂该注册邮箱，`PROBE_ALERT_EMAIL` 保持预留位；状态页/仪表盘可见性即此阶段的「告警」。
- 明示残余风险并留痕：U3 正式邮箱确认前，夜间故障可能无人收信——此风险在 `ops/signoffs.md` 记一行「降级运行中」并在每次运营触点复提，直到 U3 落地后销项。禁止用 agent 私人邮箱或一次性邮箱代注册（账号所有权与告警错投风险）。

### 实施步骤

1. 抄录 `scripts/probe.sh` 三断言与新鲜度阈值的原文到施工单，逐字核对后建监控（禁止凭记忆重写字符串）。
2. 用户本人注册 UptimeRobot Free 与 healthchecks.io Hobbyist（agent 陪跑指导，不代填密码）；两边各建上表 M1–M4、HC1–HC3，对象全部为自定义域。
3. 实现 `/api/health`（目标态）并随常规部署上线；上线前 M4 先以过渡态登记在案。
4. 配置定时调度跑 probe.sh＋HC1 ping（含 /fail 分支与日志附带）；部署管线尾部串 HC2 ping。
5. 配置告警收敛项：单一联系人、恢复通知、部署 pause/resume 流程写入 README 运营节奏（与 W2-15 同步修订）。
6. 执行触发演练（见验收）并将结果追加进 `ops/probe-log.jsonl` 与演练记录；顺手把 probe-log 中「key 注入前失败态」的旧记录标注归档说明，不删历史。

### 验收标准

- [ ] 演练 1（存活）：pause 一个克隆监控指向预览域坏路径（或临时改 M1 克隆的 URL 至 `/api/board-404` 克隆），≤10 分钟内收到 DOWN 邮件且正文含监控 ID 与断言细节；恢复后收到 UP 邮件。
- [ ] 演练 2（负向断言）：在**预览部署**上让 `/api/board` 返回一页 HTML（或用克隆监控指向一个返回 HTML 的测试路径），M3 克隆监控触发 Keyword Exists 告警。
- [ ] 演练 3（新鲜度）：`/api/health` 上线后，在预览环境用过期快照数据使其返回 503，M4 告警触发；正式环境 M4 连续 24 小时无误报。
- [ ] 演练 4（dead man's switch）：手动对 HC1 发一次 `/fail` ping → 立即收到告警且能看到附带日志；停发一个周期 → grace 后收到缺席告警。
- [ ] 演练 5（复核守夜）：HC3 以「次日测试日期」的 cron 临时验证一次触发与 ping 销项，再改回 2026-11-21 正式表达式并截图存档。
- [ ] M1–M4、HC1–HC3 的配置截图与 ID 清单存 `ops/probe-config.md`（不含 ping URL 与任何密钥）。

### 工作量级

**M**（配置与演练本身约 1 天；`/api/health` 小改动与陪跑注册、演练等待周期合计 2–3 天）。

### 成本

$0（UptimeRobot Free ＋ healthchecks.io Hobbyist）。回退方案 C 为 $12–13/月，非默认。

### 风险与回滚

- 免费档再缩水（2026 年已多次改版）：监控配置清单文档化（`ops/probe-config.md`），迁移到 Better Stack Free 只需按表重建，半天内完成；healthchecks.io 可自托管兜底。
- 误报疲劳导致告警被忽略：靠 pause/resume 纪律与恢复通知闭环控制；若单月误报 >3 次，季度体检（W2-15）必须复盘断言字符串。
- 回滚：删除/暂停全部外部监控即回滚，不触碰站点本身；`/api/health` 为新增只读端点，回滚即删函数文件并随部署下线，M4 同步暂停。

---

## W2-14 Web Analytics 启用 + 隐私说明页

### 目标设计

**启用路径（纠正一个已知坑）**：Cloudflare 有两个长得像的开关——Zone 级「Analytics → Web Analytics → Add a site」与 **Pages 项目级「Workers & Pages → crypto-top200 → Metrics → Web Analytics → Enable」**。对 Pages 站点只有后者真正注入 beacon；只开前者会出现「站点已建、Automatic setup 徽章发绿、三个月零数据」的静默失效（来源：dev.to 实测复盘 2026-09-17；Cloudflare 官方 Pages 文档《Enable Web Analytics》2026-04-21 更新，明确 Pages 一键路径为项目 Metrics 开关且「on the next deployment」生效）。本包只走项目级开关。
另注意权限边界：现行受限 API Token 仅有 Pages Edit 范围，**大概率无权经 API 开启 Web Analytics**——启用动作预设为用户本人在 Dashboard 点一次（agent 陪跑），不为这一步扩 Token 权限。

**可见数据清单与边界**（来源：Cloudflare Web Analytics 官方 FAQ/文档，核查 2026-11-10；Plausible 对比页与多份隐私页实测引用为旁证）

| 能看到 | 看不到 / 边界 |
|---|---|
| 页面浏览量、访问量（visits）、页面路径、来源站（referrer）、国家/地区、设备/浏览器/OS 粗分类 | **无事件级数据**：无自定义事件、无点击/筛选/自选币种等站内行为，无转化漏斗 |
| 真实用户性能：页面加载计时与 Core Web Vitals（LCP/INP/CLS 等，基于浏览器 Performance API） | **不记 URL 查询串**：UTM/渠道参数一律读不到，不要拿它做渠道归因 |
| 时间范围：仪表盘可查**过去 6 个月** | 留存：未采样 beacon 数据保留 **7 天**，之后聚合至约 10% 量级长期保存；大流量/长时段报表存在动态采样，绝对值勿当审计数 |
| 原理：beacon 脚本 `static.cloudflareinsights.com/beacon.min.js`，经 proxied 域名时回传本站 `/cdn-cgi/rum`；**无 Cookie、无 localStorage、无指纹、不跨站追踪**（Cloudflare 官方口径） | 读数偏差（本站必读）：① 广告拦截器按 EasyPrivacy 规则屏蔽 `cloudflareinsights.com`，拦截用户系统性少计；② **大陆访客少计更明显**——beacon 域在大陆网络可达性不稳定，部分访客脚本加载失败即无数据，因此大陆流量占比只可看趋势、不可当份额结论，季度体检引用数据时必须带此注脚；③ pages.dev 预览流量也会计入同一站点（若按主机名未拆分），读数时先按 hostname 过滤自定义域 |

**隐私说明页落位（结论：独立静态页 `/privacy`，不做 index 内锚点）**
理由：① 锚点依附首页，首页是 JS 榜单页，隐私文案无法被独立链接/收藏/收录，页脚与分享场景引用别扭；② 独立页可进 sitemap、可被搜索引擎单独索引、后续文案版本变更有稳定 URL；③ 成本几乎为零（一个静态 HTML，复用首页样式变量）。落位 `public/privacy/index.html`（或构建管线等价的 `/privacy` 路由），页脚与首页副标题区各放一条文字链。

**隐私说明页完整提纲（施工按此逐节写，文案经 U7 过目后定版）**

1. 本页说明什么＋最后更新日期＋适用域名（仅 `top200.oppcal.com`）。
2. 一句话总览：本站无账号、无广告、无 Cookie 统计；只有聚合流量统计与榜单数据代理两条数据流。
3. 数据流一 · Cloudflare Web Analytics：beacon 域名（`static.cloudflareinsights.com`，回传 `/cdn-cgi/rum`）；采集项逐项列（页面路径、referrer、国家、设备/浏览器/OS 粗分类、加载性能与 Web Vitals）；用途仅为了解访问量与性能；官方口径声明（无 Cookie/无本地存储/无指纹/不跨站追踪/不记查询串）；留存（未采样 7 天、聚合后仪表盘 6 个月）；本站能看到的是聚合报表，看不到单个访客记录。
4. 数据流二 · 榜单数据代理（CoinGecko）：说明浏览器不直连 CoinGecko，请求经本站服务端函数 `/api/board` 转发；服务端转发时上游可见的是本站服务器的请求而非访客身份信息（按实际实现如实写：是否缓存、缓存多久、是否记录访客 IP——施工时按函数代码逐项核对后落字，禁止写代码里没有的承诺）；本站不把榜单请求数据用于画像或出售。
5. 数据流三 · 浏览器本地存储：自选/收藏等功能若用 `localStorage`，数据只存访客本机、不上传、清浏览器数据即删除；本站自身不设任何 Cookie（如未来函数引入 Cookie 必须先改本页再上线，写为维护纪律）。
6. 「不收集什么」清单：不收集姓名/邮箱/手机号等身份信息；无注册登录；无广告与第三方营销追踪（含 Google Analytics 类工具明确不用）；不做指纹识别；不出售或共享个人数据（本站本就不持有）。
7. 屏蔽方法与不影响使用：可用广告拦截器屏蔽 `cloudflareinsights.com`、或浏览器全局拦截第三方脚本；屏蔽后本站全部功能（榜单、自选）照常可用，仅该次访问不计入统计；无 Cookie 横幅的原因一并说明（无 Cookie 故不弹）。
8. 变更与联系：文案变更时更新页首日期并在更新日志留痕；联系方式留用户指定邮箱占位（与 U3 可同址，施工时确认，不自创）。

**U7 门禁写法（写死进施工与部署清单）**：隐私文案全文须经用户过目，在 `ops/signoffs.md` 留一行签收记录（日期＋文案版本/文件哈希＋「同意启用统计」）后，方可执行启用步骤；**U7 未签收 ⇒ Web Analytics 保持关闭、部署检查单中该项记 N/A 而非跳过**；隐私页本身可先以草稿状态随站上线（它如实描述「统计尚未启用」的状态句留一版替换位），但开关不得先于签收打开。顺序不可倒置：先签收 → 再开开关 → 再把隐私页状态句改为「已启用」→ 重新部署。

### 实施步骤

1. 按提纲起草 `/privacy` 全文，逐项与 `/api/board` 函数代码、首页 localStorage 实际键名核对。
2. 提交用户过目（U7），签收记录入 `ops/signoffs.md`。
3. 用户在 Dashboard 走项目级路径开启 Metrics → Web Analytics（agent 陪跑核对点的是项目开关而非 Zone 入口）。
4. 触发一次正常重新部署（官方口径：下一次部署才注入 snippet；无需改代码、无需手写 beacon 标签——手写标签反而会与自动注入重复计数，禁止）。
5. 更新隐私页状态句为「已启用」并再部署（或将状态句切换与第 4 步合并为同一次部署，顺序以签收在先为准）。
6. 验证 beacon 真注入（见验收），并在 `ops/` 记启用日期与站点 token 的**后四位**（token 非密钥但仍不全量落盘）。

### 验收标准

- [ ] `curl -s https://top200.oppcal.com/ | grep -c static.cloudflareinsights.com/beacon.min.js` 结果为 1（有且仅有一份注入）。
- [ ] 24 小时后仪表盘出现自定义域的页面浏览数据（以「有数据」为准，不以开关徽章为准——这是本包的头号验收项）。
- [ ] `/privacy` 返回 200、含页首更新日期、页脚链接可达；文案与代码核对清单（数据流二逐项）签字留痕。
- [ ] 用开启拦截器的浏览器访问一次：页面功能完整，且明确知道该访问不会计数（预期行为，非故障）。
- [ ] `ops/signoffs.md` 中 U7 签收行日期早于启用日期（顺序可审计）。

### 工作量级

**S**（文案起草与核对约半天，启用与验证为小时级；不含等 U7 的日历时间）。

### 成本

$0（Web Analytics 对 Pages 免费、无限页面浏览量口径）。

### 风险与回滚

- 开错开关（Zone 级）导致静默零数据：验收第 1、2 条即为此设；发现零数据先查注入、不要先怀疑流量。
- 若日后引入严格 CSP，beacon 需放行 `static.cloudflareinsights.com`（script-src）与 `/cdn-cgi/rum`（connect-src 'self'），已在此备注给 W2-16 的 `_headers` 施工，避免相互打架。
- 回滚：Dashboard 关闭项目级开关＋将隐私页状态句改回，隨下一次部署生效；无数据迁移问题（聚合数据留在 Cloudflare 侧自然过期）。

---

## W2-15 运营节奏与季度体检清单定版

### 目标设计

把 README 已定版的运营节奏（四触发点／2026-11-21 复核／季度体检概念）细化为**可勾验、必留痕**的清单体系。原则：用户不长期盯盘，所有清单都为「事件触发时照单执行」设计，不产生日常打卡负担；每项含动作、证据（留痕文件）、完成判据三列，勾完即存档，不靠口头汇报。

**留痕位置规范（`ops/` 目录定版）**

```
ops/
  probe-log.jsonl            # 探针运行日志（既有，只追加不改写；历史失败记录加注不删）
  probe-config.md            # W2-13 监控/HC 清单（名称、ID、对象、断言原文；不含 ping URL/密钥）
  signoffs.md                # U3/U4/U7 等用户确认的签收行（日期+事项+版本/哈希）
  reviews/2026-11-21-review.md   # 选定复核点报告（用本包模板）
  quarterly/2027-Q1-checklist.md # 季度体检（每季一份，沿用本包逐项表）
  incidents/YYYY-MM-DD-<slug>.md # 告警事件留痕（触发即建）
  README.md                  # 本目录规范（文件命名、禁止存密钥、只追加原则）
```
密钥、ping URL、完整 token 一律不入 `ops/`；只允许记后四位与到期日。

**四触发点动作清单**

① 部署后（每次生产部署必走，≤15 分钟）
- [ ] probe.sh 全量断言通过，结果追加 `probe-log.jsonl`
- [ ] HC2 success ping 已发出（部署管线自动，人工抽查 healthchecks 日志页有记录）
- [ ] 外部探针未处于 pause（部署中若 pause 过 M1–M4，此时恢复）
- [ ] 若本次部署含数据/函数变更：抽查 `/api/board` 条数＝200、`mode` 字段、新鲜度各一项
- [ ] 若含静态文件变更：抽查 canonical/OG/favicon 抓取（与 W2-16 验收项共用）

② 数据更新（名单/快照/口径变更时）
- [ ] 名单 diff 核对：新增/退出币种清单与变更原因（顺延补位、去重规则）逐条对上
- [ ] 稳定币/锚定类计数＝0、总数＝200、无重复（三项数字写进留痕，不写「已核对」空话）
- [ ] 快照时间与新鲜度阈值复核；构建注入（W2-17）标记区计数＝200
- [ ] probe.sh 复跑通过

③ 告警转达（收到 DOWN/缺席告警时）
- [ ] 先自检复现（自定义域打开首页＋`/api/board`），区分真故障/误报/上游（CoinGecko）故障
- [ ] 建 `ops/incidents/` 事件页：起止时间、主告警 ID、根因、处置
- [ ] 只向用户转达一条汇总（故障性质＋影响＋是否已恢复），不逐条转发每封告警邮件
- [ ] 恢复通知（UP）到达后关事件页；无恢复通知则人工确认恢复并注明

④ 选定复核点（见下模板；下一次已定 2026-11-21）
- [ ] 按模板全项执行并成文 `ops/reviews/2026-11-21-review.md`
- [ ] HC3 success ping 发出（W2-13），HC3 随即停用/删除或改期到下一个用户选定日期——**没有用户新选日期时不得自行滚动生成下一个复核点**（遵守「不默认长期盯盘」约定）

**2026-11-21 复核清单模板（逐项）**

| # | 项 | 做法 | 判据/产出 |
|---|---|---|---|
| R1 | 接口契约 | probe.sh 三断言＋字段级抽查（条数、mode、价格/市值字段类型）与上次记录比对 | 无契约漂移；漂移项列明字段与影响 |
| R2 | 新鲜度 | 抽查当日 `updatedAt` 分布与探针日志中的新鲜度失败次数 | 给出最差新鲜度数值，不只写「正常」 |
| R3 | 探针历史 | 汇总 UptimeRobot 可用率（注意免费档仅保留 3 个月）＋healthchecks HC1 ping 成功率 | 两个百分比＋期间事件数，与 incidents 目录对账 |
| R4 | Web Analytics 摘要 | 若已启用：近 30 天 PV/visits、Top 来源、Web Vitals 中位数，**附大陆少计与拦截少计注脚**；若 U7 未过：本项记 N/A 及原因 | 数字带口径注脚，不下份额类结论 |
| R5 | 名单周检 diff | 全表与 CoinGecko 当日市值榜比对：进出名单、稳定币补位规则复检、重复检查 | diff 表全文入报告 |
| R6 | 两把钥匙到期日 | Cloudflare 受限 Token 与 CoinGecko Demo key：查各自到期/状态，算剩余天数 | 两行：到期日＋剩余天数；剩余 <30 天即列为待办并提示用户 |
| R7 | 窗口数据复核 | 本次复核既定主题（底部窗口 2026-10-04~11-20 关闭后的数据复核，含 11-20 美股时段）按原约定执行 | 结论与不确定性写入报告，标注「分析推演，不构成投资建议」 |

**季度体检逐项表（每季一份，沿用此表）**

| # | 项 | 动作与判据 |
|---|---|---|
| Q1 | Cloudflare Token | 有效期与权限范围复核（仍为最小范围 Pages Edit）；过期前轮换并做一次部署验证 |
| Q2 | CoinGecko Demo key | 状态/配额复核；若曾在聊天/截图暴露，按用户意愿安排重新生成并替换 Pages Secret（只记「已轮换」与日期，不记值） |
| Q3 | wrangler 版本 | 查当前版本与最新版差距；升级只在季度窗口做，升级后跑完整部署＋probe，失败即回退旧版并留痕 |
| Q4 | 回滚演练 | 在 Pages 控制台将生产回滚到上一部署版本 → probe 通过 → 再切回当前版本 → probe 通过；全程计时并留痕（只演练流程，不制造真实故障） |
| Q5 | **tail 实时日志演练（P2-4 残余收口项）** | 执行一次 `wrangler pages deployment tail`（或项目等价实时日志命令，施工时以当版 wrangler 文档为准）：能启动流、能触发一次真实请求并看到对应日志行、能按部署/函数过滤、能正常终止；演练中**禁止把含请求头/密钥的日志原文存入 ops/**，只存脱敏截图说明与「可达/不可达」结论 |
| Q6 | 合规自查 | 对照 `/privacy` 现行文案逐条核对实际数据流（统计开关状态、localStorage 键、函数转发行为）；首页与报告回链处「非投资建议」提示在位；无新增第三方脚本未登记 |
| Q7 | override 到期数 | 清点全部人工 override（名单补位、数据修正、文案覆盖等）：总数、已到期数、已续期/已撤销数；到期未处置数必须为 0 |
| Q8 | 备源条款复核 | 复读 CoinGecko 当期条款与免费 Demo 档限额（调用频率、商用/署名要求）；确认备源（如另一行情源）的字段可映射性结论是否仍成立，只复核结论不擅自切换 |
| Q9 | 外部免费档复核 | UptimeRobot／healthchecks.io／Web Analytics 免费口径有无变更（2026 年三家均有改版先例），有变更则更新 W2-13 对照表 |
| Q10 | 域名与证书 | `oppcal.com` 到期日、自动续费状态、Pages 自定义域绑定状态各查一次（免费档无 SSL 监控，此项人工补位） |

**关于 P2-4 tail 演练的收口确认（按任务要求明示）**：**确认收口于本包**——一期 P2-4 的残余项「tail 实时日志演练」并入季度体检 Q5，不单列工作包。理由：该演练是低频技能保鲜动作（故障时才用得上），无独立交付物，单列工作包会造成排期碎片；并入季度体检后有固定触发、有留痕判据、且与 Q4 回滚演练同场执行可互相借力（回滚时正好开 tail 观察）。一期台账中 P2-4 状态相应改为「残余项已并入 W2-15/Q5」。

### 实施步骤

1. 按规范建 `ops/` 目录结构与 `ops/README.md`，把四触发点清单写回项目 README 运营节奏节（替换原散文版，保留原四触发点定义不改口径）。
2. 生成 `ops/reviews/2026-11-21-review.md` 空模板（R1–R7 表头与判据预填），与 HC3（W2-13）对齐日期。
3. 生成首份季度体检空表 `ops/quarterly/`（季度归属按执行日历填，模板含 Q1–Q10）。
4. 首次季度体检即执行一次 Q4＋Q5 演练，为后续季度建立基线耗时与操作记录。

### 验收标准

- [ ] 四份清单（四触发点／复核模板／季度表／ops 规范）落盘且每项均含判据，非口号式条目。
- [ ] 用最近一次真实部署回放「部署后清单」，能全程勾完且每勾有证据文件对应。
- [ ] 2026-11-21 模板与 HC3 的日期、grace 设置一致（交叉核对记录在案）。
- [ ] Q5 演练完成一次并留脱敏记录；P2-4 台账状态已按收口结论更新表述。

### 工作量级

**S**（清单与模板编写约半天；首次演练基线半天）。

### 成本

$0。

### 风险与回滚

- 清单膨胀导致执行跳步：每份清单硬上限一页，新增项必须替换旧项并在季度体检评审。
- 留痕目录误存敏感信息：`ops/README.md` 明文禁令＋季度 Q6 抽查。
- 回滚：清单为文档资产，回滚即恢复上一版 README/模板，git/文件历史可查（若仓库未启用版本管理，施工时在 `ops/` 留一份日期化副本）。

---

## W2-16 SEO / 分享基础包

### 目标设计

一次性补齐全部静态 SEO/分享项，零运行时依赖、零第三方脚本。色系与品牌基线：背景 `#0b0e14`、强调金 `#f0b90b`（与 OG 图、theme-color、favicon 共用）。

**逐项规格**

1. **title（沿用现标题，仅核对）与 meta description（新增，文案定版）**
   - description 定版文案（约 68 字，含关键信息与免责）：
     > 市值前200加密货币下一轮牛市预估排名：实时价格、市值与上涨倍数空间一览，数据来自 CoinGecko 实时行情。本站为历史周期分析推演，不构成投资建议。
   - 施工注记：写入 `<meta name="description" content="…">`，逐字使用上文，不得在施工时自行加币种名或收益承诺类词语；OG/Twitter description 复用同一文案（见第 3 项），三处必须一致，后续改文案三处同改（写进季度 Q6 抽查）。

2. **canonical**
   - 首页：`<link rel="canonical" href="https://top200.oppcal.com/">`；`/privacy`：自指 `https://top200.oppcal.com/privacy`（路径尾斜杠与 Pages 实际解析形式施工时统一一处，全站一致）。
   - pages.dev 双份内容处置（结论）：canonical 是主信号；**不做 pages.dev → 自定义域全量重定向**（会毁掉部署预览与回滚验证流程，得不偿失）；也不用 `_headers` 全局加 `noindex`（`_headers` 无法按主机名区分，会误伤正式域）。可选增强（列为施工可选项、非验收必需）：用 Pages Functions 中间件按 `Host` 判断，仅对 `*.pages.dev` 响应加 `X-Robots-Tag: noindex`——若做，必须先在预览部署验证正式域响应不带该头才可上线。残余风险明示：canonical 生效前 pages.dev 副本仍可能被个别引擎短暂收录，接受。

3. **OG 全套 + Twitter Card**（值定版，`og:image` 等待第 4 项产出后填绝对 URL）

   | 属性 | 值 |
   |---|---|
   | `og:type` | `website` |
   | `og:site_name` | 与站名一致（施工时抄录现 title 中的站名，不新造） |
   | `og:locale` | `zh_CN` |
   | `og:title` | 同首页 title |
   | `og:description` | 同第 1 项 description 定版文案 |
   | `og:url` | `https://top200.oppcal.com/` |
   | `og:image` | `https://top200.oppcal.com/og-cover.jpg` |
   | `og:image:width/height` | `1200` / `630` |
   | `og:image:alt` | `市值前200加密货币预估排名榜单封面` |
   | `twitter:card` | `summary_large_image` |
   | `twitter:title/description/image` | 与 og 同值逐项写死（不依赖各平台回退规则） |

4. **OG 图制作规格（1200×630）**
   - 画布 1200×630；背景纯 `#0b0e14`；主标题两行内、字号 ≥64px、白色；金色 `#f0b90b` 只用于强调线/名次数字/一处点缀，占比 <15%，避免整图发黄。
   - 内容：站名＋一句话副题（与 description 首句同义）＋右下或底部一条榜单剪影（前 5 名的简化行：名次/币名/倍数，数字用快照近似值并注「示意」或干脆只用名次与币名，不放具体价格——避免图内价格过期被截图传播误读，**结论：图内不放具体价格与涨幅数字**）。
   - 免责小字：底部一行「分析推演，不构成投资建议」，字号 ≥20px、对比度可读，不藏进角落低对比灰字里。
   - 安全边距 ≥60px；**缩略可读性验收**：导出后缩到 120×63 与 300×157 两档肉眼可辨主标题，辨不出则加大字号重出。
   - 交付格式：部署文件为 JPG（质量约 82），路径 `public/og-cover.jpg` → 线上 `/og-cover.jpg`，**体积目标 ≤200KB、硬上限 300KB**；PNG 源稿留设计源目录（不部署）。更新图时改文件名版本号（如 `og-cover-v2.jpg`）并同步改 meta，避免 CDN/平台缓存旧图；`_headers` 对该路径设 `Cache-Control: public, max-age=86400`（一天，配合改名策略，不用 immutable 以防改名漏改时长期缓存错图）。

5. **favicon（SVG+ICO 双格式，外加一个低成本项）**
   - SVG 源稿：深色圆角方底（`#0b0e14`）＋金色粗体「200」字样（或等价的金币圆形＋200，二选一在施工稿定版，全站只用一款）；`public/favicon.svg`，体积 ≤2KB、纯矢量无外链字体（数字用路径或通用字重，避免字体缺失变形——定版做法：文字转路径）。
   - ICO：由 SVG/PNG 母版导出 16/32/48 三尺寸打包 `public/favicon.ico`，置站点根目录（同时满足 `/favicon.ico` 的浏览器默认请求）。
   - 附带（成本近零，一并做）：`apple-touch-icon` 180×180 PNG（同图稿、实底不透明）。
   - head 引用三行写死：`icon type=image/svg+xml`、`icon /favicon.ico sizes=any`、`apple-touch-icon`。

6. **robots.txt**（`public/robots.txt`，内容定版）
   ```
   User-agent: *
   Allow: /

   Sitemap: https://top200.oppcal.com/sitemap.xml
   ```
   不屏蔽 `/api/`（其本就不是可索引内容，且屏蔽声明无实际防护作用）；不加任何 pages.dev 字样。

7. **sitemap.xml**（`public/sitemap.xml` 或构建生成，先只列两页）
   - URL 仅：`https://top200.oppcal.com/`（priority 1.0、changefreq weekly）与 `https://top200.oppcal.com/privacy`（priority 0.3、changefreq yearly）。
   - `lastmod` 写实际部署/更新日期，禁止脚本每次构建自动刷新 lastmod 冒充内容更新；后续新增页面（如报告回链若落本站内页）时再扩列，外部研究报告 URL **不**进本站 sitemap。

8. **JSON-LD（WebSite + Dataset，字段设计）**
   - 以一个 `@graph` 数组同页输出两节点；字段如下，方括号为施工时按实填写、禁止编造：
   ```json
   {
     "@context": "https://schema.org",
     "@graph": [
       { "@type": "WebSite", "name": "[站名]", "url": "https://top200.oppcal.com/",
         "inLanguage": "zh-CN", "description": "[同 meta description]" },
       { "@type": "Dataset", "name": "市值前200加密货币下一轮牛市预估排名",
         "description": "[同上，数据集口径版]", "url": "https://top200.oppcal.com/",
         "inLanguage": "zh-CN",
         "variableMeasured": ["现价", "市值", "市值排名", "预估倍数空间", "预估排名"],
         "measurementTechnique": "基于历史周期与市值锚定的分析推演，实时行情来自 CoinGecko",
         "creator": { "@type": "Organization", "name": "[站名]" },
         "isAccessibleForFree": true,
         "distribution": [{ "@type": "DataDownload", "encodingFormat": "application/json",
                            "contentUrl": "https://top200.oppcal.com/api/board" }] }
     ]
   }
   ```
   - 不写 `license`（无明确授权口径，不编造）、不写虚构的 `dateModified` 高频更新值（可写构建日期或省略）；`contentUrl` 指向公开接口属实才保留，接口若日后加鉴权须同步删此字段（入 Q6 抽查）。

9. **theme-color 与其他 head 项**
   - `<meta name="theme-color" content="#0b0e14">`（可加 `media="(prefers-color-scheme: dark)"` 同值一行，本站深色单主题，两行同色即可）。
   - `<html lang>` 已为 zh 方向的现值核对为 `zh-CN`；charset/viewport 已有不动。

10. **noscript 说明行**
    - 定版文案（放在榜单区上方，样式与状态条一致）：
      > 本站榜单由 JavaScript 加载实时行情。未启用 JavaScript 时，您看到的是页面构建时的快照榜单（见表注时间），数据可能不是最新。
    - 与 W2-17 的衔接：W2-17 上线后此文案成立（快照实存）；若 W2-16 先于 W2-17 施工，noscript 文案临时改为「本站榜单需要 JavaScript 才能加载，请启用后刷新。」并在 W2-17 验收时切换为定版——两包验收单互相勾连，防止出现「noscript 说有快照但表是空的」的假承诺。

11. **`_headers`（本包顺带新建，最小集）**：仅含 OG 图与 favicon 的缓存规则（favicon：`max-age=604800`；og-cover 见第 4 项）以及 sitemap/robots 的正确 `Content-Type` 兜底（Pages 默认已对，写明是防构建管线改名时兜底）；**不**在本包加 CSP（避免与 W2-14 beacon 冲突，CSP 另行立项时必须包含 beacon 放行项）。

### 实施步骤

1. 按第 4 项出 OG 图稿，过缩略可读性自检后导出部署 JPG 与源稿归档。
2. 按第 5 项出 favicon 三件套。
3. 改 `index.html` head：按序写入 description、canonical、OG、Twitter、theme-color、favicon 三行、JSON-LD；`/privacy` 页（W2-14）同步自指 canonical 与基础 OG（image 复用全站 OG 图）。
4. 新建 `robots.txt`、`sitemap.xml`、`_headers`（落 `public/` 对应路径）。
5. 部署后逐项抓取验证（见验收），分享验证在正式域做，不用预览域链接外发测试（避免预览 URL 被平台缓存传播）。

### 验收标准

- [ ] 线上抓取：canonical、description、OG/Twitter 全属性与规格表逐字一致；`og:image` 返回 200 且 `Content-Type` 为 jpeg、体积 ≤300KB。
- [ ] Google Rich Results Test（或等价结构化数据校验）对首页 JSON-LD 无错误（Dataset 的警告项逐条记录，无 error 即可）。
- [ ] `/robots.txt`、`/sitemap.xml` 返回 200，sitemap 内仅两条自定义域 URL 且均可访问。
- [ ] 分享调试：Facebook Sharing Debugger 抓取无报错且预览图为新 OG 图（必要时用其「重新抓取」刷缓存）；X 发帖预览（或 Card 校验等价工具）显示大图卡；Telegram 向自己发送链接预览正常。三者各存一张截图入施工记录。
- [ ] **微信实发验证（预期管理，非通过性验收）**：向文件传输助手/自己发送正式域链接并点开——如实记录卡片形态（可能为纯链接、缩略图缺失或抓取到非 OG 图）。边界告知定版话术：未引入微信 JS-SDK、未做公众号网页授权与域名认领，故朋友圈/聊天卡片的标题图不由本站完全控制，微信侧还可能对未备案域名给出提示页；**本包承诺的是标准 OG 协议正确，微信内卡片属 best-effort，不作为回滚理由**。
- [ ] favicon 在 Chrome/移动 Safari 各肉眼确认一次显示为新图（清缓存后）。

### 工作量级

**M**（OG 图与 favicon 设计迭代占大头，约 1.5–2 天；head 与静态文件为小时级）。

### 成本

$0（校验/调试工具均免费；不购买任何 SEO 服务）。

### 风险与回滚

- 平台缓存旧 OG 图：靠改名版本号策略处理，不靠反复部署碰运气。
- JSON-LD 字段与实际不符（如接口鉴权变化）会被 Q6 抽查兜底；发现不符先删字段再议补。
- 回滚：head 改动与静态文件均为纯增量，`git`/部署版本回退即恢复；OG 图回滚需同步改回 meta 中的文件名（改名策略的代价，已知并接受）。

---

## W2-17 构建期静态注入榜单 + 报告回链

### 目标设计

**要解决的问题**：现首页 200 行榜单 100% 靠 JS 渲染，静态 HTML 中数据占比 0%——爬虫抓不到内容、无 JS 时白屏、函数故障时用户无任何数据可看。本包在**构建期**把一份榜单快照预渲染为真实 `<tr>` 写进 `index.html`，JS 加载成功后以实时数据整表替换；注入的是「带时间标注的快照」，不是伪装成实时的静态数。

**与一期 P2-8 的关系（结论：合并并取代）**
一期 P2-8「首屏直出前 20 行」与本包是同一机制（构建期注入）的子集关系：只注 20 行时，爬虫仍拿不到其余 180 行、无 JS 用户看到残表、且要维护「前 20 静态＋后 180 JS 拼接」的双路渲染逻辑（排序/筛选时极易错位）。本包直接全量 200 行注入并由 JS **整表替换**，逻辑单路、口径统一。**结论：P2-8 关闭，状态记「已并入 W2-17 被取代」，其验收点（无 JS 首屏可见真实行）由本包验收继承并加强为全表。** 唯一保留的回退：若上线后实测注入体积对 LCP 净影响为负（判据见验收），降级为只注前 50 行——仍走同一标记区机制，改生成脚本一个参数，不复活 P2-8 的拼接逻辑。

**实现设计**

- **快照来源**：构建管线已有的榜单数据产物（与线上 `/api/board` 同源同口径的那份构建快照 JSON，施工时以 W2-11 构建管线实际产物文件名为准对接，禁止为本包另开一条抓数路径造成双源）。生成脚本为管线新增一步 `render-snapshot`（命名施工时对齐 W2-11 管线既有脚本命名风格），位于数据产物生成之后、Pages 部署之前。
- **注入标记区**：模板 `index.html` 的榜单 `<tbody id="board-body">` 内置唯一标记对：
  ```html
  <tbody id="board-body">
  <!-- SNAPSHOT:BEGIN -->
  <!-- SNAPSHOT:END -->
  </tbody>
  ```
  脚本只替换两标记之间的内容并在区内首行写入生成注释 `<!-- generated:<ISO时间> source:<快照文件名> count:200 -->`。脚本健壮性写死：标记缺失、重复出现、或源数据条数 ≠200 → **构建失败并中止部署**（宁可不发版，不发一张空表/残表）；HTML 转义对币名/符号全量执行（名称来自外部数据，按不可信输入处理）。
- **行模板一致性**：快照 `<tr>` 的列序、class、价格/市值格式化（小数位、千分位、币种符号）必须复用前端渲染同一套格式化规则——施工做法：格式化函数抽为构建脚本与前端共用的单一实现（或构建脚本 import 前端模块），禁止在脚本里另写一套 `toFixed` 口径；预估倍数等派生列同理。行上带 `data-snapshot="1"` 属性供 JS 识别与整表清理。
- **JS 实时重绘的幂等性**：前端逻辑定版为——取数成功 ⇒ 清空 `tbody` 全部子节点后按实时数据重建（不做逐行 diff、不保留任何快照行）；取数失败 ⇒ **不触碰** tbody，快照原样保留；重复触发（刷新按钮、可见性恢复重拉）走同一路径，结果一致。验收以「连点三次刷新、行数恒为 200 且无重复行」为准。
- **状态标注一致性（三态文案定版，解决「快照冒充实时」的诚信问题）**：
  | 状态 | 状态条文案 | 数据来源 |
  |---|---|---|
  | 静态初始（JS 未执行/未返回） | `快照数据 · 生成于 <快照时间>，正在加载实时行情…`（此句直接写在静态 HTML 里，是默认态） | 快照 |
  | JS 取数成功 | `实时数据 · 更新于 <接口 updatedAt>`（沿用现行实时状态文案口径） | 实时 |
  | JS 在但取数失败/函数故障 | JS 把状态条改为 `实时行情暂不可用，显示构建时快照 · 生成于 <快照时间>`；JS 整体失效时保持默认态文案（本就写明是快照，不误导） | 快照 |
  表格 `<caption>` 或表注同步常驻一行：`无实时数据时显示构建快照，生成时间见状态条。`——与 W2-16 的 noscript 文案互相呼应、口径一致。
- **体积估算与 LCP 影响（施工时实测复核，设计预估如下）**：单行 `<tr>`（名次/币名/现价/市值/倍数等约 8–10 列、含 class 与 data 属性）约 260–420 字节，200 行 ≈ **55–85KB 未压缩**；经 Cloudflare Brotli/gzip 后传输增量约 **12–20KB**。对 LCP 的净判断为**正**：内容不再等待「HTML→JS→API→渲染」串行链，首屏榜单随 HTML 到达即可绘制，省去一个 API 往返＋JS 渲染时长；负项仅为 HTML 解析量微增，在上述量级下可忽略。施工须以同设备/同网络节流的 Lighthouse 前后对比留档，若 LCP 退化 >0.3s 则触发上文「降级前 50 行」回退条款，不硬上全量。

**研究报告回链（落点定版）**
- 主落点：**副标题区下方独立一行文字链**——上下文最强（读者正读「这是什么榜单」）、首屏可见；锚文本定版方向：`方法与数据口径：《币圈涨跌轮回周期研究报告》`（书名号内为报告正式名，施工时抄录现站内已有的报告名原文）。
- 次落点：方法论/口径说明区的标题旁或段末「延伸阅读」同链一处。全站回链**最多这两处**，页脚署名行**不放**（页脚放的是隐私页与免责声明链接，避免把方法论出处埋进署名行被误读为作者署名）——此点与「页脚署名行」候选明确切割，理由如前。
- 链接属性：若报告托管在本站域外 → 新窗口 `target="_blank" rel="noopener"`；若在本站同域 → 同窗口、无 noopener 需求。仅允许指向 `https://` 地址。

**U4 未确认时的占位降级（定版）**
- 构建变量 `REPORT_URL`（管线环境变量/配置文件一处定义）：为空时，两个落点的**链接元素整段不渲染**——副标题区只保留现行纯文字报告名表述（即当前线上形态），方法论区不出现空位、不出现「链接待补充」等对访客无意义的占位字、不出现 `href="#"` 死链。
- U4 确认后仅填变量＋重新部署即生效，零代码改动；启用当天按 W2-15「数据更新」清单抽查链接可达与锚文本。

### 实施步骤

1. 对接 W2-11 管线：定位构建快照产物，新增 `render-snapshot` 步骤并实现标记区替换、计数断言、转义与失败中止。
2. 抽共用格式化实现，前端改为「成功整表替换/失败不触碰」逻辑与三态状态条文案。
3. 模板写入标记区、默认态状态文案、表注行；`REPORT_URL` 变量接入两个回链落点（初始为空走降级形态，除非 U4 已确认）。
4. 预览部署全项验收（含断网/函数故障模拟），再走正式部署＋部署后清单（W2-15 ①）。

### 验收标准

- [ ] `curl` 正式域首页 HTML：`SNAPSHOT:BEGIN/END` 间 `<tr>` 计数＝200，生成注释含时间与来源；静态 HTML 数据行占比由 0% 变为全量。
- [ ] 禁用 JS 打开：全表可见、状态条显示快照文案与生成时间、noscript 说明行在位（与 W2-16 定版文案一致）。
- [ ] 正常打开：实时数据整表替换快照，行数恒 200；连点刷新 3 次无重复/残行；状态条切为实时文案。
- [ ] 故障模拟（预览环境令 `/api/board` 返回 500）：快照保留、状态条切为「暂不可用」文案，不出现白屏或空表。
- [ ] 构建负向测试：把快照源改成 199 条 → 构建必须失败且不部署；标记删一处 → 同样失败。
- [ ] Lighthouse 前后对比留档：LCP 不退化 >0.3s（或已按回退条款降级并记录）；HTML gzip 后体积增量与预估量级（12–20KB）同数量级。
- [ ] 回链：U4 未确认时全页 `grep 'href="#"'` 为空、无占位文案；U4 已确认时两处链接可达且属性正确。

### 工作量级

**M**（生成脚本＋前端替换逻辑约 1.5 天，联调与负向测试 1 天，合计 2–3 天；依赖 W2-11 管线接口先行对齐）。

### 成本

$0（构建期脚本与现有 Pages 部署，无新增服务）。

### 风险与回滚

- 快照过期被误读为实时：靠三态文案与表注防堵，这是本包的诚信红线，验收不过不上线。
- 构建源数据异常把坏表带上线：计数断言＋失败中止部署兜底；真出问题时回滚到上一部署（快照随版本走，无独立数据状态）。
- 回滚：移除管线 `render-snapshot` 步骤即恢复纯 JS 渲染形态（标记区为空，前端逻辑向后兼容空 tbody），一键可退。

---

## 附：对一期设计的主要调整汇总（供决策留痕）

| # | 一期原设计 | 二期调整 | 理由 |
|---|---|---|---|
| 1 | 探针默认单选 UptimeRobot（含 heartbeat 设想） | 改为 UptimeRobot Free ＋ healthchecks.io Free 组合（W2-13 方案 A） | 2026-11-10 核查：免费档 heartbeat 已移入付费 Solo；组合方案 $0 补齐且各自品类最稳 |
| 2 | 新鲜度拟用 keyword 检查实现 | keyword 只做存在性断言；新鲜度改走 `/api/health` 状态码（目标态）＋定时 probe 的 dead man's switch（过渡态） | keyword 无法解析时间戳做差值，原设想技术上不成立，必须纠正而非将就 |
| 3 | P2-8 首屏直出前 20 行（独立项） | 关闭并入 W2-17 全量 200 行注入 | 同一机制的子集；双路渲染易错位，全量整表替换口径更干净 |
| 4 | P2-4 tail 日志演练（残余未收口） | 并入 W2-15 季度体检 Q5，不单列工作包 | 低频技能保鲜、无独立交付物；季度触发＋与回滚演练同场更可执行 |
| 5 | pages.dev 双份内容拟靠 canonical 解决 | canonical 为主＋可选 Functions 按 Host 加 `noindex` 头；明确拒绝全量重定向 | `_headers` 不能按主机名区分、全量重定向会毁预览/回滚流程；残余收录风险明示接受 |
| 6 | Web Analytics 笼统说「在 Pages 开启」 | 精确到项目级 Metrics 开关，并把「只开 Zone 级导致静默零数据」列为头号验收风险 | 已有公开实测踩坑案例（2026-09）；验收以「有数据＋HTML 有注入」为准而非开关状态 |
| 7 | 微信分享拟按 OG 标准验收 | 微信卡片降为 best-effort 记录项，验收以 OG 调试工具＋X/Telegram 实发为准 | 未引入 JS-SDK 与域名认领时微信卡片不由本站控制，把不可控项写成通过性验收只会制造假失败 |


---

# 第六章 · 安全与合规（W2-18 ～ W2-21）

# 05 · 安全与合规工作包（二期）

> 范围：币圈前 200 预估站 https://top200.oppcal.com（备用 https://crypto-top200.pages.dev），Cloudflare Pages 项目 `crypto-top200`，且**只动 `crypto-top200`**（硬红线）。
> 基线日期：2026-11-10（一期审计属实基线，见任务书）。本文为**设计定版、未施工**；所有命令/文件内容为施工蓝本，执行时逐项打勾留痕。
> 结论先行：本期安全投入的排序是 **W2-20 密钥轮换（立即，事件驱动）> W2-18 响应头/CSP（防白屏工程化后上线）> W2-19 限流收口（W2-01 后校准）> W2-21 合规机制（轻量留痕）**。本站无登录、无用户数据、零 Cookie，真实风险不在数据泄露，而在①已暴露的 CoinGecko key 被蹭额度、②CSP 配错全站白屏、③上游额度被刷穿、④合规话术/署名漂移。四包均按此风险面定版，不做与攻击面无关的仪式性加固。

## 0. 外部口径复核（2026-11-10 以 browser_search 核查，施工前须再核一次）

| # | 口径 | 复核结论 | 来源 |
|---|---|---|---|
| E1 | Cloudflare 免费计划 Rate Limiting 规则数 | **仅 1 条**（新版规则）；Pro 2 条、Business 5 条 | Cloudflare 官方文档 Rate limiting rules（developers.cloudflare.com/waf/rate-limiting-rules/，文档更新 2026-08-25）及旧版升级页 |
| E2 | 免费层限流能力边界 | 计数特征**仅源 IP**；计数周期**仅 10 秒**；缓解时长**仅 10 秒**；表达式可用字段**仅 Path 与 Verified Bot**（无 Host、无 Method、无 Header——Method/Host 字段自 Business 起） | 同上官方 Availability 表 |
| E3 | Pages `_headers` 限制与覆盖面 | 最多 **100 条规则、每行 ≤2,000 字符**；**`_headers` 不作用于 Pages Functions 的响应**（即使路径命中规则），Function 响应头必须在代码里自带 | Cloudflare 官方文档 Pages/Workers Custom headers partial（cloudflare-docs 仓库）多处复述一致 |
| E4 | Web Analytics beacon 与 CSP | beacon 脚本源 `https://static.cloudflareinsights.com`，数据回 POST `https://cloudflareinsights.com/cdn-cgi/rum`（204）；CSP 须同时放行 `script-src https://static.cloudflareinsights.com` 与 `connect-src https://cloudflareinsights.com`，缺一则**静默失效、无报错** | Cloudflare 官方 CSP 指引转述（dmarcguard.io 汇总）+ 多个 2026 年实测修复文（dev.to / ecomsolve 等） |
| E5 | CoinGecko Demo 档 key 数 | **1 把 API Key**（10k credits/月）；Basic（$35/月）同为 1 把；10 把 key 自高阶付费档起 | CoinGecko 官方定价页 coingecko.com/en/api（Entry Plans） |
| E6 | CoinGecko 费率口径分歧 | 官方 FAQ 仍写 Demo 30 次/分钟，多个 2026 年来源称 2026-05-17 已升至 100 次/分钟。**本设计不依赖该数值做任何阈值决策**，仅记录分歧，额度保护按 credits/月（10k）理解 | 官方定价页 FAQ vs coinstats.app 对比文（2026-10 核）等 |
| E7 | CoinGecko 付费层坑位 | Demo：base `https://api.coingecko.com/api/v3` + 头 `x-cg-demo-api-key`；付费：base `https://pro-api.coingecko.com/api/v3` + 头 `x-cg-pro-api-key`。两套**不可互换**，且 key 格式肉眼不可区分、代码无法自动判档 | CoinGecko 集成文档多源一致（docs.extract.to、dlthub 等，2026-11 核） |
| E8 | Mozilla Observatory 评分要点 | 起始 100 分；CSP `script-src` 含 `'unsafe-inline'` **−20**；缺 HSTS −20、HSTS `max-age` <6 个月 −10；`preload`+`includeSubDomains` +5；**A = 90–99，A+ ≥100** | Observatory 评分体系复述（sscheck/pkg.go.dev 等，2026-11 核） |
| E9 | Zone 级功能的域名边界 | WAF 自定义规则 / Rate Limiting / Bot Fight Mode 均为 **Zone（自定义域名）层级**功能；`*.pages.dev` 不在用户 Zone 内，**无任何 Zone 控制权**，Zone 规则对其完全不生效 | 多个 Pages 加固实录（github.com/lewis0x、cloudflare-killswitch README 等） |
| E10 | HSTS preload 的不可逆性 | `preload` 一旦提交浏览器预载列表，实质不可逆；新子域未上 HTTPS 将被硬拦截。通行做法：先无 preload 运行数月，稳定后再单独决策 | 多个 2026 年安全头指南一致（webchkr、medium、mohammedbanani 等） |

> 注：E1/E2 与部分二手博客（如称免费层周期可 60 秒）冲突时，**以官方 Availability 表为准**。施工当日在控制台创建规则界面再截图确认一次，截图存入 W2-21 合规留痕（见 W2-21）。

---

## W2-18 安全响应头与 CSP

**结论：采用「内联脚本/样式 hash + 生成脚本自动产出 `_headers`」方案，外置 JS 方案否决为备选保留（触发条件见 §18.6）。CSP 分 WA-OFF / WA-ON 两变体，只有所属变体与 W2-14 的实际上线状态一致时才允许发版。验收目标定为 securityheaders.com A 级 + MDN Observatory ≥90（A 级），本期不承诺 A+（理由见 §18.4）。工作量 M。**

### 18.1 目标设计

#### 18.1.1 职责分界（先于一切取值——一期设计的关键修正）

由 E3：`_headers` 只覆盖**静态资产响应**，不覆盖 Pages Functions。因此全站头分三处下发，缺一处即留洞：

| 路径 | 响应产生方 | 头的下发处 | 本包交付物 |
|---|---|---|---|
| `/`、`/index.html` 及其余静态文件 | Pages 静态托管 | `public/_headers`（生成，禁手改） | §18.2 定版文件 |
| `/api/board` | Pages Function（`onRequestGet`） | **Function 代码内常量**（与现有 Cache-Control 头组同处合并下发） | §18.3 头组常量 |
| `/data/*` | 视 W2-01/W2-03 落地形态：静态文件则走 `_headers` 分组；经 Function/KV 读出则走代码常量 | 两处写同一组值 | §18.2 分组 + §18.3 常量共用取值表 |

HSTS 的下发处单独决策，见 §18.1.3。

#### 18.1.2 CSP 定版（逐指令取值与理由）

前提审计（施工第 0 步，不通过不发版）：现 `public/index.html` 为单文件、JS/CSS 全内联。须先确认：①内联 `<script>` 块与 `<style>` 块的数量与边界；②**全文无 `onclick=` 等内联事件属性、无 `javascript:` URL**（hash 只覆盖 `<script>` 块本身，事件属性走 `script-src-attr`，一旦放行 `'unsafe-inline'` 于该指令，Observatory 与实际防护同时塌方——发现即先重构为 `addEventListener`，不许用放行解决）；③`style="…"` 属性清单（走 `style-src-attr` 单独决策，见下）；④无 `eval` / `new Function`（有则先重构，`'unsafe-eval'` 永不放行）。

WA-OFF 变体（W2-14 未启用时唯一允许上线的变体；`{{...}}` 为生成脚本替换位）：

```text
default-src 'none'; script-src 'self' {{SCRIPT_HASHES}}; style-src 'self' {{STYLE_HASHES}}; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'; manifest-src 'self'; upgrade-insecure-requests
```

WA-ON 变体（仅当 W2-14 实际启用 Web Analytics 的同一发版内切换）：

```text
default-src 'none'; script-src 'self' {{SCRIPT_HASHES}} https://static.cloudflareinsights.com; style-src 'self' {{STYLE_HASHES}}; img-src 'self' data:; font-src 'self'; connect-src 'self' https://cloudflareinsights.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'; manifest-src 'self'; upgrade-insecure-requests
```

逐指令理由：

| 指令 | 取值 | 理由 |
|---|---|---|
| `default-src` | `'none'` | 本站资源面极小（无外链脚本、无第三方字体/图片），以全关为基线、逐项白名单，比 `'self'` 基线更严且 Observatory 友好 |
| `script-src` | `'self'` + 每个内联块一个 `'sha256-…'`（+ WA-ON 时 beacon 域） | `'self'` 保留同源外置脚本的未来余地且不扣分；hash 使内联脚本可执行而**不引入 `'unsafe-inline'`**（E8：script 的 unsafe-inline −20，是 A 级的分水岭）；beacon 为外源文件脚本、只能按域放行（E4），其内容由 Cloudflare 控制、无法 hash |
| `style-src` | `'self'` + `<style>` 块 hash | 同上。**例外决策**：若审计发现大量 `style="…"` 属性且短期无法内聚，允许追加 `style-src-attr 'unsafe-inline'`（仅 attr、仅样式）作为过渡，并在生成脚本中打 `TODO-W2-18` 标记、纳入季度自查（W2-21）复核是否可摘除；`style-src` 本体永不加 `'unsafe-inline'` |
| `img-src` | `'self' data:` | 币种图标若为同源或 `data:` 内嵌均可覆盖；出现外源图标域需求时逐域追加并在变更单里说明，禁止 `https:` 通配 |
| `font-src` | `'self'` | 现用系统字体栈，`'self'` 实际不加载任何字体文件，仅防未来同源字体被默认策略误杀；若确认永不用字体文件可改 `'none'`，本期取 `'self'` 降回归风险 |
| `connect-src` | `'self'`（+ WA-ON 时 `https://cloudflareinsights.com`） | 前端只 fetch 同源 `/api/board` 与 `/data/*`；WA 回传端点为独立域、与脚本域不同名，两者缺一不可（E4） |
| `base-uri` / `form-action` | `'none'` / `'none'` | 本站无 `<base>`、无表单提交；关死防 base 劫持与表单外泄面，无功能代价 |
| `frame-ancestors` | `'none'` | 本站无被嵌入需求，等同点击劫持全关；与 `X-Frame-Options: DENY` 双写（后者照顾旧浏览器与扫描器） |
| `object-src` / `worker-src` | `'none'` / `'none'` | 无插件对象、无 Worker；关死零代价 |
| `manifest-src` | `'self'` | 若有同源 manifest 不被 `default-src 'none'` 误杀；无 manifest 时该指令无副作用 |
| `upgrade-insecure-requests` | 启用 | 自定义域全站 HTTPS，子资源 http 引用自动升级；零风险 |
| 不设置的指令 | `report-uri`/`report-to`、`sandbox` | 无违规收集端点，写了只会产生无处投递的报告与额外 `connect-src` 需求；`sandbox` 对本页有意外行为风险。违规观察改走 §18.5 的 Report-Only 预演期人工看控制台，不建收集设施 |

长度自检：上式展开后（按 1 个 script 块 + 1 个 style 块估算）约 550–650 字符，远低于 E3 的 2,000 字符/行上限；生成脚本对最终 CSP 行做 >1,900 字符硬失败断言，防内联块增多后悄然超限。

#### 18.1.3 其余响应头定版与 HSTS 的挂载方式

`/*` 分组（静态，下发处 `_headers`）：

| 头 | 定版值 | 说明 |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | 全路径统一，含 `/api/board`、`/data/*`（JSON 防嗅探同样需要） |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 同源全量、跨源仅 origin、无外链引流需求，比 `no-referrer` 少一分对署名外链点击统计的干扰，Observatory 可过 |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()` | 本站零设备 API 使用，全关；`interest-cohort=()` 为 FLoC 退出声明，部分新浏览器已忽略该 token，保留无副作用 |
| `Cross-Origin-Opener-Policy` | `same-origin` | 窗口隔离，对单页表格站零功能影响 |
| `Cross-Origin-Resource-Policy` | `same-origin` | 同源资源不被跨站嵌入读取；`/data/*` 分组同值（见下），等于顺带堵死「把本站 JSON 当免费数据源直嵌」的最低成本路径（真正的滥用治理在 W2-19） |
| `X-Frame-Options` | `DENY` | `frame-ancestors 'none'` 的旧浏览器回退，双写不冲突 |
| `X-XSS-Protection` | `0` | 显式关闭旧 XSS 过滤器（现代共识：启用 `1; mode=block` 反而引入绕过面）；写 `0` 使扫描器判为「已刻意处置」而非缺失 |
| `Strict-Transport-Security` | 见下段 | 挂载方式有坑，单独决策 |

**HSTS 只挂自定义域的写法注意（本节核心坑位）**：

1. `_headers` 的匹配是**按路径、不按 Host** 的：写进 `/*` 的 HSTS 会同时出现在 `top200.oppcal.com` 与 `crypto-top200.pages.dev` 的响应上。对 pages.dev 而言，该头登记在 Cloudflare 的域名之下、无意义且不受我方控制（且 Observatory 只测正式域），属于「无害噪音」；真正的风险在另一侧——见第 2 条。
2. **严禁图省事改走 Zone 级 HSTS 开关**（Dashboard → oppcal.com Zone → SSL/TLS → Edge Certificates → HSTS）：Zone 级设置作用于 **oppcal.com 全部子域**，若再勾 `includeSubDomains`，等于替该 Zone 下所有其他子域（用户另有站点/服务，与本站无关）做出「全站 HTTPS」承诺，任一子域存在 http-only 用途即被浏览器硬拦截，爆炸半径远超本站。**本期定版：Zone 级 HSTS 保持关闭，HSTS 只经 `_headers` 随本站部署下发。**
3. 本站定版值：`max-age=31536000`，**不带 `includeSubDomains`、不带 `preload`**。理由：`top200` 本身无下级子域，`includeSubDomains` 保护对象不存在；preload 按 E10 实质不可逆，本期不做此承诺，留待运行满一季度后在 W2-21 季度自查中单独决策。代价是 Observatory 少 +5 奖励分——由 §18.4 的分数账消化，不为 5 分押上不可逆项。
4. **互斥断言**：全站只许一处下发 HSTS。施工验收须查控制台确认 Zone 级 HSTS 为关闭态、且响应中 `Strict-Transport-Security` 只出现一次（重复下发时浏览器只取首个、扫描器判畸形）。

`/data/*` 分组（静态形态时写入 `_headers`，位于 `/*` 之后；Pages `_headers` 多规则命中时头合并，后写分组补充/覆盖同名头）：

```text
/data/*
  Content-Type: application/json; charset=utf-8
  X-Content-Type-Options: nosniff
  Cross-Origin-Resource-Policy: same-origin
  Cache-Control: public, max-age=60, stale-while-revalidate=300
```

说明：**不开 `Access-Control-Allow-Origin`**——数据只供本站同源 fetch，任何跨源直读需求一律走人工评估，不预先开口。`Cache-Control` 数值与 W2-01 的数据新鲜度口径对齐，若 W2-01 定版不同，以 W2-01 为准、本分组随生成模板同步改一处（模板变量 `DATA_CACHE_CONTROL`，见 §18.2）。

### 18.2 `_headers` 定版全文（生成目标，禁手改）

文件头注释两行由生成脚本固定写入（`#` 注释行在 `_headers` 语法中合法）。占位符在生成时被真实 hash/变体替换，仓库中只存**模板** `ops/headers/_headers.tmpl` 与生成脚本，`public/_headers` 为构建产物、每次构建重生成：

```text
# GENERATED by ops/headers/gen-headers.mjs - DO NOT EDIT; source: ops/headers/_headers.tmpl
# variant: {{VARIANT}}; generated: {{GENERATED_AT}}; index.html sha256: {{INDEX_SHA256}}
/*
  Content-Security-Policy: {{CSP}}
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-XSS-Protection: 0
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin

/data/*
  Content-Type: application/json; charset=utf-8
  X-Content-Type-Options: nosniff
  Cross-Origin-Resource-Policy: same-origin
  Cache-Control: {{DATA_CACHE_CONTROL}}
```

`/api/board` 不在此文件内出现任何分组——即使写了也不生效（E3），写了反而误导后人以为已覆盖。文件内以注释明示：

```text
# NOTE: /api/board is a Pages Function response; _headers does NOT apply.
# Its security headers live in functions/api/board.* SECURITY_HEADERS (W2-18 §18.3).
```

### 18.3 `/api/board` 的 Function 内头组（与 W2-01 合并施工）

在现有响应头组（P0 已有 Cache-Control 等）基础上，由代码常量统一合并下发（与现有头同名时以本表为准对账一次，避免重复头）：

```js
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": /* 沿用 P0 既有定版，不在本包改动 */,
  "Content-Security-Policy": "default-src 'none'",
};
```

取值说明：JSON 响应不加载任何子资源，CSP 只给 `default-src 'none'` 作纵深防御（防响应被当作文档打开时的脚本执行），**不下发** Permissions-Policy/COOP 等文档类头（对 JSON 无意义、只增噪音）；`Referrer-Policy` 在 API 上取更严的 `no-referrer` 与页面侧的 `strict-origin-when-cross-origin` 有意不同（API 响应无跟随链接场景）。HSTS 不在 Function 内重复下发（边缘/部署层已覆盖该 Host 的文档响应；JSON 客户端不消费 HSTS）。405/429/错误响应分支必须走同一常量出口——验收要逐状态码查头，不能只查 200。

### 18.4 与 Web Analytics（W2-14）的交互定版

1. 变体即契约：生成脚本以环境变量/参数 `WA=off|on` 选变体，默认 `off`。**WA 未启用而 CSP 已放行 beacon 域 = 无谓扩大攻击面**（多两个可加载脚本/连接的外部源），禁止「先放行、以后再开」；W2-14 启用/停用 Web Analytics 的变更单必须包含「同步切换 CSP 变体并重新发版」一行，两包在此互为前置检查项。
2. 静默失效的验收法（E4）：WA-ON 发版后，在浏览器 Network 面板过滤 `cloudflareinsights`，须见 beacon 脚本 200 且 `/cdn-cgi/rum` POST 返回 204；控制台无 `Refused to load the script` / `Refused to connect` 的 CSP 报错。只看「统计后台有数」不可靠（有延迟），以 Network 证据为准并截图入留痕。
3. **Rocket Loader 必须关闭**（Zone → Speed → Optimization）：它会重写内联脚本（含注入 `ajax.cloudflare.com` 的 loader 并改脚本字节），直接使 hash 失效且需额外放行域——与 hash 方案根本冲突，无条件关。Auto Minify（若 Zone 尚有此开关）同理：任何会改写 HTML 内联字节的边缘优化都必须关，或在生成脚本侧以线上字节为准验 hash（§18.5 断言 S3 抓的就是这个）。Speed Brain 等只加头不改体的功能不受影响。
4. beacon 脚本由边缘注入、不在 `index.html` 源码内，生成脚本**不会**为它算 hash，也不需要——它走 `script-src` 的域名放行；但注入的 `<script>` 标签若带内联 `data-cf-beacon` 属性不影响执行（属性非脚本体）。

### 18.5 hash 生成脚本设计与防白屏流程

**脚本** `ops/headers/gen-headers.mjs`（Node 标准库 only，零依赖，与 W2-11 管线同运行时）：

- 输入：`public/index.html`、`ops/headers/_headers.tmpl`、参数 `--variant=off|on`、`--check` 模式开关。
- 步骤：①以字节流读入 index.html（**不做任何规范化/换行转换**——hash 对字节敏感，CRLF 差异即不同 hash）；②正则提取全部无 `src` 属性的 `<script>…</script>` 块内容与全部 `<style>…</style>` 块内容，保持文档顺序；③对每块内容原始字节算 SHA-256、Base64 编码，拼为 `'sha256-…'` 列表；④静态审计闸门：检出内联事件属性、`javascript:`、`eval(`、`document.write(` 任一 → 非零退出并逐行报错（见 §18.1.2 前提审计）；检出 0 个 script 块 → 非零退出（防止提取逻辑失效时生成「全站脚本皆被拦」的策略还一路绿灯）；⑤渲染模板（CSP、DATA_CACHE_CONTROL、文件指纹、UTC 时间戳），断言无残留 `{{` 占位、每行 ≤1,900 字符；⑥写出 `public/_headers`。`--check` 模式只比对不写出，与现有文件不一致即非零退出。
- 幂等与可审：同一输入必得同一输出（时间戳行除外，该行不参与 `--check` 比对）；模板与脚本进仓库评审，`public/_headers` 的每次变化在部署 diff 中必须能对应到 index.html 的变化或变体切换，否则拦下人工核对。
- 与 W2-11 的衔接：生成步骤挂在 W2-11 构建管线中 `wrangler pages deploy` **之前**且为强制前置（生成失败 = 管线红 = 不部署）；若 W2-11 尚未落地，本脚本可独立以 `node ops/headers/gen-headers.mjs` 手跑后人工部署，接口不变。**红线：禁止任何人手改 `public/_headers` 救急**——线上 CSP 与源码不一致时，唯一正确动作是改 index.html/模板后重跑生成。

**预览先行验证流程（防白屏的硬门，未全过不得上生产）**：

1. 生成 → 部署到 Preview 环境（`*.pages.dev` 预览部署）；
2. 冒烟断言（脚本化 `ops/headers/smoke-headers.mjs`，对任意 base URL 运行）：
   - S1 响应头存在性：`/` 的 CSP/HSTS/nosniff/frame 等 §18.1.3 全表逐项等于定版值；HSTS 只出现一次；
   - S2 **线上字节自洽**：抓取线上 `/` 的 HTML，用与生成脚本同一提取函数对**线上字节**重算 hash 集合，断言与线上 CSP 头中 hash 集合**完全相等**——此条专抓「边缘改写/部署产物与源码不一致」类事故；
   - S3 功能探针：无头浏览器打开预览页，断言表格渲染出行数 >0、控制台零 CSP 违规、零脚本错误；
   - S4 API 头组：对 `/api/board` 分别以 GET（200）与非 GET（405）请求，断言 §18.3 头组在位；
   - S5 WA-ON 时追加 §18.4-2 的 beacon 证据检查；
3. Report-Only 预演（仅首次上线 CSP 时执行，后续小改可跳过）：先以 `Content-Security-Policy-Report-Only` 同内容在 Preview 挂 24 小时人工观察控制台，再切正式头上生产。生产首次切换安排在低峰时段，切换后 30 分钟内复跑 S1–S4（base 换正式域）。

### 18.6 备选方案对比与结论

| 方案 | 机制 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| A. 内联 + hash + 自动生成（本期定版） | §18.5 | 保持单文件架构零改动；无额外请求；Observatory 不扣 unsafe-inline 分 | 每次改脚本必重生成（已由管线自动化消化）；hash 对字节改写零容忍，依赖关闭边缘重写功能 | **采用** |
| B. 外置 JS + 文件名指纹 | 脚本拆为 `/assets/app.<hash>.js`，`script-src 'self'` 即可，可加 `immutable` 长缓存 | CSP 永不变、与发版解耦；缓存友好 | 推翻单文件架构：拆分、构建、引用改写的工作量比 A 的生成脚本更大；多一次请求；CSS 内联样式仍需同样决策，并未免除生成/审计 | **否决为本期方案，保留为触发式备选**：当内联 script 块 >3 个、或单文件 >60 KB、或季度内因 hash 同步出过 2 次事故时，在季度自查中重提评估 |
| C. 内联 + `'unsafe-inline'` | 一行了事 | 零工程 | script 维度等于没有 CSP（注入脚本照跑），Observatory −20 直接丢 A；本包核心目标落空 | 否决，不保留 |
| D. nonce + 边缘重写注入 | Worker/HTMLRewriter 每请求打 nonce | 动态站标准解 | Pages 静态托管无此环节，为一个文件引入 Worker 层，复杂度与故障面远超收益 | 否决，不保留 |

### 18.7 验收标准（Observatory A 级路径与功能回归）

分数账（按 E8 估算，起始 100）：hash CSP（无 unsafe-inline/unsafe-eval）不扣分；HSTS `max-age` 1 年达标、无 preload 少 +5 奖励；零 Cookie 不扣分；HTTP→HTTPS 跳转正常。预期 **Observatory 90–100（A，冲 A+ 差在 preload 一项有意不取）**，securityheaders.com 预期 A（其 A+ 同样卡 preload）。**验收线定为双站均 ≥A 级**；若实测仅 B，先逐项对照扣分表修到 A 再收尾，不接受「B 也够用」结项。

功能回归清单（Preview 与生产各跑一遍，结果入留痕）：

- [ ] 表格 200 行渲染、排序、筛选、搜索、置信度呈现与改版前一致
- [ ] 手动刷新/自动刷新拉 `/api/board` 成功，stale 提示与错误态（断网模拟）正常
- [ ] `/data/*` 若被前端引用，加载成功且 Content-Type 为 JSON
- [ ] Chrome / Firefox / Safari 控制台零 CSP 违规、零脚本错误
- [ ] 移动端视口渲染与交互正常；favicon 显示正常（`data:` 或同源均在放行内）
- [ ] WA-ON 时 beacon 证据齐（§18.4-2）；WA-OFF 时 Network 中无 cloudflareinsights 请求
- [ ] Observatory 与 securityheaders.com 扫描链接及分数截图存档

### 18.8 实施步骤

1. 前提审计（§18.1.2 第 0 步）并记录 script/style 块清单；发现事件属性/eval 先做等价重构小单。
2. 写生成脚本 + 模板 + `--check`，本地对现 index.html 跑通，人审首份生成的 `_headers` 全文。
3. Function 侧合并 §18.3 头组常量（与 W2-01 同窗口施工，避免两次动 Function）。
4. Zone 控制台核查并关闭 Rocket Loader、确认 Zone 级 HSTS 关闭（截图留痕）。
5. Preview 部署 → Report-Only 预演（首次）→ 冒烟 S1–S5 → 切正式头 → 生产低峰发布 → 生产复跑冒烟 + 双扫描器验收。

### 18.9 工作量 / 成本 / 风险与回滚

- **工作量：M（2–3 天）**。其中生成脚本与冒烟脚本约 1 天，审计/重构与两轮预览验证约 1 天，生产切换与扫描调分约 0.5–1 天。
- **成本：$0**。全部为免费层能力与开源扫描器；无新服务。
- **风险与回滚**：最大风险是 CSP 与线上脚本不匹配导致**全站白屏**——靠 §18.5 的预览硬门 + S2 线上字节自洽断言拦截；万一生产仍中招，回滚 = 用 Wrangler 回退到上一部署（P0 已演练的回滚路径），或紧急部署「仅删 CSP 一行」的 `_headers`（其余低风险头保留）——该紧急产物同样必须由生成脚本以 `--variant` 外的 `--no-csp` 应急开关产出并事后补变更单，仍禁手改。HSTS 回滚注意：`max-age=31536000` 一经下发，浏览器在有效期内认 HTTPS，回滚头文件不能撤销已缓存的策略——因本站本来全程 HTTPS，无实际影响。


---

## W2-19 接口滥用面收口

**结论：①Zone Rate Limiting 做——但只占免费层那唯一 1 条规则、只保 `/api/board`、动作必须 Block，且阈值在 W2-01 上线后按一周实测峰值校准再启用；②Sec-Fetch-Site 做最轻版（仅拦显式 `cross-site`，先影子观察一周）——它防不住爬虫，价值仅在抬高顺手滥用成本；③Referer 校验不做（与 Sec-Fetch 重复且误伤更高）。pages.dev 侧无 Zone 控制权是已知敞口，定版为「接受 + 监测」，不为它牺牲备用地址可用性。工作量 S。**

### 19.1 目标设计：滥用代价在 W2-01 后的重估

一期 §5.1 提出 Sec-Fetch-Site 与 Zone 限流时，`/api/board` 还是「每次请求现拉上游」的形态，滥用 = 烧 CoinGecko credits（Demo 仅 10k/月，E5），防护是保命题。W2-01 改为 Cron 定时拉取 + KV 快照后，Function 只读：单次滥用请求的边际代价降为一次 KV 读 + 一次 Function 调用，不再碰上游。剩余风险按大小排序：

1. 高频刷接口耗尽 Pages/Workers 免费调用量（100k 次/日量级）致正常用户不可用——概率低、影响中，Zone 限流正对症；
2. 第三方把 `/api/board` 当免费数据源长期直连/转售——数据本身公开，Sec-Fetch/Referer 对带伪造头的客户端**均无效**，真实对策只有 CORP `same-origin`（W2-18 已下发，堵浏览器内嵌场景）+ 限流抬成本 + 法务/合规层面的署名与条款（W2-21）；本包不假装技术手段能解决此项；
3. 顺手型跨站 fetch 滥用（别人网页里直接 fetch 本站接口）——Sec-Fetch-Site 正对症，且浏览器不可伪造此头（forbidden header），是三项里唯一能干净拦住的。

### 19.2 Sec-Fetch-Site / Referer 软校验定版

**做，轻量版，落地位置：Function 入口、方法校验（405）之后、读 KV 之前**，与 W2-01 改造同一窗口合入，伪代码：

```js
const sfs = request.headers.get("Sec-Fetch-Site");
// 影子期：仅计数不拦截（console 结构化日志，观察 7 天分布）
// 正式期：只拦显式 cross-site；same-origin / same-site / none（地址栏直达、刷新）与
// 头缺失（curl、健康检查、冒烟脚本、部分隐私浏览器）一律放行
if (ENFORCE_SFS && sfs === "cross-site") {
  return json({ error: "forbidden_cross_site" }, 403, SECURITY_HEADERS);
}
```

设计要点：

- **只拦一个值**：`Sec-Fetch-Site` 取值四种里只有 `cross-site` 是明确的「别的站的页面在调你」；`none` 是用户直达/刷新，误拦即自伤；头缺失占比在影子期实测，若非浏览器流量本就以限流（W2-19.3）约束，不靠此头。
- **先影子后启用**：影子 7 天看 `cross-site` 计数是否为零星噪声；若影子期发现有合法跨站调用方（例如自家其他子域页面——那会是 `same-site`、本就不拦），再复核。启用开关为代码常量/环境变量，可秒关（回滚即改开关重部署）。
- **Referer 不做**：Referer 可被隐私工具剥离、可被非浏览器任意伪造，与 Sec-Fetch-Site 信号完全重叠且假阳性更高；双写只增加误伤面与维护口径。一期 §5.1 的「Sec-Fetch-Site/Referer 软校验」在本期明确收敛为**只做前者**，此为对一期设计的调整（理由即本段）。
- 优先级定级 P2：W2-01 上线后此项必要性已从「保额度」降为「抬成本」，**可与 W2-01 顺带合入（增量约 20 行），不单独发版、不阻塞任何其他包**；若 W2-01 窗口紧张，允许推迟到二期收尾，不算欠账。

### 19.3 Zone Rate Limiting Rule 定版

**配额现实（E1/E2）**：oppcal.com Zone 为免费计划，全 Zone **只有 1 条** Rate Limiting 规则——用在本站即意味着该 Zone 下其他子域本期无规则可用，施工前须在变更单里向用户明示这一占用（Zone 下若已有规则，先导出其配置再谈替换，禁止直接覆盖）。

**规则定版（控制台手工配置——现有受限 Token 仅 Pages Edit 权限，无 WAF 权限，本包不为自动化而扩权，见 §19.5）**：

| 项 | 定版 | 依据 |
|---|---|---|
| 名称 | `top200-api-board-guard` | 可检索、可交接 |
| 匹配表达式 | `(http.request.uri.path eq "/api/board")` | 免费层表达式字段仅 Path 与 Verified Bot（E2），**写不了 Host、写不了 Method**——路径本身已足够特异（该 Zone 下 `/api/board` 仅本站使用，施工前全局搜 Zone 内其他子域有无同路径，有冲突则本规则暂停、先走 §19.2+§19.4 替代）；方法不限的副作用极小：非 GET 本就由 Function 回 405，让它们也计数反而更早触发对乱刷者的拦截 |
| 计数特征 | 源 IP（免费层唯一选项，E2） | IPv6 按 Cloudflare 默认粒度计数，不另配置 |
| 阈值 | **30 次 / 10 秒 / IP**（初始值，上线门见下） | 正常模型：单用户一次页面打开 = 1 次 GET，加手动刷新与自动刷新，峰值 ≤3 次/10 秒；共享 NAT 出口（公司/校园网数十人同看）放大一个数量级仍在 30 内。30 次/10 秒 ≈ 持续 180 次/分钟，是人类流量的 ≥10 倍余量、对脚本洪水又足够低 |
| 动作 | **Block** | 明确不用 Managed Challenge：`/api/board` 的调用方是 `fetch()`，挑战返回的 HTML 会让前端 JSON 解析失败、呈现为无声故障，且挑战对 API 客户端本就无解；Block 的默认拦截响应虽非 JSON 契约格式（免费层不可定制响应体），但只命中已超限的滥用方，前端只需保证解析失败走既有错误态（纳入 §19.6 回归项） |
| 缓解时长 | 10 秒（免费层唯一可选，E2） | 意味着拦截是「每 10 秒窗口反复触发」的节流而非封禁——对本威胁模型足够（目标是把脚本流量压回正常量级，不是拉黑）；长封禁需求出现时再议升 Pro（2 条规则、周期/缓解至 1 分钟/1 小时） |
| 启用方式 | 先以「仅日志/模拟」观察若控制台提供对应模式则用之；无则直接启用但安排在 §19.6 的校准门之后 | 免费层动作选项有限，不为观察模式纠结 |

**阈值校准门（与 W2-01 的依赖关系）**：本规则**不在 W2-01 之前启用**。顺序定版：W2-01（Cron+KV）上线 → 观察 7 天 `/api/board` 的真实单 IP 峰值（Zone Analytics / Function 日志）→ 若实测 NAT 峰值 >20 次/10 秒，阈值上调至实测峰值的 1.5 倍（仍须 ≤100，超过则说明有未识别的合法批量调用方，先查清再设值）→ 启用规则并截图留痕。W2-01 若延期，本规则同步顺延，**禁止在旧「现拉上游」形态下用此规则代替额度保护**——旧形态的额度保护靠既有 429 熔断（P0 已做），限流只是第二道。

### 19.4 pages.dev 边界与处置

`crypto-top200.pages.dev` 不属于任何用户 Zone（E9）：Zone 限流、WAF、Bot 规则对它**全部不生效**，攻击者直刷 pages.dev 的 `/api/board` 可绕过 §19.3。处置定版：

- **接受敞口**：W2-01 后 pages.dev 的 Function 同样只读 KV，刷它的代价模型与正式域相同且不烧上游额度；pages.dev 是备用/排障入口、未对外推广，真实流量趋近于零，被当数据源滥用的发现概率与收益都低。
- **监测兜底**：季度自查（W2-21）固定看一眼 Pages 项目按域名的请求量分布，pages.dev 占比异常（如 >正式域 20%）即升级处置。
- **升级处置预案（本期不施工）**：Function 内按 `new URL(request.url).hostname` 判断，若为生产 `crypto-top200.pages.dev` 且路径以 `/api/` 开头则回 404/重定向正式域。注意**不能**一刀切 pages.dev：Preview 部署的冒烟（W2-18 的 S1–S5）正跑在 `*.pages.dev` 预览子域上，规则必须精确匹配生产主机名一个值，放行一切预览子域。本期只留预案文字，避免为低概率敞口引入「备用地址与冒烟链路双双被误杀」的新故障面。

### 19.5 施工方式与权限说明

Zone 规则在 Cloudflare 控制台手工配置（路径：oppcal.com Zone → Security → WAF → Rate limiting rules → Create）。动用的是用户本人的控制台会话，**不使用、也不扩大现有受限 API Token 的权限**（Token 保持 Account→Pages→Edit 单一范围是 W2-20 的既定最小权限口径，为一条限流规则扩 WAF 权限不划算）。全过程截图（表达式、阈值、动作、启用时间）存入 W2-21 留痕目录，作为「代码外配置」的唯一账本——此类控制台配置不在仓库里，留痕即防漂移。

### 19.6 实施步骤与验收标准

步骤：①变更单明示占用免费层唯一规则、核 Zone 现有规则与同路径冲突 → ②W2-19.2 代码合入（影子模式）随 W2-01 部署 → ③影子/峰值观察 7 天 → ④定阈值、控制台建规则启用、截图 → ⑤Sec-Fetch 开关切正式拦截。

验收：

- [ ] 自测脚本以单 IP 连发 >30 次/10 秒 GET `/api/board`，第 31 次起收到拦截响应，10 秒后自动恢复 200
- [ ] 正常浏览（多标签页 + 反复刷新 + 另一网络出口）全程无拦截；前端对拦截响应呈现既有错误态而非白屏/无声失败
- [ ] 跨站页面 fetch 探针（本地测试页跨源调用）被 403 且错误结构与 §18.3 头组齐全；同源调用、curl 无头调用、W2-18 冒烟脚本全部放行
- [ ] pages.dev 侧按 §19.4 预期「规则不生效」得到验证记录（确认边界属实，而非误以为已防护）

### 19.7 工作量 / 成本 / 风险与回滚

- **工作量：S（合计 ≤1 天）**：代码增量约 0.5 天（含影子日志与开关），控制台配置与校准约 0.5 天；7 天观察期为日历时间、不占人力。
- **成本：$0**（免费层 1 条规则内）。
- **风险与回滚**：最大风险是误伤共享 NAT 后的真实用户——靠校准门与 30 次的宽阈值控制；回滚 = 控制台一键禁用规则（秒级生效）/ Sec-Fetch 开关置回影子。规则被占用的机会成本（Zone 其他子域无规则可用）已在变更单明示，不属事故。

---

## W2-20 密钥轮换剧本定版与本期立即动作

**结论：CoinGecko key 因聊天/截图暴露，本期立即轮换——但官方定价页证实 Demo 档全账号只有 1 把 key（E5），「先建新、后吊旧」的无缝双活在 Demo 档不存在，剧本定版为「双路径：控制台先试增发（路径 A），被拒即走原地换钥 + KV 快照兜底的分钟级切换（路径 B）」。Preview 环境独立 key 在 Demo 档同样无解，一期 P2-2「双环境各一 key」在本期改为「Preview 用 fixture 数据、零 key」（见 §20.3）。Cloudflare Token 约 2027-02-08 到期，续期提醒定于 2027-02-01 落点到跟踪项 + 日历各一。工作量 M。**

### 20.1 密钥台账（现状定版，台账只记元数据、永不记值）

| # | 密钥 | 存放 | 权限/额度 | 关键日期 | 状态 |
|---|---|---|---|---|---|
| K1 | Cloudflare 受限 API Token | 自定义连接（保险箱）保管，部署经代用值通道使用 | 仅 Account→Pages→Edit、限本人账号 | 2026-11-10 创建，90 天，**到期约 2027-02-08** | 有效；到期即部署通道中断，须按 §20.4 提前续 |
| K2 | CoinGecko API key（Demo） | Pages Secret `COINGECKO_API_KEY`（`crypto-top200`，Production） | Demo：10k credits/月（E5/E6） | 2026-11-10 注入 | **已暴露**（用户在聊天与截图中明文提供，保险箱外渠道），本期立即轮换 |
| K2p | CoinGecko API key（Preview 环境） | —— | —— | —— | 未配；本期按 §20.3 改走 fixture，不再配 key |

**暴露定性**：K2 为免费 Demo key，无付费、无写权限、无关联支付方式，最坏后果是额度被蹭（10k credits/月被耗尽 → 当月 mode 跌回异常/stale）。定级为**低危事件、立即处置**：处置 = 轮换 + 本节剧本固化 + 一条流程硬规则（见 §20.2 步骤 0），不升级为事故复盘，但事件事实（暴露渠道、时间、处置）记入 W2-21 留痕首期。

### 20.2 CoinGecko key 立即轮换剧本（K2，本期第一优先，当日可完成）

**步骤 0（流程硬规则，先于操作）**：新 key 的值**只许经保险箱安全采集页录入**，禁止再走聊天消息、截图、文档粘贴。2026-11-10 的暴露正源于安全表单误报后改走聊天——本期起，表单校验失败时的正确动作是停下报错、换采集方式，**不许降级到明文渠道**。此条同步写入 README 红线区（见 §20.5）。

**步骤 1（用户在 CoinGecko 控制台操作，助手给分步指引）**：登录 CoinGecko（账号为用户自选的 Google 账号）→ Developer Dashboard → 尝试 **+ Add New Key**：

- **路径 A（增发成功——以施工当日实测为准）**：若控制台允许第 2 把 key（定价页写 1 把，但控制台实际策略以当日为准，故先试），命名 `top200-prod-202611`（月份后缀便于台账对账）→ 走步骤 2–5 的无缝切换 → 最后吊销旧 key。切换全程双 key 有效，零窗口。
- **路径 B（增发被拒，预期路径）**：同一 key 槽位执行删除旧 key → 新建 key（命名同上）。从删到新 key 注入完成之间，上游调用必然失败——**兜底来自 W2-01 的 KV 快照**：`/api/board` 继续出 stale 数据并打 stale 标记，用户侧无感（仅新鲜度降级）。因此路径 B 的执行窗口选在 Cron 刚成功跑完一轮之后（快照最新），且全程目标 ≤15 分钟。若 W2-01 尚未上线、现形态仍是请求时现拉上游，则路径 B 须先排在 W2-01 之后，或接受分钟级 `/api/board` 报错窗口并在低峰执行——**排序定版：K2 轮换与 W2-01 同窗口、紧随其后**。

**步骤 2（注入新 key）**：经保险箱更新后，由部署通道执行（命令中的值不出现在聊天/日志/脚本文件里）：

```bash
npx wrangler pages secret put COINGECKO_API_KEY --project-name crypto-top200
# 交互式粘贴新 key 值；禁止使用 echo/参数明文传值（会进 shell 历史与进程列表）
```

注意 Pages Secret 变更**需重新部署才对 Function 生效**——紧接步骤 3 部署，不得只 put 不 deploy 就宣布完成。

**步骤 3（重新部署）**：走现行 Wrangler 直推管线（与 W2-11 合并后即管线一键）；部署产物须同时包含 W2-18 的 `_headers` 时按其流程，不得为轮换单独绕过生成步骤。

**步骤 4（线上验证，无感验收标准）**：

- 手动触发一次 Cron（或等最近一轮）后查 `/api/board`：`mode=live`（或 W2-01 定版的新鲜度字段等价物）、`updatedAt` 为切换后的新时间、200 币覆盖数与切换前一致（200/200）；
- CoinGecko 控制台用量图出现新 key 名下的调用记录；
- （路径 B 追加）旧 key 直连探针：以旧 key 值对 `https://api.coingecko.com/api/v3/ping` 发一次带 `x-cg-demo-api-key` 头的请求，须返回 401/403——证明旧值确已失效（旧值已暴露，此探针不产生新的保密问题；探针在本地执行、旧值不进任何留痕文件）；
- 切换后 24 小时观察：`/api/board` 无因额度/鉴权导致的异常波动。

**步骤 5（吊销与收尾）**：路径 A 在步骤 4 全过后于控制台吊销/删除旧 key，并复跑一次旧 key 探针确认失效；更新密钥台账（§20.1 的 K2 行：轮换日期、新 key 名称、下次轮换期 §20.6）；事件记录入合规留痕。

**回滚**：新 key 若验证不过（额度未生效、控制台状态异常），回滚 = secret put 回旧 key 值 + 重新部署（路径 A 旧 key 尚在，回滚干净；路径 B 旧 key 已删不可回滚——这正是路径 B 须在步骤 1 先把新 key 在控制台**直连探针验活**（本地 curl 通了再删旧槽位/再注入）的原因，探针未过不许动生产 Secret）。

### 20.3 Preview 环境独立 key 的改判（对一期 P2-2 的调整）

一期 P2-2 设想「Production / Preview 各一把 key」，前提是同账号可多 key——E5 已证伪（Demo 档 1 把，升到 Basic 仍 1 把）。三条出路的定版取舍：

| 选项 | 评价 | 结论 |
|---|---|---|
| 再注册第二个 CoinGecko 账号专供 Preview | 等于一人多号领免费额度，与平台免费档「每账号 1 key」的意图相悖、且要用户再出一个身份并长期养两个账号台账 | 否决 |
| Preview 与 Production 共用同一 key 值（两环境各 put 一份） | 表面「各有 key」、实为同一把：额度共享（预览冒烟烧生产额度）、泄露面翻倍、轮换要改两处易漏一处 | 否决（假隔离） |
| **Preview 零 key、走 fixture**：Preview 环境不配 `COINGECKO_API_KEY`，Function 在 Preview 上下文读仓库内固定的样例快照（或构建时注入的一份脱敏 board JSON），以 `mode=fixture` 标识 | Preview 的真实用途是验 UI/CSP/冒烟（W2-18 的 S1–S5），不验上游新鲜度；零 key = 零额度消耗、零泄露面；fixture 还使预览结果可复现 | **采用** |

施工要点：fixture 数据取一份真实 board 快照的结构、数值可保留（本就是公开行情）但须带固定旧时间戳以免被误当实时；W2-18 冒烟脚本对 Preview 的断言相应调整为「fixture 标识在位、行数齐」，不查 `updatedAt` 新鲜度。**将来若升付费高阶档（10 key），届时再启用真·双环境独立 key**，并回写本节。

### 20.4 Cloudflare Token 续期剧本（K1，到期约 2027-02-08）

到期日推算：2026-11-10 创建 + 90 天 = **2027-02-08**（施工时以控制台 Token 详情页显示的 Expires 为准复核一次，若不符以控制台为准并改台账）。

**提前提醒落点（本期立即动作，防「到期当天才发现部署全断」）**：

1. 建一条跟踪项：标题「Cloudflare Token（Pages Edit）续期」，到期日 2027-02-01（提前 7 天触发处置，而非到期日）；
2. 建一个一次性日历事件/一次性定时任务于 **2027-02-01 上午**，内容只写剧本指针（本节编号）与台账位置，不写任何 key 值；
3. 此后每季度自查（W2-21）固定核对「K1 剩余天数 >30」，使 90 天短周期 Token 永远在两道防线之内。

**续期步骤（T-7 窗口内执行，新旧交叠 ≤24 小时）**：

1. 用户在 Cloudflare 控制台以**与现 Token 完全相同的模板**新建 Token：权限仅 Account → Cloudflare Pages → Edit、账号范围限本人账号、有效期 90 天，命名 `pages-deploy-202702`（年月后缀）；新 Token 值只经保险箱采集页录入（同 §20.2 步骤 0 硬规则）；
2. 更新自定义连接中的代用值指向新 Token；
3. **只读验证先行**：以新 Token 调 Pages 项目列表/详情接口，确认能读到且仅需读到 `crypto-top200`（读成功即证明权限与账号范围正确），此步不做任何写操作；
4. 写验证：向 **Preview** 环境做一次部署（不碰生产），成功即证明 Edit 权限完整；
5. 生产部署通道切换确认：下一次正常生产部署走新 Token 成功后（或人为做一次无内容变化的生产重部署），到控制台**吊销旧 Token**；
6. 台账更新 K1 行（创建/到期日顺延至约 2027-05-09 一线，以控制台为准）、留痕记录新旧交叠的实际起止时间。

**失败兜底**：若到期未续导致部署通道中断，站点本身不受影响（Pages 继续托管现有部署），只是发不了新版——处置即按上面步骤补建 Token，不构成线上事故，不许为赶时间改用全权限 Token 或把 Token 值贴进聊天求助。

### 20.5 附带修正：过时口径清理（与本包同 PR/同变更单）

现状：`wrangler.toml` 注释仍写大意「不设 `COINGECKO_API_KEY` 也能用公共接口」，与实测结论（匿名调用已被上游拦截）矛盾，后人按此注释排障必走错路。定版改法：

- `wrangler.toml` 注释替换为（定版文案）：

```toml
# COINGECKO_API_KEY 为必填 Secret（Pages 控制台/wrangler secret put 注入，不写在本文件）。
# 实测（2026-11）：未带 key 的匿名调用已被 CoinGecko 上游拦截，代码不得回退匿名模式；
# 未配置时 Function 应明确报错（数据源未配置），不得静默降级。轮换剧本见二期设计 W2-20。
```

- README 同步排查：「匿名可用 / 无需 key / 公共接口」类表述逐处改为同一口径，并新增一行密钥硬规则：「任何 key/token 值只经保险箱采集页录入，禁止出现在聊天、截图、仓库与日志中」；
- 代码侧对账（与 W2-01 合并核查，不在本包单独改逻辑）：确认 Function 在 Secret 缺失时走的是「明确错误」而非「匿名重试」——若代码仍保留匿名回退分支，在 W2-01 变更单里一并删除并在本节留痕中登记。

### 20.6 半年轮换节奏与付费层备注

**轮换节奏（写入 W2-21 季度体检固定项）**：

| 密钥 | 节奏 | 下一个动作点 |
|---|---|---|
| K2 CoinGecko（Demo） | **每 6 个月**轮换一次（或任一疑似暴露时立即轮换，不等周期） | 本期轮换完成后 +6 个月 ≈ **2027-05**，其后 2027-11，以此类推；每次走 §20.2 剧本（届时先试路径 A） |
| K1 Cloudflare Token | 90 天有效期天然季频，按 §20.4 在每期到期前 7 天续 | 2027-02-01 触发首次续期处置 |

**将来升 CoinGecko 付费层的坑位备注（只记账、本期不施工）**：

1. **三件套必须同改**：base URL `api.coingecko.com` → `pro-api.coingecko.com`、请求头 `x-cg-demo-api-key` → `x-cg-pro-api-key`（E7），外加 Secret 换成付费 key 值——漏改任一项的症状都是 401，且 key 格式不可区分、肉眼排障无从下手。代码侧的预防在本期就埋好：上游调用只许有一处封装（如 `cgFetch()`），base 与头名由单一配置常量 `CG_TIER ∈ {demo, pro}` 决定，业务代码禁止散写头名字符串（此约束登记给 W2-01/W2-03 施工）。
2. 付费 key 只在 Pro base 上可用、Demo key 只在 Demo base 上可用，不存在「一把 key 两边通」；升级切换按 §20.2 同款剧本走（注入 → 部署 → 验证 → 吊旧），多一道 `/key` 端点查额度（该端点仅 Pro base 提供，Demo 调用返回 401，勿拿它验 Demo key）。
3. 升档同时触发两件合规联动：数据源授权/商用条款复核（W2-21 红线）与署名口径复核——不得先升档、先商用、后补授权评估。

### 20.7 实施步骤与验收标准

步骤：①§20.4 提醒落点两件（跟踪项 + 2027-02-01 一次性事件）当日建好 → ②§20.5 文档修正随本期首个变更单合入 → ③W2-01 上线窗口内执行 §20.2 轮换（先探针、后注入、必重部署）→ ④§20.3 Preview fixture 落地并更新 W2-18 冒烟断言 → ⑤台账与留痕更新。

验收：

- [ ] 旧 K2 值探针 401/403、新 key 名下用量记录可见、`/api/board` 切换后 24 小时无鉴权类异常
- [ ] Preview 打开任一预览部署：表格以 fixture 渲染、标识在位、该环境无 `COINGECKO_API_KEY` 配置（控制台截图）
- [ ] 跟踪项与 2027-02-01 事件均存在且内容无任何密钥值；台账中 K1 到期日与控制台一致
- [ ] 全仓搜索「匿名」与 key 相关注释，无与 §20.5 口径冲突的残留表述

### 20.8 工作量 / 成本 / 风险与回滚

- **工作量：M（2 天，含 24 小时观察的跨日收尾）**：剧本执行本身约 0.5 天，Preview fixture 改造约 0.5 天，文档修正与台账/提醒落点约 0.5 天，验证与留痕约 0.5 天。
- **成本：$0**（Demo 档内轮换；提醒与台账均为既有设施）。
- **风险与回滚**：最大风险是路径 B 的删旧建新窗口内上游中断——靠 Cron 后窗口 + KV 快照兜底压到用户无感，且新 key 先本地探针验活才动生产（§20.2 回滚段）；Token 续期的最大风险是新旧搞混吊错——靠「先验证新 Token 的 Preview 部署、后吊旧」的顺序硬约束。两把钥匙的任何一步都不许跳过验证直接吊旧。

---

## W2-21 合规自查机制化

**结论：把一期靠人记性的合规（免责三层、零引流红线、署名、话术）变成「季度清单 + 事件触发 + 一份留痕文件」的机械流程：每季一张逐项勾选表、结果存 `ops/compliance-log/YYYY-Qn.md`，单次执行 ≤0.5 天。话术统一的抓手是「限定词与数字同框」规则 + 一份可全文检索的违禁词清单。数据源授权先于一切商业化——此红线在本节复述定版，任何商业化讨论先过授权关。本节为工程合规提示、非法律意见（见 §21.6）。工作量 S（建制）+ 每季 0.5 天（运行）。**

### 21.1 目标设计

机制三件套：①**固定清单**（§21.2，逐项可勾、判定标准写死，不留「酌情」空间）；②**触发器**：季度例行（每年 1/4/7/10 月各一次，与既定的底部窗口复核等用户日程互不捆绑）+ 事件触发（数据源切换 W2-03、启用新外部脚本/统计 W2-14、新增任何外链、涉商业化讨论、隐私数据流变化——任一发生后 7 天内加跑一次针对性自查）；③**留痕**（§21.4 模板与存放）。清单的维护规则：每次自查发现的新漂移模式（如新话术变体、新外链类型）当场补进清单下一版，清单版本随留痕文件记录。

### 21.2 季度自查逐项清单（定版 v1）

**A. 免责与风险提示在位（三层，逐处打开页面核对，不凭记忆）**

- [ ] A1 页首风险条可见且文案与定版一致（未被改版挤掉/折叠/改色弱化）
- [ ] A2 方法论区完整：数据来源、预估方法、置信度含义、局限说明四要素齐
- [ ] A3 页脚免责完整：「不构成投资建议」与「情景推演」限定在位
- [ ] A4 预估窗口与倍数的话术限定通过 §21.3 排查（与 C 组联动，此处只记结论）

**B. 署名与数据口径（与 source 联动——本组为 W2-03 的合规验收面）**

- [ ] B1 查 `/api/board` 响应的 `source` 字段当前值，页面署名文案/链接与之**动态一致**：`source=coingecko` 时显示 CoinGecko 署名（如 “Data powered by CoinGecko” 及指向其站点的链接）；切换备源后署名随之切换为备源口径，**不残留、也不误挂**原源署名
- [ ] B2 构造/等待一次备源态（或在 Preview 以 fixture 模拟备源 `source` 值），复核 B1 的切换行为属实——署名若是前端写死的字符串，本项直接判不通过并开整改单（署名必须由数据驱动）
- [ ] B3 数据新鲜度标识（更新时间/stale 标记）真实反映数据状态，无「拿旧数据冒充实时」的呈现

**C. 话术与呈现（详见 §21.3）**

- [ ] C1 违禁/受限词全站检索完成，命中逐条处置并记录
- [ ] C2 置信度「低」行的倍数呈现已按 UX 包定版降饱和/弱化——判定标准写死：低置信倍数的视觉权重（字号/饱和度/对比度任一维度）须可分辨地低于高/中置信行，截图对比存档；未达标即联动 UX 包开整改（本项是 W2-21 对一期 §5.4 残余项的验收落点，施工归 UX 包、验收在此）

**D. 零商业化红线（README 顶部硬红线逐字复核）**

- [ ] D1 零广告：全站无广告位/广告脚本/赞助内容（结合 F 组外链与脚本清单核）
- [ ] D2 零返佣：无交易所/平台返佣链接、无带 `ref`/`invite` 等参数的外链
- [ ] D3 零引流：无导向社群/付费群/个人联系方式的引导文案与链接
- [ ] D4 风险提示未被删除或弱化（与 A 组交叉验证，红线原文比对）

**E. 隐私与数据流一致性**

- [ ] E1 隐私说明（页脚/方法论内 privacy 段落）与实际数据流逐项一致：现行实际 = 无账号、无 Cookie、前端只请求同源 `/api/board` 与 `/data/*`；若 W2-14 已启用 Web Analytics，隐私段落须已同步写明「使用 Cloudflare Web Analytics、无 Cookie、不跨站追踪」与其数据去向——**功能先上线、文案没跟上 = 本项不通过**（W2-14 与 W2-18 的 CSP 变体切换同理，变更单三处联动：功能、CSP、隐私文案）
- [ ] E2 浏览器实测：清空站点数据后访问，DevTools 查 Cookie 为零（WA 启用后仍应为零，若出现 Cookie 立即查来源）、本地存储无未声明项
- [ ] E3 外部请求清单：Network 面板全量外部域名导出，与 F 组清单逐一对账，无清单外域名

**F. 全站外链与外部资源清单（逐一可解释）**

- [ ] F1 导出当前全站外链/外源清单（`index.html` 内全部 `href`/`src` 外部值 + CSP 放行域 + 实际 Network 域名三方对账），逐条填写「指向 / 用途 / 归类（署名|文档|统计）」；**出现无法解释的一条即不通过**
- [ ] F2 清单与上季 diff：新增项必须能对应到变更单编号，无变更单的新增外链按红线事件处置

**G. 安全与密钥状态（承接 W2-18/W2-20，只查状态不查值）**

- [ ] G1 Observatory/securityheaders 快速复扫 ≥A（链接存档；跌级即联动 W2-18 排查）
- [ ] G2 K1（Cloudflare Token）剩余有效期 >30 天；K2 距上次轮换 <6 个月（对照 §20.6 节奏表）
- [ ] G3 Pages Secret 清单与台账（§20.1）一致：Production 有且仅有所需 Secret、Preview 无 key（§20.3）；Zone 里唯一的 Rate Limiting 规则仍在且配置与 §19.3 留痕截图一致（防控制台配置漂移）
- [ ] G4 pages.dev 与正式域流量占比巡检（§19.4 监测兜底）

### 21.3 话术统一排查清单（「情景推演」限定）

**规则定版**：凡出现具体预估数字（倍数、价格窗口、时间窗口、目标排名）的内容块，同块内必须出现限定词「情景推演」或等价限定（如「假设情景下的推演值」），且同页免责（A3）不得缺席。「同块」指同一卡片/同一表格区/同一图注——不接受「全站页脚有一句」来给正文数字兜底（页脚是第三层、不是唯一层）。

**检索词表（对 `public/` 全文 + README + 分享文案执行，逐词记录命中数与处置）**：

| 类别 | 检索词 | 处置口径 |
|---|---|---|
| 断言类 | `保证`、`必涨`、`必跌`、`稳赚`、`确定`（预估语境）、`目标价` | 出现即改：删除或改为推演口径 |
| 预测直陈类 | `预测`、`预计将`、`将会涨`、`底部时间`、`高点时间`、`见底于`、`见顶于` | 改为「情景推演：若历史周期规律重演，窗口可能落在…」式表述，数字与限定词同框 |
| 建议类 | `买入`、`卖出`、`抄底`、`加仓`、`推荐`（标的语境） | 出现即删改；本站只呈现数据与推演，不给操作建议 |
| 限定词在位检查 | `情景推演`、`不构成投资建议`、`历史规律不预示未来` | 反向检索：确认每个含数字的内容块附近有限定词（与上三类配合人工过一遍目录） |

注：方法论中讨论「历史上的底部/高点日期」属事实陈述、不受预测直陈类约束，但同段出现对当下/未来的外推时即按上表处置——判定从严，拿不准的按受限处理并记入留痕。

### 21.4 留痕格式与存放

- 路径：`ops/compliance-log/YYYY-Qn.md`（例：`ops/compliance-log/2026-Q4.md`，本期建制时补首期，含 K2 暴露事件记录）；事件触发的加跑用 `YYYY-Qn-extra-<slug>.md`。
- **存放红线**：`ops/` 必须在部署目录之外——施工时核实 Wrangler 部署的静态目录仅为 `public/`，留痕文件永不进部署产物；验收方法：线上访问 `/ops/compliance-log/…` 须 404（或等价路径不可达），此项写进首期留痕。
- 模板（定版）：

```markdown
# 合规自查留痕 YYYY-Qn
- 执行日期 / 执行人 / 清单版本（如 v1）/ 触发类型（季度例行 | 事件：<变更单号>）
## 逐项结果
| 项 | 结果（通过/不通过/不适用） | 证据（链接、截图文件名、检索命中数） | 备注 |
## 外链与外部域名清单（本季全量）
| 域名/链接 | 用途 | 归类 | 对应变更单 |
## 发现与整改
| 发现 | 严重度 | 整改单/去向 | 期限 |
## 密钥状态（只记元数据）
- K1 到期日与剩余天数 / K2 上次轮换日期 / Secret 清单核对结论
## 签字确认
- 复核人： （自查人与复核人不得为同一执行的同一步骤时，至少留一行交叉确认记录）
```

- 留痕只记结论与证据指针：**禁止写入任何密钥值、token 片段、用户个人信息**。

### 21.5 商业化前置红线（复述定版）

1. **数据源授权先于广告/返佣/任何变现**：现行 CoinGecko Demo 档为免费探索档，其定价页未授予商用权益（E5 定价表：商用许可不在 Demo 档内）。在取得覆盖「公开展示 + 商业化使用」的数据授权（升至相应付费档并核对其条款，或取得书面许可）之前，全站维持零广告、零返佣、零引流、零付费功能——顺序不可颠倒，不存在「先上线广告再补授权」的例外。
2. 任何商业化意向出现的当天，即触发 §21.1 的事件自查，且自查第一项就是授权状态；授权未落地，商业化施工不得立项。
3. 备源（W2-03）同理：每个数据源分别核其展示/署名/商用条款，B 组署名联动以各源条款为准。

### 21.6 声明

本节及本文件全部内容为**工程与运营层面的合规提示与自查框架，不是法律意见**，不构成对任何司法辖区下证券、金融推广、数据许可等事项的合规保证。涉及商业化、数据授权条款解释、对外推广文案定性等事项时，应另行咨询合格的法律/合规专业人士，本机制化清单不替代该步骤。

### 21.7 实施步骤与验收标准

步骤：①建 `ops/compliance-log/` 与模板、确认部署目录隔离 → ②按 §21.2 跑首期自查（与 W2-18/W2-20 收尾同周，顺带验收 G 组）→ ③话术排查（§21.3）在首期完成一次全量并给出改文清单（改文施工可并入 UX 包窗口）→ ④把季度节奏写入日程（每年 1/4/7/10 月各一次的提醒落点，与 §20.4 的 Token 提醒同一处管理）。

验收：

- [ ] 首期留痕文件齐全：逐项有结果与证据、外链清单可逐一解释、K2 暴露事件已记录
- [ ] 线上不可达 `ops/` 路径（部署隔离验证通过）
- [ ] 话术检索有书面结果：每个检索词命中数与处置逐条在案，抽查 3 个含数字内容块均满足「限定词同框」
- [ ] 季度提醒落点存在（下一次 = 2027-01，与 Token 续期提醒互不覆盖、各自独立）

### 21.8 工作量 / 成本 / 风险与回滚

- **工作量：S（建制 ≤1 天）**；运行成本为每季约 0.5 天人力，已计入季度节奏。
- **成本：$0**。
- **风险与回滚**：机制本身最大风险是「清单形式化、勾选不核实」——靠证据强制（每项必须附链接/截图/命中数，无证据的勾选在模板上无法填写）与 F1「一条解释不了即不通过」的硬判定对冲。本包无线上变更，**无回滚需求**；若留痕误入部署产物，按 §21.4 红线立即下线并检查部署目录配置。

---

## 附：四包总览与对一期设计的主要调整

| 包 | 工作量 | 成本 | 关键前置/依赖 |
|---|---|---|---|
| W2-18 响应头与 CSP | M（2–3 天） | $0 | W2-14 变体状态确认；与 W2-01 同窗口改 Function 头组；W2-11 管线挂生成步骤 |
| W2-19 接口滥用收口 | S（≤1 天）+ 7 天观察 | $0（占免费层唯一限流规则） | **W2-01 上线后**校准启用；控制台手工配置 |
| W2-20 密钥轮换 | M（2 天） | $0 | K2 轮换紧随 W2-01 窗口；2027-02-01 Token 续期提醒本期先落点 |
| W2-21 合规机制化 | S（≤1 天）+ 0.5 天/季 | $0 | 首期自查与 W2-18/W2-20 收尾同周 |

对一期设计的主要调整（详见各包正文）：

1. **W2-18 头的下发面拆三处**（一期未区分）：`_headers` 不覆盖 Functions 响应（E3），`/api/board` 必须在代码内自带头组，否则一期方案上线后 API 侧仍是裸奔且不易察觉。
2. **HSTS 不走 Zone 级、不带 includeSubDomains/preload**（一期只提「只挂自定义域」未给写法）：Zone 级会波及 oppcal.com 全部子域；preload 不可逆，本期以放弃 Observatory +5 奖励分为代价保住可逆性，目标定 A 不定 A+。
3. **CSP 变体与 W2-14 强绑定**：不存在「先放行 beacon 域备用」的中间态，WA 开关与 CSP 变体必须同发版切换；另新增「Rocket Loader 必须关闭」这一 hash 方案的存亡级前置。
4. **W2-19 降级 Referer、Sec-Fetch 只拦 cross-site**（一期为并列软校验）：W2-01 后滥用代价结构已变，Referer 与 Sec-Fetch 信号重叠且误伤更高，砍掉；限流阈值改为「W2-01 后实测校准」而非设计期拍死，且按官方口径修正免费层能力（1 条规则、仅 Path 字段、仅 10 秒周期/缓解、动作必须 Block 不能用 Challenge）。
5. **W2-20 的 Preview 独立 key 改判 fixture**（一期 P2-2 前提被 E5 证伪）：Demo 档全账号 1 把 key，双环境真隔离在现档位不存在；K2 轮换亦因此定版为「先试增发、预期走原地换钥 + KV 快照兜底」的双路径剧本，而非默认无缝双活。
6. **W2-21 把署名做成数据驱动验收项**（一期 §5.4 只提「署名随 source 切换」原则）：B2 明确「写死字符串即不通过」，使 W2-03 备源切换时署名联动有可判定的验收面。
