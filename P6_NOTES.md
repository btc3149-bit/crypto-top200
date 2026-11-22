# P6_NOTES — 第六期批 5/6「测试补强与治理」施工记录（本分支 wt/p6-batch5-tests-gov）

施工员文件域：scripts/gen-paprika-map.mjs、scripts/verify-paprika-coverage.mjs、
scripts/decode-coins.mjs（新建）、tests/quota_check_test.py（新建）、
tests/compare-shadow.test.mjs（新建）、tests/contract-real-data.test.mjs（仅文件头注释）、
ops/testing/coverage-baseline.md、ops/security/security-baseline.md。
基线：master 6cb7122；施工前全量实跑 93 项全绿（Node 71 + Python 22，0 失败 0 跳过）。

---

## F6-77（verify-paprika-coverage 天数写死 + 门槛不落退出码）→ 已修

- 天数：新增 `resolveDay()`——优先 `--day N` 参数；未给时按 `docs/` 下已有
  `paprika-coverage-<日期>.md` 文件数 +1 推导。标题与文末说明均改用该变量，
  不再有「第 1 天」字面量。
- 退出码与机器可读结论：报告**首行**恒输出
  `RESULT: PASS|WARN|FAIL hits=<n> required=195 enableGate=197 day=<d>`；
  hits<195（禁止启用）时 `process.exitCode = 1`；195–196 黄区为 `RESULT: WARN`、
  退出码仍 0（定版口径为「须站长知情确认」，非硬失败）；≥197 为 PASS。
- 未实跑全脚本（其执行含 Paprika tickers 与线上 /api/board 两次外呼，本批纪律
  从严只做代码审查 + `node --check` 通过）；day 推导按现存报告数核对：docs 下现有
  1 份（2026-11-10），默认推导为第 2 天，与连测语义一致。

## F6-78（gen-paprika-map 子串包含易误配，疑似）→ 已核实 + 已修

核实（纯本地分析既有产物，未发任何请求；/tmp/paprika-candidates.json 不在仓内，
以仓内现行 candidates 输出 docs/paprika-map-review.csv 为据）：

- 中置信共 27 行。其中 slugPart 长度 <4 的仅 2 行：`sun-token→sun-sun`（slugPart
  「sun」，长 3）、`htx-dao→htx-htx`（slugPart「htx」，长 3）。逐一核对身份：
  两行候选均为本币正确映射（且与 docs/paprika-mapping-proposal.json 的人工核定
  paprikaId 逐字一致）→ **抽查误配率 0/2 = 0%**。
- 扩展核查全部 27 行中置信：与提案核定值逐一比对，误配 0 行。即疑似条目所述
  误配在现行数据中**未实际发生**；但机制风险属实（短串 `includes` 双向包含无
  任何下限，如未来出现长 2–3 的 id/slugPart 极易串配），按报告建议修复。
- 修复：全等分支不变；子串包含分支加两道门——①较短一侧长度 ≥5；②name slug
  前缀一致（slugPart 与 slugify(name) 一方为另一方前缀，或首 token 相同）。
- 修复影响（以现行 review 表回放新逻辑）：27 行中置信保留 20 行、7 行降为无候选：
  长度门挡下 aero / sun-token / rain / htx-dao（较短侧为 4/3/4/3），前缀门挡下
  syrup（改名 Maple）、world-liberty-financial（official- 前缀）、elrond-erd-2
  （改名 MultiversX）。**如实记录代价**：这 7 行原候选事后核定均为真配，新规则
  是以召回换精度——降级行变为「无候选」交人工另行查找，不会再产生可能误导
  核定者的假中置信行；候选表本就禁止全自动采信，此取舍与报告建议一致。
  下次重跑 gen 脚本时 review 表会按新规则变化（本批未重跑：该脚本会覆写
  docs/paprika-map-review.csv——不在本施工员文件域内，且需 1 次 Paprika 外呼）。

## F6-71（JS 侧）→ 已修（本文件域内部分）

- 新建 `scripts/decode-coins.mjs` 为 JS 侧单一实现：rows 行长必须恰等于
  meta.fields 长度，否则抛错（注明行号与两侧长度），不再短行补 undefined /
  长行静默丢值。gen-paprika-map.mjs、verify-paprika-coverage.mjs 已删除各自
  本地副本、改 import 该模块。
- 自测（一次性内联脚本，未落盘为套件）：coins 直通、rows 正常解码、短行抛错、
  长行抛错、无 fields 返回 []、真实 data/coins.json 解码 200 行，全过。
