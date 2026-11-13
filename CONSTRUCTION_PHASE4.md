# 第四期施工记录（CONSTRUCTION_PHASE4）

> 方案：PHASE4_REVIEW.md（27 个工作包 W4-01～W4-27），站长 2026-11-13 拍板「P0+P1+P2 一次全做」。
> 本文件按批追加。**本轮 = 批 0（文档类）+ 全部 fetcher 相关修复的代码准备**，受时序门禁约束：
> fetcher 部署须等 2026-11-14 09:17 G1 结算之后另行放行；批 2 须等站长 G2 决策；W3-22/W3-25 不在本期施工单内。
> 本轮**无生产部署**（未改动 public/ 与 functions/ 任何文件），故无部署 ID、无 HC2 报到；线上以只读探针验证未受影响（见文末证据）。

---

## 批 0（2026-11-13，文档类，不动线上）

### W4-14（P1）密钥台账补全与轮换节奏 —— ✅ 完成

- **做了什么**：`ops/security/key-ledger.md` 补全至 6 类凭据（K1 CF Token / K2 CoinGecko-Pages / K2f CoinGecko-fetcher+build.py / K3 MANUAL_RUN_TOKEN / K4 UptimeRobot Main API Key / K5 healthchecks API key），主表新增「轮换周期」「下次复核/轮换日」两列；K2 状态由「已暴露、轮换待执行」更正为「已轮换，2026-11-11」（旧 key 删除作废、新 key 名 `top200-site-2`、两注入点已注入并重新部署、线上实测 mode=live），暴露事件摘要的处置状态同步销项；K2f 明文「三点须同一次轮换一并更新、不得只换一处」。`ops/security/rotation-playbook.md` §20.6 轮换节奏表由 2 行扩为 6 行并新增「K3 轮换与吊销流程」（换值即吊销四步）。`ops/quarterly/2027-Q1-checklist.md` Q2 行销项：已完成部分关闭，本季仅余状态/配额复核。
- **验收证据**：覆盖自检 6/6 类、每类有周期与下次日期、K2「已轮换」口径在台账/剧本/季度清单四处一致、无残留「待执行」表述；全程只记元数据，未写入任何密钥值。
- **如实保留项**：K3（MANUAL_RUN_TOKEN）轮换状态**无记录、待站长确认**，台账与剧本均如实标注；本次未执行任何轮换、未碰任何 Secret。

### W4-22（P2）四本账定期复核与触发线 runbook —— ✅ 完成

- **做了什么**：新建 `ops/quota-ledger.md`：四本账（CoinGecko credits / Cloudflare KV 读写 / Pages Functions / Pages 部署）统一格式（限额｜水位与估算口径｜计量方法｜月度复核｜三级触发线｜触发后动作），加「触发线总则」（撞线当天顺序：核对计量→免费手段→仍不足才提交付费选项→站长批准后执行）与「月度复核记录」空表。数字与 W4-02 对齐：CoinGecko 定版 5,760/月、当前 bug 形态 8,640/月、legacy 每次未命中 2 credits 且日均 >约 70 次击穿、投影击穿 ≤7 天警告/≤3 天升级；KV 写现估 400–600/天并注明 W4-10 prev 键上线后 +约 144/天须专项复核；付费扩容一律标注「须站长明确批准，未批不采购、不开通」。
- **验收证据**：文件 251 行、章节齐全、四本账触发线各有分级数字（70% 注意 / 85% 警告 / 撞线）；0 元基线在文件头与总则明示不变。ops/README 无索引区，按约未动。

### W4-26（P2）runbook 与值班手册补齐 —— ✅ 完成

- **做了什么**：`docs/fetcher-runbook.md` 新增「故障处置」三节（额度击穿 / KV 坏数据 / Cloudflare 账号不可用），统一格式（识别信号/处置步骤/责任人/恢复目标/关联发现）；新建 `ops/oncall-handbook.md` 单一值班手册（结构速览、健康入口清单 M1–M4 与 HC1–HC3 判据、11 类故障→处置文档索引、部署与回滚入口、凭据位置索引只记位置零值、升级给站长的 7 条条件）；`scripts/weekly_check.py` 增加 REPORT_URL 外链健康检查（自唯一控制点 `pipeline_config.py` 取值，非 200 记 WARN 计入提示，不改名单逻辑、不写生产数据）。
- **验收证据**：`python3 -m py_compile scripts/weekly_check.py` 通过；按红线**未实际运行 main()**（零 CoinGecko 额度消耗）；手册索引经核对均指向真实文件与小节，grep 自检无凭据值/邮箱/监控 ID。
- **如实标注**：runbook 中 W4-10 prev 回滚写明「尚未上线、属待建，现只有四键、无上一版可回退」；W4-11 灾备写明「尚未完成、RTO 未演练、现估 2–4h 为未验证估计」；未把任何计划写成现状。

