# 第八期全面评审报告（PHASE8_REVIEW）

- 评审对象：crypto-top200（生产 https://top200.oppcal.com，BOARD_READ_MODE=kv），仓库 HEAD `f536aab`（第七期施工收官）
- 评审方式：六路并行独立取证（前端功能与可达性 / API 与 Functions / fetcher 与数据管线 / 脚本与运维工具 / 测试与契约 / 安全与健壮性），只评审不施工；生产只读核查，绕过与变异实验仅在仓库外临时副本进行
- 评审日期：2026-11-23

## 一、总览

**发现 37 条：P0 0 / P1 4 / P2 33；确认 30 / 疑似 7。**

**成熟度：B 级，约 3.3/5**（与第七期持平）——主链与第七期修复的真实性经本期抽查与实跑继续成立（全量测试 22 套件 273 项实跑全绿、Paprika 四计数独立复跑与定版逐项一致、身份抽样 16/16 同一资产）；但第七期增量代码在「运行时口径与离线口径的一致性」上再现系统性弱点：Paprika 身份门禁在 fetcher 运行时退化为自洽校验（F8-01）、同资产重复条目可全过门禁（F8-02）、KV 写守卫被现代常用写法绕过（F8-03）、部署冒烟链本身零测试覆盖（F8-04）。四条 P1 均为验证层/门禁层问题，无一影响当前线上数据正确性（Paprika 保持关闭、线上 source=coingecko 实测）。

### P1 清单（4 条）

| 编号 | 一句话 |
|---|---|
| F8-01 | fetcher 运行时 preflight 的 identityValid 是同义反复：运行时数据无 name/symbol，身份校验退化为「条目 id 前缀 == 条目自身 symbol」自洽校验，旧错配值以运行时形态喂入四计数全过；全名复核脚本未被任何门禁强制执行 |
| F8-02 | 3 条映射指向同资产的重复/次级条目（cosmos、litecoin、zcash），价格对、市值错约两个数量级且全过四项门禁；门禁无 rank/市值与 CG 的交叉合理性校验 |
| F8-03 | KV 写守卫对可选链完全盲区：`kv?.put()` 与 `kv.put?.()` 均零 offender 且运行时真实执行写——最惯用的现代写法，F7-03 的 fail-closed 承诺在此破口 |
| F8-04 | 部署后冒烟链零套件覆盖：smoke.sh 与 gen-headers/smoke-headers 是 deploy.sh 多道门禁的被测本体，却无任何离线套件验证，坏掉只能在真实部署时暴露 |

### 第七期抽查复核结论（汇总，明细见第三节）

六路共抽查 **54 项次：完全属实 48 / 属实但有残余、副作用或打折 5 / 仓库外事项按施工记录采信 1**。有问题的 5 项为：F7-36（44px 规则范围漏网 ≤640 手机档，→F8-05）、F7-13（与 L3 降级分支交互残余，→F8-09）、F7-02（identityValid 运行时口径打折，→F8-01、F8-15）、F7-24（原子落盘副作用收紧权限，→F8-19）、F6-05（未来时间戳封堵未覆盖 global 通道，→F8-13）。采信 1 项为 F7-28（cron delivery 本体在仓库外，脚本侧可核部分属实）。

### 如实登记的证据边界

- 路 1 无可用无头浏览器，前端几何数字以 CSS 级联计算 + CSSOM 断言双路取证，非真机实测。
- F7-28 的 cron delivery 本体不在仓库内，本期无法独立复核，按 CONSTRUCTION_PHASE7.md 记录采信。
- Paprika 外部数据为 2026-11-23 评审当日快照（目录 62,744 条、tickers 前 2,000 条），计数随源数据漂移属正常。

## 二、发现清单

### P1（4 条）

#### F8-01fetcher 运行时 identityValid 同义反复，全名复核无自动化强制

