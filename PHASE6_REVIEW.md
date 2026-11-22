# 第六期评审报告：代码与功能全面评审（只评审、只找 bug）

- 评审对象：crypto-top200（https://top200.oppcal.com），仓库 ~/workspace/cloudflare-top200-site @ commit 5db1627
- 评审时点：2026-11-23。评审时生产形态：G3 已完成（BOARD_READ_MODE=kv、/api/board 为 KV 契约 v2）、W3-22 rows 紧凑形态与 W3-25 volume24h 已上线、compare verdict=pass
- 组织：六路并行、互不知晓对方结论、独立取证——① 前端功能 ② API 与 Functions ③ Fetcher 与数据管线 ④ 脚本与运维工具 ⑤ 测试与契约 ⑥ 安全与健壮性；协调人汇总时通读六路全文、跨路去重合并、逐条定级，并对四条关键发现（F6-03、F6-01、F6-12、F6-07）亲自抽查代码复核属实
- 纪律：全程只读。未改任何代码、未部署、未写 KV、未调用 fetcher /run、未消耗 CoinGecko 额度；线上仅少量 GET（/api/health、/api/board、首页）；本地实跑全部现有测试套件取证

---

## 一、执行摘要

**成熟度判断（本期口径：代码与功能）：B 级，约 3.2/5。** 运行面稳健、防御与验证面偏弱：

- **线上当前行为是对的**：评审时点实测 /api/board 契约 v2 覆盖 200/200、servedFrom=kv、数据新鲜，fetcher 节奏与额度稳态（约 183–192/天）正常，93 项现有测试全绿属实，密钥卫生干净（git 全历史模式扫描 0 命中、npm audit 0 漏洞）。**没有发现代码级的 P0**——唯一 P0 是流程问题（部署门禁不跑测试，F6-01）。
- **系统性弱点集中在「验证层」**：写进生产的 blob 几乎没有字段级校验（F6-02），本应独立把关的 compare 在 G3 后退化为同源自比（F6-08），health 与 coverage 存在多处假绿通道（F6-04、F6-05），额度核账判级口径过期（F6-07）——即「数据错了时，现有的尺子大多量不出来」。
- **模式与部署的事故面未收口**：[vars] 一次拼写错误即可静默回落 legacy 直抓且无告警（F6-03），而 deploy.sh 对模式值不设门禁（F6-06）——G3 的成果缺最后一道锁。
- **备源仍是假备源**：F5-01 只修了字段形变，Paprika 映射实测 0/200 从未落库、无启用门禁（F6-10），冗余叙事不成立。

**发现总账：94 条 —— P0 1 / P1 18 / P2 75；确认 76 / 疑似 18。**（六路原始发现 107 条，跨路重复合并 13 条：同一问题被多路独立发现本身即为证据强度信号，合并项在条目中注明来源路号。）

与第四期（3.4/5）的口径差异：第四期为含产品、SRE、流程的全面评审，本期只审代码与功能缺陷，两者不可直接比大小；本期分数反映的是「缺陷密度与防御纵深」这一专项。

**测试实跑总账（第 5 路实跑，协调人复核口径）**：9 个套件内部计数共 93 项（Node 71：board 9、board-v2 13、board-fetcher 8、fetcher-branches 24、frontend-dom 6、contract-real-data 6、snapshot-verify 5；Python 22：render 8、weekly 14）全部通过、0 失败、0 跳过，总耗时约 5 秒——「全绿」属实；但全绿无门禁（F6-01）、且 health 端点、判级脚本、null 全链等关键路径根本不在这 93 项内（F6-15~F6-19）。

---

## 二、发现清单

### P0（1 条）

**F6-01｜P0｜确认｜部署门禁不跑测试：测试全红也能照常部署，且部署带 --commit-dirty**（来源 R5-01 + R4-23）
证据：scripts/deploy.sh 全文 grep `test` 命中 0 处（协调人亲自复核），门禁只有工具链、coins.json 哈希、check_meta、_headers --check、fetcher dataHash、coins-list 名单；package.json 的 scripts 只有 deploy/deploy:preview/smoke，**根本没有 test 脚本**；仓库无任何 CI 配置；deploy.sh:122 部署带 `--commit-dirty=true`，脏工作区照常上线、无 git status 提示。
影响：任何回归（board 三模式、fetcher 写 blob、前端解码）都不会被部署流程拦住，「全绿」只是人工跑时的状态而非发布条件；本地未提交/实验中改动可随一次部署上线，只能靠部署后 smoke（仅验状态码/键存在/coverage≥94%）与 probe 事后发现。
修复建议：package.json 增加统一 `test` 脚本串联全部 9 套件、任一非零即失败；deploy.sh 在数据门禁前调用、失败即中止，保留 DEPLOY_SKIP_TESTS=1 留痕绕过口；去掉 --commit-dirty 或脏树时醒目警告并记入部署输出。

### P1（18 条）

**F6-02｜P1｜确认｜无字段级校验：坏 rows 能通过 validateBlob 覆写好 blob 并全链透传**（来源 R3-01 + R6-02 + R5-02）
证据：shared/board-schema.js:73-95 normalizeCgMarkets 对 current_price/market_cap/total_volume 仅 `?? null` 透传、无类型/范围检查；computeCoverage（:53-57）只按 id 存在计数；validateBlob（:207-227）对 row 只查 `id 为 string 且 "price" in r`。两路独立实测一致：全 null rows → coverage ratio=1.0、validateBlob ok=true；price="oops"/"12.34"（字符串）、mcap=-5、price=1e30/Infinity 同样 ok=true。tests/board-fetcher.test.mjs:77 对 validateBlob 只有一条正向断言，全仓无一条负向用例。
影响：上游降级/半坏响应（HTTP 200 但字段大面积 null 或类型异常）会以「coverage 200/200、health ok」姿态覆写上一版好数据，前端整表空价/错价；prev 只保留一代，连续两 run 坏数据即无好版本可回滚；board.js 三处 validateBlob().ok 消费点（:559/569/592）全部放行。
修复建议：normalize/validateBlob 增加字段级门禁——price/mcapUsd 须为有限数（非数置 null 并计数），非 null 比例低于阈值（如 price 非 null <98%）整 run 拒绝写 blob；validateBlob 补 rows 长度与 coverage.returned 一致性校验；测试补至少 5 条逐字段污染的负向用例。

**F6-03｜P1｜确认｜BOARD_READ_MODE 缺失/误写一律回落 legacy（fail-open），且 legacy 在 Pages key 缺失时匿名抓取**（来源 R2-02 + R6-01；协调人亲自复核 board.js:757-772）
证据：dispatchGet 中 rawMode 为空时 mode="legacy" 且因 "legacy" 在白名单内连 board_mode_unknown 日志都不记；误写（"kvv"/"KV"/带空格）仅记一条 error 日志后仍走 legacy（tests/board.test.mjs 用例⑧固化此行为）。board.js:229 仅在有 key 时加头、缺失时匿名请求上游（文件头注释与 wrangler.toml:24-27 注释均自认该偏差）。legacy 与 kv-L0 对外 mode 同为 "live"，health.js:99-102 不校验 contractVersion，监控无从分辨。与 fetcher 侧 BOARD_TARGET_KEY 的 fail-closed 口径正面冲突。
影响：一次 [vars] 丢失或拼写事故即可让生产静默回到 G3 前的直抓形态——每访客触发上游抓取、消耗额度、数据口径切换——看板与 health 均无告警，只能靠人看日志发现。
修复建议：kv 期改为 fail-closed：env 缺失或未知值时返回 snapshot 契约 v2 + error 日志（或至少 health 增加 contractVersion===2 断言使错模式必红）；legacy 分支在 key 缺失时走配置错误路径（回快照/503），与 fetcher 统一口径；区分「未显式配置」与「显式 legacy」记日志。

**F6-04｜P1｜确认｜契约 v2 的 coverage 只透传 blob 自报计数、不按 rows 重算，health 跟着假绿**（来源 R2-01）
证据：functions/api/board.js:675 非 L3 分支 `coverage: blob.coverage` 原样透传，coins/count 却由 rows 现场组装（:661-678）；validateBlob 不校验 returned 与 rows 去重 id 数一致。第 2 路探针实测：blob 自报 coverage={expected:4,returned:4} 但 rows 仅 3 行（或含重复 id）时，/api/board 返回 mode=live、coverage.returned=4、count=3；health.js:99-102 只看 coverage 计数，此形态下仍 ok=true。
影响：fetcher 写出计数与 rows 不一致的 blob（写方 bug、部分写坏、人工修 KV）时，用户实际少拿币而监控全绿，G3「compare pass + health 200」的健康结论可被架空。与 F6-02 同源但不同层（本条为读端不重算）。
修复建议：assembleV2 按 coins 实际键集重算 coverage，或 returned≠键数时降级并记结构化日志；validateBlob 增加 returned===rows 去重 id 数、missingIds 与 rows 互补的交叉校验；health 增加 count===returned 断言。

**F6-05｜P1｜确认｜health 对未来时间戳假绿：updatedAt 在未来时 ageSec 为负仍判 fresh**（来源 R2-03）
证据：functions/api/health.js:99-100 `fresh = ageSec <= 900` 无下界校验。第 2 路探针实测：mock board 返回 updatedAt=now+3600s、coverage 200/200 时，health 返回 HTTP 200 {ok:true, ageSec:-3600}。board 侧 freshnessFor 对时钟偏移只钳制 staleAgeSec 为 0 并记 CLOCK_SKEW、仍按 L0/live 端出，故一条未来时间戳 blob 可同时骗过 board 与 health。
影响：fetcher 时钟漂移或 blob 时间字段写坏时，新鲜度被高估最多达偏移量，M4/HC1 新鲜度告警失效。
修复建议：health 增加 ageSec < -60（与 board-schema clockSkewToleranceSec 对齐）判 503、reason=board_clock_skew；board 侧 CLOCK_SKEW 时 freshness.level 不高于 L1 或暴露 clockSkew 字段供 health 消费。

**F6-06｜P1｜确认｜deploy.sh 不校验 wrangler.toml 的 BOARD_READ_MODE，模式被改回 legacy/dual 也全门禁通过**（来源 R4-04）
证据：scripts/deploy.sh 全文无 BOARD_READ_MODE 字样（grep 无命中）；门禁只有数据哈希、_headers 变体、fetcher dataHash、coins-list 名单。而 wrangler.toml:15-18 注释与 rollback.sh 头注释均实测确认：本管线模式切换的唯一载体就是 [vars] BOARD_READ_MODE + deploy.sh 直推。线上探针亦无法兜底：kv 与 legacy 对外 mode 同为 "live"，probe 与 M2 均不区分 servedFrom。
影响：一次误改 wrangler.toml（或回滚演练后忘改回）+ 正常部署 = 生产静默退回 legacy 直连，G3 成果被推翻而无任何告警——正是 F6-07 核账场景本应防的事故、却先被部署环节放行。与 F6-03 互为表里（运行期回落 + 部署期不验）。
修复建议：deploy.sh 增加模式门禁：解析 [vars] BOARD_READ_MODE 与期望值（production 应为 kv）比对，不符即中止、须显式环境变量放行；部署后冒烟追加 servedFrom 断言（应为 kv/cache/memory 之一）。

