# 第七期全面评审报告（PHASE7_REVIEW）

- 评审对象：crypto-top200 项目全仓（生产 https://top200.oppcal.com ，BOARD_READ_MODE=kv）
- 评审时间：2026-11-23；基线 HEAD `1c94ef8`（W5 六项收官）
- 方式：六路并行独立取证（前端功能与可达性 / API 与 Functions / fetcher 与数据管线 / 脚本与运维工具 / 测试与契约 / 安全与健壮性），只评审不施工；生产只读核查、测试实跑、Paprika 公开 API 全量核对
- 实测基线：测试 15/15 套件、178/178 项全绿（多路独立实跑一致）；线上 /api/board 契约 v2、coverage 200/200、servedFrom=kv、source=coingecko；仓库 index.html 与线上逐字一致

## 结论摘要

**发现 57 条：P0 0 / P1 7 / P2 50；确认 49 / 疑似 8。成熟度 B 级、约 3.3/5（本期代码口径；第六期 3.2）。**

线上主链行为正确、无 P0；第六期 89 条「已修」经六路抽查 25 条，23 条完全属实、1 条属实但带新副作用、1 条部分落地——修复真实性整体成立。本期新风险集中在三处：

1. **W5 新落库的 Paprika 映射数据本身有错**：3 条映射指向了不同资产（F7-01），而启用门禁只数条数、不验身份与实际命中（F7-02）——「门禁守住了」只在计数意义上成立。当前 Paprika 保持关闭、线上无实际危害，但这是离启用最近的一道坎。
2. **验证层的尺子仍有可绕与未测区**：KV 写守卫可被别名写法绕过（F7-03，两路独立发现并实测坐实）；第六期三条新判级口径（compare 上限、quota 陈旧判级）零回归用例（F7-06/F7-07）——与第六期「弱点在验证层」的系统性结论同源，未根除。
3. **G3/W5 之后的文档同步债成片**：台账、手册、基线、README、fetcher README 等 10 条文档与代码现状脱节（F7-48~F7-57），其中 fetcher README 的旧启用步骤具有实际操作危险性（F7-05，P1）。

## 一、P1 发现（7 条）

### F7-01｜Paprika 落库映射有 3 条错配（不同资产），正确条目本就存在
- 证据（`workers/fetcher/src/coins-list.js` COINS；2026-11-23 以 Paprika `/v1/coins` 全量 62,744 条逐条核对，协调人已复核错配值在文件内属实）：
- `pump-fun` → `pump-pumpbtc`（名 PumpBTC，rank 1428）；正确条目 `pump-pumpfun`（名 Pump.fun，rank 73，活跃）存在却未采用。
- `sky` → `sky-skycoin`（名 Skycoin，rank 1380）；正确条目 `sky-sky`（名 Sky，rank 69，活跃）存在却未采用。
- `seeker` → `skr-saakuru-labs`（名 Saakuru，rank 833，在 tickers 前 2000 内）；正确条目 `skr-seeker`（名 Seeker，rank 305，活跃）存在却未采用。
- 根因：提案 `docs/paprika-mapping-proposal.json` 中此 3 条 verdict=accept、置信「中」，依据仅「symbol 精确 + 价差核定 ratio≈1.00x」——同 symbol 异资产在快照时刻价格恰好接近（实测 Saakuru $0.009626 vs Seeker $0.009665，相差 0.4%），价差无法区分身份。此类「仅 symbol+价差、无 name 核对」的 accept 共 38 条，其余 35 条经全量核对为同资产异名变体、无误。生成脚本的审查表 `docs/paprika-map-review.csv` 对此 3 币给出的高置信候选恰是正确值，错配发生在人工核定环节；W5 落库校验只验「id 对上、无重复、196 非空格式合法」，未做映射值与 Paprika 名录的身份复核，故未拦下。
- 影响：真实身份有效映射实为 193/200（非 196）；若 Paprika 启用且覆盖过门禁，`seeker` 行将静默写入 Saakuru 的价格（另两条目前不在 tickers 前 2000、只计缺失）。

### F7-02｜fetcher 启用门禁只数「映射条数」，不验身份/活跃/实际命中
- 证据：`workers/fetcher/src/index.js:175` `paprikaMappedCount = coins.filter(c => c.paprikaId).length`、`:177` 以 `>= PAPRIKA_MIN_MAPPED`（197，`source-state.js:29`）判定可用。计数不验：身份真伪（F7-01 的 3 条错配照样计数）、`is_active`（`yzy→yzy-yzy` 已下线、rank 0，仍计数，落库记录自认）、tickers 实际命中（2026-11-23 实测命中 175/200，落库日 178/200，均远低于发布门禁 94%=188）。
- 守住的部分（实测确认、无绕过路径）：启用须 `PAPRIKA_ENABLED="true"` 严格等值且过计数门禁，未过强制 CG 并 warning（`index.js:323-330`），`BOARD_SOURCE=coinpaprika` 亦不能绕过；生产 `PAPRIKA_ENABLED="false"`，线上 source=coingecko。
- 影响：将来补 1 条映射凑满 197 门禁即放行，但 tickers 覆盖约 87.5%<94%，Paprika 态每 run 必被 coverage 门禁拒写、回切 CG 需连续 3 次成功 + 60 分钟静默期，期间榜单长期 stale（不写错数据，但可用性受损）；门禁达标与否完全取决于计数、不取决于映射质量。

### F7-03｜kv-write-guard 静态守卫可被别名/解构/括号写法绕过，写保护假绿
- 证据：`tests/kv-write-guard.test.mjs:28-36` 仅正则匹配字面 `BOARD_KV.(put|delete)(...)` 并逐点核准参数。API 路在 /tmp 副本实测坐实：新增 Function 文件以 `const kv = env.BOARD_KV; kv.put("v1:board:current", …)` 与 `env.BOARD_KV["put"](…)` 写 current/health 两键，守卫仍输出 PASS。平台层绑定本身读写不分（`ops/security/security-baseline.md:100-104` 自认），此测试是 W5 写例外之后唯一的写防线，且部署门禁依赖它。测试路独立同报（原疑似，经 API 路实测升为确认）。
- 影响：未来任一 Function 以别名/解构/括号形式写任意 KV 键，门禁全绿放行，生产 blob 与 health 键无自动拦截。

### F7-04｜preview 部署必被自家冒烟判死，与 README 定版定位正面冲突
- 证据：`scripts/deploy.sh:13-15,193-197` preview 与 production 共用同一 `smoke.sh` 全量断言，失败即报 HC2 fail + exit 1；`smoke.sh` 断言含 servedFrom∈{kv,cache,memory} 与 v2 契约；而 `README.md:54` 定版「preview 不注入 CoinGecko key、/api/board 必然 stale/503、只做静态/UI 冒烟」。实测（2026-11-23）：`smoke.sh https://preview.crypto-top200.pages.dev` → 5 项 FAIL、exit 1（board 503、缺 coins/coverage、servedFrom=None、contractVersion=None）；生产址全 PASS。
- 影响：每次 preview 部署都被报「已上线但冒烟失败、需人工处理/回滚」并误发 HC2 fail，preview 通道事实上不可用且污染部署告警可信度。