- 证据：`shared/paprika-identity.js:64-72`。fetcher 运行时 COINS 只有 {id, paprikaId}、无 name/symbol，`paprikaIdentityMatch` 退化为「目录条目 id 前缀 == 该条目自身 symbol」的自洽校验。
- 实测：将 F7-01 的三个旧错配值（pump-pumpbtc / sky-skycoin / skr-saakuru-labs）以运行时形态喂 `countPaprikaGateStats`（真实目录 + tickers），mapped/identityValid/activeUsable/tickerHit = 3/3/3/3 全过；同一数据带 name 形态喂全名口径则 3/3 被 name_mismatch 拦下。
- 另一半：全名复核脚本 `scripts/verify-paprika-identity.mjs` 未登记于 run-tests.sh / deploy.sh / suites-manifest / package.json 任何一处，无自动化强制执行。映射若在周检轮换中回归，运行时门禁与 health.paprikaGate.identityValid 都会给出假绿。
- 影响：当前靠离线人工复核 + tickerHit 未达标（179<188）双重挡住，无线上危害；tickerHit 一旦达标，此腿为真放行风险。
- 与 F8-29 关联：该脚本本体亦无套件覆盖。

#### F8-023 条映射指向同资产重复/次级条目，价格对、市值错约两个数量级，全过四项门禁

- 证据：coins-list.js 映射与 Paprika 目录实测（2026-11-23）：
- cosmos → atom-cosmos-token（目录 rank 1108、市值 $2.63M；主条目 atom-cosmos rank 108、市值 $464.9M）
- litecoin → ltc-litecoin-token（rank 424、$30.1M；主条目 rank 30、$3,062M）
- zcash → zec-zcash-token（rank 236、$94.5M；主条目 zec-zcash rank 11、$12,921M，本期新坐实）
- 前两条第七期施工记录已「留档未改」，zcash 为同类新增。根因：身份规范化剥离 "Token" 后缀，使「X Token」重复条目与正主同名同 symbol、身份判定通过；门禁 tickerHit 只验 price 有限正数（`shared/paprika-identity.js:78-82`），无 rank/市值与 CG 的交叉合理性校验。
- 同盲区另见 htx → htx-htx（Paprika 侧唯一活跃条目，市值为 CG 的 0.11%，无更优条目可选，属 Paprika 数据质量问题、非映射错误）。
- 影响：Paprika 一旦启用，此 3 行的 mcapUsd/rank 将静默错误；当前保持关闭、无线上危害。

#### F8-03KV 写守卫对可选链完全盲区

- 证据：`tests/helpers/kv-guard-scan.mjs` 写判定仅认 `.`+`(` 形态、不处理 `?.` token。红队在仓库外副本实测 50 种写法：`env.BOARD_KV?.put()` 与 `env.BOARD_KV.put?.()` 均 offenders=0，且 Node 假 KV 实跑确认写真实执行。
- 定级说明：守卫定位为「代码自律 + 防误写」验证层（平台层 BOARD_KV 本为读写权限，baseline §5.1 已登记），无外部攻击者可独立利用；但可选链是最惯用的现代写法，误写或评审漏看即假绿，F7-03 的 fail-closed 承诺在此破口，故定 P1。

#### F8-04部署后冒烟链零套件覆盖

- 证据：`scripts/smoke.sh`（188 行，deploy.sh 生产/preview 共同门禁）、`ops/headers/gen-headers.mjs`（279 行）与 `smoke-headers.mjs`（200 行，deploy.sh (b2)/(b2b)/(d2) 三道门禁的被测本体）在 tests/ 中零引用（grep 零命中）。
- 影响：这三者是部署门禁的被测本体，其自身逻辑（如 gen-headers --check 对改坏的 _headers 是否真判不一致）从未被离线验证，坏掉只能在真实部署时暴露。

### P2（33 条）

#### 前端（4 条）