**F6-07｜P1｜确认｜quota-check.py 判级口径未识别 G3、legacy 576/天硬编码，G3 后每日核账持续误判 WARNING（待核实项独立结论：成立）**（来源 R4-01；协调人亲自复核 quota-check.py:44-50 与 wrangler.toml:18）
证据：第 4 路独立验证——scripts/quota-check.py:44-50 LEGACY_SCENARIOS 写死 [0, 576, 1152] 且判级只用规划口径（:129-155，WARNING 线 projected≥8500 或 dte≤7），全脚本无 BOARD_READ_MODE/G3 概念。ops/quota-log.jsonl 实测复算：11-20/21/22 三条 G3 后记录 verdict 全为 WARNING（规划投影 10361.5/9775.4/9192.5），而同记录 floor（legacy=0）口径投影 4080.6/4070.6/4063.6、余量 41.73/40.79/39.82 天，与待核实说法（约 4,081、约 41.7 天）逐数吻合；以 11-22 数据独立复算 legacy=0 应判 OK。其余口径自洽：fetcher 前向 192/天与 fetcher 本体常数一致、实测日增量约 183–185，三场景与经验护栏算术逐条复算无误——问题只在判级取错场景、且护栏不参与判级；护栏 impliedMaxAvgLegacyPerDay 至 11-22 已降至 362.4 < 576，规划场景对已过时段亦已被实测证伪。注：G3 前（11-14~19）的 WARNING 本有依据，本条仅指 G3 后前向口径失效。
影响：每日假 WARNING（退出码 1），告警疲劳、真实额度风险被噪声淹没；账本/汇报引判级会得出「额度告急」的错误结论。
修复建议：判级按现行模式取数：读 [vars] 或线上 servedFrom 判定模式，kv 模式下规划口径 legacy=0；576/1152 降为历史参考列；或给场景加生效区间（legacy 仅计至 2026-11-19）；护栏应能把「场景已被实测证伪」标进 verdict 旁注。

**F6-08｜P1｜确认｜compare-shadow 在 G3 后以 current blob 为输入时退化为同源自比，pass 是同义反复（假 pass）**（来源 R4-02）
证据：scripts/compare-shadow.mjs:102-113 直接把 live.coins 与 shadow.rows 逐价相比，不校验两侧是否同源、不读 live 的 servedFrom 判别来源；G3 后 live /api/board 由 KV current blob 组装、比对输入按现行口径亦为 v1:board:current——同一份数据，价差恒 0。第 4 路合成实测复现：同一 blob 构造两侧即输出 verdict=pass、价差中位数 0%、P95 0%（与 2026-11-19 G3 后首次实跑形态完全一致，正是同源特征而非独立验证特征）。脚本头注释仍称「影子比对」，runbook（docs/fetcher-runbook.md:43）仍把「影子比对失败」列为 KV 坏数据信号，但同源形态下它对 fetcher 源头错误原理上不可能 fail。
影响：G1/G2 时代的独立交叉验证在 G3 后名存实亡；「compare 仍 pass」被当作数据正确性证据引用时构成假保证，fetcher 系统性错误只能靠 probe/health 的覆盖率发现（而字段质量连覆盖率也发现不了，见 F6-02）。
修复建议：脚本增加同源检测：live servedFrom 为 kv/memory 且比对输入为 current 键时，verdict 强制降级 conditional 并注明「同源自比、非独立验证」；真正的独立比对应改为 blob vs 上游抽样直查或 vs 上一 run blob 的字段级 diff，报告中区分两种模式。

**F6-09｜P1｜确认｜weekly_check.py 在 top250 拉取失败时清零 watchOut/watchIn 并推进 lastRunWeek，连续周计数被一次瞬时故障抹掉**（来源 R4-03）
证据：scripts/weekly_check.py:204-213 拉取失败仅记 incomplete；:270 `state["watchOut"], state["watchIn"] = new_out, new_in` 无条件赋值（失败时为 {}）；:313-317 state 照常写盘、lastRunWeek 更新；main 无条件 return 0。第 4 路 stub 实测复现：top250 抛错后 watchOut 变 {}、incomplete=1、rc=0。
影响：「连续 2 个自然周才成候选」的核心规则被一次上游抖动/限流静默重置，移入/移出候选漏报且无信号，原计数不可恢复。
修复建议：任一关键拉取失败时不得写 state（或只写 lastAttemptWeek），并以非零退出码或报告头醒目标记「本轮作废」；至少 top250 为空时保留旧 watch 不变。

**F6-10｜P1｜确认｜Paprika 备源仍是「假备源」：映射 0/200 从未落库、无启用门禁，启用必恒定覆盖率失败**（来源 R3-02）
证据：第 3 路本地实测 coins-list.js COINS 200 条 paprikaId 非 null 数 = 0；data/coins.json（rows 形态）fields 中根本无 paprikaId 字段；docs/paprika-mapping-proposal.json 自述非空 196/200、未达 197 启用门槛、仅为提案未落库。coinpaprika.js:54-60 按 paprikaId 匹配，全 null 时 rows=0；index.js:308-320 coverage<0.94 必 finishFail。代码内无「映射达标才允许启用」的门禁。F5-01 的修复只完成了字段形变统一与契约测试，落库从未发生。
影响：一旦 CG 连败触发切换或人工置 PAPRIKA_ENABLED=true，备源每 run 必失败、不写 blob，故障期反而多烧 Paprika 调用；站长若误以为备源可用会误判系统冗余度。
修复建议：先完成 W2-11 落库（≥197 非空且 verify-paprika-coverage 连测达标），并在 resolveProvider 增加映射非空数门禁，未达标时强制 CG 并告警；落库前应在 runbook 中把备源状态标注为「不可用」。

**F6-11｜P1｜确认｜creditsUsedEst 系统性漏计失败 run 的真实消耗，额度降频保护可能永不触发**（来源 R3-03）
证据：workers/fetcher/src/index.js:230-242 creditsUsed 仅在探针成功、global 成功、markets 成功三处 +1；finishFail（:143-161）写 health.quota 时用旧计数，未并入本 run 已发生的调用。markets 失败但 global 成功时，global 结果被丢弃且其 1 credit 不记账；失败尝试（5xx/超时/解析失败）均不记账。故障连 streak 时每 run 可真实消耗 2 credits、账面 +0。
影响：月额度被故障期加速消耗而 quotaMode 仍显示 normal，saving/critical 降频失效，可能月中真耗尽 10,000 后才发现；账面「稳态 180–192/天」与真实消耗出现系统性偏差（与 F6-07 的核账口径问题叠加，额度账两头不准）。
修复建议：finishFail 接收本 run 的 attempts/creditsUsed 并入后再 estimateQuotaMode；对「成功但被丢弃的 global」与探针调用统一记账；health 中区分 est 与 attempts 总数。

**F6-12｜P1｜确认｜置信度筛选 100% 失效：选任一置信度必出空表**（来源 R1-01；协调人亲自复核 index.html:224 与:917）
证据：public/index.html:224 三个选项 `<option>高（4）</option>` 等均无 value 属性，按 HTML 规范其 value 等于文本（"高（4）"等）；currentFiltered（:916-917）以 `c.confidence === conf` 严格比较，conf 取自 select.value（"高（4）"/"中（39）"/"低（157）"），与 coins.json 中 confidence 实际取值 "高"/"中"/"低" 永不相等。任一非空选择 → 结果恒 0 条 → 显示「没有符合条件的币种」。现有测试无一驱动 confSel 真实取值。
影响：工具栏核心筛选功能完全不可用，空态文案误导用户以为无符合币种。
修复建议：三个 option 加 value="高"/"中"/"低"（计数留在文本），或在过滤时把 conf 归一化为首字；补一条以浏览器语义取值驱动的回归测试。

**F6-13｜P1｜确认｜实时 mcapUsd=0 被 falsy 回退成快照市值且不打标，主表与详情自相矛盾**（来源 R1-02）
证据：public/index.html:567 effMcap 用 `l && l.mcapUsd? l.mcapUsd: c.snapshotMcapUsd`，0 被当缺失；:566 effPrice 同理。线上实测（2026-11-23 /api/board）：telcoin-2、wefi、yellow 三币 rank:null、mcapUsd:0（上游对无市值币返回 0）。后果：主表在「实时市值」表头下显示三币快照市值（telcoin-2 约 $2.0亿、yellow 约 $0.955亿），而 missingTag（:868）仅在无 live 条目时加「快照价」标，用户无从分辨；detailHTML:800 以 `!= null` 判空，0 显示「—」——同币主表有市值、详情显「—」。价格侧同理：实时价真为 0 时会静默用快照价算倍数。
影响：3/200 币在实时模式下市值口径错误且无标记；极端情形下倍数被快照价污染。
修复建议：effPrice/effMcap 改显式 null 判断，并对 mcapUsd===0 单独定口径（显「—」或按缺失打标）；detailHTML 与主表共用同一 effMcap 结果。

**F6-14｜P1｜确认｜前端 fmt 函数假定数值类型，数字字符串价格使整表渲染抛 TypeError 中断**（来源 R6-03）
证据：public/index.html:532-546 fmtPrice 直接调 `p.toFixed(2)`、:561-564 fmtPct 同理，仅以 isFinite 把关——isFinite 对数字字符串返回 true。第 6 路本地复刻实测 fmtPrice('12.34') 抛 TypeError。调用点:987 与:1079 的 rebuildDerived(); render(); 位于 loadBoard 的 try/catch 之外，异常无人接住。与 F6-02 串联：BOARD.coins 字段来自 assembleV2 对 blob 行的原样拷贝，legacy 路径同样原样拷贝上游字段。
影响：单个币字段畸形即可让实时层整体失效（页面停留在构建快照行、横幅状态与实际不符），上游字段改型时无降级路径。
修复建议：fmt* 入口做数值归一（typeof/Number 转换 + Number.isFinite 复核，非数返回「—」）；或在解码层对 BOARD.coins 做数值清洗；render 调用包 try/catch、失败时保留快照行并横幅标注。

**F6-15｜P1｜确认｜functions/api/health.js 零测试覆盖**（来源 R5-03）
证据：ops/testing/coverage-baseline.md 自认 health.js 行覆盖 0/128；grep tests/ 对 health.js 的 import 为 0（tests 中的 health 命中均为 fetcher 写的 KV health 记录，非 health 端点）。
影响：对外健康端点的状态映射、字段处理、异常分支改坏无人发现；缺口自 W4-06 登记至今未补。与 F6-05（未来时间戳假绿正出在此端点）互证。
修复建议：仿 board-v2 手法为 health.js 建最小套件：正常/降级/down 三态、KV 缺失、负 ageSec、敏感字段 grep。

**F6-16｜P1｜确认｜quota-check.py 与 compare-shadow.mjs 的判级逻辑零测试**（来源 R5-04）
证据：grep tests/ 对 quota-check/compare-shadow 命中 0；quota-check.py:128-134 的 CRITICAL/WARNING 阈值与退出码、compare-shadow.mjs:268 的 pass/conditional/fail 判定与退出码均无任何用例，coverage-report 亦不含这两者。
影响：这两把尺子直接决定额度告警与历次 G2/G3 就绪结论（F6-07 的 WARNING 假象、F6-08 的假 pass 均出自这两把尺子），判级写反/阈值漂移不会被发现，历史结论的可复核性只剩人工复算。
修复建议：quota-check 建合成输入→期望 verdict/退出码的参数化用例；compare-shadow 用固定双 blob fixture 覆盖 pass/conditional/fail 与 runId 不对齐分支。

