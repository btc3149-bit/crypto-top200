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

### W4-14（P1）K3 `MANUAL_RUN_TOKEN` 轮换 —— ✅ 完成

- **做了什么**：站长授权后按剧本 §20.6 执行：生成 256 位随机新值，只经 `wrangler secret put MANUAL_RUN_TOKEN -c workers/fetcher/wrangler.toml` 的 stdin 注入（未打印、未落盘）；`secret list` 注入前后回读均确认在位，旧值随单值 Secret 替换即刻失效=吊销完成。台账 K3 行与剧本节奏表已更新（状态改「已轮换，2026-11-13」，下次 2027-05-13），剧本 K3 小节补执行留痕。
- **纪律与如实标注**：未部署 fetcher（secret put 即生效；顺带 deploy 会带上未放行的 W4-01/W4-10 代码、越门禁），未触发 `/run`（不污染 G1 观察数据）；剧本步骤 3 的新旧值实测因沙箱直连 workers.dev 被边缘 1010 拦截而未做，已在台账明示，留待 G1 结算后按需补验——不声称已实测。

### W4-18（P1）第二告警通道 —— ◐ 邮箱已定；两家 API 实测建不了，转控制台一步

- **邮箱已定**：`769530631@qq.com`（站长 2026-11-13 指定）。
- **API 实测（本轮）**：UptimeRobot `newAlertContact` 两次均 HTTP 410 Gone、回读确认未创建（联系人列表仍只有主联系人 `9028550`）；healthchecks `POST /api/v3/channels/` 返回 405（channels 端点只读）、回读确认未创建。两家的新增投递地址都只能在各自网页控制台添加并经该邮箱验证链接激活——属平台限制，非权限问题。
- **待办（已在 `ops/probe-config.md` W4-18 节写明精确步数）**：站长在控制台会话中顺手完成两家各加一次 + QQ 邮箱点两封验证信；助手随后经 API 挂载（UR 联系人→M1–M4、HC 通道→HC1–HC3）、回读复核并做主邮箱失效模拟，届时 F4-20 销项。本地探针 `PROBE_ALERT_EMAIL` 双收件人口径待平台生效后同步（探针只标注不直发）。
- 未对主邮箱制造任何测试告警；本轮未改动 M1–M4 与 HC1–HC3 的现有挂载。

### W4-11（P1）远端备份 —— ◐ 推荐已批准、本地准备与克隆等效演练完成；待站长 GitHub 一步

- **选型落地**：推荐方案 = **GitHub 私有仓**（站长 2026-11-13 批准按推荐执行）。理由一句话：本仓只需异地副本 + 可克隆重建，托管方熟悉度与长期可用性优先，候选中 GitHub 免费私有仓最稳。
- **已完成（本地）**：`git fsck --full` 通过；演练步骤 1 本地等效验证——file:// 全新克隆约 1 秒，HEAD 一致、全 refs 69 commits / 24 tags / 12 branches、克隆内 fsck 干净；推送通道定为仓库 Deploy key（本机 SSH 公钥由助手交办时提供，不入仓库文件）。
- **待站长一步（约 3 分钟，步骤已写入 `ops/disaster-recovery/config-inventory.md` §5）**：GitHub 建空 Private 仓 `crypto-top200` + 加 Deploy key（勾 write access）+ 回告仓库地址。本机 `gh` 未登录、无 GitHub 账号授权，此步无法代办；其余全部就绪，地址一到即可推送并完成远端克隆复核与 §5.1 剩余演练、回填实测 RTO。**整体 RTO 仍未实测，不按已达标表述。**

### W4-19 / W4-27（P1/P2）真机验证项实验室收口 —— ◐ 实验室可验部分全部收口，余 6 项终局待站长真机

站长授权「实验室能等效验证的做掉、真机肉眼项整理最短清单」。以 chrome-headless-shell 157 + puppeteer-core 对生产站实测（证据全文入 `ops/verification-tracker.md` 跟踪记录）：