---

## fetcher 代码准备（2026-11-13，只写代码+本地测试，**未部署**）

### W4-01（P0）修 fetcher global 重抓键 —— 代码就绪，待 G1 结算放行后部署

- **改动**：`workers/fetcher/src/index.js`——目标键计算提前到 runFetch 开头单一变量复用，prevBlob 改读目标键（影子期读 shadow），global due 与 markets 新鲜度判定从此读真实上一版；G3 后 current 形态行为与现状完全一致。
- **creditsUsedEst 核查结论**：计数为成功调用实计（三处计数点均为成功后 +1，providers 无内部重试），口径无误、未改；此前虚高是 bug 本身造成的真实误抓被如实计数，修复节奏后自然回落（定版 5,760/月）。
- **验收证据**：内存 KV 自检实证——影子模式连跑两次（间隔 10 分钟）第二次未重抓 global（调用数停在 1、旧 asOf 原样沿用）、current 键零触碰；新增分支测试 2a/2b/2c 固化该行为（见 W4-16）。**部署门禁**：G1 结算（2026-11-14 09:17）汇报之后、G2 决策之前执行（批 1）。

### W4-10（P1）的 fetcher 部分：KV 版本化 —— 代码就绪，待随 fetcher 部署窗口

- **改动**：`shared/board-schema.js` 的 KV_KEYS 纯增量新增 `currentPrev`/`shadowPrev` 两键（既有键与其他导出零改动，board.js 共用无影响）；`index.js` 写主 blob 前把内存中的 prevBlob 归档到对应 prev 键，归档失败只记日志不阻断（仿 writeHealth 风格）；每成功 run +1 次 KV 写，已计入 W4-22 台账待复核项。
- **验收证据**：分支测试 6b（归档抛错主流程仍成功）、7a/7b（连跑两次 prev=上一版、首次不写 prev 不报错）通过。
- **未做部分**：W4-10 的 deploy.sh 第四份副本校验与字段级 validate 属批 3 范围，本轮未动 deploy.sh。

### W4-16（P1）的 fetcher 部分：高风险分支补测 —— ✅ 完成（测试先行就绪）

- **产出**：新建 `tests/fetcher-branches.test.mjs`，21 条用例覆盖 F4-17 六条高风险分支 + W4-01 回归 + W4-10 归档：额度降频跳过（saving/critical 四态）、global due 两态（shadow/current）、partial 失败（有/无 prev 两口径）、CoinPaprika 真实形态解析与回落、scheduled 与 /run 鉴权（无/错 token 均 404 零调用）、KV put 抛错（主 blob 与 prev 两路）。
- **验收证据**：新套件 21/21 PASS；测试方报告源码行为异常「没有」——7 组分支实测行为与源码及定版口径一致。**未做部分**：W4-16 的前端 DOM 级回归属批 2，本轮未动前端。

---

## 全量测试与线上证据（2026-11-13，协调者集成复跑）

- 仓库测试 6 套共 **61/61 PASS**：board 7/7、board-v2 12/12、board-fetcher 8/8、fetcher-branches 21/21（新增）、snapshot-verify 5/5、test_render_snapshot 8/8。施工前基线为 40/40。
- 线上只读探针 `scripts/probe.sh`：7/7 pass（coverage、freshness 等全过，updatedAt 距今 0s），证实本轮改动未影响线上（本轮无部署，线上仍为 v2.0.0-phase3-ui 代码）。
- 改动范围自检：`git diff --stat` 与各包声明逐项对账一致；`scripts/__pycache__/*.pyc` 的一处 modified 为既存现象，非本轮产生，未纳入提交。

## 本轮提交

- 批 0 + 本记录：tag `v2.1.0-phase4-batch0`（文档批，无生产部署，线上版本号不变）。
- fetcher 代码准备：独立 commit（信息注明「未部署，待 G1 结算放行」），不打 tag。

---

---

## 批 3/批 4 推进轮（2026-11-13 下午，站长指示「继续剩下的待推进任务」）