**F6-17｜P1｜确认｜契约 v2（kv 模式）字段断言不全：volume24h 在现行生产模式下无断言**（来源 R5-05）
证据：tests/board-v2.test.mjs 的 kv 用例只断言 `body.coins.bitcoin.price===100`（:100），coins 的 mcapUsd/rank/change24h/volume24h 在 kv 模式下无一断言；volume24h 断言仅出现在 legacy/dual 路径（board-v2:215、board.test:323）。生产 assembleV2（board.js 约:672）的 volume24h 映射若写错/漏掉，kv 模式全绿照过。
影响：当前生产即 kv 只读模式，W3-25 的核心增量字段恰在该模式下无回归保护。
修复建议：kv 用例对首行做五字段逐项断言，并加一行 volume24h 缺失（旧 blob）→ null 的用例。

**F6-18｜P1｜确认｜null 字段全链无用例：rank=null / price=null / volume24h=null 从未被喂过**（来源 R5-06）
证据：grep tests/*.mjs，rank/volume24h 夹具恒为数字；normalize 本可产出 null（board-schema.js 多处 `?? null`），contract-real-data 的 NULLABLE 集合针对的是快照静态字段、非行情 blob 行；前端 index.html:801 的 volume24h 空分支亦无 DOM 用例触达。
影响：上游缺排名/缺成交量是常态（新币、备源），null 穿越 fetcher→blob→board→前端的任一处抛错或显错都测不出来（F6-13 的 mcapUsd=0 正是这类形态在线上先于测试被发现）。
修复建议：fetcher-branches 与 board-v2 各加一条「整行多字段为 null」用例，断言 blob 校验、board 应答与前端 detailHTML 三段均不抛错且显示占位。

**F6-19｜P1｜确认｜前端测试的 live 载荷与生产契约脱节：mock 不带 volume24h、甚至不带 rank**（来源 R5-07）
证据：tests/frontend-dom.test.mjs:52-60 的 liveCoins 只有 {price,mcapUsd,rank,change24h}（无 volume24h）；tests/snapshot-verify.mjs 约:199-212 的 liveCoins 只有 {price,mcapUsd,change24h}（rank、volume24h 皆无）；而生产契约恒输出五字段含 volume24h，前端 index.html:801 详情「24h 成交量」正读该字段。
影响：W3-25 的前端成交量展示自始无一条 DOM 测试真正喂过该字段，字段改名/格式化写错不会红；mock 形态长期落后于契约，后来者还会照 mock 误判契约。
修复建议：两处 mock 补齐五字段，frontend-dom 增加 detailHTML 成交量段断言（仿现有市值、涨幅段）。

### P2（75 条）

#### 验证与监控类（F6-20 ~ F6-29）

**F6-20｜P2｜确认｜compare-shadow 的 verdict=pass 与 runGate/g1Ready 脱钩，无 health 输入时运行次数未知仍判 pass 并退出 0**（R4-05）证据：compare-shadow.mjs:262-296 verdict 只由 numericPass 与 alignment 决定，runGate.met 只进单独字段 g1Ready；第 4 路实测：不带 --health 时 countedRuns=null、g1Ready=false，verdict 仍 pass、退出码 0。影响：只读 verdict/退出码的调用方会把「样本期运行次数毫无证据」误记为干净通过。修复：runGate.met!==true 时 verdict 上限降为 conditional，或双字段输出并让 g1 口径退出码非零。

**F6-21｜P2｜确认｜compare-shadow 字段门禁只罚 shadow 侧 null，live 侧 null 价格/市值只计数不判 fail**（R4-06）证据：compare-shadow.mjs:126-138 fieldGate 只看 shadowNull*，比对循环对 live price 为 null 直接 skip；实测 live 侧 10 币 price=null → compared=190（≥188 下限）、verdict=pass、failReasons=[]。影响：live 侧多达 11 个币无价时仍可 pass，F4-08「字段级非空入门禁」只落了一半（与 F6-02 叠加）。修复：liveNull* 设上限（>0 fail 或 >2 降级），或把 live null 计入 compared 分母。

**F6-22｜P2｜确认｜probe.mjs 对 v2 契约缺字段静默 PASS**（R4-11）证据：probe.mjs:22-44 各判读量缺失时为 null、hits 为空，:47 verdict=hits≥2 才 FAIL；本地合成实测：返回 {contractVersion:2, mode:"live", coins:{}}（无 freshness/fetch/staleAgeSec/coverage）→ verdict=PASS、rc=0、无不可判读注记。影响：board.js 若回归丢 freshness/fetch 字段——恰是探针要抓的契约坏死形态——探针反而全绿。修复：isV2 时 freshness/staleAgeSec/fetch 任一缺失判 FAIL 或 UNREADABLE（非零退出），「不可判读」按字段缺失触发而非按版本号触发。

**F6-23｜P2｜疑似｜probe.sh 的 warn 判定退出 0，HC1 编排若按退出码 ping，stale 数据（≤3600s）会被报成成功**（R4-12）证据：probe.sh:7-9 定版 warn 不算 FAIL、退出码 fail 时 1 其余 0；:100-105 warn 形态为 mode=stale 且 staleAgeSec≤3600；ops/probe-config.md HC1 行定版「任一断言失败 ping /fail」，而 warn 在脚本内不是断言失败。编排 cron 本体不在仓库内、无法核其是否单独解析 verdict=warn。影响：数据陈旧 15–60 分钟这一档在 HC1 维度无告警痕迹，只剩 M4 一条线。验证方法：查 cron top200-hc1-hourly-probe 指令是否对 warn 分流。修复：probe.sh 对 warn 单独退出码（如 4），或编排解析 verdict=warn 时 ping /fail 并注明降级。

**F6-24｜P2｜确认｜quota-check.py 不校验 health 新鲜度与月份一致性，陈旧 health 会算出假 OK（漏报）**（R4-07）证据：quota-check.py:99-117 只要求 quota 字段存在，days_remaining 以 health 的 month 为锚；fetcher 已死、health 停在上月时 days_remaining=0、projected=旧月 used，完全可能落 OK，脚本不比对当前 UTC 月、不看 lastRunAt 距今。HC4 对 fetcher 新鲜度有独立覆盖故定 P2，但核账脚本自身无防线、其 OK 不可独立采信。修复：前置校验 health.month 与当前月、lastRunAt 距今，失效时退出 3 并注明「health 陈旧、核账失效」。

**F6-25｜P2｜确认｜quota-log 落盘记录无脚本版本/口径标识，口径变更点在日志中不可见**（R4-08）证据：ops/quota-log.jsonl 第 1 条（2026-11-14T02:12）verdict=CRITICAL、投影 21409.4（旧版回填口径），7 分钟后同日第 2 条改判 WARNING/13868.1（现行口径）；quota-check.py:158-176 的 record 无 version/commit/口径代号字段。影响：事后审计逐日判级序列时易把口径切换误读为真实额度事件。修复：record 增加 scriptVersion 与 methodology 字段，历史切换点在旁注中标注。

**F6-26｜P2｜确认｜DEPLOY_SKIP_META_CHECK 绕过无强制留痕，仅靠注释约定**（R5-11 + R6-17）证据：deploy.sh:67-70 该变量置 1 时仅 echo 一行警告即跳过 check_meta 对账，留痕要求只是注释中的「请在 CHANGELOG 注明」，无强制校验、无 ops 日志落盘；第 6 路在 ops/ 中未检索到该绕过的审计记录机制。影响：数据一致性门禁可被无痕绕过，事后审计无法区分「未绕过」与「绕过未留痕」。修复：绕过时强制第二个环境变量填原因、脚本自动追加部署日志（时间/操作者/原因），或直接移除绕过通道。

**F6-27｜P2｜确认｜部署后冒烟判据偏松：不验 v2 契约字段，smoke-headers 未接入部署链**（R5-11 + R4-24）证据：smoke.sh 对 /api/board 只验状态码、JSON 键存在与 coverage≥94%，不验 contractVersion/freshness/fetchRunId 等 v2 关键字段，kv 应答结构整体退化（如退回 legacy 形态）时冒烟仍可全过；ops/headers/smoke-headers.mjs 专为线上安全头而写（S1/S2/S4/S6），但 deploy.sh 部署后只跑 smoke.sh、grep 确认无其他调用点，其 S3/S5 还恒 SKIPPED。影响：_headers 被平台忽略或 board 契约退化可长期无人发现，安全评级证据停留在本地生成层。修复：smoke 增加 kv 契约字段断言；deploy.sh 冒烟后追加 smoke-headers 子集，非零退出按 probe 同级告警留痕。

**F6-28｜P2｜确认｜check-shadow-health.py 对工作目录敏感**（R4-09）证据：check-shadow-health.py:40 以相对路径读 package.json、:52 subprocess.run 无 cwd 参数；从非仓库 cwd 调用时 pin 读取静默回退写死 "4.159.0"（当前恰与 pin 相同、暂无后果），失败统一以退出 2 呈现、难定位。quota-check.py 已以 REPO_ROOT 拼路径并传 cwd，可对齐。修复：REPO_ROOT 拼路径、subprocess 传 cwd、pin 回退时打印 WARN。

**F6-29｜P2｜疑似｜check-shadow-health.py 对无时区的 lastSuccessAt 会在 try 外抛 TypeError、以退出 1（链异常）而非 2（检查失效）收场**（R4-10）证据：check-shadow-health.py:57-62 parse_iso 在 try 内仅做 fromisoformat（naive 可解析），:66 age 计算在 try 之外，aware−naive 抛 TypeError 无人捕获。当前 health 由 fetcher 以 ISO+Z 写入、格式正常，故为疑似。验证方法：以假 wrangler 替身输出无 tz 的 health JSON 跑脚本，看退出码与 traceback。修复：age 计算纳入 try，或 parse_iso 对 naive 结果补 timezone.utc。

#### API 与契约类（F6-30 ~ F6-41）

**F6-30｜P2｜确认｜L3（snapshot）分支的 coverage.missingIds 语义反了：填的是在场行 id 而非缺失 id**（R2-04）证据：board.js:652 `missingIds: (blob.rows || []).map((r) => r.id)`；第 2 路探针实测：expected=200、returned=190、真实缺失 m0..m9 的 blob 老化 7h 后，返回 missingIds 为 190 个在场 id，真缺失反而不在其中。影响：消费 L3 missingIds 的前端/探针/对账会被误导；当前前端只用 returned/expected 未爆雷属侥幸。修复：L3 时 missingIds = blob 自报缺失 ∪ rows id 并去重，或改字段语义并同步契约文档与测试（现行用例未断言 L3 的 missingIds 内容）。

**F6-31｜P2｜确认｜/api/board 对 HEAD 返回 405，与 health 的 HEAD 修复先例不一致**（R2-05）证据：board.js 只导出 onRequestGet/onRequest，非 GET 一律 405、无 onRequestHead；线上实测 `curl -I /api/board` → 405 Allow: GET。health.js:133-135 已因 UptimeRobot HEAD 探测误报事故补过 onRequestHead，board 未同步。影响：任何以 HEAD 探活 /api/board 的监控/工具会误报故障。修复：照 health.js 模式给 board 加 onRequestHead（复用状态与头、body 置空）。

**F6-32｜P2｜确认（代码层；线上 503 分支未实测）｜board 的统一 Cache-Control 被套到 405/503/snapshot 等错误与降级应答上**（R2-06 + R6-18）证据：board.js:63-73 单一 CACHE_CONTROL_VALUE（public, s-maxage=120, stale-if-error=86400），jsonResponse 与 methodNotAllowedResponse 无差别使用，503 upstream_unavailable 与 snapshot 空数据 200 同样带此头；本地探针与线上 POST 405 均确认该头在位。线上 GET 的 cf-cache-status 为 DYNAMIC，边缘当前未实际缓存 Function 应答，故实际影响未证实。影响（若缓存按头执行）：snapshot 空应答可被缓存并在 stale-if-error 下最长 24h 被当作兜底反复端出，延误恢复感知。修复：按应答类型分级——live 用现行长头，snapshot/503/405 改 no-store 或短 max-age 且去掉 stale-if-error。

**F6-33｜P2｜确认｜/api/health 完全没有安全响应头，与 board 的同出口原则不一致**（R2-07 + R6-06）证据：health.js:24-43 只有 content-type 与 cache-control: no-store，无 nosniff/CSP/Referrer-Policy；public/_headers 对 Pages Function 不生效（文件头注释自明），两路线上实测均确认 health 响应头无任何安全头、board 则三头齐全。影响：实际风险低（JSON + 探针消费），但属安全头治理漏网端点，季度自查易漏检。修复：health.js 复用 board 的 SECURITY_HEADERS 常量（宜抽到 shared/ 单一定义），全出口同带，并纳入 ops/headers 冒烟对照。

**F6-34｜P2｜确认｜getIds() 静默丢弃无效 id 使 coverage 分母缩小，legacy/dual 下可假满覆盖（G3 休眠、回落即激活）**（R2-08）证据：board.js:207 对缺字段/空字符串 id 一律静默过滤，无「解码所得数 ≠ coins.json 行数」校验，亦不去重——重复 id 会使 expected 大于唯一币数、coverage 与 count 可不一致；rows 形态（:197-202）只取列索引、不校验每行长度。影响：当前 kv 不走此路径；一旦发生 F6-03 式回落或人工切 dual/legacy，名单小损坏会被覆盖率口径吞掉。修复：getIds 增加与源行数对账及去重，不符记 error 并判 ids_parse_failed 走回退；补 rows 部分行缺 id 的用例。

**F6-35｜P2｜疑似｜契约 v2 双时钟：freshness 按 fetchedAt 算、updatedAt 取 marketsUpdatedAt、health 只看 updatedAt，三方口径可分裂**（R2-09）证据：board.js:615-616 freshnessFor 用 fetchedAt、:671 updatedAt 优先取 marketsUpdatedAt、health.js:80-100 只按 updatedAt 算龄。第 2 路探针实测：fetchedAt 为当前、marketsUpdatedAt 为 2h 前的 blob，board 返回 live/L0 而 updatedAt 已 2h 旧，同一应答自相矛盾、health 会判 503（假红）；反向构造则 board 已 snapshot 而 health 可能仍绿。现行 buildBlob 将两字段写为同一时刻，故为潜伏项。修复：契约层明确 updatedAt≡fetchedAt 并在 assembleV2 统一，或 health 改读 freshness.fetchedAt 判龄；补两字段不一致的回归用例。

**F6-36｜P2｜确认｜dualCompare 比对逻辑多处弱点，且 dual 在 G3 后是「休眠但带电」的死代码**（R2-10）证据：board.js:770-774 dual 模式把 legacy 抓取 + dualCompare 全额加在请求路径（未用 waitUntil 异步化），额外触发 KV 读；:737 中位数取上中位而非真中位数；:732-735 只比交集币、单边缺失与 coverage 差异只记计数不设阈值告警。wrangler.toml 当前为 kv，dual 仅靠改一个 [vars] 值即可重新启用整条 legacy 抓取链。影响：运维价值已低，却保留误切即双倍读放大 + 回源抓取的面；其历史比对结论口径偏乐观。修复：G4 下线 legacy 时一并删除 dual 分支与 dualCompare；此前至少改走 waitUntil、修正中位数、加 coverage 差阈值告警。

**F6-37｜P2｜确认｜gen-headers 的失败处置提示漏写 --variant=on，照提示操作会把 _headers 刷成 WA-OFF 变体**（R2-11）证据：ops/headers/gen-headers.mjs:248 --check 失败时提示「运行 node ops/headers/gen-headers.mjs 重新生成」，而脚本默认 variant=off；当前线上 _headers 为 WA-ON。第 2 路实测 --variant=off 报不一致、--variant=on 通过。deploy.sh 的 (b2) 门禁写死 --variant=on 可拦部署（缓解项），但本地 _headers 会被静默改错、任何绕过 deploy.sh 的直推不受保护。影响：维护者照提示修复后若直推，Web Analytics beacon 域被 CSP 拦截、统计静默失效。修复：提示改为带 --variant=on 的完整命令，或生成到 public/_headers 时强制显式 --variant。

**F6-38｜P2｜疑似｜health 内部 fetch /api/board 无超时，board 挂起时 health 跟着挂起**（R2-12）证据：health.js:67 fetch 无 AbortController/超时（对比 board.js legacy 路径有 3500ms 超时兜底）；handleHead 复用 handleGet，HEAD 探针同样受影响。影响：board 慢挂时 M4 探针只能等平台/客户端超时，告警延迟。修复/验证：给内部 fetch 加 5~10s 超时、超时返回 503；本地 mock fetch 永不 resolve 断言 health 在超时内返回 503。

**F6-39｜P2｜确认｜无 blob 的 snapshotV2Body 语义自相矛盾：stale=true 但 staleAgeSec=0、coverage.expected=0**（R2-13）证据：board.js:685-708 硬编码 staleAgeSec:0、expected:0/returned:0；探针实测 KV 空时返回 mode=snapshot、updatedAt=null、staleAgeSec=0。影响：契约消费者按字面会误判「刚更新过/期望为零」；与 F6-30 同属 snapshot 形态字段可信度问题（当前前端 snapshot 分支未用该文案，未爆雷）。修复：无 blob 时 staleAgeSec 用 null（未知），expected 填可得的真实期望值；契约文档注明 snapshot 下字段语义并补断言。

**F6-40｜P2｜疑似｜kv 读路径的内存回退不对称：Cache 命中不回填 MEM_BLOB、MEM_HEALTH 出错时可无限期用旧值**（R2-14）证据：board.js:556-562 Cache 命中分支直接返回、不写 MEM_BLOB（仅 KV 命中分支 :570 写），故一直走 Cache 命中的 isolate 其 last-good 始终为空，Cache 过期且 KV 同时故障时直接落 snapshot；:602-611 readHealthSummary 在 KV get 抛错时无条件返回 MEM_HEALTH.data、不看年龄。两者均有 freshness 6h 硬顶/health 15 分钟阈值兜底，故定疑似。修复/验证：Cache 命中时同步 MEM_BLOB；出错分支加年龄上限（如 >10 分钟视为 null）；本地 mock 先 Cache 命中、后双坏，断言 servedFrom=memory。

**F6-41｜P2｜疑似｜契约 v2 公开透传上游运维细节（fetch.upstreamStatus / attempts / durationMs）**（R2-15）证据：board.js:630-635 fetchInfo 将 blob.fetchMeta 的三字段原样对外（线上实测在位；fetchRunId 对外可见为已定版口径、不在此列）。影响：任何人可实时观测本站上游抓取成败、重试与耗时画像，为针对性施压/踩点提供情报；调试便利可由日志/health 键替代。修复：对外 fetch 只保留 fetchRunId，其余改记结构化日志或仅经 health 键消费；若保留应在契约文档明示为有意公开。

#### Fetcher 与管线类（F6-42 ~ F6-53）

**F6-42｜P2｜确认｜global 端 429 被完全吞掉：无 skip、无退避、无状态机记账**（R3-04）证据：index.js:246-258，global 请求 rejected 时仅沿用 prev global 并抄 upstreamStatus，不设 skipRunsRemaining、不 applyOutcome，UpstreamError 的 retryAfterSec 无人消费；health.lastUpstreamStatus 成功时只记 markets 状态（:386），监控看不见 global 限流。影响：global 端限流时 fetcher 每 10 分钟照常重试并连带 markets 请求，可能把局部限流拖成全面 429；global 静默变旧。修复：global 429 至少记 health 字段/日志并对 global 单独退避，或复用 skip 计数。

**F6-43｜P2｜确认｜PAPRIKA_ENABLED=false 时状态机仍会把 state 写成 PAPRIKA_ACTIVE，health 快照与实际抓取源不符**（R3-05）证据：source-state.js applyOutcome（:69-128）无 paprikaEnabled 判断，CG 连败 ≥3 或 quotaMode=critical 即 enterPaprika；resolveProvider 未启用时忽略 state 仍走 CG，但 index.js 把 {state, activeProvider} 原样快照进 health.sourceState。影响：观察者会看到「已切 Paprika」而实际仍在抓 CG，排障误导；日后真启用还会继承被污染的状态与静默期（与 F6-10 叠加）。修复：applyOutcome 增加 enabled 参数，未启用时只累积失败计数不迁移 state，或快照以 resolveProvider 的实际 provider 为准。

**F6-44｜P2｜确认｜额度降频的实际节奏与注释/方案不符且投影模型自相矛盾**（R3-06）证据：index.js:92-99 saving 为 age<15 跳过，但在 */10 网格上实际落点 0/20/40 分钟，即 markets 实为 20 分钟一抓而非注释:75 的 15min；estimateQuotaMode（:79-90）投影恒用 192/天、不随降频后速率调整，进入 saving 后仍按 normal 外推，mode 可能整月粘滞或临界抖动。影响：降频比设计更狠（数据更旧）或临界月反复横跳，滞后放大无显式提示。修复：投影改用当前 mode 的日速率分段估算，或 saving 改按 run 计数实现并同步注释口径。

