# CONSTRUCTION_PHASE7 — 第七期评审修复施工记录（2026-11-23）

依据：PHASE7_REVIEW.md（57 条：P0 0 / P1 7 / P2 50；确认 49 / 疑似 8）。
组织：6 个 worktree 并行施工（批 0 数据/Paprika、批 1 守卫与测试、批 2 API/fetcher、
批 4 脚本工具、批 3 前端 + 批 5 文档、批 6 安全治理），协调人集成、部署与验收。
各组原始记录见 P7_NOTES_*.md（已随各批 commit 并入主干）。

## 总账（57 条）

- **已修 57 条 / 证伪 0 条 / 遗留 0 条**
- 其中 F7-46 口径单列说明：npm audit 路径在本环境因注册表策略 403 不可复现
  （环境限制，已如实登记于 security-baseline §5.5，不冒充已审计）；本期已按
  报告验证方法换用可复现的 OSV 路径完成真实审计（91 包、0 漏洞，见批 6 该条），
  故计为已修。
- 疑似 8 条全部按报告验证方法核实，**8 条全部确认成立并修复**：
  F7-13（missingIds 非数组产出矛盾 coverage，构造 blob 实测复现）、
  F7-17（build.py 单行切分在「分号后无换行」形态抛 JSONDecodeError）、
  F7-18（同 symbol+同名多 id 共 118 组，本表涉及 3 组且现映射均为 rank 最优、无错配；
  生成器已改活跃/rank 优先 + 歧义标记，机制风险消除）、
  F7-27（probe.sh/check-shadow/quota 三处 +1h 未来时间戳改前全部假绿）、
  F7-28（HC4/quota 两条 cron delivery 为空属实，已补齐投递并验证，见集成节）、
  F7-38（第 50 行 symbol=数字复现 TypeError）、
  F7-44（stub KV 实测 /run 节流读失败 fail-open 属实）、
  F7-52③（键集口径漂移属实：KV_KEYS 现 7 键，runbook 已按代码证据同步，
  prev 实际写入未做 KV 直读核验、文档按谨慎口径表述）。

## 部署

- Fetcher Worker：Version `7c0971a6-7100-422e-99cd-20eae0ed86c2`（wrangler deploy，2026-11-23）
- Pages production：部署 `17e3be31-a11d-44ed-8870-cd649789ba84`（上一部署 eba9cb0d）。
  首次部署被本期新加的 F7-47 report-only 门禁拦下（产物需按合并后 index.html 再生），
  按门禁提示再生后第二次部署全门禁一次通过；HC2 已报 success。
- 无回滚（部署后验证全过，见文末）。

## 逐条处置

### 批 0 · 数据正确性（wt/p7-data）

- F7-01 已修：三条错配改正确值（pump-fun→pump-pumpfun、sky→sky-sky、seeker→skr-seeker），
  以 coins-list.js 为唯一源结构化同步三份 coins.json（每份恰改 3 条、dataHash 按口径 A 重算、
  三份逐字节一致、check_meta 8/8）。新脚本 scripts/verify-paprika-identity.mjs +
  shared/paprika-identity.js（symbol 全等 + 规范化 name/显式别名）对 38 条 symbol-only
  accept 全量复核：其余 35 条为同资产异名变体、身份成立，无新增留空。
  **修正后实测（2026-11-23）：mapped=196、identityValid=196、activeUsable=195
  （yzy 已下线不计）、tickerHit=179**（两个独立脚本复跑同得 179）。
  附带发现（留档未改）：cosmos/litecoin 现映射为同资产重复条目、另有 rank 更优主条目，
  建议后续单独定夺。