- **V3-6 已验关闭**（协调者项）：表格 200 行渲染、控制台零 CSP 违规、零脚本错误；RUM 回传实测 204 在位。S3/S5 的浏览器侧补验缺口关闭。
- **V3-5 间距分项已验**：注入 WCAG 1.4.12 定版值（行高比实测 1.50 证明生效），2236 元素无截断/丢失；另键盘功能面走查通过（Tab 序合理、Enter 开/Esc 关详情）。仅余「移动端浏览器工具栏遮挡」分项待站长。
- **附实验室证据、终局仍待站长**：V3-1（断点显隐与 sticky 客观项已测；观感待真机）、V3-2（拦截延迟下补丁保持展开、滚动漂移 27px；手感待真机）、V3-3（360/390 无溢出、5 列、13px；**命中域实测展开钮 28×28、排序钮高 36，未达清单 44px 口径**，满足 WCAG 2.5.8 AA 24px 下限，整改与否待裁决）、V3-4（静态 ARIA 审计：skip link/aria-live/scope/sr-only 在位；**展开钮 aria-controls 仅 1/201** 已定位；播报待实机读屏）、V3-7（placeholder 对比度实测 3.85:1、color-scheme dark 在位；发色待真机）。
- 时限不变（2026-11-30）；未冒充任何真机结论，站长最短清单见本轮汇报。

### W4-20（P2）Zone 处置裁决与收编 —— ✅ 完成并上线

- **裁决 A（收编进仓库管理）**：§18 定版不开 ACAO 且全站无跨源消费者，B（保留登记用途）所需的实际用途不存在；A 可消除不确定性，B 只登记不确定性。裁决与执行全文见 `ops/security/zone-config-registry.md` Z-01 处置记录。
- **注入点定位**：Functions 响应从不带 ACAO、静态与 404 路径带头、自定义域与 pages.dev 及 preview 部署一致——定性为 Pages 平台静态服务层默认行为，非 Zone 手工配置，「来源未定位」就此关闭。
- **执行与证据**：`_headers.tmpl` `/*` 组新增 `Access-Control-Allow-Origin: https://top200.oppcal.com` 并按 WA-ON 变体重新生成；preview（部署 `d7a16217`）四路径实测单条声明值（平台 `*` 被替换非叠加）；生产部署 **`8dff02de`**：冒烟 6/6、自动 probe 7/7、smoke-headers 全过、HC2 ping success；生产四路径复测均为单条声明值。Observatory 收编前后各复测一次均为 **135 / A+（11/12）**（scan `135200672` / `135218297`），ACAO 被排除为扣分来源；未通过 1 项的名称仍待人工在 analyze 页确认（明细端点本轮再试仍 404），如实保留。

## 27 个工作包状态总表（截至 2026-11-13 站长待办处置轮结束）