**F6-45｜P2｜确认｜global 相位锚定上一版 asOf、无墙钟对齐，跳过/失败会永久平移相位；「最长滞后约 40 分钟」只是无故障下限**（R3-07）证据：index.js:215 globalDue 以 prevBlob.global.asOf+30min 判定、只在 10 分钟 tick 上评估；429 skip（:185-192）与 quota skip（:201-205）都在 globalDue 计算之前整 run 返回，到期也被一并跳过；抓取失败则下个 tick 才重试。影响：任一次跳过/失败/部署延迟把 global 相位平移 +10 分钟并保持；故障期滞后可远超 40 分钟（6h 才置 null），结构上无自愈对齐点。修复：globalDue 改墙钟相位（如按 epoch 30 分钟窗口判定），或 skip 路径中 global 已严重过期时不跳过 global；报告口径注明 40 分钟为无故障值。

**F6-46｜P2｜确认｜429 skip 轮数向上取整过度，且 429 本 run 仍计入连续失败，与代码注释口径不完全一致**（R3-08）证据：index.js:326-327 skip=Math.ceil(retryAfterSec/600)，parseRetryAfter 缺省 60s → skip=1，即上游只要求等 60 秒却实际停抓约 20 分钟；同时:180 注释称「跳过的 run 不计入连续失败」，但 429 本 run 经 finishFail（:152）consecutiveFailures+1。影响：短暂限流被放大为约 20 分钟数据停滞 + 失败计数虚增，告警可能因纯 429 序列误报。修复：skip 改为 retryUntil 时间戳判定；429 是否计数与 W2-02 §3.3 口径对齐后二选一并改注释。