- F7-02 已修：source-state.js 新增纯函数 evaluatePaprikaGate——mapped / identityValid /
  activeUsable / tickerHit 四项均须 ≥94%（188/200），旧「非空 ≥197」降为历史口径；
  主流程仅在 Paprika 候选 run 做 preflight（本地计数已不达标时零 Paprika 调用），
  不过即同 run 强制 CG；四项计数分开落 health.paprikaGate。生产 PAPRIKA_ENABLED="false"
  未动，tickerHit 179<188，**Paprika 保持关闭**；CG 正常路径零额外调用（用例断言）。
- F7-14 已修：verify-paprika-coverage.mjs 加 limit=5000、命中须报价有效，
  输出 mapped/present/validQuoteHit/presentInvalidQuote/missing 分项（实跑 hits=179）。
- F7-15 已修：board-schema 新增 signed/rank 清洗器，Paprika 与 CG 两路对齐清洗
  price/mcap/volume/change/rank，坏值置 null 并计 invalidFields，validateBlob 补 change/rank 门禁。
- F7-16 已修：fetcher wrangler.toml 与 coins-list.js 头注释改为现行形态。
- F7-18 疑似→确认（机制风险）→已修：见总账疑似节；gen-paprika-map 改活跃优先 + rank 优先，
  同名多条标记 ambiguousNameGroup 降置信交人工、并列最优不给候选。
- F7-05 已修（随批 0 提前）：fetcher README 顶部重写为 G3 现状与事故处置要点，
  G0/G1 内容移入明确标注失效的历史专节，并补「--emit 不重同步 paprikaId」注意事项。

### 批 1 · 守卫与门禁（wt/p7-guard）

- F7-03 已修：新写 token 级扫描器 tests/helpers/kv-guard-scan.mjs（零新依赖）：
  来源追踪迭代至不动点，识别直接/链式别名、解构（含重命名）、计算属性、方法别名等写法，
  接收者来源不可判定一律 fail-closed；批准写五项精确核准（board.js + addLegacyCredits
  函数体内 + env.BOARD_KV.put + KV_KEYS.legacyCredits + 恰 1 处）。11 个负向 fixture
  逐一被拦、3 个正向放行，套件 15/15。
- F7-04 已修：smoke.sh 加 [production|preview] 模式（preview 只跑静态/安全头子集、
  board 断言整组 SKIP）；deploy.sh preview 不再发 HC2 success/fail。实测 preview 址
  preview 模式 exit 0（原 5 项 FAIL 消除）、生产址全量 8 项 PASS。
- F7-06 已修：compare-shadow 测试 6→13 例（same-source 两形、runGate、live null
  1/2 上限与 3 个 fail）；变异验证：删 sameSource 上限即 2 红。
- F7-07 已修：quota_check 测试 6→22 例（月份不符、陈旧/边界、非 kv 两形、
  legacyMeasured 缺失/跨月/畸形 5 形）；其中 ⑩⑭ 两例原锁定旧缺陷现状，
  集成时已按 F7-27/F7-25 的脚本修复翻转期望（见集成节）。
- F7-29 已修：shared/board-schema 新增 isValidPaprikaId/countValidPaprikaMappings；
  contract 新增 R4/R5/R6（行长 23/25 解码 throw、getIds 只取 id 列、paprikaId
  数字/对象/空串门禁判畸形不计数），真实数据合法映射恰 196 对账。
- F7-30 已修：legacy-credits 测试补 markets 失败仍计、熔断不计、dual 计、
  旧键字符串/JSON 损坏回退等（与批 2 合并后共 14 例，见集成节）。
- F7-31 已修：命中域测试改为微型 CSSOM 级联计算断言（position:relative、::after
  几何、粗指针级联、星标不侵入定版）；集成时另修其 px 解析不接受无单位 0 的
  潜伏缺陷（该断言此前被场景 A 先行失败掩盖）。
- F7-32 已修：tests/suites-manifest.json 单一事实源（run-tests.sh 与
  coverage-report.mjs 共用），新增 suite-manifest 一致性套件；coverage 的
  Python 清单已含 quota_check_test.py。
- F7-26 已修：coverage-report 默认 fail-closed，--report-only 才只报告；
  注入必红套件实证默认 exit 1 / report-only exit 0。