| 包 | 状态 | 说明 |
|---|---|---|
| W4-01 | ✅ 已部署（2026-11-14） | fetcher Version 17019273；+96/天重抓已停、稳态 180~192 credits/天；global 相位注记见文末施工小节 |
| W4-02 | ✅ 落地（2026-11-14，Muse 侧核账形态） | 每日 cron 核账、判级变化才报；首次核账 WARNING（规划口径投影）；board.js 计数键方案仍待复核、未激活 |
| W4-03 | ✅ 完成（本轮） | HC4 已建+首 ping UP+每小时 cron 接线，G2 开始前已生效 |
| W4-04 | 代码就绪（prep 分支，未激活） | 待 rebase 至现行 deploy.sh + preview 演练后激活 |
| W4-05 | ✅ 完成（本轮） | 契约测试交付；rows 段待 W3-22 施工转绿 |
| W4-06 | 代码就绪（prep 分支，未部署） | 口径统一+health 补测 20 条随分支，待结算放行 |
| W4-07 | ✅ 返工完成（2026-11-14） | compare-shadow 原地升级（top20 入判据/compared 下限/fetchRunId 对齐/自动计数）+ 字段门禁；修复后实跑 conditional（数值+字段全过、skew 43s、计数 442） |
| W4-08 | ◐ F4-07 修复 ✅ 已上线；非空率门禁代码就绪（prep 分支） | 门禁部分待结算放行 |
| W4-09 | ✅ 完成（本轮） | 不改变「不自动跑」口径；state 迁移待下次人工运行 |
| W4-10 | ✅ 完成（本轮） | deploy.sh/build.py 门禁已生效；fetcher prev 部分已于 2026-11-14 随 W4-01 部署上线并实证（shadow:prev 逐 run 归档） |
| W4-11 | ◐ 推荐已批准（GitHub 私有仓）；本地准备与克隆等效演练完成 | 待站长 GitHub 一步（建空私有仓 + Deploy key），其后助手推送并完成重建演练与 RTO 实测 |
| W4-12 | ✅ 完成（本轮，preview 口径） | production 实弹回滚未演练，留 G3 窗口补记；mode 路径端到端须部署期注入（G3 前置修正项，见逐包记录） |
| W4-13 | ✅ 完成并上线（本轮） | S2 子集断言为集成修正，已留痕 |
| W4-14 | ✅ 完成（批 0）；K3 已于 2026-11-13 轮换（站长授权） | `/run` 实测因 1010 拦截与 G1 纪律未做，台账已如实标注 |
| W4-15 | ◐ SFS 代码就绪（prep 分支）；Zone 限流待站长控制台配合 | 规则定版在 PHASE2_PLAN §19.3 |
| W4-16 | ✅ 完成（本轮） | fetcher 部分（批 0）+ 前端 DOM 回归 6/6 |
| W4-17 | ✅ 完成（本轮） | preview 定版/工具链预检/checklist 自动化均已生效 |
| W4-18 | ◐ 邮箱已定（769530631@qq.com）；两家 API 实测建不了（UR 410 / HC 405），待站长控制台各加一次并点验证链接，助手随后 API 挂载 | 精确步数已写入 probe-config W4-18 节；F4-20 未销项 |
| W4-19 | ◐ 静态部分已上线；实验室可验部分已收口（V3-5 间距通过、键盘功能面通过） | 真机三项终局待站长（读屏播报/工具栏遮挡/手感类），清单见 verification-tracker，时限 2026-11-30 |
| W4-20 | ✅ 完成（2026-11-13 站长授权裁决 A 收编并上线，部署 8dff02de） | Observatory 未通过 1 项名称待人工在 analyze 页确认（不阻塞收编） |
| W4-21 | ✅ 完成（本轮） | 对照表 24 项；4 项不一致 T-1~T-4 另册待办 |
| W4-22 | ✅ 完成（批 0） | 监控探测成本条目本轮已补入（W4-18） |
| W4-23 | ✅ 本轮基线完成 | v2.1.1 口径中位 LCP 1.71s/CLS 0/TTFB 129ms；月度采样口径已定，W3-22 后再冻结重测 |
| W4-24 | ✅ 完成（本轮） | 预算线定版；拆分结论「暂不拆」 |
| W4-25 | ✅ 完成（本轮） | 首次季度抽查排 2026-Q4（待执行） |
| W4-26 | ✅ 完成（批 0） | — |
| W4-27 | ◐ 度量+定版完成；真机 7 项中 V3-6 已验关闭、V3-5 间距分项已验，余项附实验室证据待站长终局 | 跟踪表 ops/verification-tracker.md，时限 2026-11-30 不变 |

## 紧急修复轮（2026-11-13 晚，站长真机 V3-3 失败回炉）—— ✅ 已修复上线

**v2.1.2-phase4-mobile-fix，部署 `90f98abf`，commit `8ce7c53`（修复）+ 本节文档回填提交。**

### 故障与根因

站长手机截图（2026-11-13 约 17:05）：≤640px 表格价格与倍数文字叠印、数字逐字竖排、行高 196–324px，不可读。实验室（chrome-headless-shell 157 + CDP，本地服务线上同版字节 + 拦截注入真实 /api/board 快照）在 360px 复现，快照与实时（patchInPlace 后）两阶段症状一致——**纯 CSS 布局问题，与实时注入无关**。

逐列实测：colgroup 计算宽度全部正确（合计 350px=表宽），但实际列几何为价格列 0px、预估列 0px、倍数列 68px、表尾 134px 幻影宽。**根因：≤640 用 `display:none` 隐藏 7 列单元格（.hm 六列 + .c-conf），但在 `table-layout:fixed` 下 Blink 按 colgroup 顺序把列宽顺位配给存活列——价格列吃到被隐藏的「2029 报告排名」列的 0 宽、预估列吃到「报告现排名」列的 0 宽、倍数列吃到价格列的 68px。** 两列塌成 0 宽后 nowrap 内容溢出叠印、预估列的 break-word 把数字逐字竖排撑高行高。桌面端无恙是因 ≤1500 只隐藏最后一列、顺位错配无害。此前 V3-3 实验室证据只测文档级横溢与列数、未测逐列几何，故漏检（已在 tracker 如实留痕）。