- **F8-05≤640 手机档排序按钮仍 36px**：F7-36 的 44px 粗指针规则限定 `min-width:641px`（public/index.html:207），≤640 档仅改内边距（:137）、基础 min-height 仍 36px（:172），与本档其余控件（均 44px）不一致；仍高于 WCAG AA 24px 下限故 P2。复现：360px 触控视口查 sortBtn 计算高度 = 36px。
- **F8-06状态横幅 aria-live 每次 render 无条件重写**：横幅 `aria-live=polite`（index.html:232），applyBoardState（:718 起）由 render() 无条件调用并赋 textContent（值不变亦重写），部分读屏可能重复播报整段横幅。验证：NVDA/VoiceOver 下连续输入搜索词，或 MutationObserver 计数横幅 mutations 后比对读屏播报次数。
- **F8-07Escape 关闭详情以未转义 id 拼 querySelector**：index.html:1311 `querySelector("[data-exp='" + id + "']")`，coingeckoId 含 `'` 的畸形数据会抛 SyntaxError 使 Escape 关闭失效（F6-66 转义链未覆盖此 JS 选择器拼接点；现行 200 币 id 均为 slug、无触发）。验证：本地副本把某 id 改为 `a'b`，展开详情后在详情行按 Escape，看控制台是否 SyntaxError 且详情未关。
- **F8-08隐私页无 `<main>` 地标、无跳过链接**：privacy/index.html:24 仅 `<div class="wrap">`，读屏地标导航到不了正文（首页有）。验证：读屏地标列表打开本页应为空。

#### API 与 Functions（5 条）

- **F8-09L3 降级分支 coverage 守恒破裂（F7-13 残余）**：blob 的 missingIds 非数组且老化至 L3 时，coverage 输出 `{expected:200, returned:0, missingIds:[]}`——coins 已全部扣下，真实缺失应为全部 200 个 id，且 expected−returned ≠ missingIds.length。证据：functions/api/board.js:840 L3 分支直接取 recomputed.missingIds，而非数组时 recomputed 在:811-815 被置 `[]`；本地构造 blob 实测复现。health 仍因 expected/新鲜度判红，无假绿，仅契约字段失真。
- **F8-10legacy-credits 计数 KV 往返无超时、可阻塞主流程**：addLegacyCredits 无任何超时包裹（board.js:120-170），且:354 await 后才 allSettled——计数 get/put 若挂起（非抛错），行情应答无限期阻塞，与「计数失败绝不影响主流程」的设计自述不符（失败被吞、挂起不被吞）。本地 stub KV put 永不返回 + 上游即时响应，实测请求 5s 后仍 pending。F7-10 移点只消除了串行前置，未消除此项。
- **F8-11legacy/dual 路径 coins 值零清洗**：fetchUpstreamInternal 直接透传上游 price/mcap/rank/change24h（board.js:415-424），与 fetcher 两源已对齐的 F6-02/F7-15 清洗口径不对称；上游形变值（字符串价、负市值、字符串 rank）原样进入应答，现靠前端 num() 兜底。生产 kv 形态不触发，属回滚/dual 潜伏项。本地 mock 实测逐字透传。
- **F8-12legacy 应答 count 与 coverage.returned 可不一致**：coins 字典收录上游全部 id（含期望列表外），count 按字典键数计、returned 只计列表内命中（board.js:415,445-454），破坏 v2 侧 health 强制的 count===returned 不变量。本地 mock 追加 1 个列表外 id 实测 count=3、coverage={expected:2, returned:2}。legacy 无 contractVersion、health 本就判红，影响限于 dual/legacy 消费方。
- **F8-13global 子字段未来时间戳盲区（F6-05 未覆盖通道）**：globalForContract 对 asOf 年龄做 `Math.max(0,…)` 钳制、无 clockSkew 判定（shared/board-schema.js:395-412）——global.asOf 在未来（如 +7h）时输出 stale:false 且永不触发 >6h 置 null，直到真实时间追过 asOf+6h。本地构造 fetchedAt 新鲜、global.asOf=+7h 的 blob 实测照常端出。fetcher 正常时两戳同源，故为潜伏项。

#### fetcher 与数据管线（5 条）