### 批 2 · API 与 fetcher 健壮性（wt/p7-api）

- F7-08 已修：health 新增 coins 本体校验——board.coins 实际键数须与
  coverage.returned、count 三方守恒，缺失/空/不等一律 503 board_coins_mismatch
  （响应带 coinsCount，线上已实测在位）；health 测试 boardBody 改为生成守恒
  coins 并新增 3 例假汇总用例，套件 12→15。
- F7-09 已修：onRequestHead 先过 sfsShadowCheck 再 dispatchGet；HEAD 与 GET
  回源与计数口径一致；新增 HEAD sfs 与 HEAD legacy 计数用例。
- F7-10 已修：计数点移到两个上游请求已发出之后（与在途重叠，不再串行前置），
  「发出后、发请求前终止」的多计缝消除；未用 waitUntil 的理由已记 notes。
- F7-11 已修：prev.credits 有限非负钳制（≤1,000,000），负数/异常大/非数一律
  base=0 自愈并记 warn 日志；三坏值实测自愈。
- F7-42 已修：60 秒写节流 + pending 累积 flush（节流直测：首写 2、间隔内不写、
  +61s 后 flush 至 6），回滚形态下计数 KV 写频受限、总量近似不丢。
- F7-12 已修：未知/缺失模式 fail-closed 改 503 + error:"board_mode_unknown"；
  合法 kv 无 blob snapshot 仍 200 不误伤。
- F7-13 疑似→确认→已修：assemble 层对 missingIds 非数组重算守恒
  （expected=returned=在场数、missingIds=[]、记 error 日志），不产出矛盾 coverage。
- F7-43（board 部分）已修：getIds 改走 fetchWithTimeout（3.5s），新增挂起超时回退用例；
  前端部分见批 3。
- F7-44 疑似→确认→已修：/run 节流读 health 抛错改 fail-closed（503
  throttle_check_failed、不触发抓取；键缺失照常放行）；拒绝回写改专用节流键
  v1:meta:manual-run-throttle + 重读最新 health 只合并单字段，消除整对象覆盖竞态；
  fetcher-branches 新增 23a/23b，套件 40→42。

### 批 3 · 前端（wt/p7-frontdocs）

- F7-34 已修：.exp::after 改 inset:-8px -4px -8px -8px——右扩 4px 恰填
  margin-right 间隙、止于星标左缘，不再蚀星标；有效命中域 40×44（纵向维持 44；
  横向 44 在不侵星标/不改布局约束下不可达，40 为最大值，几何已写入注释）。
- F7-35 已修：† 按钮加 ::after{inset:-16px -12px} 透明扩展，有效约 33×45px，
  视觉字形/行高/布局零变化。
- F7-36 已修：粗指针档（≥641）追加 .th-sort{min-height:44px}。
- F7-37 已修：≤640 删除 #thRank clip 隐藏、改 10px 折行可见；五列重定宽
  34+98+64+62+68=326px ≤330（360 视口一屏可见，390 亦验证）；内边距与冻结列
  left 同步；隐藏列与 col 同步原则未动。几何以 CSS 算术 + 测试断言验证，
  建议真机复测（见 notes）。
- F7-38 疑似→确认→已修：decodeCoinsData 全行校验（coingeckoId/symbol/estRank，
  任一不合整表 throw 走快照兜底）+ parseHashTarget/syncHashForExpand 类型守卫
  + cmpRankTie 经 num() 归一不产 NaN；修前复现脚本修后改为 decode 直接 throw。
- F7-39 已修：页脚与隐私页删除「120 秒」文案，改现行事实（fetcher 约每 10 分钟
  抓取写缓存、本站只读 KV 组装），线上已实测。
- F7-40 已修：首页页脚加 /privacy 链接（线上已实测）；隐私页自选披露改已上线
  定版口径（键名 top200.watchlist.v1），删除待复核注释，最后更新改 2026-11-23。