**F6-47｜P2｜确认｜kvGetJson 把 KV 读错误与键不存在混为一谈，瞬时读失败会重置计数与锁定状态**（R3-09）证据：index.js:59-66 kvGetJson catch 全部返回 null；:124-125 health/sourceState 读 null 即用 empty 兜底；:141 prevBlob 读 null 即视为无上一版。影响：一次 KV 读抖动即可把 consecutiveFailures 清零重计（掩盖持续故障）、丢失 sourceState 的额度锁定、误判 globalDue 多耗额度且不写 prev 归档（回滚链断一环）。修复：区分「键缺失」（返回 null）与「读异常」（抛错）：读异常时本 run 以 stage=kv-get 失败收尾、不覆写 health/sourceState。

**F6-48｜P2｜疑似｜cron 与手动 /run（或双 /run）并发无锁，health/sourceState/quota 为读-改-写竞态**（R3-10）证据：runFetch 全程无并发互斥/版本校验，两 run 可同时读同一 health 与 prevBlob，后写者覆盖先写者计数，prev 归档与 blob 写入可交错成 prev==current 或旧 blob 后落盘覆盖新 blob。单 run 时长通常短、cron 自重叠概率低，但 /run 与 cron 撞车或人工连点即可触发。验证方法：本地 KV mock 下并发启动两个 runFetch，断言最终 blob 为较新 run、计数不丢失。修复：/run 入口做在途合并（in-flight promise 复用），或写入前复读 fetchRunId/updatedAt 做乐观校验。

**F6-49｜P2｜确认｜/run 鉴权与滥用面：非常量时间比较、无节流、且绕过 BOARD_FETCH_DISABLED**（R3-11 + R6-07）证据：index.js:396-410 token 用 `provided!== token` 普通字符串比较；无调用频率/并发限制；scheduled 的 FETCH_DISABLED 检查（:390-394）对 /run 不生效（注释自述为有意设计）。每次 /run 最多耗 markets+global 2 credits 并产生 3 次 KV 写。令牌为 256 位随机值，在线爆破/时序攻击不现实，故 P2。影响：token 一旦弱泄露（日志误记、截图），无第二道防线限制滥用频率，只能靠轮换吊销；人工连点也会与 F6-11 的漏计叠加。修复：比较改常量时间（双侧 SHA-256 后逐字节比对）；/run 增加最小间隔（如 60s）与触发留痕入 health；评估 disabled 时 /run 是否也应拒绝。

**F6-50｜P2｜确认｜coingecko.fetchMarkets 的 fetchImpl 注入参数是死参数；两 provider 的响应体解析不在超时保护内**（R3-12）证据：coingecko.js:72 签名含 fetchImpl 但函数体只调用内部 fetchWithTimeout（用全局 fetch），注入从未被使用——调用方若以为注入了 mock 实际打的是真网络（现有测试靠 stub 全局 fetch 才未暴露）；coingecko.js:101-106 与 coinpaprika.js:47-51 的 res.json() 均在超时计时器清除之后执行，body 读取挂死无上限。影响：测试替身语义误导（未来重构易踩）；上游 body drip 可让单 run 长时间悬挂、推迟后续调度。修复：删除 fetchImpl 参数或真正透传；res.json() 纳入同一 AbortController/race 保护。

**F6-51｜P2｜确认（潜伏）｜coins-list.js 靠手工命令再生成，无任何测试断言其与 data/coins.json 一致**（R3-13）证据：coins-list.js:1-3 头注生成方式为 runbook 中的手工 node -e；tests 中 fetcher-branches 仅 import 自用、无 ids 集合比对断言。第 3 路本次实测当前一致（200 条、无重复、两份 coins.json 字节一致）。影响：将来榜单换币后若漏跑再生成，fetcher 会静默继续抓旧 200 币、coverage 仍显示 200/200——榜单内容错误而健康全绿。修复：加契约测试断言 COINS ids 集合 == data/coins.json 解码后 coingeckoId 集合，或把生成并入 build 流程。

**F6-52｜P2｜确认｜global 段同样无字段有效性校验：上游返回空/残缺 global 会被盖上新鲜 asOf 覆写好值**（R3-14）证据：board-schema.js:99-110 normalizeCgGlobal 对缺失字段一律产 null；validateBlob（:221-224）对 global 只查是否为对象、不查关键字段是否非 null；index.js:240 对成功返回的 globalSegment 无条件盖新戳。影响：CG /global 返回 200 但 data 为空时，blob.global 变为 {全 null, asOf=刚刚}，读端当新鲜 global 输出，且下一 run 30 分钟内不再重抓，坏值被「保鲜」半小时（与 F6-02 同源）。修复：global 关键字段全 null 时视为抓取失败、沿用 prev global 原 asOf；validateBlob 对 global 全 null 给 error 或 warning 并落 health。

**F6-53｜P2｜疑似｜Paprika tickers 请求无 limit/分页参数且 rank 口径直接透传，与 CG 的 market_cap_rank 语义未经再核**（R3-15）证据：coinpaprika.js:55 请求 tickers 端点无任何分页参数；board-schema.js:140 rank 直接取 t.rank（Paprika 自家排名）。历史实测基于全量返回假设，本次未消耗额度复测其默认返回上限。影响：若免费层默认返回条数有上限，尾部映射币静默 missing（与 F6-10 叠加）；切源瞬间名次会因口径差异跳变。验证方法：启用评审时单次 GET 该端点核对返回条数与最尾映射币是否在内，抽 10 币比对两源 rank 差。修复：显式带 limit 或分页拉取；rank 差异在切源说明中标注。

#### 前端类（F6-54 ~ F6-68）

**F6-54｜P2｜确认｜coins.json 加载失败时 loadWatch 未执行，此时在快照行上点星会覆盖清空已存自选**（R1-03）证据：init（index.html:1060-1072）取数失败即 showSnapshotFallback 后 return，loadWatch（:478）只在成功路径调用；而 tbody 点击委托在脚本底部无条件绑定。失败态下 watchSet 为空集，点星 → saveWatch（:493-499）把仅含新点一币的数组写入 localStorage，旧自选被永久冲掉。概率低（静态文件与页面同源同部署）但后果不可逆。修复：loadWatch 提前到 init 最前先按原始数组载入，或失败态禁用星标/自选保存。

**F6-55｜P2｜确认｜快照模式下自选星标不回显**（R1-04）证据：init 成功路径末尾（:1073-1080）仅在 hash 命中或 board 已 live 时 render；board 失败/快照模式下 tbody 保留构建期静态行、星标一律为 ☆（静态写死），与 localStorage 已存自选不一致，须先做一次触发 render 的交互才纠正。影响：行情不可达（恰是用户更需要确认自选的时刻）时自选标记全错，与 F6-54 叠加更糟。修复：init 在 loadWatch 后对静态行做一次轻量星标同步，或快照模式也走一次 render。

**F6-56｜P2｜确认｜livePatched 永不复位，「前 50 条」折叠在实时修补后永久失效**（R1-05）证据：effectiveLimit（index.html:770-772）把 livePatched 列为 Infinity 条件之一；render 的 patch 分支（:946）置 true 后全站再无置 false 之处。修补后任意排序/筛选再清除，列表恒为 200 条，「收起为前 50 条」分支不可达。影响：长列表浏览负担回归三期治理前状态，与 W3-24 定版收起交互矛盾。修复：livePatched 改一次性标志（patch 后即清），或为该态提供可达的收起入口。

**F6-57｜P2｜确认｜patchInPlace 不刷新已展开详情行，实时到达后详情仍是旧的「无实时数据」**（R1-06）证据：patchInPlace（index.html:889-910）对 detail 行仅随主行搬移、内容不重算；board 到达前展开的详情（24h/实时市值/成交量均为「—（无实时数据）」）在修补后仍旧，主行已是实时价、同屏自相矛盾，须手动收起再展开。修复：patch 时对 expandedIds 中的币以最新 detailHTML 重建 detail 行。

**F6-58｜P2｜确认｜patchInPlace 单元格 innerHTML 整体替换会销毁币种列内的按钮节点，焦点丢失**（R1-07）证据：patchInPlace（index.html:900-905）对每行 12 个 td 逐个赋 innerHTML，展开/收藏按钮被新节点替代；W3-05 注释（:887-888）称「节点不销毁、焦点不丢」——tr 节点确实保留、滚动可保，但焦点若落在按钮上，行情到达瞬间焦点掉回 body。DOM 桩不建模焦点，此路径无测试覆盖。影响：键盘/读屏用户的无障碍回归。修复：patch 时跳过含 activeElement 的单元格做差异更新，或修补后恢复焦点到同 id 新按钮；至少修正注释口径。

**F6-59｜P2｜疑似｜decodeCoinsData 无字段健全性校验，fields 改名/行形变时整表变垃圾而非保留快照兜底**（R1-08）证据：decodeCoinsData（index.html:1044-1058）rows 形态只验 meta.fields 为数组便按位 zip；若某行是对象而非数组，产出 200 个缺字段对象，init 的 `if (!COINS.length) throw`（:1067）不触发，render 以 undefined 字段渲染满屏「—」/空行，静态快照行已被整表替换，W2-17 定版的快照兜底被绕过；行元素为 null 时反而走 catch 兜底，两种形变结局不一致。验证方法：本地把 coins.json 的 fields 中 coingeckoId 改名后喂 init，观察 tbody 是否被垃圾行替换。修复：解码后加最小校验（首行 coingeckoId 非空字符串、estRank 为数字、抽样行长==fields 长），不合即 throw 走既有兜底。

**F6-60｜P2｜确认｜watchOnly 下「显示全部」是死按钮，toggleStar 手工删行后按钮状态不刷新**（R1-09）证据：renderShowAllBar（index.html:774-783）的 filtered 判定只看 q/confSel、不含 watchOnly；自选 >50 且只看自选时按钮显示「显示全部（还有 X 条）」，点击仅置 showAllManual，render 仍按 watchOnly 过滤，永远看不到「全部」。另 toggleStar 手工删行路径（:514-525）只更新 resultMeta、未调 renderShowAllBar，计数随之过期。修复：filtered 计入 watchOnly 并在该态改文案/隐藏；删行路径末尾补 renderShowAllBar 调用。