### F7-05｜fetcher README 仍停在 G0 形态，照其「G1 启用步骤」操作会把生产打回影子链
- 证据：`workers/fetcher/README.md:8-12` 称「已部署，Cron 禁用：BOARD_FETCH_DISABLED="1" 且 wrangler.toml 未注册 triggers」「COINGECKO_API_KEY 待协调者注入」，`:15-16` 的 G1 步骤要求「置 BOARD_TARGET_KEY="shadow" 后 wrangler deploy」；现行 `workers/fetcher/wrangler.toml` 已注册 crons `*/10 * * * *`、BOARD_TARGET_KEY="current"、无 BOARD_FETCH_DISABLED，与 G3 终局一致。同文件下半部却是 2026-11-23 的现行开关口径表（F6-84/85），文件内部自相矛盾：上半 G0、下半现行。
- 影响：运维者按文件顶部现状认知或 G1 步骤处置事故时，会误以为抓取未启用、或把目标键改回 shadow 部署，直接冻结生产行情更新。

### F7-06｜compare-shadow 新口径三条 verdict 上限零用例
- 证据：`tests/compare-shadow.test.mjs:83-118` 全部 6 例仅覆盖 pass / conditional（runId 不一致、live 无 runId）/ fail 三类；全文无 `same-source`、`verdictCaps`、`runGate`、live 侧 null 用例。而被测脚本 `scripts/compare-shadow.mjs:212-215,327-332` 的三条上限逻辑（sameSource→上限 conditional、runGate 未满足→上限、liveNull 1–2→上限、>2→fail）正是第六期 F6-08/F6-20/F6-21 的核心修复。删掉这三条逻辑，现有用例仍全绿。
- 影响：生产现行形态（kv 同源自比、verdict 应恒为 conditional）无任何回归保护，假 pass 可静默复活。

### F7-07｜quota-check 的 F6-24 陈旧判级与非 kv 分支零用例，legacyMeasured 只测 happy path
- 证据：`tests/quota_check_test.py:100-139` 6 例的 health fixture 恒为当月 + lastRunAt 新鲜 + boardReadMode="kv"；`scripts/quota-check.py:173-196` 的月份不符 / lastRunAt >3h → verdict=INVALID + 退出 3（F6-24）无一例触发；`:228-241` 非 kv 规划口径分支无一例；legacyMeasured 仅测 available=true 一例，available=false（计数键缺失/月份不符/形态畸形，`:152-157`）无用例。
- 影响：F6-24 是会改变核账判级的修复却不在回归网内；legacyMeasured 在生产中的常态恰是 available=false（kv 下恒无键），常态路径反而没测。

## 二、P2 发现——API 与 Functions（6 条）

### F7-08｜health 只验 board 的自报汇总字段，不验 coins 本体，存在汇总假绿通道
- 证据：`functions/api/health.js:169-172` 的 ok 条件仅为 `fresh && returned===expected===200 && count===returned`，从不检查 `board.coins` 实际键数。其自家测试即为实证：`tests/health.test.mjs` 的 `boardBody()` 根本没有 coins 字段，却断言 200 ok:true 并通过（实跑 12/12）。
- 影响：board 组装层若回归为「coins 为空但 coverage/count 正确」，M4 探针保持绿灯而站点实际无数据。

### F7-09｜board 的 HEAD 路径绕过 sfsShadowCheck，legacy/dual 下可驱动回源与计数
- 证据：`functions/api/board.js:938-940` `onRequestHead` 直接 dispatchGet，未过 sfsShadowCheck（GET 路径在 `:931` 与 `:947` 均过）；HEAD 与 GET 同路，缓存未命中时同样触发 CoinGecko 回源并在 `:306` 计 +2 credits。health 的 HEAD（`health.js:195-197`）内嵌 GET /api/board，同理可间接驱动。
- 影响：影子计数对 HEAD 流量全盲（将来 ENFORCE_SFS=true 时 HEAD 亦不拦）；legacy 形态下 HEAD 探活不再是廉价探测，与台账探针消耗口径需对齐（现行 kv 生产不触发，属潜伏项）。

### F7-10｜legacy-credits 在请求关键路径串行 await，且计数时点早于自述口径
- 证据：`board.js:306` `await addLegacyCredits(env, 2)` 位于两个 fetchWithTimeout 创建（`:309-310`）之前；`addLegacyCredits`（`:106-124`）串行做 KV get + put 两次往返，全文件无 waitUntil。注释 `:100-102` 自述口径为「请求已发出」才计——实际发出前计：计数后进程若在发请求前终止，credits 已入账而上游未调用（多计）；计数慢 KV 的延迟全额加在每轮 legacy 回源请求的响应时延上（失败被吞、延迟不被吞）。
- 影响：实测口径与自述口径有一条缝（极端时多计），legacy 回退形态下每次回源被计数 IO 串行拖慢。

### F7-11｜legacy-credits 读-改-写非原子为已知接受项，但 prev 坏值无健全性钳制
- 证据：`board.js:113-120` 读-改-写无 CAS，多 colo 并发同读旧值丢增量（注释 `:104` 自认「少量漏计」，此部分为已知接受、登记残余风险）；新子项：`:118` 对 prev.credits 仅验 typeof number，负数/异常大浮点等坏值原样成为 base 继续累加；`scripts/quota-check.py:152-158` 读入时同样只验类型，坏值将以「实测值」身份进入核账记录与建模并列呈现。
- 影响：并发漏计使 legacy 实测恒偏低；计数键一旦被写坏，无自愈、无告警，整月实测列失真。

### F7-12｜模式 fail-closed 应答仍是 HTTP 200，发现责任单点压在 health 上
- 证据：`board.js:905-917` 未知模式走 snapshotV2Response → jsonResponse 默认 200（空 coins 的 snapshot v2）。以状态码判活的 M2/M3 类探针在此事故下保持绿；只有 health 因 expected/returned 异常判 503。另该路径每次还调用 getIds 与 readHealthSummary，配置事故期间每个请求都付这笔开销。
- 影响：F6-03 的 fail-closed 只保证「不直抓」，不保证「可被发现」——直接打 board 状态码的监控全盲。

### F7-13｜assembleV2 在 blob.coverage.missingIds 非数组时产出不守恒的 coverage
- 证据：`board.js` assembleV2 后备分支（`:746-775` 区间）：missingIds 非数组时 expected 取 blob 自报、returned 取 rows 实数、missingIds 硬填 `[]`，可出现 expected 200 / returned 190 / missingIds [] 的组合；`shared/board-schema.js` validateBlob 对 missingIds 仅在 Array.isArray 时做互补校验。health 因 returned≠expected 仍会红，故不构成健康假绿、只污染契约字段可信度。
- 验证方法：仿 board-v2 harness 构造 190/200 行、coverage={expected:200, returned:190} 且删除 missingIds 的 blob 走 kv 路径，断言响应 coverage.missingIds 与 expected−returned 是否守恒。

## 三、P2 发现——fetcher 与数据管线（5 条）