- **F8-14字段清洗计数 invalidFields 在运行路径全程丢弃**：coingecko.js fetchMarkets 解构时直接扔掉（只取 rows/coverage），coinpaprika.js 虽返回，fetcher index.js 从不读 mVal.invalidFields（无日志/health/blob 落点）。F6-02/F7-15 的「坏值计数留痕」在生产 run 中实际不存在，上游字段大面积形变时监控无感（validateBlob 因值已被清洗为 null 也看不到）。
- **F8-15health.paprikaGate 失败时零填充、「未测」与「实测 0」不可区分**：preflight 未执行（mappedBelowGate）或抛错时以 `{mapped, identityValid:0, activeUsable:0, tickerHit:0}` 落盘（workers/fetcher/src/index.js preflight 段 gateStats 兜底），监控按分项读数会误判身份全灭。
- **F8-16fetcher 侧 mapped 计数未走 F7-29 定版接口**：index.js 的 paprikaMappedCount 与 countPaprikaGateStats 的 mapped 均以「非空字符串」计，畸形串（如 `"not in directory!!"`）实测计 mapped=1，与 shared/board-schema.js:20-24「计数一律经 isValidPaprikaId、禁止 truthy 计数」的定版自相矛盾。现行真实数据格式全合法（contract 套件有正则断言）且下游计数能拦门禁，无现行实例；health.paprikaMappedCount 存在被畸形值灌水的口子。
- **F8-17preflight 失败路径漏记账**：`ledgerCall(false, 2)` 在 fetchGateStats 成功后才执行（index.js:340-346），preflight 中途失败（如目录成功、tickers 500）时已发生的 1–2 次 Paprika 调用不入 attemptsTotal，与表头「attemptsTotal 为同月上游调用总次数（含 Paprika）」口径不符。成功路径及 CG 各路记账核对无误。
- **F8-18countPaprikaGateStats 不做 paprikaId 去重**：同一 paprikaId 被两个本地币引用时四项计数双计（构造 dup 输入实测 2/2/2/2）。现行数据无重复且 contract-real-data:281 有数据级「不得重复」断言拦截，故仅为函数级残余。验证：向 countPaprikaGateStats 喂两条同 paprikaId 合成 coins 看 tickerHit 是否双计（已实测为是；定疑似系因数据层已有防线、实际触发需先绕过部署门禁测试）。

#### 脚本与运维（8 条）

- **F8-19F7-24 副作用：原子落盘后产物权限被收紧为 0600**：scripts/build.py:553,558 `_stage_and_land` 用 mkstemp 暂存（0600）+ os.replace 落盘，不保留原权限——/tmp 实测目标文件 0644 → 落盘后 0600。同用户部署链可读、不阻断现行流程，但与改前 write_text 行为不一致，多用户/组读场景会断。
- **F8-20fetcher-runbook 的 Paprika 状态段未随第七期同步**：docs/fetcher-runbook.md:8 仍写「映射未落库（0/200）」与实测 mapped=196/200 矛盾、「须 ≥197 非空」与 F7-02 四项门禁（均 ≥188）矛盾；同文件其他段已按 F7-52 修订，唯此段漏改。方向偏严不会误启用，但会误导处置判断。
- **F8-21Paprika 启用门槛双口径并存未对账**（路 3、路 4 双路独立发现，合并）：fetcher preflight 为四项 ≥188（F7-02 定版），而独立核验脚本 verify-paprika-coverage.mjs 仍以 hits ≥197 PASS / <195 FAIL+exit 1 为门槛（文件头与:77-85），且该脚本不拉目录、不查 identity/active，其 RESULT: PASS 会被误读为「可启用」。同一批数据（如 tickerHit 190）会在两处得到相反结论，仓库内无任何说明哪道门为准。
- **F8-22quota-check 的 INVALID 路径静默吞日志写失败**：scripts/quota-check.py:243-246 `except Exception: pass`，与正常路径「写日志失败 → 报错 exit 3」的口径不一致——恰在核账失效时，失效记录可能无声丢失，只剩 stdout。验证：将 LOG_PATH 指向只读目录构造陈旧 health 跑 main，看退出码与 stderr。
- **F8-23quota-check 的 wrangler pin 回退无警告且绕过锁版入口**：quota-check.py:120-125 写死回退 `4.159.0` 时无任何警告（check-shadow-health.py:80-85 同处有 WARN，口径不齐）；两脚本均绕过 F7-45 锁版入口（裸 `npx wrangler@<pin>`、不校验 lockfile）。当前 pin 实测与 package.json 一致（4.159.0），属漂移隐患非现行错误。
- **F8-24probe.sh 写探针日志无失败检查**：scripts/probe.sh:125 末尾写 ops/probe-log.jsonl 的 python 行无任何失败检查，脚本无 set -e、其后直接按 verdict 定退出码——日志写失败（磁盘满/权限）时 pass 仍 exit 0，探针留痕静默丢失。验证：副本中将 LOG_FILE 指向不可写路径跑本地 mock 基址，观察退出码仍随 verdict。
- **F8-25compare-shadow 拉 live 不判 HTTP 状态**：scripts/compare-shadow.mjs:90 非 2xx 的 JSON 错误体会被当 live 数据判读（F7-21 同形盲区未覆盖到本脚本）；现被 compared 下限（188）兜底大概率落 fail，但含 coins 形态的错误体可污染比对口径。验证：本地 mock 对 /api/board 返回 503 + 伪造 v2 体，跑 `--live http://127.0.0.1:<port>` 看 verdict 与 failReasons。
- **F8-26weekly_check 默认日期用本地时区**：scripts/weekly_check.py:239 用 `date.today()`（本机时区），而 quota/check-shadow 全按 UTC 月/周判定：跨年/跨周边界且运行机时区非 UTC 时，周标签与 state 的 ISO 周推进可能与 UTC 口径错位一天。验证：`TZ=Pacific/Auckland` 与 `TZ=UTC` 在周一 00:30 分别跑（--state/--out 指向 /tmp）比对 week_label。