- F7-41 已修：sitemap 两条 lastmod → 2026-11-23（线上已实测）；自动化方案只记 notes。
- F7-43（前端部分）已修：init 的 data/coins.json fetch 加 10 秒 AbortController
  + res.ok 检查，失败仍走快照兜底。

### 批 4 · 脚本与运维工具（wt/p7-scripts）

- F7-17 疑似→确认→已修：build.py 新增 extract_js_array（括号匹配、字符串感知）
  替代单行切分；新套件 tests/build_paprika_map_test.py 6 项全过。
- F7-19 已修：rollback.sh 删除 ACCOUNT_ID 字面量默认值（grep 清零），缺失时
  退出 3 fail-closed（--help 不受影响）；usage 示例补 ROLLBACK_MODE_API_ONLY=1
  （production 另补 ALLOW_PROD_MODE_ROLLBACK=1）；实测无 env 均 exit 3、不发调用。
- F7-20 已修：deploy_log 双写脱敏审计 ops/deploy-audit.jsonl（长 hex/键值打码、
  截断 200 字、无秘密），.gitignore 加例外（check-ignore 实测不忽略、git add 可行）；
  每次留痕及部署收尾均提示 commit 审计文件。本次部署的审计条目已随本记录一并 commit。
- F7-21 已修：probe.mjs 先判 HTTP 状态、非 2xx 即 FAIL/exit 1 且错误体不判读，
  输出加 httpStatus；改前 mock 503 实测判 PASS、改后 FAIL。新套件
  tests/probe-http-status.test.mjs 3 项全过（集成时按套件命名口径由
  probe_http_status_test.mjs 改名，见集成节）。
- F7-22 已修：weekly 新增 exit_code_for——run_void 恒 2 优先；
  missing_rows/cand_in/cand_out/due/queue/report_url_warn/incomplete 任一 → 1。
- F7-23 已修：weekly 写序改报告原子落盘成功后才写 state；报告/state 均
  tmp+os.replace；报告失败退出 3 不推进；state 损坏经 load_state/StateError
  退出 3（端到端实测无 traceback、无报告产出）。weekly 套件 14→18。
- F7-24 已修：build.py 落盘改 _stage_and_land 事务化（同目录暂存 + 备份，
  失败回滚已替换目标）；--emit 实跑四目标哈希一致、与改前逐字节相同。
- F7-25 已修：quota-check 新增 build_legacy_measured——跨月/陈旧/畸形/无键时
  credits/month/updatedAt 全置空、available=false 带 reason；cron 本体侧由
  协调人同步补 legacyMeasured 汇报口径（见集成节）。
- F7-27 疑似→确认→已修：probe.sh、check-shadow-health（抽 judge()）、
  quota-check（抽 health_stale_reasons()）统一容差 300s 双侧判定；
  +1h fixture 三处改前假绿、改后均判异常。新套件 tests/time_tolerance_test.py 全过。
- F7-28 疑似→确认→已修：仓库内无 cron 配置副本（全仓检索无命中）；协调人用
  cron 工具实读三条 job——HC4 与 quota 的 delivery 原为空数组属实，已补齐为
  与 HC1 相同的用户主会话目标并回读验证；quota 本体另按 F7-25 建议补
  legacyMeasured 五字段汇报规则（见集成节）。

### 批 5 · 文档同步（wt/p7-frontdocs）

- F7-48 已修：台账/legacy counter 文档删除「尚未部署」现行误述并标注历史段
  （已随 Pages 部署 eba9cb0d 生效）。
- F7-49 已修：security-baseline §5.1/§5.2 登记 W5 唯一批准 put 例外与
  kv-write-guard 口径。