### F7-14｜verify-paprika-coverage.mjs 未同步 F6-53 的 limit=5000，命中口径只看存在性
- 证据：`scripts/verify-paprika-coverage.mjs:37` 拉 tickers 无 limit 参数；fetcher 侧 `workers/fetcher/src/providers/coinpaprika.js:72` 已带 limit=5000。今日实测该端点无参/带参均只回 2000 条（上限即 2000），当前数字巧合可比，但口径已分叉、端点行为一变即不可比。另命中判定仅 `tickById.get(pid)` 存在性，不验报价非 null / is_active，与 fetcher coverage 口径同病（见 F7-15）。
- 影响：启用前「连测 3 天达标」的证据链与生产抓取口径不完全一致，达标结论强度打折。

### F7-15｜Paprika 归一化未做 F6-02 字段清洗，与 CG 路径不对称
- 证据：`shared/board-schema.js` normalizeCgMarkets 对 price/mcapUsd/volume24h 走 sanitizeMarketNumber（`:88-95`，坏值置 null 并计数）；normalizePaprikaTickers（`:157-161`）直接透传 usd.price/market_cap/volume_24h/percent_change_24h，无清洗、无 invalidFields 计数，兜底只有写前 validateBlob 的 row_field_invalid 整 blob 拒绝——Paprika 源单个字段形变会整 run 失败，CG 源同情形只置 null 单字段。另 change24h、rank 两字段两条路径均未清洗、validateBlob 亦不查类型（现靠前端 num() 兜底）。
- 影响：Paprika 一旦启用，字段级鲁棒性明显弱于 CG 路径，单币坏数据可拖垮整轮抓取。

### F7-16｜fetcher wrangler.toml 头部注释仍是 G0 旧形态，与文件实际配置相反
- 证据：`workers/fetcher/wrangler.toml:2-6` 注释称「禁用 Cron——BOARD_FETCH_DISABLED="1" 且暂不注册 triggers」「[triggers] 块已注释」；文件实际无该变量、`:20-21` triggers 已启用 `*/10 * * * *`、BOARD_TARGET_KEY="current"。同类小项：`coins-list.js:1-3` 头注释仍写「Generated: 2026-11-10 (W2-01 G0)」，未提 W5 已在此文件落 Paprika 映射（值注释已在:4-9 补充，日期行未更新）。
- 影响：运维按注释判断抓取开关状态会得出反结论。

### F7-17｜build.py 的 load_paprika_map 解析对 coins-list.js 排版格式强耦合
- 证据：`scripts/build.py:387-391` 以字符串切分取单行 JSON；现行文件恰为单行形态、可正常解析（三份 coins.json 与事实源逐币一致，见复核节）。若日后重新生成 coins-list.js 时排版变化（多行/分号后无换行），json.loads 将直接抛错使 build 全停（fail-closed、不产出错数据，但管线脆弱）。
- 验证方法：临时副本中把 COINS 数组改排为多行，跑 `python3 scripts/build.py --emit`，观察是否异常退出。

### F7-18｜gen-paprika-map 高置信匹配取「首个 name 全等者」，同 symbol+同名多条目时有误配风险
- 证据：`scripts/gen-paprika-map.mjs:36-42` 遍历同 symbol 候选、首个 normName 全等即 break，不比较 rank/活跃等属性；Paprika 全量中同 symbol 异资产极多（实测 PUMP 下 ≥5 个活跃条目、SKY 下 ≥3 个）。本次落库 196 条经全量复核除 F7-01 的 3 条外未发现由此产生的错配，故定疑似。
- 验证方法：对 /v1/coins 全量统计「同 symbol 且归一化 name 相同、id 不同」的活跃条目组数，逐组核对本表 200 币是否涉及。

## 四、P2 发现——脚本与运维工具（10 条）

### F7-19｜rollback.sh 仍保留 ACCOUNT_ID 字面量默认值（F6-87 漏网），且 usage 示例与门禁自相矛盾
- 证据：`scripts/rollback.sh:42` `ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-<真实账号 ID 字面量>}"`（值不抄录）；对照 `scripts/quota-check.py:56`、`scripts/check-shadow-health.py` 已改必填 fail-closed。同文件 `:80` usage 示例缺 F6-74 要求的 `ROLLBACK_MODE_API_ONLY=1`，照抄示例必被拒（exit 3）。
- 影响：F6-87 的「缺失即 fail-closed」口径在回滚路径不成立，错误环境下仍会对真实账号发调用；帮助示例与门禁矛盾。

### F7-20｜deploy 绕过留痕只落 gitignored 本地文件，审计链不在版本控制内
- 证据：`scripts/deploy.sh:31-50` deploy_log() 写 `ops/deploy-log.jsonl`；`.gitignore:13` `ops/*.jsonl`（git check-ignore 实证 deploy/quota/probe 三日志均被忽略）；现行 deploy-log 仅 2 行、无任何绕过记录可交叉核对。
- 影响：DEPLOY_SKIP_TESTS / ALLOW_DIRTY / ALLOW_MODE_OVERRIDE / SKIP_META_CHECK 的「有理由留痕」只剩本机单点留痕，换机/清理即灭失，事后无法证明某次部署没绕过门禁。

### F7-21｜probe.mjs 不判 HTTP 状态码，503 错误体可被判 PASS
- 证据：`scripts/probe.mjs:14-18` 先 `await res.json()` 再 `if (!res.ok &&!body) throw`——body 为解析出的对象恒真值，非 200 永不抛；`:63` verdict 仅由 missingFields/hits 决定，v1 形态错误体缺 staleAgeSec → hits=0 → PASS、exit 0。
- 影响：人工巡检/验收用此判读时，上游 503 降级体可能被读成 PASS，与 F6-22「不可判读即 FAIL」的定版精神相悖（仅 v2 分支落实）。

### F7-22｜weekly_check 退出码不覆盖其最高价值信号
- 证据：`scripts/weekly_check.py:400-405` 仅 run_void→2、alerts|incomplete→1；missing_rows（疑似下架）、cand_in/cand_out、due、queue（含多源偏离）、report_url_warn 均不影响退出码（脚本头 F6-73 口径本身如此定义）。
- 影响：任何按退出码分流的运行者（或未来编排）会把「出现疑似下架候选」的一周当无事周静默放过，信号只剩人读报告正文。

### F7-23｜weekly_check 先写 state 后写报告，报告写失败即丢周且计数已推进
- 证据：`scripts/weekly_check.py:348-349` 先 json.dump(state)（含 lastRunWeek 推进），`:394` 才写报告文件；state 写入本身亦非原子（直接覆盖写，无 tmp+replace）。
- 影响：报告落盘失败时该周无报告但连续周计数与 lastRunWeek 已推进，下一周无法重建本轮证据；写 state 中途崩溃留下截断 JSON，下轮 json.load 未捕获异常以 traceback exit 1 退出——与 F6-73「exit 1 = 有效但有告警」语义撞码、被误读。

### F7-24｜build.py「全部成功才一并落盘」在落盘段本身不成立
- 证据：`scripts/build.py:505-529` docstring 称任一步失败现行产物逐字节不变，但落盘段 `:526-529` 为三次独立操作且 `public/data/coins.json` 用 write_text 非原子写；`:526` 已 replace data/coins.json 后若 `:527` 写失败，源/产物哈希即不一致，只能靠事后双哈希校验报错、无法回滚已换的源文件。
- 影响：F6-69 的原子性承诺只覆盖渲染段；落盘段中途失败留下一对不一致的 coins.json（deploy 数据门禁会拦下，但本地产物已污染、需手工恢复）。