- **文件域外待协调人处理**：public/index.html（decodeCoinsData）与 tests/ 内
  （contract-real-data.test.mjs 的 decodeDoc 等）仍有各自解码副本，未收敛到
  本模块；Python 侧 check_meta.decode_coins 的 zip 静默截断断言亦不在本域
  （报告修复建议含该项）。如需全仓收敛，请另行派工。

## F6-16（quota-check / compare-shadow 判级零测试）→ 已建套件（quota 一套待批 0 合并转绿）

### compare-shadow：新建 tests/compare-shadow.test.mjs，6/6 全绿（本批实跑）

- 调研结论：脚本无导出（顶层脚本、无可 import 的 verdict 纯函数），但原生
  支持纯文件 fixture 输入（--shadow / --health / --live-file），故以子进程
  驱动真实脚本、断言 stdout JSON 的 verdict 与退出码，无需改脚本本体、无缺口。
- 覆盖：pass（同 run 对齐，退出 0）/ conditional 两条不对齐分支（runId 不一致、
  live 无 fetchRunId 的 legacy 形态，均退出 2）/ fail 三条（价差中位数超限、
  compared 低于下限 188、shadow 行 price=null 触字段门禁，均退出 1）。

### quota-check：新建 tests/quota_check_test.py，按 F6-07 新口径写，当前 3 PASS / 2 FAIL

- 风格仿 weekly_check_test.py：import 脚本模块后 stub read_health（不走
  wrangler/KV）、LOG_PATH 指临时文件、datetime 冻结 2026-11-15T12:00Z
  （days_remaining=15.5），合成 health 覆盖 OK/WATCH/WARNING/CRITICAL 四档
  期望 verdict 与退出码，另加「缺 creditsUsedEst → 退出 3」口径无关用例。
- 用例按**报告期望的新口径**写：G3/kv 模式 legacy=0，向前日耗只认 fetcher
  192/天，旧规划口径（legacy 576/天）场景不参与判级。
- **当前实跑结果（本分支，批 0 未合并）**：`python3 tests/quota_check_test.py`
  → 3 PASS / 2 FAIL，退出 1。红的两例：①used=1000 期望 OK(0)、现状 WARNING(1)；
  ②used=4500 期望 WATCH(0)、现状 WARNING(1)——均因现行脚本仍以 legacy 576
  规划口径判级。③④⑤在新旧口径下结论恰一致、当前即绿。
- **需协调人跟进**：批 0 的 F6-07 修复（quota-check.py 本体改 kv 口径）合并后，
  本套件应 5/5 转绿、退出 0；合并时请重跑确认，若届时仍红则为批 0 口径与
  用例期望不一致，须回查而非改用例迁就。本批未为迁就旧口径改任何期望值，
  也未改 quota-check.py 本体（他人文件域）。

## F6-79（文档澄清部分）→ 已办

- tests/contract-real-data.test.mjs 仅在文件头新增注释段，明确区分：
  (1) 静态产物契约（coins.json / FIELDS23 / dataHash 口径 A，本文件守护，
  定义源 scripts/build.py）；(2) KV blob 契约（shared/board-schema.js 的
  SCHEMA_VERSION / validateBlob，守护套件 board-fetcher / board-v2）。
  并注明「改 board-schema 时本套件不会红属预期」。未做任何结构性改动；
  FIELDS23 单一来源化（board-v2 侧对账）由他人负责，不在本域。

## F6-81（文档部分）→ 已办

- ops/testing/coverage-baseline.md：文首加「2026-11-23 第六期施工中更新」注，
  声明最终计数以集成后全量为准；「读数说明」末尾加实跑更正段——2026-11-23
  在 master 6cb7122 上重跑全部 9 套件：93 项全绿、0 失败、0 跳过；frontend-dom
  退出码现为 0（6/6 PASS，不再是「预期红」/退出码 1）；contract-real-data
  默认模式 6 PASS / 0 SKIP（rows 段已常驻，不再有 PENDING-W322 跳过）。
- 文件域外待协调人处理：frontend-dom.test.mjs 文件头/标题/尾注自身的「预期红」
  文案不在本施工员文件域内，本批未改，请派其文件域负责人删除。

## F6-92（治理登记部分）→ 已办

- ops/security/security-baseline.md 新增 §5.1/§5.2：登记「Pages 侧 BOARD_KV
  绑定为平台读写权限、只读靠代码自律」为已知权限面（非现行漏洞；本批实查
  functions/ 下 BOARD_KV.put/delete 命中 0）；「functions/ 不得出现
  BOARD_KV.put/delete」已写入 §5.2 代码评审硬性检查项清单，并注明由
  tests/kv-write-guard.test.mjs 契约测试守护（他人在建，本批未建该文件）。

## F6-94（SFS 影子模式复核点）→ 已办（仅登记，未改 board.js）