### 修复（仅 `public/index.html` 第一个 `@media (max-width:640px)` 块，+ `_headers` 按流程重生成）

1. 隐藏列的 `<col>` 一并 `display:none`（c-estrank/c-ranknow/c-chg/c-mcap/c-ath/c-conf/c-reason），列宽与存活列一一对齐；
2. 倍数列 54px → 88px（文案「▲ 6.7–14.8×」实测需约 83px，原宽必溢出）；
3. 价格/预估/倍数表头 `white-space:normal`（长标签在窄列内换行，不再横溢叠印）；
4. 排名表头 `#thRank` 视觉隐藏（sr-only 口径，文案最长 6 字在 36px 列内无解；读屏保留、排序箭头可见）。

未动 fetcher、未动 /api/board 契约、未动 board.js；桌面端样式零改动（改动全在 ≤640 媒体块内）。

### 验收

- 六宽度（360/390/412/768/1280/1500）逐一渲染审计（文字矩形互叠检测 + 全 200 行溢出扫描）：重叠 0、溢出单元格 0、无异常高行；小屏行高 77–95px、表头 51px（实时）/77px（快照，价格表头三行换行），桌面行高 47–51px 与修复前一致；
- 360px 点开详情：报告排名、报告现排名、24h、实时市值、置信度、核心依据全部在位，隐藏列数据无丢失；
- 全套测试全绿无回归：Node 七套件（board 7/7、board-v2 12/12、board-fetcher 8/8、fetcher-branches 21/21、contract-real-data 4 过/2 按设计跳过、frontend-dom 6/6、snapshot-verify 5/5）+ Python 两套件（render_snapshot 8/8、weekly_check 14/14）；
- 部署后冒烟 6/6、探针 7/7、HC2 ping success；生产 index.html 与本地逐字节一致，且以生产字节复跑 360 实时/412 快照审计全清；
- 覆盖范围如实标注：无头验证为 Blink 内核（与站长 Android 环境几何完全吻合）；iOS WebKit 对 `col{display:none}` 的行为未实测，待站长真机（Android）复核后 V3-3 关闭。

## W4-11 远端备份关单（2026-11-14）

- 站长已建 GitHub 私有仓 btc3149-bit/crypto-top200 并添加 Deploy key（指纹 SHA256:WH8jMeps23gtnNE0v05nV4gKqEVjmDteGQzKfJQ0gjw、Read/write，2026-11-13 添加，截图核对一致）。
- 助手侧故障定位：沙箱 SSH 须经 nc CONNECT 隧道且须显式指定身份文件（core.sshCommand 已定版：-i id_ed25519 + IdentitiesOnly + ProxyCommand），此前两次 Permission denied 均为助手侧连接方式问题、非钥匙问题。
- 2026-11-14 全量推送完成：10 分支 + 25 标签，远端 master 与本地 HEAD 一致（43c8b67）；自远端全新克隆演练约 1.8 秒、fsck 干净、77 commits/25 tags 齐全。W4-11 销项（RTO 以本次克隆演练为据；完整生产重建含 Cloudflare 侧配置恢复的部分仍以 ops/disaster-recovery 清单为准）。

## G1 结算后三项前置修复（2026-11-14，站长拍板「先修三项，再进 G2」）

> 状态总表 W4-01 / W4-02 / W4-07 / W4-10 四行已于本节落盘时同步更新。本轮未执行任何 G2/G3 配置变更（未改 BOARD_READ_MODE、未动 Pages 读取路径、fetcher 目标键仍为 shadow）。

### W4-01 fetcher 修复部署（W4-10 fetcher 部分同步上线）—— ✅ 已部署并实测