#### 测试与契约（6 条）

- **F8-27suite-manifest 套件识别口径有盲区**：suite-manifest.test.mjs:31-34 isSuiteFile 仅认顶层 `*.test.mjs`/`snapshot-verify.mjs`/`test_*.py`/`*_test.py`；新套件若命名为 `foo.check.mjs`、置于 tests/helpers/ 下或用 `*.test.js`，磁盘扫描与 manifest 双向断言同时看不见，可静默不入册、不被 run-tests 执行。验证：副本内新增 tests/foo.check.mjs（内含必失败断言），suite-manifest 与 run-tests 均仍全绿即坐实。
- **F8-28fetcher 独立部署路径不经测试门禁**：deploy.sh 只管 Pages；fetcher 按 deploy.sh:182 注释与 runbook 经 wrangler-pinned.sh 单独部署，该入口只锁版本、不跑 npm test；同理直接以 wrangler-pinned 执行 pages deploy 可绕开 deploy.sh 全部门禁——目前仅靠操作纪律，无技术拦截。属设计口径，但「所有部署路径都过门禁」不成立，应明示为已知豁口。
- **F8-29Paprika 校验三脚本等零套件覆盖**：scripts/verify-paprika-identity.mjs、verify-paprika-coverage.mjs、gen-paprika-map.mjs 本体零套件（仅 build.py 解析函数被覆盖）；scripts/coverage-report.mjs 本体零套件（仅被 suite-manifest 以字符串断言其读 manifest）；hc_ping.sh、rollback.sh 零套件（rollback 有真机演练记录，风险可接受）。另 paprika-gate.test.mjs:5 头注释仍写「待协调人登记进 run-tests.sh」，与已入册现状不符（文档陈旧，无功能影响）。
- **F8-30audit-deps 套件硬编码版本号、与 pin 耦合**：tests/audit-deps.test.mjs ②④ 正则写死 `/wrangler@4\.159\.0/`；wrangler 升 pin 后必假红，须人肉同步改测试（对比 wrangler-pinned.test.mjs 从 package.json 动态读 pin 的正确做法）。复现：副本内改 pin 为 4.160.0 并同步 lockfile 后跑该套件。
- **F8-31wrangler-pinned 套件未覆盖两条失败分支**：本地二进制缺失（走 npx 兜底）与 lockfile 与 pin 不一致时 wrapper 自身拒绝执行，均无用例（后者仅 deploy.sh 的独立预检段覆盖、不在套件内）。tests/wrangler-pinned.test.mjs 仅 4 例。验证：副本内设 WRANGLER_PINNED_LOCAL_BIN=/nonexistent 跑 wrapper 人工核对行为即可补例。
- **F8-32套件计数口径不统一、总账靠人工对表**：legacy-credits 自报 14 项却打 15 行 PASS（第 6 项双子例）；各套件汇总格式至少 5 种，run-tests.sh 只判退出码、无项数汇总，273 的总数只能逐套件人工加总核对，未来增删项不易被发现。