- F7-50 已修：security-baseline §3.3 Observatory 未过项统一为 §5.4 的 SRI 定版口径。
- F7-51 已修：Pages wrangler.toml 两处注释改 fail-closed 现行口径。
- F7-52 已修（含③疑似→确认）：fetcher-runbook 三处同步（写例外、实测计数优先、
  键集 7 键；prev 按代码证据谨慎表述，未做 KV 直读核验）。
- F7-53 已修：oncall-handbook 以 kv 现行形态起头并补 HC4 入口。
- F7-54 已修：probe-config 更新 HC4 生产数据链口径与核对范围。
- F7-55 已修：README deploy 流程按现行门禁重写（测试→脏区→模式→工具链→数据
  →_headers→部署→smoke/smoke-headers）与绕过留痕口径（DEPLOY_SKIP_REASON +
  deploy-log），删除删除条件早已满足的旧现状注记。
- F7-56 已修：quota/contract 测试文件头与 paprika 落库记录按主干 15 套件/178 项
  （2026-11-23 时点）对齐，NULLABLE 分布以脚本实数重新对账。
- F7-57 已修：public/_headers 与 ops/headers/_headers.tmpl 注释改 shared/http.js
  单一定义（_headers 已随集成再生，见集成节）。

### 批 6 · 安全治理（wt/p7-security）

- F7-45 已修：新增统一锁版入口 scripts/wrangler-pinned.sh（从 package.json 读 pin、
  校验 lockfile、本地二进制优先、否则 npx 锁版回退、参数透传）；README、
  rotation-playbook、fetcher-runbook、季度清单 Q5、deploy.sh 部署步均改走该入口；
  fetcher README 的命令形态由协调人在集成时按替换表补齐（见集成节）。
  新套件 tests/wrangler-pinned.test.mjs 4/4，真二进制 --version 实测 4.159.0。
- F7-46 已修（换可复现路径完成审计；npm audit 环境限制如实登记）：
  npm audit 实测 403 policy_denied、osv-scanner 未安装；新增 scripts/audit-deps.mjs
  （从 package-lock 枚举、OSV querybatch + vulns 明细、退出码 2 明示未审计）。
  安全组首轮 OSV 外呼因审批超时未完成，协调人集成阶段重试获批并实跑成功：
  **2026-11-23T05:11Z，91 个包、漏洞 0 条、退出码 0**，报告落盘
  ops/security/audit-deps-2026-11-23.json，security-baseline §5.5 已回填
  当期结论（禁止再沿用第六期数字）。新套件 tests/audit-deps.test.mjs 4/4。
- F7-47 已修：gen-headers --report-only 强制显式 --variant（未传退出 2）、
  --check 提示按上下文修正；产物按 WA-ON 现行口径重新生成；deploy.sh 新增
  (b2b) 门禁每次部署校验（本次部署首轮即被该门禁拦下并按提示再生后通过，
  见部署节）。

## 集成事项（协调人）

- 六分支合并冲突 3 处，均已逐项裁决：tests/legacy-credits.test.mjs（批 1 与批 2
  用例合并为 14 例全集）、tests/frontend-dom.test.mjs ⑰（取批 1 的 CSSOM 计算版，
  批 3 的 ⑲ 断言保留）、scripts/run-tests.sh（取批 1 的 manifest 版，
  批 6 的两支新套件改登记进 manifest）。
- 新套件统一登记：manifest 由 16 增至 **22 套件**（新增 paprika-gate、
  wrangler-pinned、audit-deps、probe-http-status、build_paprika_map、
  time_tolerance）；scripts 组的 probe_http_status_test.mjs 按套件发现口径
  （*.test.mjs）改名为 probe-http-status.test.mjs。
- quota 用例期望翻转：批 1 的 ⑩（未来时间戳）与 ⑭（跨月 credits）在批 4
  脚本修复后按新行为改期望（INVALID/退出 3；credits/month 置空），22/22 全绿。
- fetcher README 锁版命令按批 6 替换表补齐（secret put 行注明锁版入口）。
- index.html 有变：已跑 gen-headers --variant=on 再生 public/_headers 并 --check 通过；
  report-only 产物在首次部署被 (b2b) 门禁拦下后按提示再生并 commit。