- **代码与部署**：修复 commit b552973 经审计已合入 master（ancestor 确认），无需 cherry-pick；部署前全量测试全绿（board 7/7、board-v2 12/12、board-fetcher 8/8、fetcher-branches 21/21、frontend-dom 6/6、contract-real-data 4 PASS/2 SKIP、weekly_check 14/14、render_snapshot 8/8）。部署走既有路径 `npx wrangler@4.159.0 deploy -c workers/fetcher/wrangler.toml`（custom.cloudflare 代用值通道），**2026-11-14 09:31 CST 上线，Version ID `17019273-55b2-4228-a2c0-7eb5fd6be992`**；wrangler.toml 未改（BOARD_TARGET_KEY=shadow、Cron */10 不变）。
- **部署前基线**（01:30Z run，旧代码）：creditsUsedEst=878、当班 2.00 credits/run（bug 形态）；影子 global.asOf == fetchedAt（每 run 重抓签名）。
- **部署后逐 run 实测**（KV health / shadow / shadow:prev 对照）：
  - 01:40Z run：+1 credit（879），global 沿用 asOf 01:30:57 不重抓；
  - 01:50Z run：+1 credit（880），asOf 仍 01:30:57（滞后 20 分钟）；
  - 02:00Z run：+1 credit（881），asOf 仍 01:30:57（滞后 29 分 59 秒）；
  - 02:10Z run：+2 credits（883），global 到期刷新，asOf=02:10:56。
  - 4 个 run 合计 +5 credits（窗口均值 1.25/run），**+96 credits/天的超额重抓已停**；全程 consecutiveFailures=0、lastUpstreamStatus=200、影子覆盖 200/200。
- **节奏注记（如实记录，留 G2 决策定夺）**：global 到期判定为「asOf 年龄 ≥30min」（src/index.js:189），run 相位使 +30min 的 tick 常以约 29 分 59 秒擦过、顺延至 +40min tick 刷新——稳态刷新间隔 30~40 分钟（约 36~48 次/天），fetcher 日耗 180~192 credits、月化 5,400~5,760，**不高于定版 5,760**；代价是 global 段最长滞后约 40 分钟而非 30 分钟。W4-01 验收字面「48 次/天 ±2」受相位影响未必恒达；本轮未改 b552973 之外的 fetcher 代码，是否接受该偏差或微调到期阈值，留站长 G2 决策时定夺。
- **W4-10 fetcher 部分**：`v1:board:shadow:prev` 已实证在位并逐 run 滚动归档（01:58Z 读到 01:40 版 blob、02:11Z 读到 02:00 版 blob），回滚/比对的上一版数据源成立；KV 写量 +144/天已生效，账二专项复核按 quota-ledger 节奏在月度复核时做。

### W4-02 双路总账与预警 —— ✅ 落地（Muse 侧定时核账形态）

- **形态选择**：prep 分支的 board.js 回源计数键方案（`v1:meta:legacy-credits`）是对「Function 只 get」约定的局部突破，状态总表原注「激活前须复核」——本轮未激活该方案（留待站长复核），改按规格允许的 Muse 侧路径落地，不新增任何 Cloudflare 侧 cron（账号 cron 占用仍 4/5）。
- **构成**：① `scripts/quota-check.py`——读 KV health 取 fetcher 实测 creditsUsedEst；legacy 按三场景估算（0 全命中下界 / 576 规划口径（F4-02 定版探针成对估算）/ 1,152 压力口径（PHASE5 修正绝对最坏））；每次运行向 `ops/quota-log.jsonl` 追加一行，两路合计自此有可见载体。② 每日核账 cron `top200-quota-daily-check`（goal-owned，约 10:17 CST）——判级与 quota-ledger §3 对齐（向前击穿 ≤7 天 WARNING、≤3 天 CRITICAL、投影 ≥8,500 WARNING、≥7,000 WATCH），**只报判级变化**（升级必报、回落报恢复、同级静默），避免同根因每日重复打扰。③ 判级基准为「向前投影」：已用只认 fetcher 实测，legacy 已耗不回填场景假设；另设经验护栏（上游 200 ⇒ legacy 真实已耗 < 10,000 − fetcher 实测，给出日均弱上界），与事实矛盾的场景读法只作风险注脚。
- **首次真实核账**（2026-11-14 10:13 CST，修正版口径）：fetcher 实测 **883**（11 月累计，含修复前 bug 形态消耗；修复后向前速率 192/天）；规划口径投影月合计 **13,868**、向前击穿 **11.87 天**（约 11-26）；压力口径投影 23,607、向前击穿 6.78 天；下界口径（legacy=0）投影 4,129、击穿 47.48 天。**判级 WARNING**（由投影 ≥8,500 触发，非击穿天数触发）。经验护栏：上游 200、连续失败 0 ⇒ 真实合计未撞顶，legacy 真实已耗 <9,117、日均 <696.4——规划/压力场景「自月初全额成立」的读法（击穿 2.05 天 / 已超额）与 13 天实测事实矛盾，不作判级依据。结论：fetcher 单路修复后永不单独击穿；月内风险全部来自 legacy 未计量侧——若其未来真按规划速率（576/天）燃烧，11 月将在约 11-26 撞顶，此即 F4-02 结构性风险，现由每日核账持续监视；根除须等 board.js 计数键方案过复核激活实测计量。
- **留痕更正**：核账脚本初版曾把场景速率回填已用数、误判 CRITICAL（当日 10:12 首行记录），已当场修正判级基准为向前投影并在脚本头注明；quota-log.jsonl 首行 CRITICAL 系初版口径、不作数，以第二行（WARNING）起为准，两版均留痕不删。