> 执行口径：两道硬门禁不变——① G1 证据保护（2026-11-14 09:17 结算放行前）：改变 fetcher 行为、KV 证据或 /api/board、/api/health 输出的改动只备不部署；② G3 切换等站长 G2 决策。本轮 9 路并行（独立 worktree）+ 协调者直做管线/监控/集成。**生产部署 1 次**：部署 ID `75a71b9a`（tag `v2.1.1-phase4-batch3` 指向部署点 commit `d9b91c4`），deploy.sh 全门禁（含本轮新增的工具链预检与 coins-list 门禁）+ 冒烟 6/6 + 部署后自动 probe 7/7 全过；HC2 已按名 ping success；smoke-headers 线上 S1/S2/S4/S6 全过（S3/S5 为既定浏览器侧补验项）。

### W4-03（P0）影子链监控接线 —— ✅ 完成（批 1 提前至本轮，只读侧先行）

- **做了什么**：经 API 新建 healthchecks 检查 `HC4-top200-fetcher-shadow`（period 1h、grace 20m、邮件通道已挂）；新建 `scripts/check-shadow-health.py`（只读 KV `v1:meta:health`，lastSuccessAt ≤25 分钟且 consecutiveFailures ≤2 为健康；读不到 KV 退出码 2 同样告警）；新建每小时 cron `top200-hc4-shadow-probe`（goal 归属同 HC1，pass 静默、fail 附日志并向用户汇总）；`ops/probe-config.md` 补 HC4 行与接线状态。
- **验收证据**：脚本对线上实测 exit 0（age 9.7m、consecutiveFailures 0）；无凭证时 exit 2；HC4 手动首 ping 后转 UP 并经 checks 复核（timeout 3600/grace 1200）；cron 已建、首跑约 2026-11-13 11:50。全程只读，未写 KV、未触发抓取、零 CoinGecko 额度。F4-03 的最长约 73h 盲窗自此关闭（断档 >2 个 run 即告警，缺席另有 period+grace 兜底）。

### W4-13（P1）CSP 生成扩至全站 HTML —— ✅ 完成并上线

- **做了什么**：`ops/headers/gen-headers.mjs` hash 提取范围扩至 `public/` 全部 HTML（递归发现、相对路径排序、并集去重、审计闸门逐文件覆盖）；`public/_headers` 按新生成器重生成（WA-ON）；`ops/headers/smoke-headers.mjs` 新增 S6 隐私页断言。**集成修正（协调者）**：S2 原「hash 集合完全相等」被并集语义打破，改为子集断言（页面 hash 逐个在 CSP 清单内，与 S6 同口径），已注明于脚本注释。
- **验收证据**：隐私页 style hash `sha256-LIT7zg/…` 已在 CSP style-src 内（F4-14 修复）；`--check --variant=on` 通过；线上 S6 五项全 PASS（/privacy/ 200、style hash 在放行清单内）；S2 子集断言线上 PASS（script 2/2、style 1/2，CSP 多出的 1 个即隐私页 hash，属预期）；新增临时页实测生成器自动纳入/--check 报错，闸门有牙。

### W4-19（P1）内容可信度小批 —— ◐ 代码部分完成并上线，真机项待站长

- **做了什么**：`scripts/render_snapshot.py` 新增标记式幂等渲染两落点：①「数据截至」行（statband 后、工具栏前，首屏静态可见），文案由逐币 `dataDate` 分布派生（实测生成：「2026-11-08 快照（139 个币）、2026-11-10 核验（61 个币）…」，临时改数据实证文案随分布自动变化、非写死）；②口径摘要 `<details>` 折叠块（预估窗口取 meta 原值、快照口径、实时/快照区别、「不构成投资建议」一句，与页内方法论文本一致）。已随本轮部署上线，线上 curl 实测两落点在位。
- **未做部分**：无障碍真机验证三项（读屏/键盘/间距注入）须站长真机配合，未做、未写已验；已在 W4-27 的 `ops/verification-tracker.md` 中定责任人与 2026-11-30 时限。

### W4-08（P1）字段契约修复 —— ◐ F4-07 已上线；非空率门禁代码就绪待放行

- **F4-07 一词修复 ✅ 已上线**：`public/index.html` 的 `lv.marketCapUsd` → `lv.mcapUsd`（与 board.js/schema 契约一致），全仓 grep 零残留；W4-16 的 DOM 契约断言合入后由红转绿（6/6），live 详情市值恢复显示的数据路径已打通。
- **字段级非空率门禁（代码就绪，prep 分支）**：具名常量 `FIELD_NONEMPTY_MIN_RATIO = 0.99`（shared），两档口径（<99% fail、99%~<100% warn）；board legacy/KV 双路与 fetcher 写前校验四侧均有测试（2 个 rank=null → WARN；价格全 null → 四侧不得 pass）。**部署门禁**：改 board/fetcher 输出与行为，属门禁 1，只备不部署，待 G1 结算放行。