### F7-25｜quota-check 的 legacyMeasured 跨月陈旧值仍填入 credits 字段
- 证据：`scripts/quota-check.py:229-234`：available 按 month==month_str 判定，但 credits/month/updatedAt 无条件取计数键现值；计数键跨月未重置或读到旧月数据时，记录会出现 available=false 却带非空 credits 的组合。现行 quota-log 三条均为 available=false + credits=null（键不存在形态），此分支尚未在线上出现。
- 影响：只读 credits 不看 available 的引用者会把上月累计当本月实测引用，与 W5「实测优先」的引用纪律冲突。另同源小项：quota 每日 cron 本体只字未提 legacyMeasured，实测通道在日报层实际不可见（判级不含该值、汇报规则永不触发提及）。

### F7-26｜coverage-report.mjs 默认 exit 0 吞套件失败
- 证据：`scripts/coverage-report.mjs:223` 仅 --strict 时套件失败才置 exitCode 1，文件头自认默认「只报告不拦截」。
- 影响：任何顺手以退出码判断的调用都会把红套件的覆盖报告当成功产物；与 run-tests 的 fail-closed 口径不一致，易误引。

### F7-27｜时间类判定的「未来时间戳」盲区（两处同形）
- 证据：`scripts/probe.sh` 新鲜度段（age≤900 即 pass，age 为负同样 pass）；`scripts/check-shadow-health.py` age>1500s 才 FAIL，lastSuccessAt 在未来时 age 为负直接 OK。quota-check 的 F6-24 陈旧校验同样只查「距今 >3h」单侧。
- 影响：fetcher/上游时钟漂移或未来时间戳异常时三把尺子集体假绿。
- 验证方法：本地以 fixture health（lastSuccessAt=+1h）跑 check-shadow-health 的判定函数，应得 OK（代码直读可证；未实跑因该脚本 main 直连 KV）。

### F7-28｜HC4 与 quota 两条 cron 的 delivery 为空数组，失败投递去向未验证
- 证据：cron.view 实读三条本体：HC1（interval 1h）的 delivery 明确带目标 chat，退出码 0/4/1 三分流与 probe.sh 定版逐字一致；HC4、quota 两条本体的 delivery 为空数组，而两条本体均要求失败时「向用户发一条汇总」。近 3 次 HC4 run 均为成功静默，无从验证失败投递去向。
- 影响：若空 delivery 的默认投递语义不是用户所在会话，HC4/quota 的失败汇总可能静默丢失。
- 验证方法：查一条历史 HC4/quota 失败 run 的 result 投递记录，或在 cron 层核对空 delivery 的默认投递语义。

## 五、P2 发现——测试与契约（5 条）

### F7-29｜FIELDS24 第 24 列异常形态无负向用例
- 证据：缺失列仅 `tests/contract-real-data.test.mjs:311-320` 一例（FIELDS23 旧形态喂前端解码）；无用例喂 board.js getIds（`functions/api/board.js:235-248` 按 meta.fields 索引解码）一份「rows 行长 23、fields 声明 24」的截断产物，也无行长 >24 用例。类型异常全无：没有任何套件构造 paprikaId 为数字/对象/空串的合成数据；现行断言只有真实数据上的格式正则（contract-real-data:278）与两处来源等值 + 真值计数（coins-list-contract:70-73）——两处同错为非字符串真值时等值断言照样绿，fetcher 门禁计数（按 truthy 计）会把畸形值计入 mapped 数（与 F7-02 同源）。
- 影响：FIELDS24 作为字段规范变更首例，其异常输入行为（校验拒绝还是静默透传）目前靠巧合而非测试定义。

### F7-30｜legacy-credits 计数时机关键口径未测
- 证据：`tests/legacy-credits.test.mjs` 5 例覆盖成功 +2、缓存命中不计、跨月重置、kv 零写入（有 puts 负向断言，质量合格）、put 失败不影响主流程。但被测口径明文「按已发出计、与成败无关」（`board.js:100-103`，计数点在发请求之前 `:306`），却无一例让 markets 失败后断言仍 +2；无熔断短路不计数用例；dual 模式（同走 legacy 抓取路径，`:919-921`）是否计数无用例；旧计数键畸形形态（credits 为字符串 / JSON 损坏，addLegacyCredits 回退分支 `:113-119`）无用例（与 F7-11 呼应）。
- 影响：计数口径若被改成「成功才计」或熔断误计，测试全绿无感，实测计量静默失真。

### F7-31｜命中域 DOM 测试是 CSS 文本正则断言，不是行为断言
- 证据：`tests/frontend-dom.test.mjs:643-661` 用例⑰全部断言为对 `<style>` 文本的正则（基础 min-width 数值 +::after inset 数值 + 两处 inset:0 计数 + 一处级联顺序 indexOf）；未断言.exp 的 position:relative（::after 绝对定位锚点，删之命中域即错位而本测试仍绿）、未断言粗指针档级联顺序、无任何 computed-style / 真实命中测试。对照：⑯ aria 测试（同文件 598-641）为真断言，质量合格；⑱ SRI 守卫为静态计数断言，与其定位相符。
- 影响：W5 的真浏览器六宽度实测结论没有等价的自动化回归替身，CSS 后续改动可使 44×44 实际失效而门禁仍绿。

### F7-32｜测试套件集合有三处定义、无一致性守卫（已漏一例）
- 证据：`scripts/run-tests.sh:15-31` 的 SUITES 数组与 tests/ 目录 15 个文件当前逐一对上、无游离套件，deploy.sh 门禁（`:60-67` 跑 npm test → run-tests.sh）与统一入口为同一集合——此部分经实跑确认无问题。但 `scripts/coverage-report.mjs:173` 的 pySuites 硬编码仅 test_render_snapshot、weekly_check 两支，第六期新增的 `tests/quota_check_test.py` 不在其内（Node 侧靠目录扫描可自动纳入，Python 侧靠手写清单、已漏一支）；且 run-tests.sh 本身亦为硬编码清单，新增套件文件不会自动进门禁、也无任何一致性断言守着各处定义。
- 影响：覆盖率报告的「全套件」口径自第六期起即不完整；下一次新增测试若忘改 run-tests 清单，该套件永远不进部署门禁且无人察觉——正是 F6-01 类事故的复发通道。

### F7-33｜契约硬编码计数与具体币单耦合，榜单正常轮换即多套件连环红（设计权衡提示）
- 证据：paprikaId 非空 ==196、未映射恰为 4 个具名币（celium/genius-3/hash-2/nxm）同时硬编码于 `tests/contract-real-data.test.mjs:274-280` 与 `tests/coins-list-contract.test.mjs:73`；200 币总数断言散布于至少 6 个套件。
- 影响：作为「落库变更须显式过评审」的门禁是有意设计，但周检下架/补位导致的正常名单轮换会先打红门禁、需改测试才能部署，运维上须预知此摩擦（与 F7-01 联动：纠正 3 条错配不改变 196 计数，但若改为留空则会触发此摩擦）。

## 六、P2 发现——前端功能与可达性（8 条）