- cron 平台侧（F7-25/F7-28）：top200-hc4-shadow-probe 与 top200-quota-daily-check
  的 delivery 由空数组补齐为用户主会话（与 HC1 同目标），cron.view 回读验证在位；
  quota 本体已补 legacyMeasured 汇报规则（available=true 报实测五字段，
  =false 明示不可用原因、不得以建模值替代）。
- 各组 P7_NOTES_*.md 已随合并入主干备查。

## 测试总账

- 修复前基线：15 套件 / 178 项。
- 修复后：**22 套件 / 273 项全绿**（bash scripts/run-tests.sh 主干实跑 rc=0；
  逐套件：board 15、board-v2 22、board-fetcher 15、fetcher-branches 42、
  frontend-dom 20、contract-real-data 11、snapshot-verify 5、health 15、
  kv-write-guard 15、legacy-credits 14、coins-list-contract 5、compare-shadow 13、
  suite-manifest 3、test_render_snapshot 8、weekly_check 18、quota_check 22、
  paprika-gate 9、wrangler-pinned 4、audit-deps 4、probe-http-status 3、
  build_paprika_map 6、time_tolerance 4）。
- 部署时 deploy.sh 门禁内 npm test 再次全绿。

## 部署后验证（全部实测，2026-11-23）

- /api/health：ok=true、coverage 200/200、count=200、**coinsCount=200**（F7-08 新字段在位）。
- /api/board：契约 v2、servedFrom=kv、source=coingecko、stale=false、coverage 200/200、missingIds=[]。
- KV health（API 只读）：status=ok、consecutiveFailures=0、paprikaMappedCount=196
  （与修正后本地数据一致）；fetcher 新代码部署后 cron 正常出 run。
- 线上 data/coins.json：pump-pumpfun / sky-sky / skr-seeker 各命中 1 次，
  旧错配值 pump-pumpbtc / sky-skycoin / skr-saakuru-labs 命中 0。
- compare-shadow（新口径）：mode=same-source、verdict=conditional、
  verdictCaps 含 same-source 上限标注——同源自比如实降级，非假 pass。
- quota-check 实跑：verdict=OK、规划口径投影 4057.1、legacyMeasured available=false（kv 常态）。
- probe/deploy 冒烟：deploy.sh 内 smoke + smoke-headers 全过、probe verdict=pass。
- UptimeRobot M1–M4（804645009/804645065/804645066/804645067）：全部 status=2（up）。
- 用户可见项线上实测：页脚新文案（约每 10 分钟抓取）在位、页脚 /privacy 链接在位、
  sitemap lastmod=2026-11-23（两条）。
- Paprika：PAPRIKA_ENABLED="false"（fetcher 部署绑定实测）、tickerHit 179<188，
  门禁保持关闭、线上 source=coingecko。

## 用户可见修复清单

- F7-34 桌面端展开按钮 ::after 不再侵入星标左缘（点星标左缘不再误展开详情）。
- F7-35 ATH「†」按钮有效命中域由约 7×10px 扩至约 33×45px。
- F7-36 粗指针设备上排序表头按钮高度 36px → 44px。
- F7-37 手机 ≤640：首列表头文字可见；五列总宽 384px → 326px，360px 屏一屏可见、不再横溢截断倍数列。
- F7-39 页脚/隐私页数据更新文案改现行事实（不再宣称每 120 秒更新）。
- F7-40 首页页脚新增隐私说明链接；隐私页自选披露改已上线口径并更新日期。
- F7-41 sitemap lastmod 更新为 2026-11-23。
- （内部可见）F7-04 preview 部署不再误报冒烟失败/误发 HC2 fail；F7-28 两条监控
  cron 的失败汇总投递已补齐；F7-25 quota 日报将单列 legacyMeasured 实测通道。