**F6-61｜P2｜确认｜hash 直达的 document.title 名次与主表名次口径不一致，且无效 hash 时 hashTarget 残留**（R1-10）证据：applyHashTarget（index.html:1035）title 写报告排名 estRank；主表 rank 列在 live/stale 模式显示 liveRank（rowCells:869、表头「实时预估排名」）。同一币分享出去的标题名次与打开后表内名次不同。另 onHashChange（:1037-1047）对无效 hash 只重置 title、不清 hashTarget，effectiveLimit 的 Infinity 豁免残留到后续交互。修复：title 按 boardMode 取 liveRank/estRank 与表头同源；无命中时一并 hashTarget=null。

**F6-62｜P2｜确认｜契约 v2 的 L1「delayed」模式前端不识别，横幅误称「上游暂不可达」**（R1-11 + R2-16，两路独立发现）证据：shared/board-schema.js freshnessFor 的 L1 返回 mode:"delayed"，board.js assembleV2 原样透传；前端 boardMode（index.html:584-590）只识别 live/stale/snapshot，"delayed" 落入 stale 兜底，applyBoardState（:647-652）显示「…上游暂不可达」横幅——而 delayed 仅表示数据龄 15–30 分钟、抓取链路可能完全正常。影响：状态文案夸大故障程度，与第四期「状态须实」口径相悖。修复：前端显式识别 delayed 并给「行情延迟约 X 分钟」中性文案，或 API 侧 L1 mode 改回 stale 以 freshness.level 区分；二选一后补契约测试锁定。

**F6-63｜P2｜确认｜fmt* 边界格式三件：价格千分位/小数位不一致与负价显「0」、涨跌「-0.0%」红字、市值进位成「$10000亿」**（R1-12 + R1-13 + R1-14）证据（第 1 路本地实测同一批函数）：fmtPrice（index.html:531-546）999.999 → "1000.00"（无千分位，与 ≥1000 分支断裂）、2127.5 → "2,127.5"（不补两位小数）、-5 → "0"（p<=0 分支把负价与零价都渲成 0，异常数据被伪装成真实零价）；fmtPct（:561-564）-0.04 → "-0.0%" 且颜色由未舍入原值决定，出现红色「-0.0%」；fmtMcap/sig3（:547-560）v=9.9995e11 时输出 "$10000亿" 而非 "$1.00万亿"，正是 W3-13 注释声称要消除的形态（当前总市值约 $2.08万亿未触发，单币或回落区间即触发）。修复：≥1000 分支加 minimumFractionDigits:2；p<0 返回「—」；|x|<0.05 统一显示 "0.0%" 且不着色（或颜色用舍入后值）；sig3 进位达 10000 时提升单位重算。

**F6-64｜P2｜确认｜展开按钮初始渲染缺 aria-controls，详情行关联靠点击后补设**（R1-15）证据：coinInnerHTML（index.html:861-864）与静态快照行的 exp 按钮均只有 aria-expanded、无 aria-controls；只有 toggleExpand 点击路径（:840）才补设，hash 直达以 btn=null 展开时永不补设。先前 tracker 已记「aria-controls 仅 1/201」小缺口，本期复核仍在。影响：读屏用户无法由按钮定位对应详情区域。修复：模板中直接输出 aria-controls='d-<id>'。

**F6-65｜P2｜确认｜自选币下架/缺失被静默除名且下次保存即永久删除，无任何提示**（R1-16）证据：loadWatch（index.html:484-490）以当前 COINS 的 id 集过滤已存数组，不在集内的 id 直接丢弃；用户下一次点任意星标触发 saveWatch，落盘即过滤后集合，原自选永久消失且无感知。影响：榜单季度换血时用户自选被无声清理。修复：过滤只作用于显示/计数、落盘保留原始 id 集，或在自选文案处标注「N 个自选已不在榜单」。

**F6-66｜P2｜确认｜esc() 不转义单引号，却被大量用在单引号属性值上下文，存在属性逃逸面**（R1-17 + R6-04，两路独立发现）证据：esc（index.html:580）只处理 & < > "；单引号属性用法遍布 detailHTML/coinInnerHTML/rowHTML（data-exp、id='d-…'、aria-label、class='conf-…'、CoinGecko 外链 href），且经 innerHTML/insertAdjacentHTML 注入。当前 200 条数据未见单引号异常值，属防御纵深问题：一旦某币 id/name/confidence 含 '，属性可被截断，轻则行结构破裂、重则注入（CSP 可挡内联脚本执行，挡不住 HTML 注入类篡改）。修复：esc 补 `'` → &#39;（及反引号），或属性统一改双引号；build.py 产出时对 id/name/symbol 做字符集白名单校验。

**F6-67｜P2｜确认｜detailHTML/rowCells 多个数值字段未经转义/格式化直拼 HTML，全靠静态数据自律**（R6-05）证据：index.html:807 estRank 原样拼接、:871 String(c.estRank) 直入 innerHTML、detailHTML 中 multLo/multHi 原样拼接；decodeCoinsData 对 rows 只按 fields zip 透传、无字段类型校验。现行数据为数值、暂无实际注入内容。与 F6-66 同源：数据管线一旦产出字符串型异常值，此处即为注入/渲染崩坏点。修复：数值字段一律经 fmt*/Number() 归一后拼接，或在 decodeCoinsData 出口加字段类型断言（非有限数置 null 并计数告警）。

**F6-68｜P2｜疑似｜搜索词不支持 coingeckoId，且 searchBlob 无分隔拼接可跨界误命中**（R1-18）证据：rebuildDerived（index.html:761）searchBlob 为 name+symbol+aliases 无分隔拼接：查 "nbt" 可命中 "bitcoinbtc" 的跨界子串；同时 hash 直达支持按 id 定位（:1000-1011），搜索却不含 id，粘贴 "avalanche-2" 搜不到对应币。影响：搜索召回口径与直达口径不一致，长尾币难搜。验证方法：分别以 "avalanche-2"、"nbt" 实测命中集。修复：searchBlob 以空格拼接各字段并追加 coingeckoId。

#### 脚本与管线类（F6-69 ~ F6-78）

**F6-69｜P2｜确认｜build.py 两条路径都是先 emit 落盘、后 render_snapshot，渲染失败时 coins 已更新而首页快照仍旧，半成品可被正常部署**（R4-13）证据：build.py:505-513 与:668-675 均先 emit 写两份 coins.json、再渲染，失败 return 1 且产物不回滚；此后两份 coins.json 哈希一致（deploy.sh:67-72 只比这两份），index.html 内快照仍是上一版，部署门禁无快照-vs-coins 一致性检查。JS 加载后自愈，但首屏/无 JS/SEO 口径错位。修复：先渲染到临时文件、成功后一并落盘；或 deploy.sh 增加快照新鲜度断言（index.html 内 generated 注释 == coins.json meta.generatedAt）。

**F6-70｜P2｜确认｜build.py emit() 静默丢弃 FIELDS23 之外的字段且不重算 dataHash，产物自洽性被破坏且当场不报**（R4-14）证据：build.py:452-463 emit 以 FIELDS23 编码 rows、meta 除 fields 外原样透传（含旧 dataHash）；--emit 路径的 check_meta 在 emit 之前跑，对象形态源若某币多一字段，dataHash 按含该字段的规范对象计算可通过校验，emit 丢字段后落盘文件的 dataHash 与其 rows 解码结果不再匹配，要等下一次门禁才暴露且报错指向无辜的下一次运行。现行数据恰为 23 字段整齐，影响为潜在。修复：emit 前断言每币字段集恰等于 FIELDS23（多/少都报 GateFail 并列 symbol），或 emit 后对落盘文件再跑一次 check_meta 才返回 0。

**F6-71｜P2｜确认｜check_meta.decode_coins 用 zip 静默截断，且「解码单一来源」仅限 Python 侧、JS 侧多份实现行为已分叉**（R4-15）证据：check_meta.py:21-33 `dict(zip(fields, r))` 对行长≠字段数不报错（短行丢尾字段、长行丢多余值）；gen-paprika-map.mjs:11-24 与 verify-paprika-coverage.mjs:11-24 各自实现 decodeCoins（短行补 undefined，与 Python「键缺失」语义不同），index.html 与 tests/ 另有两份。Python 侧 build/weekly/render 确为单一来源（注释属实），但跨语言口径靠注释维系、无行长契约校验。影响：rows 行被截断/错位时各工具静默产出不同币对象，下游计数/哈希可能各自「自洽」而互相矛盾。修复：decode_coins 增加行长断言；JS 两处改调同一共享模块，或至少补一条畸形行跨实现一致性测试（与 F6-79 同批）。

**F6-72｜P2｜确认｜weekly_check.py 对 ids 行情「拉到空/残缺 list」无完整性下限，会整表误报疑似下架**（R4-16）证据：weekly_check.py:218-227 ids_fetch_ok 只判响应是 list；:120-134 在 ok 时把缺行全列候选。第 4 路实测（stub ids 返回 []）：missing=200、报告全表「疑似下架/迁移」。真实上游若因参数/限流返回部分行，同样产生近全表假候选，200 条噪声足以淹没真信号。与 F6-09 同源（失败形态只分「抛错」未分「残缺」）。修复：ids 返回行数设下限（如 <180 判 incomplete、本节不判定），报告区分「大面积缺行（疑似拉取异常）」与「个别缺行」。

**F6-73｜P2｜疑似｜weekly_check.py 退出码恒 0，告警/候选/到期均不反映到流程信号**（R4-17）证据：main 全路径 return 0，alerts（注释自称「最高优先级告警」）与 incomplete、override 到期只进报告文本。脚本定版为「只交付、人工手动运行」，靠人读报告属设计权衡，故为疑似；但同项目其他检查脚本均以退出码分级，口径不一致。定级方法：由站长确认周检是否永远纯人工阅读；若未来接入任何调度/汇总，未改退出码即系统性漏报。修复：alerts>0 或 incomplete 非空时返回非零，报告内容不变，脚本头注明退出码语义。

**F6-74｜P2｜确认｜rollback.sh mode 子命令明知对直推管线不生效，仍真执行 PATCH 并先打印「mode 已设置」**（R4-18）证据：rollback.sh:26-35 头注释实测结论「API 改 env 对 Wrangler 直推的新部署不生效、不得单独作为模式回滚完成依据」；但 cmd_mode 对 preview 无任何确认变量（production 才要 ALLOW_PROD_MODE_ROLLBACK=1），执行后先输出「mode 已设置：…BOARD_READ_MODE=…」、再输出生效口径警告——事故现场的操作者极易在第一行收尾。脚本不回读线上验证（按其自述也验不到模式），即无任何「已生效」证据却给 success 语义。影响：G3 坏数据回滚实战中可能误判已回滚、延误真正的 [vars]+deploy 处置。修复：mode 子命令默认拒绝执行、须显式 ROLLBACK_MODE_API_ONLY=1 且输出首行打印「此操作不改变线上行为」；或改为打印正确回滚步骤的向导。

**F6-75｜P2｜疑似｜rollback.sh deployment 自动选「上一个部署」时不校验其 latest_stage 是否成功，可能回滚到失败部署**（R4-19）证据：cmd_deployment 的选择逻辑只按创建时间倒序取 items[1] 或按 id 定位，不读 latest_stage.status，stage 只在回滚成功后的摘要里打印。Cloudflare 列表是否包含失败部署及其可回滚性未在仓库内实测。验证方法：preview/生产部署列表只读导出，核对是否存在 stage!=success 的条目及其位置。修复：选择时过滤 latest_stage.status=success 并在确认输出中打印目标 stage。