### F7-34｜桌面端.exp 的::after 外扩偷走星标左缘 4px 命中域
- 证据：`public/index.html:163`（.exp 28×28、margin-right:4px）、`:167`（`.exp::after{inset:-8px}`）、`:186`（粗指针档才收回）。无头 Chrome 实测（768/1280/1500 三宽度一致）：star 矩形 32×32 且 star.left = exp.right + 4；elementFromPoint(star.left+2, star 中心) 返回 exp、elementFromPoint(exp.right+6)（已在 star 盒内）仍返回 exp——star 有效可点宽度由 32px 被蚀至 28px。纵向已核无问题（桌面行高 50.875px、按钮上下余量约 11px，不误触相邻行）；≤640 与粗指针档 inset:0 实测干净。
- 影响：桌面用户点星标左缘会展开详情而非收藏，与 CONSTRUCTION_PHASE5 §③「扩展仅覆盖无内容死区」的定版声称不符（star 不是死区）。

### F7-35｜ATH「†」按钮命中域约 7×10px，远低于全站标准
- 证据：`public/index.html:141-142`：`.ath-flag{font-size:10px}`、`button.ath-flag{padding:0 1px;border:none}`，无 min-width/min-height；主表含此按钮的行数 = meta.counts.byAthFlag.approx = 69 行。W5 只放大了.exp，此按钮未被覆盖；低于 WCAG 2.5.8（AA 24×24）与本站 44px 触控口径。键盘可达（有:focus-visible）但指针操作基本不可用。
- 影响：想点 † 查看图例的用户极易点空/误触行内其他元素。

### F7-36｜排序表头按钮高度 36px，粗指针档未被 44px 规则覆盖
- 证据：`public/index.html:157` `.th-sort{min-height:36px}`；`:186` 粗指针媒体查询只放大.exp/.star 与.toolbar 控件，不含 thead 内的.th-sort。平板/触控笔记本（≥641px 粗指针）上 6 个排序按钮高度恒 36px（仍高于 WCAG AA 24px 下限，故 P2）。
- 影响：触控排序操作目标小于本站自定 44px 口径。

### F7-37｜≤640 档两个移动端几何问题：首列表头文字被视觉隐藏、五列总宽 384px 溢出小屏
- 证据：① `public/index.html:127` ≤640 时 #thRank 被 clip 成 1×1 视觉隐藏，排序按钮只剩「▲」箭头——读屏有 aria-label 兜底，但明眼用户在手机上看不到首列列名、也不易察觉可点排序（代码注释中自承的设计取舍）。② ≤640 存活五列宽 36+112+68+80+88 = 384px；无头实测 360 宽视口 tablewrap scrollWidth=384 > clientWidth=330，倍数列默认被截约 54px 须横滑（640 宽时无溢出）。
- 影响：360/390 级手机上「只留关键五列」的移动布局并未真正一屏可见，倍数（核心卖点列）首屏缺席。

### F7-38｜decodeCoinsData 健全性校验只验首行，后段行 symbol 非字符串可击穿 hash 直达路径
- 证据：`public/index.html:1182,1197` 两处校验均只查首条的 coingeckoId 与 estRank；parseHashTarget（`:1126-1135`）对每条 `x.symbol.toUpperCase()` 无类型防护，syncHashForExpand 同理。后段某行 symbol 若为数字，解码放行，带 hash 打开页面时 onHashChange→parseHashTarget 抛 TypeError 中断 init 后段；estRank 为字符串时 cmpCoins 的 tie-break 产生 NaN 排序不稳定。属 F6-59 防线未覆盖的同类残余。现行数据已核干净：200 币 symbol 均为字符串、无重复。
- 验证方法：复制 coins.json，把 rows 第 50 行 symbol 改为数字 123，本地静态托管后打开 `/#BTC`，看控制台是否 TypeError 且 hash 定位失效。

### F7-39｜页脚与隐私页宣称「每 120 秒更新／服务端函数直拉 CoinGecko」，与 G3 现行架构不符
- 证据：`public/index.html:472` 页脚「经本站服务端缓存代理，每 120 秒更新」；`public/privacy/index.html:47-49`「由本站服务端函数向 CoinGecko 拉取行情…缓存 120 秒」。现行事实：抓取者为 fetcher Cron `*/10 * * * *`（`workers/fetcher/wrangler.toml:21`），board 在 kv 形态下只读 KV blob、不回源；120 秒仅是 board.js 内部 Cache API 的 CACHE_TTL_SEC。线上实测佐证：2026-11-23 12:34 的 /api/board 返回 staleAgeSec:232、mode=live，数据龄以 10 分钟级跳动。
- 影响：对访客宣称的行情新鲜度约为实际的 5 倍，属状态文案失实（与本站「状态须实」口径相悖）。

### F7-40｜隐私页不可达 + 自选披露仍是上线前预写口径
- 证据：① 首页全文检索 `/privacy` 命中 0 处——页脚无隐私链接，隐私页只能靠 sitemap 或直输 URL 到达。② `public/privacy/index.html:56` 仍写「**若您使用**本站的自选/收藏功能…键名以实际上线版本为准，**预定为** top200.watchlist.v1」，源码内还留有「[待 W2-06 前端包落地后复核]」注释；实际代码 `public/index.html:487` 键名已定版为该值且功能早已上线。③ 隐私页页首「最后更新：2026-11-11」（`:26`），早于 G3 切换与 W5。
- 影响：访客在站内找不到隐私说明；找到后看到的也是「假设性」披露，与实际 localStorage 实践对不上。

### F7-41｜sitemap lastmod 停留在 2026-11-10，与页面现状脱节
- 证据：`public/sitemap.xml` 两条 URL 的 lastmod 均为 2026-11-10，而 index.html 已于 2026-11-23 经 W5 变更并重新部署（git 6e13d20、部署 eba9cb0d）。
- 影响：搜索引擎侧的更新时间信号失真，仅 SEO 层面小瑕疵。

## 七、P2 发现——安全与健壮性（6 条）

### F7-42｜legacy-credits 写守卫只守「键名」不守「写频」：回滚形态下未认证访客可驱动 KV 写放大
- 证据：`functions/api/board.js` 的 addLegacyCredits 在真正回源前无条件执行一次 BOARD_KV.get + put(KV_KEYS.legacyCredits)，失败吞掉；`tests/kv-write-guard.test.mjs:29-37` 只核准调用点参数字面量与处数，对频率/总量无约束。Cache API 为 per-colo 缓存（CACHE_TTL_SEC=120 仅在本 colo 内去重），legacy/dual 一旦经回滚启用，分布在多 colo 的未认证 /api/board 请求每 120 秒/colo 即可各触发一轮 get+put，实际写量可显著超过 quota-check 对 legacy 的 0/576/1152 credits 建模场景；读-改-写非原子（见 F7-11），高并发下计数失真。现行 kv 形态下休眠（legacy-credits 测试用例 4 实证 kv 不触发）。
- 影响：回滚到 legacy/dual 期间，KV 写配额（1,000/天，fetcher 成功 run 已占 576/天）可能被计数写挤占并与 fetcher 写竞争，计数本身亦不可作精确账。