- ops/security/security-baseline.md 新增 §5.3：为 ENFORCE_SFS=false 影子模式
  设明确复核点——下次季度自查必须二选一并留痕：置 true 转正式，或在该节
  正式销项接受现状并记理由（含「未来给 board 加 ACAO:* 时销项自动失效」
  的再评估触发条件）。未做二选一前条目保持「未决」。

## F6-89（SRI 登记确认）→ 已办（无代码改动）

- 复核确认：HTML/源码中无 integrity 属性（全仓 grep 命中仅 package-lock.json
  的 npm 哈希字段与评审文档本身，与 SRI 无关）；与基线 135/A+、唯一未过项
  SRI −5 一致。已在 security-baseline.md §5.4 标注「维持 W5 增补包既有处置
  路径，本期不重复施工」。

## F6-10 / F6-53（批 5 落库评估）→ 评估结论：不落库，列为遗留项

核实（纯本地读产物，零外呼）：

- docs/paprika-mapping-proposal.json 自述非空 196/200 与实数一致（逐条复点：
  非空 196、为 null 的 4 个为 hash-2、celium、genius-3、nxm）；距启用门槛
  197 差 **1** 个。
- 但落库 ≠ 可启用：docs/paprika-coverage-2026-11-10.md 实测 tickers 命中仅
  **179/200**（17 个已映射币不在免费层 tickers 内），距 verify 门槛 195 尚差
  16——即使 196 全数落库，verify-paprika-coverage 连测也无法达标，F6-10 的
  「落库 + 门禁 + 连测达标」三件缺一不可，目前第三件与数据现状不符。
- F6-53 附带核实（纯代码分析，未消耗额度复测）：verify 脚本与 coinpaprika.js
  的 tickers 请求均无 limit/分页参数、rank 直接透传 Paprika 自家排名，与 CG
  market_cap_rank 语义差异未经再核——疑似维持未核实状态，须与落库立项一并
  以单次免费 GET 核对返回条数与尾部映射币在否。

落库影响面评估（把 paprikaId 写进 coins.json）：

- coins.json 的字段集即 FIELDS23（恰 23 字段）；新增 paprikaId 是 **FIELDS24
  字段规范变更**，不是机械写入。触及至少 6 处：①scripts/build.py（FIELDS23
  定义与 emit 编码）；②scripts/check_meta.py（字段集校验口径）；③public/
  index.html（decodeCoinsData 按 meta.fields 解码，字段表变化须同步验收）；
  ④functions/api/board.js（getIds 同口径解码）；⑤两份契约测试各自硬编码的
  FIELDS23 副本（contract-real-data、board-v2，与 F6-79 的单一来源化未收口
  叠加）；⑥dataHash 口径 A——哈希对象为解码后规范对象数组，每币多一字段
  即全量哈希值变更，须重算并核对所有引用该值的门禁/记录。
- 另有落点之争：fetcher 实际消费的是 workers/fetcher/src/coins-list.js 的
  COINS 名单（现 paprikaId 非空 0/200），与 coins.json 是两份数据源；只改
  coins.json 并不能让备源可用，落点与同步机制本身就是设计决策。

**结论与建议**：列为**遗留项**，不在本批落库。理由：跨 6+ 组件的字段规范
变更 + 落点设计决策 + 启用门槛（映射 196<197、tickers 命中 179<195）双双
未达，落库后备源仍不可启用，收益为零而回归面覆盖全部契约套件。
后续立项要点：①先定 paprikaId 落点（coins-list.js 为 fetcher 事实源，
coins.json 侧是否同步另议）与 FIELDS 规范变更流程（与 F6-79 单一来源化
同批做）；②补齐第 197 个映射并对 17 个 tickers 缺失币逐一归因（下线/改名/
免费层上限，联动 F6-53 的 limit 与 rank 口径核对）；③落库后跑
verify-paprika-coverage 连测 3 天（本批 F6-77 已备 --day/退出码/RESULT 行）；
④在 resolveProvider 加映射非空数门禁（他人文件域）后才谈启用。

---

## 本批测试总账（2026-11-23 实跑）

- 既有 9 套件：93 项全绿（未被本批改动打红；contract-real-data 仅文件头注释，
  重跑仍 6 PASS）。
- 新增 tests/compare-shadow.test.mjs：6 PASS / 0 FAIL，退出 0。
- 新增 tests/quota_check_test.py：3 PASS / 2 FAIL，退出 1（预期内，待批 0
  合并 F6-07 后转绿，见 F6-16 条）。
- 其余改动均为脚本逻辑（F6-77/78/71）与文档，无对应既有套件覆盖；脚本以
  `node --check` + 内联断言自测验证（见 F6-71 条）。