### W4-09（P1）名单周检脚本修复 —— ✅ 完成

- **做了什么**：`scripts/weekly_check.py` v1.1.0：①markets 缺行不再跳过，单列「A2. 疑似下架候选」（拉取失败时不判定，防误报）；②weeks 改 ISO 自然周推进（同周重跑不累加、断周重置）；③假候选清零重建：定位结构性来源（29 个补位币基线 rankNow 即在 251–293、另 6 个老币无基线排名），新增 `watchout_eligible()` 仅对基线 ≤250 者适用跌出判据，旧 state 首次读到时一次性迁移清零（`watchBasis=iso-week-v2`，报告留注记）；④C6 改按 symbol 连接（CoinCap/CoinGecko 两套 id 命名空间错位为根因），基数恢复 200/200。
- **验收证据**：离线单测 14 项全过（`tests/weekly_check_test.py`）；五段 dry-run 全流程（替身数据源、state 指 /tmp）演示缺行检出、清零重建、同周不累加、两周成候选全链。**口径不变**：未建任何定时任务，`ops/weekly/state.json` 未被直接改写（下次人工运行时自动迁移）。

### W4-25（P2）ATH 标记复核计划 —— ✅ 完成

- `ops/ath-review-plan.md` 定版复核节奏：verified 95 年度抽查 10%、approx† 69 半年度抽查 18 个 + 年度聚合口径复核、unverified 36 季度抽查 12 个按 estRank 轮转（一年轮完）；人工双源交叉、只产待修正清单走 build 管线、永不直接改数；首次抽查排 2026-Q4（待执行，如实标注）。weekly_check 报告新增恰一行 ATH 复核提醒（实时计数 + 本季留痕状态），不自动改数、不改变不自动跑口径。

### W4-10（P1）四份副本一致性门禁 —— ✅ 完成

- **deploy.sh 部分（本轮已生效）**：新增 (b4) 门禁——`workers/fetcher/src/coins-list.js` 的 id 集合与 `data/coins.json` 严格比对（实测 200=200；构造 197 名单的负向用例被正确拦截退出 1）；`scripts/build.py --emit` 补跑字段级 validate（G3–G8），实测真数据通过、typo 字段与缺字段均被 GateFail 拦截（此前 --emit 只跑 check_meta，手改 typo 可一路绿灯的通道已堵）。本轮生产部署即在新门禁下完成。
- **fetcher 部分**：KV prev 版本化代码已就绪（批 0 轮，commit b552973），待 fetcher 部署窗口随 W4-01 一并放行。

### W4-17（P1）发布流程正名三件套 —— ✅ 完成

- **preview 定版**：README 新增定版段——preview 不注入 key（§20.3 不变），只验静态/UI、不验行情新鲜度，生产保障由部署门禁 + 部署后 smoke/probe 承接（回应 F4-19「名存实亡」：把承诺改成真实口径）。**工具链**：`package.json` 补 engines（node >=22 <25）、新增 `.nvmrc`（24）；deploy.sh 新增 (a2) 预检（lockfile 存在且 wrangler 版本与 pin 一致、Node 主版本在范围，不符即中止；实测 pin=locked=4.159.0）。**checklist 自动化**：deploy.sh 生产部署后自动跑 probe.sh 全量断言并留痕（未全过只告警不改判，本轮实跑 7/7）；`ops/checklists.md` ①的三项已逐项标注自动/人工口径（HC2 的 hc_ping env 路径与协调者按名 ping 的等效路径二选一留痕）。

### W4-05（P0）真实产物契约测试 —— ✅ 完成（W3-22 硬前置就位）

- 新建 `tests/contract-real-data.test.mjs`：真实 `public/data/coins.json` 喂 board.js（经 onRequestGet 间接驱动 getIds，coverage 200/200、上游请求 id 顺序逐一一致）+ 前端 decodeCoinsData 对象形态解码（200 行 23 字段完整）+ dataHash 口径 A 复算一致——默认模式 4 PASS / 2 SKIP。rows 紧凑形态段以 `PENDING-W322` 标记跳过；`--rows` 模式实测**红**（桩直通未按 meta.fields 解码），即 W3-22 的「先红」留痕成立，其施工以此转绿为验收。fixture 字段序按 build.py FIELDS23 构造（真实产物 meta 暂无 fields 字段，已加防漂移断言）。