**F6-76｜P2｜确认｜scripts/archive/ 旧管线无脚本级退役守卫，merge_refill*/build_coins_json 以绝对路径直写现行 coins.json，误跑可覆盖现行数据**（R4-20）证据：archive/2026-11-10-refill/merge_refill.py:16-17 绝对路径、:184-185 双写现行两份 coins.json，脚本头 docstring 仍是正常功能说明、无退役字样；merge_refill2.py:254、legacy-pipeline/build_coins_json.py:52 同形态。退役声明只在各归档目录 README 内。在用代码/文档无任何对 archive 的引用（grep 确认），不会被自动误调用，风险限于人工误跑；产物为旧形态、deploy 时 schemaVersion 门禁可拦上线、git 可恢复，故 P2。修复：每个归档脚本首行加 sys.exit 退役守卫（或改扩展名.py.retired），保留可读性、杜绝可执行性。

**F6-77｜P2｜确认｜verify-paprika-coverage.mjs 报告标题写死「第 1 天」且启用门槛不落退出码**（R4-21）证据：verify-paprika-coverage.mjs:61 标题模板中「（第 1 天）」为字面量，脚本头注释却要求连测 3 天各存一份——第 2/3 天产物会被误标第 1 天；:52 gate 只生成文案、无 process.exitCode 设置，hits<195「禁止启用」时仍退出 0。影响：三日连测证据链天数失真（无意）、门槛未达靠人读文案拦截（与 F6-10 的落库验收直接相关）。修复：天数由参数/已有报告数推导；gate 非达标时退出码置 1 并在首行输出机器可读结论。

**F6-78｜P2｜疑似｜gen-paprika-map.mjs 中置信匹配用子串包含，短 coingeckoId 易误配候选**（R4-22）证据：gen-paprika-map.mjs:52 `slugPart.includes(id) || id.includes(slugPart)`，短串包含关系会把无关条目列为中置信候选。产物为人工核定审查表、定版明确「禁止全自动采信」，影响限于审查噪声。验证方法：对现行 candidates 输出按 slugPart 长度 <4 的中置信行抽查误配率。修复：包含匹配加最小长度门槛（如 ≥5）并叠加 name slug 前缀一致。

#### 测试与契约类（余，F6-79 ~ F6-83）

**F6-79｜P2｜确认｜「契约测试」不校验 board-schema：两份契约混名、FIELDS23 三处硬编码复制**（R5-08）证据：contract-real-data.test.mjs 全文不 import shared/board-schema.js，校验的是 coins.json 静态产物的 FIELDS23（文件内硬编码:33-37），与 KV blob 契约（SCHEMA_VERSION/validateBlob）无关；同一 FIELDS23 又在 board-v2.test.mjs:198 逐字复制一份，第三份在 scripts/build.py，board-v2 的副本不与产物 meta.fields 对账、漂移时静默。影响：改 board-schema 字段时 contract 套件不会红；FIELDS23 任一处漏改只有一条路径能发现。修复：FIELDS23 收敛为单一来源，两套件改为 import/读取；contract 文件改名或文件头明确区分「静态产物契约」与「blob 契约」（与 F6-71 同批）。

**F6-80｜P2｜确认｜无统一测试入口，运行方式靠文档口口相传**（R5-09）证据：package.json 无 test 脚本（见 F6-01）；Python 侧无 pytest（本机 No module named pytest）、无 requirements，两套件只能逐个直跑；coverage-report.mjs 只自动发现 Node 套件且未列 weekly_check_test.py；各期 CONSTRUCTION 文档记载的套件数/计数口径互不一致（40/61/85/93，无单一台账）。影响：无法一条命令复现「全绿」，漏跑某个套件（尤其 Python 两套）无人发现，历期结论不可直接复核。修复：加 npm test（或 scripts/run-tests.sh）串联 Node+Python 全部套件并汇总计数；覆盖报告纳入 weekly 套件。

**F6-81｜P2｜确认｜测试注释与基线文档的红/绿状态已过期，与实跑不符**（R1-19 + R5-10）证据：frontend-dom.test.mjs 文件头（:24-27）、标题（:345）与尾注（:388-390）仍称 ④ F4-07 为「预期红」、基线退出码 1，但生产 index.html:800 已改读 lv.mcapUsd、本期实跑 6/6 PASS、退出码 0；ops/testing/coverage-baseline.md 仍记「frontend-dom 退出码为 1」「contract rows 段 PENDING-W322 跳过」，与实跑 6 PASS/0 SKIP 不符。影响：过期「预期红」标签会训练维护者对红灯脱敏，真回归易被当作「已知的红」放行；基线数字被后续评审引用时误导。修复：删除预期红标注与尾注特判文案；coverage-baseline.md 加「已过期」头注或重跑更新。

**F6-82｜P2｜疑似｜前端 DOM 桩保真度有限，时序型假绿/假红风险**（R5-12）证据：frontend-dom 与 snapshot-verify 均以手写 DOM 桩在 vm 中跑 index.html 真实脚本，桩只实现被测路径用到的 API 子集；frontend-dom ⑤ 靠 settle(3,60) 等待 localStorage 防抖 100ms，属墙钟时序断言。本次实跑全过，但桩未实现的属性/方法在页面演进后可能先以「桩报错」形式假红，或因桩对 innerHTML 只存字符串而漏掉真实浏览器解析差异（假绿）。修复：桩缺失方法时抛显式「桩未实现」错误以区分假红；套件头注维护桩覆盖的 DOM API 清单。

**F6-83｜P2｜疑似｜board 系列 mock 规模与形态偏理想：4 币小样本 + 完全对齐的 dual 对比**（R5-13）证据：board/board-v2 的 IDS 均为 4 币手工 mock，dual 用例中两路喂完全相同数据、只断言价差中位数日志为 0，未构造「两路真有差异」时的对外口径与日志数值；fetcher 侧虽有 200 币真实名单用例，但 board 消费端从未以 200 行 blob 走 kv 路径。影响：大 blob 的序列化/覆盖计算/dual 差异分支在消费端无证据；dual 日志曾是 G2/G3 决策依据，其差异算法从未被验算过非零情形（与 F6-36 呼应）。修复：board-v2 加一条 200 行 blob 的 kv 用例（可复用真实产物名单）；dual 用例加一组人为价差数据断言中位数计算。

#### 安全与治理类（余，F6-84 ~ F6-94）

**F6-84｜P2｜确认｜BOARD_FETCH_DISABLED 仅精确等于 "1" 才停抓，禁用开关为 fail-open 方向**（R6-08）证据：index.js:375 `String(env.BOARD_FETCH_DISABLED) === "1"`，误写 "true"/"yes"/" 1" 均静默按启用处理、cron 照常抓取烧额度。与同仓口径不对称：PAPRIKA_ENABLED 仅精确 "true" 启用（fail-closed）、BOARD_TARGET_KEY 白名单 fail-closed。影响：紧急停抓（额度事故/上游封禁）时值写错，操作者以为已停、实际继续运行，且 skipped 日志缺席不易察觉。修复：改为「除非显式为 "0"，任何非空值都视为禁用」或至少接受 "1"/"true" 并对未知值记 error；三个开关的取值口径在 fetcher README 中列表统一。

**F6-85｜P2｜疑似｜BOARD_SOURCE 未知值静默按 auto 处理、无告警留痕**（R6-09）证据：source-state.js:29-48 resolveProvider，forced 不在 {coingecko, coinpaprika, auto} 时穿落 auto 分支，既不产生 warnings 也不记日志（对比：PAPRIKA_ENABLED=false 时强制 coinpaprika 会 push warning）。验证方法：单测直调 resolveProvider 传 BOARD_SOURCE 拼写错误值，观察 warnings 为空且走 auto（本次未跑该单测，属代码直读推断）。影响：人工覆盖源时拼写错误会被误认为「已按指定源运行」，熔断演练/事故处置时误判系统状态。修复：未知值 push warning（主流程已有 source_config_warning 落日志通道），或记结构化 error。

**F6-86｜P2｜确认｜本地脚本在 CoinGecko key 缺失时匿名回退，与线上 fail-closed 口径分裂**（R6-10）证据：scripts/build.py:58-61 cg_headers「key 为空返回空头字典」即匿名调用；scripts/weekly_check.py:41-44 同形且文件头注释明示「可为空=匿名」。fetcher 与 kv 读路径对同情形均为配置错误、绝不匿名；匿名共享 IP 限流约 5–15 次/分钟且与他人共享（PHASE2_PLAN）。影响：构建/周检环境漏注入 key 时不报错、静默匿名，既可能因限流产出残缺构建数据（build.py 有覆盖门禁兜底、风险部分受控），也可能连累同出口 IP 的线上抓取被限流；「全仓不匿名」的审计结论不成立（与 F6-03 的 legacy 匿名同病）。修复：key 缺失时显式报错退出（或醒目 WARNING + 报告标注 anonymous），确需匿名调试用显式开关留痕。

**F6-87｜P2｜确认｜Cloudflare 账号 ID 字面量作为默认值硬编码于两支脚本，缺失环境变量时静默指向真实账号**（R6-11）证据：check-shadow-health.py:21 与 quota-check.py:42 均为 `os.environ.get("CLOUDFLARE_ACCOUNT_ID", "<账号ID字面量>")` 形态（本报告只记模式、不抄录值）；同文件对 API TOKEN 缺失却是 fail-closed 报错退出，两类标识口径不一致。NAMESPACE_ID 亦为字面量（与 wrangler.toml 公开值相同，风险较低）。影响：账号 ID 非凭据、单独不能操作账号，但它是令牌滥用与定向攻击的必要拼图，且默认值兜底使脚本在错误环境中也会对真实账号发起调用尝试。修复：ACCOUNT_ID 改必填环境变量、缺失即 fail-closed 退出，与 TOKEN 同口径。

**F6-88｜P2｜确认｜.gitignore 未覆盖.env 等常见密钥文件形态，属预防性缺口（当前无实际泄漏）**（R6-12）证据：.gitignore 仅 6 行，含 `.dev.vars*` 但无 `.env` / `.env.*` / `*.pem` / `*.key` / `*secret*` 等模式；本次 git 全历史与工作树模式扫描未发现疑似真实密钥。影响：未来任一工具落盘.env 时可被 `git add -A` 静默带入仓库并同步到 GitHub 私有仓备份，扩大暴露面。修复：.gitignore 补 `.env*`（保留 `!.env.example`）、`*.pem`、`*.key`、`*.p12` 等模式，并考虑提交前文件名拦截。

**F6-89｜P2｜确认（已知遗留复核，维持原定级）｜SRI 现状未变：全仓无 integrity 属性，外链统计脚本无完整性校验**（R6-13）证据：grep 全仓 `integrity` 命中 0；index.html:1141 与 privacy/index.html:85 的 Web Analytics beacon 脚本无 integrity 属性，CSP script-src 按主机放行整个 static.cloudflareinsights.com。与 security-baseline.md 基线（135/A+、唯一未过项 SRI −5）一致，本次线上首页响应头实测 CSP 与仓库 _headers 逐字一致、无漂移。修复：维持 W5 增补包既有处置路径（实施 SRI 或正式接受并在基线文件销项），本期不重复定级。