### W4-07 compare-shadow 返工 —— ✅ 完成并实跑

- **改动**：`scripts/compare-shadow.mjs` 原地升级（移植 prep 分支 v2 设计 + 新增字段门禁，原 v1 判据阈值不变）：① top20SameSet 纳入 pass 判据；② compared 下限 188（`--min-compared` 可调），低于判 fail；③ fetchRunId 对齐——shadow.fetchRunId 与 health.lastRunId 互验 + live.fetch.fetchRunId（契约 v2），legacy 无 run id 时 verdict 降级 conditional 并明示 basis，附 timeSkewSec 与 240s 时间容差判定，禁止假装对齐；④ 运行次数自动计数——credits 保守下界 ceil(creditsUsedEst/2) + 窗口调度槽位交叉核对，方法与误差口径随报告输出（caveats）；⑤ 字段级非空抽查入门禁（F4-08）——shadow 任一行 price/mcapUsd 为 null 即判 fail 并列 id；rank=null 计数上报不判 fail（源数据属性）。新增 `--live-file`（预抓取的 live 响应用于近 run 配对）与 `--health` / `--shadow-prev` / `--window-start` / `--required-runs` 参数。退出码：0 pass / 2 conditional / 1 fail。
- **修复后实跑**（2026-11-14 10:11 CST；影子 = 02:10Z run `20261114T0210Z-336c`，live 为其后约 1 分钟抓取的 /api/board 响应用 --live-file 配对）：**verdict=conditional**，failReasons 空——价差中位数 0%、P95 0%（两路 1 分钟内先后抓同一源、快照价一致）、compared=200 ≥ 188、top20 集合一致、missingIds 一致、字段门禁通过（rank=null 2 个：telcoin-2、wefi，上报不判 fail；live 侧 price null 0 个）；**timeSkew=43s**（G1 结算时为 519s，10 分钟级错位已消除至近 run 配对）；shadowMatchesHealth=true；**runGate 自动计数 442 ≥ 400**（窗口槽位 444 交叉核对一致量级）。conditional 的唯一原因是 legacy 契约不暴露 fetchRunId、run-id 对齐在现行形态下不可能——属预期上限，须待 G2（dual 形态读同一 blob 组装比对）/G3 后才可能取得 verdict=pass。
- **干跑对照**（修复前基线对，影子 01:30Z run vs live 01:31Z）：verdict=conditional、数值全过、自动计数 439、槽位 440，工具行为与预期一致。

## G2 金丝雀启动（2026-11-19）