### W4-16（P1）前端 DOM 级回归 —— ✅ 完成（fetcher 部分已于批 0 完成）

- 新建 `tests/frontend-dom.test.mjs`（桩 DOM、零新依赖）：patchInPlace 真实路径（200 行节点身份保持、零整表赋值、目标单元格按 live 值更新）、详情展开/收起、detailHTML 按契约字段渲染、自选 toggle + 只看自选过滤/空态/持久化——集成后 **6/6 PASS**（其中 F4-07 断言在基线为预期红、随 W4-08 修复合入转绿，互为印证）。「接入 W4-04 部署门禁」随 W4-04 激活时以 run-tests.sh 全套形式生效（见 W4-04 就绪记录）。

### W4-27（P2）覆盖率度量 + 清单闭环 + 小修定版 —— ◐ 度量与定版完成，真机项待验

- **覆盖率**：新建 `scripts/coverage-report.mjs`（NODE_V8_COVERAGE、零依赖），首份基线入 `ops/testing/coverage-baseline.md`：合计行覆盖 73.8%（1313/1779）、函数 100%（68/68）；board.js 71.2%、fetcher index.js 89.7%、coinpaprika.js 63.5% 最低；**health.js 0%**（与 F4-06 吻合，其补测在 prep 分支有 20 条、待放行后并入度量）。
- **真机清单闭环机制**：`ops/verification-tracker.md` 抄录三期 7 条待验项（V3-1～V3-7），逐项定责任人（站长 5 项、协调者 1 项、混合 1 项）与 2026-11-30 时限，状态全部如实「待验」，并写明到期未验不自动顺延、不冒充已验。
- **定版**：F4-47 自选 localStorage 限制书面定版为已知接受项（依据「不做账号系统」）；F4-46 详情后退定版方案（pushState + popstate 关详情，含与单币 hash 直达的交互风险表），状态「方案已定版、实现与真机验证待后续批次」。

### W4-11（P1）灾备三件套 —— ◐ 配置清单完成；远端与演练待站长选型

- 新建 `ops/disaster-recovery/config-inventory.md`：Pages 项目（双自定义域、production_branch=main、env/secret **名称与类型**清单——实测 BOARD_READ_MODE 在 production **未设置**、缺省 legacy，与代码一致；preview env 为空）、UR M1–M4 与 HC1–HC3 参数、KV/Worker/Cron 仓库抄录、**DNS 只读导出成功**（令牌实际含 zone/dns read，只记类型/主机名/代理/TTL 不记值；与连接文档的权限描述有出入，已提示协调者后续更正台账口径）。
- **待站长**：git 远端选型（候选与推荐排序已入清单：GitHub 私有仓 > GitLab > Codeberg）——远端未建、未推送；从零重建演练未做（附 7 步计划与 RTO ≤2h 口径，账号本身不可用时 RTO 无上限已明示）。

### W4-12（P1）回滚证明 —— ✅ 完成（preview 口径；production 实弹如实未演练）

- 新建 `scripts/rollback.sh`（施工方主体 + 协调者接手完成演练并入库）：deployment（rollback API，dry-run 防误触、须 ROLLBACK_CONFIRM=1）与 mode（PATCH deployment_configs 改 BOARD_READ_MODE，production 额外要求 ALLOW_PROD_MODE_ROLLBACK=1，PATCH 后回读核对含 secret key 保留检查）两条路径。
- **演练实测（仅 preview，记录 `ops/disaster-recovery/rollback-drill-2026-11-13.md`，计时已入 signoffs）**：rollback API 对 preview 被平台拒绝（8000040，仅限 production 部署）；preview 等效恢复 = 重部署上一版内容实测 15.5s（含冒烟）；mode 设置+回读 2.4s，演练后已删 key 恢复 preview env 为空。可演练路径远低于 ≤15 分钟目标。**如实保留**：production 实弹回滚未演练（纪律禁动生产），脚本已对生产部署列表 dry-run 验证选目标无误，实弹留 G3 窗口补记。
- **⚠️ 口径修正（施工方完整演练迟到回收，协调者复现一致，证据见演练记录）**：mode 路径分两层——API 配置层达标（PATCH 按 key 合并、回读一致、2.4–2.8s），但**端到端不生效**：把 preview 项目配置改成 `kv` 后新建的 Wrangler 直推部署，其 env 快照仍为 `{}`、`/api/board` 仍按 legacy 应答（部署快照 + kv 功能探针双证据）。即本管线下模式切换/回滚**不能只靠改 env**，必须部署期注入（`wrangler.toml` `[vars]` + deploy.sh）；rollback.sh 已采纳施工方超集版本（脚本内含醒目警告），runbook 模式回滚条目已同步修正。此项列为 **G3 前置修正项**：G3 切换与回滚预案一律按「改 [vars] + 部署」口径执行，不得引用 API env 路径。演练总时长（施工方全程含排障）约 8.7 分钟，仍在 ≤15 分钟目标内。