#### 安全与健壮性（5 条）

- **F8-33多层/循环解构可绕过写守卫**：嵌套解构 `const {BOARD_KV:{put}}=env; put()` 与 for-of 解构 `for(const {put} of [env.BOARD_KV]) put()` 均零 offender、假 KV 实跑执行（守卫解构处理只展一层、且要求声明上下文）。红队 22/42 号样本。
- **F8-34标识符 Unicode 转义绕过写守卫**：`env.BOARD_KV.pu\u0074()` 被 tokenizer 在 `\` 处截断标识符，方法名永不等于 `put`，零 offender、实跑执行。红队 30 号样本。
- **F8-35写守卫扫描范围只含 functions/，shared/ 逃逸**：tests/kv-write-guard.test.mjs:29 walk 仅 `../functions/`，但 Functions 实际 import 仓库根 shared/（functions/api/board.js:28-37 import../../shared/board-schema.js、../../shared/http.js）——把 put 写进 shared/*.js 由 board.js 引用即完全不被扫描。
- **F8-36Reflect 绕过属已登记边界，但兜底无落点**：Reflect.get/apply 抽取写方法零 offender、实跑执行；扫描器文件头已声明元编程不在口径、靠人工评审兜底，但 security-baseline §5.2 评审清单未单列 Reflect/Proxy 检查项，兜底无落点。红队 08/09 号样本。
- **F8-37eval/Function 构造内的写调用对守卫不可见**：字符串内容被 token 化剥离（红队 19/20 号样本 offenders=0）；当前靠 Workers 运行时禁止 eval/Function 构造兜底，非守卫自身能力，仓库内现无 eval 使用（全仓 grep 零命中）。验证：在本地 wrangler dev 环境执行含 `eval("env.BOARD_KV.put(...)")` 的 Function，确认运行时抛错且无 KV 写入；若未来运行时口径变化，此项升级为确认绕过。

## 三、第七期抽查复核明细

六路共抽查 54 项次：**完全属实 48 / 属实但有残余、副作用或打折 5 / 仓库外采信 1**。第七期修复真实性整体成立。

### 路 1（前端，10 项：属实 9 / 有问题 1）

属实：F7-34 星标命中域（40×44 计算、侵入 0px、CSSOM 断言通过）、F7-35 † 按钮（约 33×46px）、F7-37 手机五列（326px ≤ 视口、不横溢）、F7-39（生产 grep「120 秒」0 命中、两页口径已改）、F7-40（隐私链接在位、键名与代码逐字一致、预写文案 0 残留）、F7-41（sitemap lastmod 2026-11-23）、顺核 F6-12（高 4/中 39/低 157 与数据实测吻合）、F6-13（主表/详情共用 effMcap）、F6-62（delayed 中性横幅）。生产三页与仓库文件 sha256 逐字一致。
有问题：F7-36——44px 规则本身属实，但范围漏网 ≤640 手机档（→F8-05）。

### 路 2（API，10 项：属实 8 / 有残余 2）

属实：F7-08（coinsCount 三方守恒 + 线上在位）、F7-10（计数时点）、F7-11（坏值钳制四形态自愈）、F7-42（60s 写频节流）、写守卫例外唯一性（全仓仅 board.js:156 一处批准 put）、F7-12（fail-closed 503 形态）、F6-03（模式白名单回落）、F6-04（coverage 按 rows 重算、线上三方一致）。本地五套件全绿；线上实测 health/board 正常。
有残余：F7-13 与 L3 分支交互（→F8-09）；F6-05 board 级仍成立但 global 通道未覆盖（→F8-13）。

### 路 3（fetcher/管线，9 项：属实 8 / 打折 1）+ Paprika 专项

属实：F7-01（三错配现值正确、旧值全仓 0 命中、全量复跑 identityValid=196 无新增不符）、F7-14（verify 脚本 limit 与报价口径，实跑 hits=179 一致；门槛文案问题 →F8-21）、F7-15（清洗对齐、坏值置 null；计数丢弃 →F8-14）、F7-16（注释/配置一致）、F7-17（解析去耦合 6/6；测试文件头注释过期小瑕）、F7-18（生成器 rank/活跃优先）、F7-05（README 重写）、F7-29/FIELDS24（三份 coins.json md5 逐字节一致、负向用例通过）。
打折：F7-02——计数/阈值/强制 CG/health 分项落盘均属实，但 identityValid 运行时口径弱于标签（→F8-01）、失败时计数零填充（→F8-15）。
**Paprika 专项结论**：四计数独立复跑与第七期定版逐项一致（mapped=196 / identityValid=196 / activeUsable=195，yzy 下线属实 / tickerHit=179，门禁阈值 188、差 9 条，保持关闭成立，线上 source=coingecko 实测）；ticker 缺失 17 条全为 rank 3116–6717 的目录内活跃条目（不在免费 tickers 前 2000），归因干净；179 个命中逐一与线上 CG 同刻比价，价差比全部 ≈1.000。**身份抽样**：随机 12 条 + 定向 4 条（含原三错配现值）逐条人工核对 name/symbol/rank/活跃，**16/16 同一资产**——离线全名复核口径可信（旧错配三值以带 name 形态喂入 3/3 被拦）。问题在运行时口径与强制执行（F8-01）及同资产重复条目盲区（F8-02），非离线复核本身。

### 路 4（脚本运维，12 项：属实 10 / 有副作用 1 / 采信 1）

属实：F7-05（README 与 wrangler.toml 实测一致）、F7-17（解析 6/6）、F7-19（ACCOUNT_ID 字面量清零、无 env 实测 exit 3 不发 API）、F7-20（审计文件已被 git 跟踪、双写+脱敏在位）、F7-21（probe 状态码 3/3）、F7-22（weekly 退出码 18/18）、F7-23（写序/state）、F7-25（legacyMeasured 置空、22/22；线上日志尾条正是该形态）、F7-26（coverage-report fail-closed）、F7-27（未来容差三处统一、4/4）。
有副作用：F7-24 原子化属实但落盘权限收紧（→F8-19）。
采信：F7-28——仓库内无 cron 配置副本，脚本侧可核部分（quota 汇报字段规则、legacyMeasured 已实际出现在日志）属实；delivery 本体补齐与回读只能采信 CONSTRUCTION_PHASE7.md 的 cron.view 记录，本期无法独立复核。

### 路 5（测试契约，7 组：全属实）+ 实跑总账

实跑全量（HEAD f536aab，run-tests.sh，rc=0）：**22 套件 / 273 项 / 全绿，与第七期定版完全一致、无漂移**（原始 PASS 行 274 系 legacy-credits 第 6 项双子例，计数口径问题 →F8-32）。
属实（含变异实证）：manifest 单一事实源 + 双向守卫（漏登/多登在现行命名口径内必红；识别盲区 →F8-27）、paprika-gate 9 例（变异 gate 恒 ok → 7/9 变红）、kv-guard 15 例（变异扫描器恒空 → 3/15）、F7-06 compare 三上限（变异删 cap → 11/13）、F7-07 quota 陈旧/非 kv 分支（冻结时钟、边界确定性）、wrangler-pinned、audit-deps（桩 OSV 服务、失败不冒充 0 漏洞）。

### 路 6（安全，6 项：全属实）+ 红队

属实：F7-46 OSV 审计本路只读实跑复核（2026-11-23T08:31Z，91 包、0 漏洞、退出码 0，与 baseline §5.5 登记一致）、F7-45 wrangler 锁版 4.159.0（pin 与 lockfile 脚本实读校验、现行文档无裸 npx 命令）、F7-44 /run 节流 fail-closed + 专用节流键 + 令牌 SHA-256 常量时间比对、F7-43 两处 fetch 超时、§5.4 SRI 登记与代码一致（仅核登记准确性）、§5.1/5.2 批准例外登记与代码三方一致。
**红队**：50 种写法在仓库外副本实测——别名、解构（一层）、计算属性、模板字面量、字符串拼接键名、参数/返回值传递、容器、Proxy、bind/call 转手、混淆等绝大多数被拦截；确认绕过 5 类（→F8-03、F8-33、F8-34、F8-36，及扫描范围问题 F8-35）；大小写变体 `.Put()` 与 `with` 语法为放行但运行时不可利用，不计发现。

## 四、无发现的方面（各路查过且干净，摘要）

- 前端：交互功能全链（搜索/排序/筛选/自选/展开/hash 直达）、畸形数据健壮性（L1-03 选择器残余除外）、对比度逐对计算全 ≥4.5:1、其余响应式档位、焦点与键盘、文案一致性（F7-39/40 之外）。
- API：wrangler.toml [vars] 与绑定、契约 v2 字段完整性（kv 主链）、缓存/熔断/回退四层、错误处理与状态码/异常方法、响应头三件套线上实测、dualCompare 与无 blob 形态。
- fetcher/管线：抓取节奏与相位（Cron */10、global 30 分钟相位、退避）、坏数据覆写好 blob 的防护链（coverage 拒写、validateBlob、prev 归档、并发合并）、CG credits 主路径记账、三份 coins.json 与 FIELDS24 透传、写 KV 字段级校验与 targetKey 白名单。
- 脚本运维：smoke.sh/hc_ping.sh/audit-deps.mjs 等退出码语义、硬编码一致性（Paprika 门禁口径除外）、build/weekly 之外的原子性、deploy.sh 门禁链、gen-paprika-map.mjs。
- 测试契约：实跑一致性（无漂移、无跳过伪装）、flaky/时序（冻结时钟与固定 NOW 注入）、契约类套件喂真实产物未见 mock 脱节、deploy.sh Pages 主路径门禁接线（旁路豁口见 F8-28）。
- 安全：注入/原型污染（innerHTML 路径均经 esc()）、敏感信息落盘/入日志、错误信息泄露、生产响应头与 _headers 逐项实测一致、权限最小化写路径盘点（守卫绕过除外）、供应链（无运行时依赖、lockfile 与 pin 一致）。

## 五、修复批次分组（供修复期排期，标注依赖）

- **批 0 · Paprika 门禁真实性（任何启用动作的前置）**：F8-01（运行时身份口径与全名复核强制化）、F8-02（3 条重复条目映射处置 + 门禁加 rank/市值合理性校验）、F8-16（计数走定版接口）、F8-18（计数去重）、F8-21（门槛口径统一对账）、F8-20（runbook 同步）。
- **批 1 · KV 写守卫加固（应先于批 3 的 functions 改动）**：F8-03（可选链）、F8-33（多层/循环解构）、F8-34（Unicode 转义）、F8-35（扫描范围含 shared/）、F8-36（Reflect 检查项落点）、F8-37（eval 口径登记/验证）。
- **批 2 · 门禁与测试基础设施**：F8-04（冒烟链套件）、F8-27（manifest 识别口径）、F8-28（部署旁路豁口明示或拦截）、F8-29（校验脚本套件）、F8-30（audit-deps 动态读 pin）、F8-31（wrangler-pinned 失败分支用例）、F8-32（计数口径统一）。
- **批 3 · API 健壮性**：F8-09（L3 coverage 守恒）、F8-10（计数超时包裹）、F8-11（legacy 清洗对齐）、F8-12（count/returned 不变量）、F8-13（global 未来戳判定）。
- **批 4 · fetcher 记账与可观测**：F8-14（invalidFields 落点）、F8-15（paprikaGate 未测态表达）、F8-17（preflight 失败记账）。
- **批 5 · 前端**：F8-05（手机档排序按钮 44px）、F8-06（aria-live 重写节流，疑似先验证）、F8-07（选择器转义，疑似先构造验证）、F8-08（隐私页地标，疑似先验证）。
- **批 6 · 脚本运维**：F8-19（落盘保留权限）、F8-22（INVALID 日志失败口径）、F8-23（pin 回退警告与锁版入口）、F8-24（probe 日志失败检查）、F8-25（compare-shadow 状态码，疑似先验证）、F8-26（weekly UTC 口径，疑似先验证）。

依赖要点：批 0 完成前 Paprika 不得进入任何启用评估；批 1 应先于批 3 落地（functions 改动需在加固后的守卫下验证）；疑似 7 条（F8-06/07/08/18/25/26/37）修复前先按各自验证方法定性，再决定修法。