### F7-43｜两处同源 fetch 无超时：board 的 getIds 与前端 init 的 coins.json 拉取
- 证据：`functions/api/board.js:225` getIds 拉 /data/coins.json 无 AbortController/超时，与同文件上游抓取的 fetchWithTimeout（UPSTREAM_TIMEOUT_MS=3500 + Promise.race 兜底）口径不一致；kv 模式无 blob 时 snapshotV2Response 也经 getIds。前端 `public/index.html:1206` fetch("data/coins.json") 无超时，而同页 loadBoard（`:1091-1094`）已有 10 秒 AbortController 定版（W3-07）。
- 影响：同源静态拉取异常挂起时 board 只能等平台层超时（health 的 8 秒超时会先判 503，监控口径与 board 实际可用性分裂）；前端 init 挂起时页面停留在构建快照行（降级方向安全，但无失败信号）。

### F7-44｜fetcher /run 的 60 秒节流为 fail-open，拒绝路径的 health 回写存在读-改-写竞态
- 证据：`workers/fetcher/src/index.js` fetch 处理段：节流检查 try { 读 health} catch { /* 读失败不阻断人工恢复通道 */}——KV 读异常时节流整体跳过、直接 runFetch；节流命中时以整对象回写 health，与并发 cron run 的 writeHealth 之间无版本校验，后写者可覆盖先写者的 health 更新。正面项：令牌比较已是 F6-49 的 SHA-256 常量时间实现、无/错令牌一律 404 不泄露入口差异，复核无误。本条未做线上触发验证（纪律禁止无谓触发抓取）。
- 影响：KV 抖动窗口内持令牌者可绕过 60 秒最小间隔连续触发抓取烧 CoinGecko 额度（仍受 F6-48 在途合并兜底，放大有限）；拒绝回写竞态可使 health 短暂回退旧值。
- 验证方法：单测以 stub KV 使 health get 抛错后 POST /run（带正确令牌），断言是否仍执行 runFetch；再以并发 cron run + 节流命中交错写，断言 health 字段是否丢失。

### F7-45｜多条人工运维路径的 wrangler 调用未锁版本，与 deploy.sh 的 pin 纪律分裂
- 证据：唯一部署入口是锁版的——`scripts/deploy.sh:184-187` 从 package.json 读 pin 并 npx wrangler@4.159.0（实测 pin = lockfile = 4.159.0），且 `:100-125` 有 pin↔lockfile 一致性门禁。但文档路径均为裸命令：`README.md:73,116,124`、`ops/security/rotation-playbook.md:26`、`workers/fetcher/README.md:16` 均为 `npx wrangler …` 无版本。在未 npm install 的环境执行时 npx 会拉取当时最新版，不受 pin 与门禁保护；fetcher 部署本身也不经 deploy.sh 的测试/数据/安全头任一门禁（设计上独立部署，runbook 已注明，但版本面未收口）。
- 影响：密钥注入与 fetcher 部署这两个高权操作恰是最可能在临时环境执行、最不受供应链锁版保护的路径。

### F7-46｜依赖漏洞扫描在本环境不可复现，第六期「npm audit 0 漏洞」结论本期无法续证
- 证据：本期执行 npm audit 返回注册表策略 403（policy_denied），与第六期报告附录「npm audit 0 漏洞」无法同法复核；仓库依赖面本身很小（package.json 仅 devDependency wrangler 4.159.0、无运行时依赖、无 CDN 库）。另有一项对 fetcher workers.dev 入口的无令牌探测因审批超时未执行，未据此下任何判断。
- 影响：后续各期若继续引用「0 漏洞」将是无当期证据的沿用结论。
- 验证方法：在不受该注册表策略限制的环境对 package-lock.json 跑 npm audit 或 osv-scanner 离线扫描，并把工具与日期记入当期评审。

### F7-47｜ops/headers/_headers.report-only.txt 为 2026-11-10 的陈旧产物，无任何门禁覆盖
- 证据：该文件头 `variant: WA-OFF+report-only; generated: 2026-11-10`，CSP hash 为旧值、无现行 ACAO 单一来源行、style 属性计数（6 处）与现行生成（5 处）不符；gen-headers --check 与 deploy.sh 门禁只校验 public/_headers，report-only 产物无 --check 路径核对。
- 影响：若按此文件做 CSP Report-Only 预演或事故对照，得到的是 WA-OFF 旧策略的错误结论。

## 八、P2 发现——文档与代码一致性专节（10 条）

### F7-48｜台账与运维文档仍称 legacy 实测计数「尚未部署」，且台账同文件自相矛盾
- 证据：`ops/legacy-measured-counter-w5.md` 末段与 `ops/quota-ledger.md:81` 附近均写计数「尚未部署 / 随下一次部署生效」；`ops/quota-ledger.md:69` 以现行口吻写「legacy 实测计数仍未激活……继续以场景估算代行」，同文件 `:81` 才有 W5 已激活的修订记，:69 段无「历史」标注、单独引用必错（W5-12 同形）。而 CONSTRUCTION_PHASE5.md:5/:36 记载其已随 Pages 部署 eba9cb0d 上线且部署后 quota-check 已实测 legacyMeasured available=false。
- 影响：引用台账者会误以为 legacy 实测计量仍未生效（四路评审独立同报此项）。

### F7-49｜security-baseline §5.1/§5.2 仍按「functions 只 get、不得出现 put/delete」登记，与 W5 现行代码直接冲突
- 证据：`ops/security/security-baseline.md:102-104` 称「functions/ 现有 board.js / health.js 均只 get」，`:114-115` 硬性检查项为「functions/ 不得出现 BOARD_KV.put / BOARD_KV.delete」；现行 board.js 已有经批准的 legacy-credits put（根 wrangler.toml:8-10、kv-write-guard 测试均已按 W5 修订，唯独基线 §5 未同步）。API 路与安全路独立同报。
- 影响：按基线做评审的人会把合法 W5 计数写误判为违规，或反之对守卫口径产生错误认知（与 F7-03 叠加：自律的守卫本身还可绕）。

### F7-50｜security-baseline 内部对 Observatory 未过项的口径自相矛盾
- 证据：同文件 `:60-61`（§3.3）仍称「未通过的 1 项究竟是 CSP 项本身，仍待逐项明细确认」；`:137-138`（§5.4）却断言「Observatory 135 / A+ 的唯一未过项即 SRI（−5）」。二者必居其一，文件未标注何者为准。（按定版口径，SRI 接受现状本身不重报，此处仅指文档内部矛盾。）
- 影响：引用基线时 SRI 归因的证据强度被高估或低估。

### F7-51｜Pages 侧 wrangler.toml 注释两处 G3 前旧口径残留
- 证据：`wrangler.toml:29`「legacy 模式现行代码在 key 缺失时仍按匿名尝试」——已被 F6-03 推翻（`board.js:289-294` 现为抛配置错误禁匿名）；同文件 `:22`「BOARD_READ_MODE（缺省 legacy）」亦与 fail-closed（缺失→snapshot v2）矛盾。
- 影响：误导回滚操作者对模式缺省与 key 缺失行为的判断。