### W4-18（P1）告警投递治理 —— ◐ 治理文档完成；第二通道待站长提供邮箱

- `ops/probe-config.md` 新增「告警分级与静默期」一节：P0（M1/M2/M4 + HC1 fail/缺席）与 P1 日报汇总类划分、24h 抖动 ≥3 次升 P0；静默能力如实分开（两家「状态翻转才发信」天然单次 + 部署 pause/resume 可落地；跨平台同根因去重平台无功能、靠转达层合并，「1 小时只报一次」是转达层口径非平台保证）。`ops/quota-ledger.md` CoinGecko 账新增「监控探测成本」条目（M2/M3+HC1 最坏约 576 credits/天，注明系 W4-02 总账 legacy 侧构成项、防双计）。
- **待站长**：第二告警邮箱（三处挂载位置已预留并写明挂载后失效模拟验收法），未提供前 F4-20 不销项。

### W4-20（P2）安全头与 Zone 治理 —— ◐ 基线与登记完成；Zone 处置待站长二选一

- 新建 `ops/security/security-baseline.md`：Observatory 本轮实测 **135 分 / A+**（scan 135196637）定版为新基线；漂移阈值（跌出 A+ 或降 ≥10 分按安全事件）与月度人工复测程序（可用命令已实测修正为表单式 POST）。**145→135 原因已定位（有证据）**：两测之间唯一指令级变更是 2026-11-11 WA 启用给 CSP 增加 cloudflareinsights 两域，其后发版仅 hash 轮换；结论为统计启用的既定代价、非漂移事故；残项：未通过的 1 项明细 API 取不到，待人工打开 details 页确认后回填。
- 新建 `ops/security/zone-config-registry.md` 登记 Z-01（ACAO:*）：本轮只读复核其在 `/`、`/data/coins.json`、`/privacy/` 及 pages.dev 域四处仍在位，仓库零命中、Page Rules 为空、规则集仅托管集——常见来源排除后**注入点仍未定位**；收编/保留二选一待站长控制台确认用途，本轮零 Zone 变更。

### W4-21（P2）隐私承诺逐项对照 —— ✅ 完成（对照表交付，不一致项另册待办）

- 新建 `ops/privacy/wa-consistency-table.md`：24 项逐项对照（承诺 → 实现证据 → 结论）：仓库可验且一致 10、基本一致/附注 4、平台文档口径不可验 6（如实标注）、**不一致/待办 4**：T-1 总览「两条数据流」与第五节「数据流三」计数自相矛盾；T-2 日志枚举不全（另有 sfs_shadow/board_kv_read/CLOCK_SKEW/dual_compare 四类事件，均不含 IP 但文案未覆盖）；T-3 自选节预写口径未更新（键名已坐实 `top200.watchlist.v1`，探测键 `__top200_probe__` 未披露、过期注释未删）；T-4 联系方式仍为占位待站长指定。四项均已登记为待办，未在本轮改隐私页文案（文案变更须随 U7 类签收口径处理）。

### W4-24（P2）体积预算与拆分评估 —— ✅ 完成（只评估）

- 新建 `ops/perf/volume-budget.md`：实测（gzip -c）index.html 241,958 B / gzip 46,183 B、coins.json 132,138 B / gzip 24,513 B（注：实测在 W4-19 合入前，合入后 index 为 243,386 B，仍在预算线内）；预算线定版：index gzip ≤50,000 B、coins ≤27,000 B、合计 ≤75,000 B、_headers ≤3,000 B，部署前人工核对、超线停部署；W3-22 上线同批收紧（coins ≤22,500 B、合计 ≤71,000 B，「≤21KB」按 21×1024=21,504 B 字节口径）。拆分评估结论：**暂不拆**（体积主体是静态行非脚本；拆分会使 CSP 由逐块 hash 钉住降为 'self' 放行；与 W3-22/F4-46 撞期），重评触发条件与预定拆法已写明。未动任何代码、未迁框架。