- **拍板依据**：站长 2026-11-19 拍板——接受 global 最长滞后约 40 分钟现状（相位偏差）、立即开启 G2。就绪证据见 `~/workspace/goals/200-top200-oppcal-com/hidden_files/g2-readiness-review-2026-11-16.md`（四类证据全齐）；启动清单按同目录 `g2-readiness-2026-11-14.md` 第三节执行。**未做 G3**（未切 kv 只读、未动限流规则）。
- **金丝雀窗口**：**2026-11-19 07:59 CST → 2026-11-21 07:59 CST（48 小时）**。窗口内形态 = BOARD_READ_MODE=dual（对外仍返回 legacy 结果，KV 组装仅在服务端记 dual_compare 差异日志，用户无感）+ fetcher 写 current 键。观察依赖既有监控（HC1/HC4 每小时探针、每日额度核账 cron），未新增 Cloudflare cron。
- **启动前核查（2026-11-19 07:58 CST，四项全过）**：① `/api/health` ok=true、mode=live、覆盖 200/200；② KV `v1:meta:health` status=ok、consecutiveFailures=0、lastSuccessAt 2026-11-18T23:50:57Z（新鲜）、creditsUsedEst=1785；③ `ops/quota-log.jsonl` 最新一行（11-18 核账）判级 **WARNING**（非 CRITICAL），fetcher 日增量 +183/+185/+184/+185（稳态 180~192/天）；④ git 工作区干净、HEAD `477d660` 与 origin/master 一致。
- **步 1 fetcher 目标键翻转**：`workers/fetcher/wrangler.toml` 的 `BOARD_TARGET_KEY` shadow→current（commit `23d28ea`，已推远端），经代用值通道 `npx wrangler@4.159.0 deploy -c workers/fetcher/wrangler.toml` 部署，**Version ID `436a30b6-3a60-4cf2-91bf-7a8f770edeb4`**，绑定回显 BOARD_TARGET_KEY="current"、Cron */10 不变。首个 current 写入 run = `20261119T0000Z-70d6`（00:00:56Z 成功，credits 1787），`v1:board:current` 覆盖 200/200、fetchRunId 与 health.lastRunId 一致；第二 run（`20261119T0010Z-a3db`，credits 1788）后 `v1:board:current:prev` 已归档 0000Z 版 blob（200/200），prev 滚动成立。
- **步 2 Pages 切 dual（W4-12 部署期注入口径）**：根 `wrangler.toml` 新增 `[vars] BOARD_READ_MODE = "dual"`（commit `bdc3871`，已推远端），跑 `./scripts/deploy.sh production`，**生产部署 `6a41bafc-b556-4218-bcc8-b81f63f501c4`（2026-11-18T23:59:42Z）**。部署后经 API 回读该部署快照：`env_vars` 实测含 `BOARD_READ_MODE=dual`（plain_text）与 COINGECKO_API_KEY（secret）——[vars] 注入被直推部署携带，与 W4-12 演练结论一致（API 改项目级 env 的路径未用）。deploy.sh 内冒烟 6/6、部署后 probe 7/7 全过；脚本内 hc_ping 因 HEALTHCHECKS_DEPLOY_PING_URL 未设置跳过，已按惯例经 `hc_api.py ping HC2-top200-deploy success` 补报到（HTTP 200）。
- **步 3 部署后验证**：`/api/health` ok/live、覆盖 200/200（00:13Z 复测）；`/api/board` mode=live、source=coingecko、覆盖 200/200、stale=false——dual 对外仍是 legacy 应答，符合 board.js 契约（dualCompare 仅服务端记日志）。新版 `scripts/compare-shadow.mjs` 以 current blob（0010Z run）实跑：**verdict=conditional、failReasons 空**——价差中位数 0.1038%（≤0.3%）、P95 0.4274%（≤1.5%）、compared=200、top20 集合一致、missingIds 一致、字段门禁通过（rank=null 3 个：telcoin-2、wefi、yellow，源数据属性、上报不判 fail）、shadowMatchesHealth=true、runGate 自动计数 894 ≥ 400、timeSkew 114s ≤ 240s 容差。run-id 对齐在 dual 下仍不可得（live 对外为 legacy 契约、不暴露 fetchRunId），conditional 为 dual 形态上限，与就绪摘要预期一致；verdict=pass 须待 G3 后 live 直读同一 blob 才可能成立。UptimeRobot M1–M4 全部 status=2（up）。证据留档：`~/workspace/goals/200-top200-oppcal-com/hidden_files/g2-start-2026-11-19/`（compare 输出 + health 导出）。
- **回滚路径（在位，未执行；两步互相独立、按需组合）**：
  - Pages 回 legacy：把根 `wrangler.toml` 的 `[vars] BOARD_READ_MODE` 改为 `"legacy"`（或删除 [vars] 整节）后重跑 `./scripts/deploy.sh production`（须带 custom.cloudflare 代用值 env）。注意 `scripts/rollback.sh` 的 mode 子命令只改 API 配置层，**不得单独作为回滚完成依据**（W4-12 实测口径）；`rollback.sh` 本体（超集版）在位。
  - fetcher 停写 current：把 `workers/fetcher/wrangler.toml` 的 `BOARD_TARGET_KEY` 改回 `"shadow"` 后重跑 `npx wrangler@4.159.0 deploy -c workers/fetcher/wrangler.toml`。
- **窗口内待办（不在本节执行）**：每 12 小时汇总 dual_compare/fetcher health/额度（走既有报告节奏）；48 小时满（11-21 07:59 CST）后出 G2 结算一页纸，交站长决定 G3 或回退。