### F7-52｜fetcher-runbook 三处口径未同步
- 证据：① `:2` 与 `:50`「Pages Function 只读组装」「KV 只读已上线」为无例外表述，未同步 W5 唯一写例外（与 wrangler.toml:5-7 的已更新注释口径不齐）。② `:24` 额度击穿处置第一步仍写「legacy 路径当前无自动记账、按回源次数估算」——W5 已激活实测计数，照 runbook 处置会漏读实测值。③（疑似）处置条 3 称「当前 KV 只有 current/shadow/health/sourceState 四键、prev 键尚未上线」，与 shared/board-schema.js KV_KEYS 现含 currentPrev/shadowPrev/legacyCredits 共 7 键的现状对不上；prev 是否已由 fetcher 实际写入属数据面核查，本节仅登记键集口径漂移。
- 影响：事故处置时按旧口径估算额度、误判键集现状。

### F7-53｜oncall-handbook 以 legacy 形态起头描述数据流，且全文无 HC4 条目
- 证据：`ops/oncall-handbook.md:8` 仍以「现行 legacy 形态下 Function 直连 CoinGecko」描述架构，与 G3 后 kv 形态（线上实测 servedFrom=kv）不符，文中后半虽提及新形态，但「现行」归属已反；全文 grep HC4 0 命中，手册健康入口表只列 HC1–HC3，值班时按手册找不到 HC4 处置（docs/fetcher-runbook.md:44 已有 HC4 引用，不能替代手册入口）。API 路与脚本路、安全路三路同报。
- 影响：值班首判易查错链路、漏 HC4 处置入口。

### F7-54｜probe-config 两处落地状态未更新
- 证据：`ops/probe-config.md:60` 仍写「影子链异常不影响当前 legacy 线上路径」——G3 后该链即生产数据链，第六期已改 cron 本体却未改此文；`:56` 落地状态仍称「HC1–HC3 三个检查的参数已逐项核对」（标题行日期 2026-11-12），HC4 已于 11-13 接线并列入同文件表格，该节未随之更新核对范围。
- 影响：探针配置的权威文档对生产链路定性错误、核对范围过期。

### F7-55｜README 两处与现状脱节：deploy 流程描述停留在第六期前、现状注记删除条件早已满足
- 证据：① `README.md:52` 的 deploy.sh 流程描述只列工具链预检→数据门禁→部署→冒烟，未提现行最前置的测试门禁、脏区门禁、模式门禁、_headers 门禁与 smoke-headers 段；且称数据门禁绕过为「DEPLOY_SKIP_META_CHECK=1 单次生效并须在 CHANGELOG 注明」，与现行实现（须 DEPLOY_SKIP_REASON + 落 deploy-log，deploy.sh:31-50,164-168）不符。② `README.md:11` 现状注记仍写「线上当前仍是首次拖放部署的版本，处于快照模式故障态……重新部署后删去本注记」——其自述删除条件（Wrangler 直推重新部署）2026-11-10 当日即已满足，此后又历经四至六期与 W5 多次部署，注记仍在，与线上 live 状态直接矛盾。
- 影响：新接手者按 README 理解部署流程与线上状态会得出错误预期。

### F7-56｜测试文件头注释与跨文档测试总账口径脱节
- 证据：① `tests/quota_check_test.py:25-29` 文件头仍写「当前脚本仍以 legacy 576 规划口径判级、①② 应红、待批 0 合并后转绿」——该合并早已完成、实跑 6/6 全绿，此段「已知状态」已成误导。② `tests/contract-real-data.test.mjs:5-6,30` 文件头仍称守护对象为「meta.fields == FIELDS23」，实际断言已是 FIELDS24（同文件:196）；同文件 57-60 行 NULLABLE 分布注释为 2026-11-13 基线数，未再对账。③ `docs/paprika-mapping-landing-2026-11-23.md` 尾节写「14/14 套件、169 项」，CONSTRUCTION_PHASE5.md 测试总账写「15/15 套件」——应为 C 路分支时点口径但落库记录未注明，两份官方记录并存互相矛盾（现行主干实测 15/15、178 项，以此为准；CONSTRUCTION_PHASE6 的 166 项与 W5 增量可完整对账至 178，无虚报）。
- 影响：后续评审者按文件头理解套件语义会得出错误预期，尤其 ① 会让人误判 quota 套件仍处预期红状态。

### F7-57｜_headers 注释仍称 Function 安全头定义在 board.js，实际已移至 shared/http.js
- 证据：`public/_headers:4` 与 `ops/headers/_headers.tmpl` 注释仍称 Function 安全头「live in functions/api/board.js SECURITY_HEADERS」，F6-33 后实际单一定义已移至 `shared/http.js`。
- 影响：低危文档漂移，但位于事故时第一手翻阅的响应头文件上。

## 九、第六期 / W5「已修」抽查复核总表

六路主抽查 25 条：**完全属实 23 / 属实但有副作用 1 / 部分落地 1**；另附带顺核 10 余条均与现状相符。修复真实性整体成立。