### 门禁准备分支（只备不部署，放行条件不变）

- **prep/w402-w406-w415**（3 commits）：W4-15 SFS 转正（ENFORCE_SFS=true，6 条测试证明仅拦显式 cross-site）；W4-08 非空率门禁（见上）；W4-02 预警落地（board legacy 回源计数键 `v1:meta:legacy-credits`、health 输出 totalUsed/totalProjected/projectedExhaustDate/daysToExhaust、probe ≤7 天 WARNING/≤3 天 fail，六场景实测）；W4-06 口径统一（`shared/health-thresholds.json` 单一源、health/smoke/probe 三方同读，smoke 94% 容忍废除；health.js 补测 20 条）。分支测试 102/102 全绿（基线 61 + 新增 41）。**显式待复核项**：W4-02 计数器是对 wrangler.toml「Function 只 get」约定的局部突破（只写该计数键，代码内已注释），激活前须协调者/站长复核；totalProjected 口径按验收取「月末投影总量」（与 totalUsed 并列输出）。
- **prep/w404-w407**（1 commit）：W4-04 测试门禁（`scripts/run-tests.sh` 串跑 6 套 61 条、npm test 入口、deploy.sh 数据门禁前插入 fail-closed 门禁段（自成一段便于 rebase）+ DEPLOY_SKIP_TESTS 留痕绕过；连跑 3 次全绿、改坏一条的 fail-closed 双层实证）；W4-07 compare-shadow-v2（新文件，原版零改动）：top20 纳入判据、compared 下限、对齐状态明示、≥400 自动计数。**v2 只读实跑结论 `conditional`**：数值全过（compared 200、中位 0.156%、P95 0.42%），但 legacy 无 fetchRunId 不可对齐（时间差 134s）、运行计数保守 303/400（差 97）——同场原版 v1 输出 pass，正是 F4-09 的问题形态；另注意 KV 读有 1–2 分钟最终一致性延迟，结算导出须复读同 run 再比对。此结论供 2026-11-14 G1 结算参考，结算执行仍由结算任务按已挂四项必查独立核查。
- **W4-02 对账部分与 W4-07 结算执行**：由 2026-11-14 09:17 的 G1 结算任务承接（已挂四项必查），本轮未重复执行。
- **W4-15 的 Zone 限流部分**：规则定版在 PHASE2_PLAN §19.3，启用须站长控制台手工配并目视复核，本轮未动（SFS 部分已备于 prep 分支）。

### 本轮全量测试与线上证据（协调者集成复跑）

- 合并后 master 全套：board 7/7、board-v2 12/12、board-fetcher 8/8、fetcher-branches 21/21、contract-real-data 4 PASS/2 SKIP、frontend-dom 6/6、snapshot-verify 5/5、test_render_snapshot 8/8、weekly_check_test 14/14——合计 85 项全绿（contract 的 --rows 模式为预期红，不在默认套件内）。
- 生产部署 75a71b9a 后：smoke 6/6、probe 7/7（freshness 0s）、smoke-headers S1/S2/S4/S6 全过、HC2 ping success、HC4 首 ping UP；W4-23 干净基线（同日、版本冻结口径）：LCP 中位 1,706 ms / CLS 0 / TTFB 中位 129 ms（本机 Lighthouse 实验室值，详见 ops/perf-baseline.md 新增节）。


---

## 站长待办处置轮（2026-11-13 下午，站长对 5 个部分完成包逐项拍板后执行）

> 拍板口径：W4-11 按推荐执行；W4-18 第二邮箱定为 769530631@qq.com；W4-20 授权助手裁决；W4-15 由站长控制台操作（不在本轮）；W4-14 K3 轮换与 W4-19/W4-27 真机项授权助手解决。本轮两道门禁不变：未部署 fetcher、未触发 /run、未改 board/health 输出。

### W4-20（P2）Zone 处置裁决与收编 —— ✅ 完成并上线