**F6-90｜P2｜疑似｜脚本错误输出原样透传 wrangler stderr 前 300 字符，可能带出账号/命名空间/端点细节**（R6-14）证据：check-shadow-health.py:54 与 quota-check.py:81 均为 `{(out.stderr or raw)[:300]}` 直接输出，去向为 cron 日志与编排留痕；compare-shadow.mjs:51 fatal() 亦透传 error 字符串（多为本地拼装文案，风险更低）。wrangler 报错通常含账号 ID、命名空间 ID、API 端点（不含令牌值本身），但未经脱敏。验证方法：以无效 TOKEN 本地跑一次 check-shadow-health.py 检视 stderr 构成（本次未执行，避免无谓动用凭据通道）。修复：错误输出只保留 rc 与错误类别归类映射，原文仅在本地调试开关下打印且先做 ID 脱敏（与 F6-87 叠加处置）。

**F6-91｜P2｜疑似｜fetcher 配置错误消息回显环境变量原值并写入 KV health 与 /run 响应**（R6-15）证据：index.js:160-166 BOARD_TARGET_KEY 非法时 message 含收到值的 JSON 原文；finishFail 将 message 存入 health.lastError.message 写 KV，failResult 的 message 又经 /run 鉴权后响应体返回。当前该变量不是密钥、无实际敏感泄漏，但「env 原值 → 持久层 + 响应」的模式若被复用到敏感变量即成泄漏通道；且 health 键的设计口径为「绝不包含任何 key/令牌片段」（board-schema.js emptyHealth 注释）。修复：message 改固定文案 + 仅记收到值的长度或类别，不落原值。

**F6-92｜P2｜确认｜Pages 侧 BOARD_KV「只读」仅靠代码自律，平台绑定本身为读写权限**（R6-16）证据：根 wrangler.toml:9-11 注释自述「KV 只读绑定（Function 只 get，写方为 fetcher）」——Cloudflare KV 绑定不区分读写，Pages 任一 Function 均可 put/delete 同一命名空间的 current/health/sourceState 键。当前 functions/ 仅 board.js/health.js 且均只读，属权限面登记而非现行漏洞。影响：未来新增 Function 或 board.js 引入缺陷时，写权限无平台层兜底，爆炸半径含生产 blob 与健康键。修复：维持现状登记于安全基线作为已知权限面；代码评审清单把「functions/ 不得出现 BOARD_KV.put/delete」列为硬性检查项（可加 grep 型契约测试）。

**F6-93｜P2｜确认｜台账文件内含 CoinGecko 账号邮箱与 key 名称明文（账号标识元数据，非密钥值）**（R6-19）证据：ops/security/key-ledger.md:9-10 K2/K2f 行记录 key 名称与所属账号邮箱明文（本报告不抄录具体值）。台账红线为「永不记密钥/token 的值或片段」，邮箱/名称不在其列，故不违反既定红线；但该仓库同步备份至 GitHub 私有仓，留存面大于本地。影响：账号邮箱 + key 名称 + 轮换日期的组合可支撑针对站长的定向钓鱼（冒充官方的续期/异常邮件），与 F6-87/F6-90 的信息面叠加。修复：台账中账号邮箱改脱敏形态或仅记「账号见保险箱连接备注」，key 名称与邮箱二选一脱敏。

**F6-94｜P2｜确认｜Sec-Fetch-Site 跨站防护仍为影子模式，/api/board 无平台层跨站拦截**（R6-20）证据：board.js:44 `ENFORCE_SFS = false`，sfsShadowCheck（:47-61）只记日志；W2-19 定版为影子期，本次复核仍未转正式。当前实际防线是 board 响应不带 Access-Control-Allow-Origin（线上实测确认无 ACAO 头），跨源脚本读不到响应体，数据本身亦为公开行情，实际风险低。影响：风险主要在未来若给 board 加 ACAO:* 时影子模式会留下无拦截的跨站面。修复：在季度自查中给 ENFORCE_SFS 设明确复核点：或置 true 转正式（代码已备），或在 W2-19 条目上正式销项接受现状，避免「影子期」无限期延续。

---

## 三、施工建议（修复批次分组）

> 本节只给分组与依赖建议，施工范围由用户拍板。每批内条目可同批施工；批次间依赖以「→」标注。标者为会改变用户可见行为/口径的条目，施工时须单独验收。

**批 0 · 门禁与判级口径（先行，其他批次的保护网）**
- F6-01（部署跑测试 + 去 --commit-dirty）、F6-80（统一测试入口，与 F6-01 同一施工面）、F6-06（deploy.sh 模式门禁 + servedFrom 冒烟断言）
- F6-07（quota-check G3 口径）
- F6-26（绕过留痕）、F6-27（冒烟验 v2 契约字段 + smoke-headers 接入）
- 依赖：本批完成后，后续每批的回归才有门禁兜底；F6-06 与 F6-03 同批或先行均可，但两者都完成才算模式事故面收口

**批 1 · 数据校验与假绿修复（验证层）**
- F6-02（validateBlob 字段级门禁 + 负向用例）、F6-04（coverage 按 rows 重算 + health 断言）、F6-52（global 全 null 不保鲜）、F6-05（health 未来时间戳）
- F6-08（compare 同源检测与降级）、F6-20、F6-21（compare 判据补强）、F6-22（probe v2 缺字段判 FAIL）、F6-24（quota-check health 新鲜度前置）
- 依赖：F6-02 的门禁阈值需先定「坏数据整 run 拒绝」的口径再施工；F6-04 与 F6-02 同改 board-schema/board.js，建议同批

**批 2 · 前端功能修复**
- F6-12（置信度筛选）、F6-13（mcapUsd=0 口径）、F6-14（fmt 数值归一 + render 兜底）、F6-63（fmt 边界格式）
- F6-62（delayed 文案）、F6-54、F6-55（自选加载/回显）、F6-65（自选除名口径）、F6-56、F6-57、F6-58、F6-60、F6-61、F6-64、F6-66、F6-67、F6-59、F6-68
- 依赖：F6-66/F6-67（转义与归一）建议先于或同批于其他前端条目；F6-14 与 F6-02 是同一条畸形数据链的两端，前后端同批验收最佳

**批 3 · Fetcher 健壮性与额度记账**
- F6-11（credits 记账并入失败 run）、F6-47（kvGetJson 区分读错误）、F6-42（global 429 退避）、F6-45（global 墙钟相位）、F6-46（429 skip 时间戳化）、F6-43（状态机未启用不迁移）、F6-44（saving 节奏与投影）、F6-49（/run 节流 + 常量时间比较）、F6-48（并发在途合并）、F6-50（fetchImpl 与 json 超时）、F6-51（coins-list 一致性断言）
- 依赖：本批动 fetcher 部署，须避开整点观察窗并按既有纪律部署后验证；F6-11 与 F6-07（核账口径）是额度账的两端，建议相邻批次完成

**批 4 · 脚本与运维工具**
- F6-09（weekly 失败不写 state）、F6-72（weekly ids 完整性下限）、F6-73（weekly 退出码，待站长确认口径）、F6-69、F6-70、F6-71（build/decode 一致性）、F6-74、F6-75（rollback 两件）、F6-76（archive 退役守卫）、F6-28、F6-29（check-shadow-health）、F6-23（probe.sh warn 退出码，须与 HC1 编排联动确认）、F6-25（quota-log 版本字段，随 F6-07 或本批）
- Paprika 工具链：F6-77、F6-78（随批 5 的落库工作一并）

**批 5 · Paprika 备源落库（独立立项，非纯修 bug）**
- F6-10（映射落库 ≥197 + 启用门禁 + verify 连测达标）、F6-53（tickers limit 与 rank 口径核对）
- 依赖：落库会改变 coins.json 字段集（新增 paprikaId），与 W3-22 的 FIELDS23/dataHash 口径 A 直接相关，须先定字段进出规范再施工；未完成本批前，runbook 应先把备源标注为「不可用」

**批 6 · 测试补强**
- F6-15（health.js 套件）、F6-16（quota/compare 判级用例）、F6-17（kv 五字段断言）、F6-18（null 全链用例）、F6-19（前端 mock 对齐契约）、F6-79（FIELDS23 单一来源）、F6-81（注释/基线文档更新）、F6-82、F6-83（桩与 mock 保真度）
- 依赖：F6-17/F6-18/F6-19 应在批 1、批 2 的对应修复同批或紧随其后落地，否则新口径无回归保护；F6-15 随 F6-05 同批最佳

**批 7 · 安全与治理收尾**
- 开关口径统一：F6-03（已在批 0/1 交叉，施工归批 1）、F6-84（FETCH_DISABLED）、F6-85（BOARD_SOURCE 留痕）、F6-86（本地脚本匿名）、F6-87（账号 ID 必填）、F6-90（stderr 脱敏）、F6-91（env 原值不回显）
- 治理登记：F6-88（.gitignore）、F6-92（KV 写权限硬性检查项）、F6-93（台账邮箱脱敏）、F6-94（SFS 复核点）、F6-89（SRI 处置，随 W5 增补包既有路径）
- API 收尾：F6-30、F6-31、F6-32、F6-33、F6-34、F6-35、F6-38、F6-39、F6-40、F6-41（多为 board.js/health.js 小改，可与批 1 同批施工、分别验收）
- G4 关联：F6-36（dual/dualCompare）与 F6-03 的 legacy 分支下线同属「legacy 退役」议题，建议并入 G4 规划，不在本轮零敲碎打

**用户可见行为变化汇总（施工时单独标注验收）**：F6-07（核账判级口径）、F6-12（筛选功能恢复）、F6-13（3 币市值显示）、F6-54、F6-55、F6-65（自选行为）、F6-56、F6-57、F6-60（列表与详情交互）、F6-62（延迟横幅文案）、F6-63（个别数字格式）。

---

## 四、附：各路复核通过项（摘要，避免重复排查）

- 密钥卫生：git 全历史模式扫描 0 命中；key 全程走请求头、不进日志/URL/响应；/run 令牌缺失 fail-closed；npm audit 0 漏洞；wrangler 精确 pin 4.159.0（第 6 路）
- 开关：BOARD_TARGET_KEY 白名单 fail-closed 实现正确（四种非法输入零上游调用）；PAPRIKA_ENABLED fail-closed；CG key 缺失（fetcher 侧）fail-closed（第 3、6 路）
- fetcher 主干：prev 归档轮换口径正确、永不拼盘断言正确、total_volume→volume24h 双源映射正确、线上当前节奏正常（第 3 路）
- API 主干：legacy 上游错误不透传原文/状态；_headers --variant=on --check 通过、CSP hash 与全站 HTML 一致；health 判定主干（fresh+complete 双条件、expected 恰为 200）与 probe-config 口径一致（第 2 路）
- 前端主干：rows 解码对齐实测无误、rank=null 本身无前端影响、patchInPlace 主路径行数/节点保持有测试实证、排序 null 沉底口径正确、移动端详情字段完整（第 1 路）
- 脚本主干：check_meta 正例 11 项全 PASS；quota 三场景与护栏算术逐条复算无误（问题只在判级取景）；probe.sh/smoke.sh 断言组与 probe-config 抄录一致（第 4 路）

（报告完）