| 条目 | 路 | 方法要点 | 结论 |
|---|---|---|---|
| F6-12 置信度筛选 | 前端 | 线上 HTML grep value 在位 + DOM 测试⑦ + 无头实测选「高」→4 行，与 coins.json 计数 高4/中39/低157 逐项吻合 | ✅ 属实 |
| F6-13 三币市值矛盾 | 前端 | effPrice/effMcap 显式 num()+>0、主表详情共用 + DOM 测试⑨（0 值同显「—」不回退） | ✅ 属实 |
| F6-14 畸形字段打崩渲染 | 前端 | num() 贯穿 + 两处 try/catch + DOM 测试⑧（字符串价、"abc"、200 行不中断） | ✅ 属实 |
| W5 命中域 44×44 | 前端 | 无头五宽度几何实测，行高与 P5 记录逐档吻合、零布局变化 | ⚠️ 定版属实，但桌面档::after 横向侵入星标 4px（→ F7-34），「无内容死区」声称不成立 |
| W5 aria-controls 200/200 | 前端 | 程序化计数 200/200/200 逐个指向 + DOM 测试⑯三路 + toggle 同步 | ✅ 属实 |
| F6-62 delayed 横幅 | 前端 | DOM 测试⑬（文案/徽标断言） | ✅ 属实 |
| F6-03 fail-closed | API | dispatchGet 白名单 + 未知值落 snapshot v2 + key 缺失抛错 + board-v2 21/21 + 线上 kv 应答 | ✅ 属实（200 应答可发现性问题 → F7-12，新角度） |
| F6-04 coverage 按 rows 重算 | API | 重算段代码 + health count 断言 + 套件全绿 + 线上 coverage/count/coins 三方一致 | ✅ 属实（残余缝 → F7-08、F7-13） |
| F6-05 未来时间戳假绿 | API | board 三联动降级 + health 双通道 503 + 套件含未来 3600s 用例 | ✅ 属实 |
| F6-02 字段级校验 | fetcher | sanitize+计数、validateBlob 组合门禁 + 相关套件全绿 | ✅ 属实（CG 路径；Paprika 路径不对称 → F7-15） |
| F6-10 启用门禁 | fetcher | 常量/主流程门禁/迁移许可 + 生产 toml + 线上 source=coingecko | ✅ 属实、无绕过路径（计数口径缺陷 → F7-01/F7-02） |
| F6-11 失败记账 | fetcher | runLedger/quotaWithLedger 全路径核对 + 套件全绿 | ✅ 属实 |
| F6-01 部署门禁 | 脚本 | 实跑 npm test 15/15 + /tmp 副本注入 failing test 实测 deploy 中止于门禁 + 无理由绕过被拒 | ✅ 属实（留痕载体问题 → F7-20） |
| F6-07 quota G3 口径 | 脚本 | 代码 + quota-log 尾 3 条实录（verdict=OK、投影 ≈4056）+ 无凭证干跑 exit 3 | ✅ 属实（字段瑕疵 → F7-25） |
| F6-08 compare 同源降级 | 脚本 | 同源检测段 + verdictCaps 汇合 + 套件 6 PASS | ✅ 属实（用例覆盖缺口 → F7-06） |
| F6-09 weekly 失败清零 | 脚本 | run_void 不覆写 watch/lastRunWeek、退出码 2 + 套件通过 | ✅ 属实（边角：作废轮仍写 state 的 updatedAt 等，与报告文案口径一致，知悉项） |
| F6-16 quota/compare 判级测试 | 测试 | 读两套件全文 + 实跑全绿 + 逐例比对判级分支覆盖 | ⚠️ 部分落地：判级四档/fail 三因已锁定且真实驱动，但 F6-08/20/21 新上限与 F6-24 陈旧判级不在覆盖内（→ F7-06/F7-07） |
| F6-17 契约 v2 四字段断言 | 测试 | board-v2:88-107 五字段逐项断言 + 线上采样字段集完全对齐 | ✅ 属实 |
| F6-19 前端 mock 对齐 | 测试 | mock 五字段齐备 + ③④ 值级断言 + 线上字段集交叉比对 | ✅ 属实 |
| F6-33 health 安全头 | 安全 | shared/http.js 单一定义 + 线上两端点（含 405）三头齐全 + smoke S4 PASS | ✅ 属实 |
| F6-86 key 缺失 fail-closed | 安全/脚本 | build.py/weekly_check.py 同形代码 + 负向实测三态（抛错/匿名开关 WARNING） | ✅ 属实 |
| F6-92 + W5 写例外 | 安全 | kv-write-guard 实跑 PASS（恰 1 处批准 put）+ 根 wrangler.toml 注释已同步 | ✅ 守卫本身属实（可绕性 → F7-03；基线登记未同步 → F7-49） |
| F6-87 ACCOUNT_ID 必填 | 安全/脚本 | quota-check.py:53、check-shadow-health.py:24,61 无字面量默认值、缺失即 fail | ✅ 属实（rollback.sh 漏网 → F7-19） |
| F6-90/F6-91 脱敏 | 安全 | classify_error/sanitized_debug 在位、fetcher 日志只记 valueKind/valueLength（代码复核） | ✅ 属实 |
| F6-84/F6-85 开关 fail-closed | 安全 | fetchDisabled/BOARD_SOURCE 未知值回落 + 留痕日志（代码复核） | ✅ 属实 |

附带顺核相符（未单列）：F6-15、F6-18、F6-23（probe exit 4 与 HC1 cron 逐字对齐）、F6-31、F6-32、F6-41、F6-48、F6-49、F6-76（archive 退役守卫齐全）；FIELDS24 全链一致性（fetcher 路专项抽验：三份 coins.json md5 一致、逐币 paprikaId 与事实源零差异、线上 coins.json 与本地逐字节相同、dataHash 与落库记录一致）；CSP 哈希与 _headers 逐一吻合；前端 esc() 转义链完整；密钥卫生复扫 0 明文落盘。

## 十、修复批次分组（供修复期排期，标注依赖与先后）

- **批 0 · 数据正确性（最先，Paprika 启用前置）**：F7-01（3 条错配改正确值 + 38 条 symbol-only accept 全量身份复核 + 落库校验加 name/symbol 身份复核环节）、F7-02（门禁加验 is_active 与 tickers 实际命中、与发布门禁 94% 对齐）。依赖：无；是 Paprika 任何启用动作的前置。
- **批 1 · 守卫与门禁**：F7-03（kv-guard 改 AST/多形态扫描或等价方案）、F7-04（preview 冒烟分流：静态子集 + 不误发 HC2 fail）、F7-06、F7-07（compare/quota 新口径用例补齐）、F7-32（套件集合单一事实源 + 一致性断言）、F7-29、F7-30、F7-31（新代码负向/行为用例）。依赖：F7-03 先于批 2 中一切 functions/ 改动落地，避免新代码继续暴露在可绕守卫下。
- **批 2 · API 与 fetcher 健壮性**：F7-08（health 验 coins 本体）、F7-09（HEAD 过 sfs/计数口径）、F7-10、F7-11（计数时点改 waitUntil/发出后计、prev 值钳制）、F7-12（fail-closed 应答改非 200 或加显式标记）、F7-13（missingIds 守恒，先验证）、F7-15（Paprika 归一化清洗对齐 CG）、F7-14（verify 脚本口径同步）、F7-42（计数写频上限/节流）、F7-43（两处 fetch 加超时）、F7-44（/run 节流 fail-closed 化，先验证）。
- **批 3 · 前端**：F7-34（::after 横向收敛不侵星标）、F7-35（† 按钮命中域）、F7-36（th-sort 粗指针 44px）、F7-37（≤640 列名与 384px 溢出）、F7-38（decode 全行校验，先验证）、F7-39、F7-40（文案与隐私页修订，含页脚加隐私链接）、F7-41（sitemap lastmod 随部署更新）。
- **批 4 · 脚本与运维工具**：F7-19（rollback fail-closed + 示例修正）、F7-20（绕过留痕入版本控制或等价审计）、F7-21（probe.mjs 状态码判定）、F7-22、F7-23（weekly 退出码与写序/原子写）、F7-24（build 落盘原子化）、F7-25（quota 跨月 credits 置空 + cron 本体补 legacyMeasured 汇报口径）、F7-26（coverage-report 退出码口径）、F7-27（时间判定双侧化，先验证）、F7-28（cron delivery 核对，先验证投递语义）。
- **批 5 · 文档同步**：F7-05（fetcher README 顶部 G0 段重写——具操作危险性，建议随批 0/1 提前）、F7-16、F7-48~F7-57 全部文档条。依赖：与对应代码批次的定版口径一致后再改，避免二次漂移；F7-49/F7-50 须与 security-baseline §5.4 的 SRI 定版口径自洽。
- **批 6 · 安全治理**：F7-45（人工运维路径 wrangler 锁版收口）、F7-47（report-only 产物纳入 --check 或退役）、F7-46（在不受限环境补跑 audit/osv 并登记工具与日期）。

## 附：评审方法与证据强度说明

- 六路均独立取证、给文件:行号；关键 P1 经协调人复核（F7-01 错配值在 coins-list.js 内逐字核对、F7-03 守卫正则与 F7-04 的 README 定版原文均已亲查）。
- 跨路同报已合并：F7-03（API + 测试两路，实测坐实）、F7-48（四路同报）、F7-49（API + 安全）、F7-53（API + 脚本 + 安全）、F7-32（测试 + 脚本）、F7-19/F6-87 漏网（脚本 + 安全互证）。
- 未执行项如实登记：KV 原始键未直读（无令牌，以 /api/health + /api/board 替代核验，paprikaMappedCount 原始字段未直读到）；fetcher workers.dev 无令牌探测因审批超时未执行；npm audit 被注册表策略拒绝（→ F7-46）。