- **裁决 A（收编进仓库管理）**：§18 定版不开 ACAO 且全站无跨源消费者，B（保留登记用途）所需的实际用途不存在；A 可消除不确定性，B 只登记不确定性。裁决与执行全文见 `ops/security/zone-config-registry.md` Z-01 处置记录。
- **注入点定位**：Functions 响应从不带 ACAO、静态与 404 路径带头、自定义域与 pages.dev 及 preview 部署一致——定性为 Pages 平台静态服务层默认行为，非 Zone 手工配置，「来源未定位」就此关闭。
- **执行与证据**：`_headers.tmpl` `/*` 组新增 `Access-Control-Allow-Origin: https://top200.oppcal.com` 并按 WA-ON 变体重新生成；preview（部署 `d7a16217`）四路径实测单条声明值（平台 `*` 被替换非叠加）；生产部署 **`8dff02de`**：冒烟 6/6、自动 probe 7/7、smoke-headers 全过、HC2 ping success；生产四路径复测均为单条声明值。Observatory 收编前后各复测一次均为 **135 / A+（11/12）**（scan `135200672` / `135218297`），ACAO 被排除为扣分来源；未通过 1 项的名称仍待人工在 analyze 页确认（明细端点本轮再试仍 404），如实保留。

## 27 个工作包状态总表（截至 2026-11-13 批 3/批 4 推进轮结束）

| 包 | 状态 | 说明 |
|---|---|---|
| W4-01 | 代码就绪，**待 G1 结算放行部署** | 批 1；结算汇报后、G2 决策前部署（未变） |
| W4-02 | 对账待批 1 结算承接；预警落地代码就绪（prep 分支，未部署） | KV 只读约定突破（计数键）激活前须复核 |
| W4-03 | ✅ 完成（本轮） | HC4 已建+首 ping UP+每小时 cron 接线，G2 开始前已生效 |
| W4-04 | 代码就绪（prep 分支，未激活） | 待 rebase 至现行 deploy.sh + preview 演练后激活 |
| W4-05 | ✅ 完成（本轮） | 契约测试交付；rows 段待 W3-22 施工转绿 |
| W4-06 | 代码就绪（prep 分支，未部署） | 口径统一+health 补测 20 条随分支，待结算放行 |
| W4-07 | 待批 1 结算执行（结算任务承接）；compare v2 已备 | v2 实跑 conditional（未对齐/计数 303/400），供结算参考 |
| W4-08 | ◐ F4-07 修复 ✅ 已上线；非空率门禁代码就绪（prep 分支） | 门禁部分待结算放行 |
| W4-09 | ✅ 完成（本轮） | 不改变「不自动跑」口径；state 迁移待下次人工运行 |
| W4-10 | ✅ 完成（本轮） | deploy.sh/build.py 门禁已生效；fetcher prev 部分随 fetcher 部署窗口 |
| W4-11 | ◐ 配置清单完成；远端+演练待站长选型 | 候选与推荐已入清单，未建远端 |
| W4-12 | ✅ 完成（本轮，preview 口径） | production 实弹回滚未演练，留 G3 窗口补记；mode 路径端到端须部署期注入（G3 前置修正项，见逐包记录） |
| W4-13 | ✅ 完成并上线（本轮） | S2 子集断言为集成修正，已留痕 |
| W4-14 | ✅ 完成（批 0） | K3 轮换待站长确认 |
| W4-15 | ◐ SFS 代码就绪（prep 分支）；Zone 限流待站长控制台配合 | 规则定版在 PHASE2_PLAN §19.3 |
| W4-16 | ✅ 完成（本轮） | fetcher 部分（批 0）+ 前端 DOM 回归 6/6 |
| W4-17 | ✅ 完成（本轮） | preview 定版/工具链预检/checklist 自动化均已生效 |
| W4-18 | ◐ 治理文档完成；第二通道待站长提供邮箱 | 未提供前 F4-20 不销项 |
| W4-19 | ◐ 静态部分完成并上线；真机三项待站长 | 跟踪表定时限 2026-11-30 |
| W4-20 | ✅ 完成（2026-11-13 站长授权裁决 A 收编并上线，部署 8dff02de） | Observatory 未通过 1 项名称待人工在 analyze 页确认（不阻塞收编） |
| W4-21 | ✅ 完成（本轮） | 对照表 24 项；4 项不一致 T-1~T-4 另册待办 |
| W4-22 | ✅ 完成（批 0） | 监控探测成本条目本轮已补入（W4-18） |
| W4-23 | ✅ 本轮基线完成 | v2.1.1 口径中位 LCP 1.71s/CLS 0/TTFB 129ms；月度采样口径已定，W3-22 后再冻结重测 |
| W4-24 | ✅ 完成（本轮） | 预算线定版；拆分结论「暂不拆」 |
| W4-25 | ✅ 完成（本轮） | 首次季度抽查排 2026-Q4（待执行） |
| W4-26 | ✅ 完成（批 0） | — |
| W4-27 | ◐ 度量+定版完成；真机 7 项待验 | 跟踪表 ops/verification-tracker.md，时限 2026-11-30 |
