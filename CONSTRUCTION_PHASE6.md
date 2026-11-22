# CONSTRUCTION_PHASE6 — 第六期评审修复施工记录（2026-11-23）

依据：PHASE6_REVIEW.md（94 条：P0 1 / P1 18 / P2 75；确认 76 / 疑似 18）。
组织：5 个 worktree 并行施工（批 0+4 脚本、批 1+7 API、批 2 前端、批 3 Fetcher、批 5 工具+批 6 测试+治理），
协调人集成、部署与验收。各组原始记录见 git 历史中五份 P6_NOTES.md（已并入本文后移除）。

## 总账（94 条）

- **已修 89 条**
- **证伪 2 条**（疑似所述问题在现行数据中未实际发生，但机制风险属实、已加固防御）：F6-75、F6-78
- **遗留 3 条**：F6-10（映射落库部分；启用门禁已修）、F6-36、F6-89
- 疑似 18 条全部按报告验证方法核实：确认后修复 15 条（F6-23、29、35、38、40、41、48、53、59、68、82、85、90、91 及 F6-16 所涉口径），未发现现存实例 2 条（F6-75、F6-78），余 1 条随所属条目处置（F6-44 schema 对齐为跨组确认项）。

## 部署

- Fetcher Worker：Version `d8efdb0e-ffbe-4cb5-b481-8d69bf7d3415`（wrangler deploy，2026-11-22T23:47Z）
- Pages production：部署 `33163028-231f-47de-af42-1b4c0ac21c13`（2026-11-22T23:49:47Z，success；上一部署 760d8089）。经新 deploy.sh 全门禁（npm test + 模式门禁 + smoke + smoke-headers 子集）一次通过；HC2 已报 success。
- 无回滚（部署后验证全过，见文末）。

## 逐条处置

### 批 0 门禁与口径 + 批 4 脚本工具（wt/p6-batch0-scripts）

- F6-01已修：新建 scripts/run-tests.sh（SUITES 集中清单）+ package.json test；deploy.sh 部署前强制 npm test、去掉 --commit-dirty、脏树默认中止；一切绕过须 DEPLOY_SKIP_REASON 并落 ops/deploy-log.jsonl（无理由实测 rc=1 拒绝）。
- F6-80 已修：coverage-report 纳入 Python 两套件计数与退出码。
- F6-06 已修：deploy.sh 行首锚定解析 wrangler.toml [vars]（注释中先出现的 `[vars]` 字样坑），production≠kv 中止、可 override+留痕；smoke 断言⑦ servedFrom∈{kv,cache,memory}。
- F6-07已修：quota-check.py 识别 kv 形态（toml 优先、回退线上 servedFrom），判级取 legacy=0 口径，576/1152 降为参考列，护栏证伪时 verdictNote 旁注；scriptVersion="2.0-g3"。stub 实测同数据旧口径 WARNING→新口径 OK；上线后实跑 verdict=OK（见验收节）。
- F6-24 已修：health 月份不符或 lastRunAt >3h → 退出 3 并落 verdict=INVALID+staleHealth 记录（不落正常判级）。
- F6-25 已修：record 加 scriptVersion 与 methodology。
- F6-26 已修：DEPLOY_SKIP_META_CHECK 绕过统一走理由+落 log。
- F6-27 已修：smoke 断言⑧ v2 契约字段；deploy.sh 在 smoke 后跑 smoke-headers 子集（S1,S2,S4,S6）并落 log。
- F6-09 已修：weekly top250 拉取失败/为空 → 本轮作废（不覆写 watch、不推进 lastRunWeek、退出 2），monkeypatch 实跑验证。
- F6-72 已修：ids 返回行数 <180 判 incomplete、不产出下架候选。
- F6-73 已修：weekly 退出码定版——作废=2、alerts>0 或 incomplete 非空=1、其余=0，脚本头注释写明。
- F6-69 已修：build.py 两条路径统一 emit_and_render（临时目录全成才落盘）；--emit 实跑三产物 sha256 逐字节不变。
- F6-70 已修：emit 前断言字段集恰=FIELDS23，落盘后复跑 check_meta。
- F6-71（Python 侧）已修：check_meta.decode_coins 行长断言抛 ValueError（JS 侧见批 5）。
- F6-74 已修：rollback.sh mode 子命令默认拒绝（rc=3），须 ROLLBACK_MODE_API_ONLY=1，输出首行声明「此操作不改变线上行为」。
- F6-75 证伪（未发现现存实例）+已加防御：只读核查 production 24 条 + preview 17 条部署 latest_stage 全部 success，现行无非 success 条目可误选（潜伏风险）；已加自动选择过滤 success + 打印目标 stage + --to 非 success 警告。
- F6-76 已修：scripts/archive/ 全部 6 个.py 加退役守卫，逐个实跑 rc=2。
- F6-28 已修：check-shadow-health.py 改 REPO_ROOT 拼路径 + subprocess cwd + pin 回退 WARN。
- F6-29 疑似→确认→已修：stub 复现旧脚本对无时区时间戳抛 TypeError 退出 1；修后 parse_iso 补 UTC、age 纳入 try。
- F6-87 已修：quota-check/check-shadow-health 的 CLOUDFLARE_ACCOUNT_ID 改必填、缺失 fail-closed（rc 3/2 实测）；NAMESPACE_ID 为 wrangler.toml 公开值，保留并注明。集成核查：两支脚本的编排 cron 本体原本即带该 env，无需补（见集成节）。
- F6-90 疑似→确认→已修：stub 复现旧脚本透传含 ID 的 stderr；修后只输出 rc+类别（auth/network/notfound/unknown），原文仅 DEBUG 打印且 32 位 hex 脱敏。compare 侧 fatal() 脱敏由批 1 完成。
- F6-37 已修：gen-headers --check 失败提示改带 --variant=on 完整命令；生成 public/_headers 未显式传 --variant 拒绝 rc=2。
- F6-88 已修：.gitignore 补.env/.env.*（保留!.env.example）、*.pem/*.key/*.p12。
- F6-93 已修：key-ledger 中 CoinGecko 账号邮箱改脱敏形态（仅域名+保险箱备注），key 名称保留。
- F6-86 已修（集成时全覆盖扫查发现五组均漏接，由协调人补修）：build.py 与 weekly_check.py 的 cg_headers 在 key 缺失时 fail-closed 抛错（weekly 侧经既有 try 路径走 incomplete/本轮作废）；确需匿名调试须显式 ALLOW_ANONYMOUS_CG=1，stderr 留痕、周检报告标注「匿名」；weekly 文件头「可为空=匿名」旧注释已改。三态（无 key/匿名开关/有 key）双脚本实测通过。

### 批 1 校验与假绿 + API 收尾（wt/p6-batch1-api）

- F6-02 已修：board-schema 新增 FIELD_LIMITS+sanitizeMarketNumber；normalizeCgMarkets 清洗并计数 invalidFields；validateBlob 新增 row_field_invalid 与 price_null_ratio 门禁（口径经集成对齐，见集成节）；board-fetcher 补 7 条负向用例。
- F6-52 已修：validateBlob 对 global 关键字段全 null 给 error 标记 `"global_all_null"`（ok=false）；fetcher 侧写前字段直查同口径拦截、沿用 prev global 及原 asOf（批 3），两端语义一致（集成核对 index.js 写路径：组装后 validateBlob 不过则不写）。
- F6-04 已修：assembleV2 按 coins 实际键集重算 coverage（不符记 coverage_recomputed 日志）；validateBlob 加 returned/missing 交叉校验；health 加 count===returned 断言。
- F6-05 已修：health 对 ageSec<−60 或 board 自报 clockSkew → 503 board_clock_skew；board freshness 暴露 clockSkew:true 且 level 封顶 L1。
- F6-03 已修：dispatch fail-closed——mode 缺失/未知 → snapshot v2 应答 + error 日志；legacy 无 key 禁匿名；health 加 contractVersion===2 断言。
- F6-08 已修：compare-shadow 同源检测（servedFrom∈{kv,memory} 且同 run，或 --shadow-key current）→ mode:"same-source"、verdict 永不许 pass；另输出 current vs prev 的 blobDiff 信息段（不进 verdict）；fatal() hex32 脱敏。
- F6-20 已修：runGate.met!==true 时 verdict 上限 conditional，与 F6-08/F6-21 取更严者、verdictCaps 列明。
- F6-21 已修：live 侧 null price/mcap 取大者 >2 → fail、1–2 压上限；compared 改含 null 配对的分母口径、另列 priceCompared。
- F6-22 已修：probe.mjs 对 v2 缺 freshness/staleAgeSec/fetch 任一 → FAIL rc=1 并列 missingFields（本地 mock 实测）。
- F6-23 已修：probe.sh 退出码三档 pass=0/fail=1/warn=4（mock 实测 warn→4）；ops/probe-config.md HC1 行同步；编排 cron 分流由协调人集成时更新（见集成节）。批 0 只读核实原 cron「退出 0 含 warn→success」未分流，疑似成立。
- F6-30 已修：L3 的 missingIds 改真缺失（在场 id 不入列），200/190 回归用例锁定。
- F6-31 已修：board 新增 onRequestHead，405 的 Allow 改 "GET, HEAD"。
- F6-32 已修：live/stale 长缓存头不变；snapshot/503/405 改 no-store。
- F6-33 已修：新建 shared/http.js 导出 SECURITY_HEADERS，board/health 共用；health 补齐三头（上线实测在位）。
- F6-34 已修：getIds 解码对账+去重，不符记 ids_parse_failed 并走回退；缺 id/重复 id 均有用例。
- F6-35 疑似→确认→已修：旧代码探针实证 board/health 判龄分裂；选 health 侧修——判龄优先用 board 的 staleAgeSec、缺失才回退 updatedAt（未动 updatedAt 展示语义）。
- F6-38 疑似→确认→已修：旧 health 对永不 resolve 的 fetch 挂起 >2s 实证；内部 fetch 加 AbortController 超时 8s（env 覆写仅供测试）。
- F6-39 已修：无 blob 时 staleAgeSec=null、coverage.expected 尽力取 ids 数否则 null，有断言。
- F6-40 疑似→确认→已修：旧代码实证 cache-only isolate 双坏直落 snapshot；Cache 命中回填 MEM_BLOB、MEM_HEALTH 出错分支加 10 分钟年龄上限；三段 servedFrom 回归用例。
- F6-41 疑似→确认→已修：curl 线上实证三字段在位、grep 前端零消费 → 对外 fetch 只留 fetchRunId，三字段改记 board_fetch_meta 结构化日志（上线实测 fetch 键集恰为 [fetchRunId]）。
- F6-15 已修：新建 tests/health.test.mjs 12 例。
- F6-17 已修：board-v2 kv 用例首行五字段逐项断言 + volume24h 缺失→null 用例。
- F6-18（board 部分）已修：100 行中 1 行全 null 用例——不抛错、占位正确（99% 在门禁内）。fetcher/前端部分见批 3/批 2。
- F6-83（board 部分）已修：board-v2 加 200 行 kv 用例；dual 用例加人为 1% 价差并断言中位数=1/101（非零期望）。
- F6-79（board-v2 部分）已修：FIELDS23 副本改运行时与 data/coins.json meta.fields 对账断言（本次一致、副本未变）；文档澄清部分见批 5。完整单一来源收敛未做——现形态为「生产者 build.py + 其余副本全部有对账断言/文档定位」，漂移即测试红，防漂移目标达成；如需物理收敛另行立项。
- F6-92 已修：新建 tests/kv-write-guard.test.mjs 扫描 functions/，BOARD_KV.put/delete 命中即失败（治理登记见批 5）。
- F6-44（schema 侧对齐，批 3 发现）已修：FETCH_INTERVAL_SEC.saving 900→1200，与 fetcher 实际 20 分钟节奏一致；消费点全仓核查仅 board.js assembleV2，无测试依赖旧值。

### 批 2 前端（wt/p6-batch2-frontend）

- F6-12已修：confSel 三个 option 加 value="高/中/低"，置信度筛选恢复；测试⑦以浏览器语义取值驱动过滤、断言非空。
- F6-13已修：effPrice/effMcap 显式 null 判断——实时 0/负按缺失显「—」、不回退快照算倍数；详情与主表共用 effMcap，三币（telcoin-2/wefi/yellow 形态）主表详情一致。测试⑨锁定。
- F6-14 已修：新增 num() 归一贯穿 fmt*；loadBoard/init 两调用点 try/catch → liveLayerFail 保留现有行 + 横幅标注，不再整表崩。
- F6-63已修：fmtPrice ≥1000 补两位小数（"2,127.50"）、负价显「—」；fmtPct |x|<0.05 显 "0.0%" 且 chgCls 不着色；fmtMcap 进位提升万亿（"$1万亿"，sig3 去尾零口径）。200 静态行按新 rowHTML 再生；生成侧同步由协调人集成时完成（见集成节）。
- F6-62已修：boardMode/applyBoardState 显式识别 delayed，横幅「行情延迟约 X 分钟」；测试⑬锁定。
- F6-54已修：loadWatch 提前到 init 最前按原始数组载入，失败态点星不覆写自选；测试⑮。
- F6-55已修：二选一取轻量同步——init 对静态行做 syncSnapshotStars 星标回显（避开整表 render 与 W2-17「不触碰 tbody」定版冲突）。
- F6-65已修：watchRawSet/watchSet 双集，落盘保留原始 id；metaText 标注「N 个自选已不在榜单」；测试⑭。
- F6-56已修：二选一取可达收起入口——livePatched 全量态显示「收起为前 50 条」，点击清标志收起（保 W3-05 刷新恒 200 口径）；测试⑥。
- F6-57已修：patchInPlace 摘下详情行、以最新 detailHTML 重建内容再随主行移动；测试⑫。
- F6-58 已修：跳过含 activeElement 的单元格整体替换；W3-05 注释同步修正。方案边界：焦点在其他单元格按钮上仍会被重建（报告二选一中取此方案，残余如实登记）；DOM 桩不建模焦点，无桩内用例。
- F6-60已修：renderShowAllBar 的 filtered 计入 watchOnly；toggleStar 删行路径末尾补 renderShowAllBar()。
- F6-61 已修：document.title 名次按 boardMode 同源（liveRank/estRank）；onHashChange 无命中清 hashTarget。
- F6-64 已修：coinInnerHTML 与 200 静态行均直接输出 aria-controls='d-<id>'；toggleExpand 恒设不移除。
- F6-66 已修：esc 补 `'`→&#39;、反引号→&#96;；现行数据无单引号字段、逐行 diff 仍 0。
- F6-67 已修：detailHTML/rowCells/liveMult 数值字段一律 num()/fmt* 归一，非有限数显占位。
- F6-59 疑似→确认→已修：改前实测 fields 改名产 200 条 coingeckoId=undefined、对象行产垃圾对象；修后解码加健全性校验、throw 走快照兜底；测试⑩。
- F6-68 疑似→确认→已修：改前实测 "nbt" 跨界命中 bitcoin、"avalanche-2" 搜不到；修后空格拼接 + 追加 id；测试⑪。
- F6-19 已修：两套件 mock 补齐五字段；frontend-dom ③增 detailHTML 成交量段断言。
- F6-18（前端部分）已修：测试⑨——volume24h=null/rank=null/price·mcapUsd=0 不抛错且显占位。
- F6-81（前端部分）已修：frontend-dom 文件头/④标题/尾注的 F4-07「预期红」标注全删改，与实跑一致（文档部分见批 5）。
- F6-82 疑似→评估成立→已修：桩静默 undefined + 注册表自动建桩会掩盖缺失；两套件加 Proxy 守卫（未实现属性抛「桩未实现」）、补布局量/activeElement、文件头维护桩 API 清单；tr 节点模型未加 Proxy（清单注明）。残余：saveWatch 防抖用例仍靠 settle 墙钟等待。

### 批 3 Fetcher + 批 5 启用门禁（wt/p6-batch3-fetcher）

- F6-11 已修：runLedger 记账——探针/markets/global 每次真实调用（含失败与被丢弃的 global）并入后再估 quotaMode；新字段 health.quota.attemptsTotal；creditsUsedEst 口径改为含失败 run 消耗。用例断言 global 成功+markets 失败 → 账面 +2。上线实测 attemptsTotal=2、creditsUsedEst 2518→2520（见验收节）。
- F6-47 已修：kvGetJson 区分键缺失（null）与读异常（抛 KvReadError）；读异常以 stage=kv-get 收尾、不覆写 health/sourceState。
- F6-42 已修：global 429 消费 retryAfterSec，记 health.globalLast429At/globalSkipUntil，global 单独退避、markets 照常。
- F6-45 已修：globalDue 改 epoch 30 分钟墙钟窗口；整 run 跳过在 global 过期 >2h 时绕过，global 自身退避不绕过；注释注明约 40 分钟为无故障下限。
- F6-46 已修：skip 改 health.retryUntil 时间戳；口径定版——429 本 run 计入连续失败、被跳 run 不计（与 runbook 原文及既有锁定用例一致）。
- F6-43 已修：applyOutcome 加 paprikaEnabled 参数（缺省 true）；未启用只累积 CG 失败不迁移 PAPRIKA_ACTIVE；health 快照 activeProvider 以实际 provider 为准。
- F6-44 已修：投影改分段速率 normal 192/saving 120/critical 48（credits/天）+ 月内只升不降；saving 调度不动、注释同步为实际 20 分钟节奏（schema 侧 900→1200 见批 1）。
- F6-49 已修：/run token 双侧 SHA-256 常量时间比较；60s 最小间隔（health.lastManualRunAt + 拒绝留痕）；决策——BOARD_FETCH_DISABLED 时 /run 维持可用（人工恢复通道），已写入代码注释、P6_NOTES 与 fetcher README。
- F6-48 疑似→确认→已修：mock 实证旧代码后落盘覆盖新 blob 且 credits 丢计数（2≠4）；runFetch 入口在途合并、复用同一 promise。
- F6-50 已修：删 fetchImpl 死参；两 provider 的 res.json() 纳入同一 AbortController。
- F6-51 已修：新建 tests/coins-list-contract.test.mjs 4/4。
- F6-10 启用门禁已修：PAPRIKA_MIN_MAPPED=197 常量；映射未达标强制 CG + warning，计数落 health.paprikaMappedCount（上线实测 =0，门禁在位）；runbook 已加「当前不可用」标注。**落库遗留**（见遗留节）。
- F6-52（fetcher 部分）已修：新抓 global 关键字段全 null → 视为失败、沿用 prev 及原 asOf（与批 1 的 validateBlob 标记同口径，集成已核对写路径）。
- F6-53 疑似→确认→已修：授权内单次 GET 实证 Paprika tickers 默认恰好返回 2000 条（末条 rank 2000）；请求加 limit=5000；rank 口径差异已注代码注释。
- F6-84 已修：BOARD_FETCH_DISABLED 改 fail-closed（非 "0" 的非空值即禁用、未知值 error 日志）；fetcher README 加三开关取值口径表。
- F6-85 疑似→确认→已修：未知 BOARD_SOURCE 现 push warning 走 source_config_warning，不再静默穿落 auto。
- F6-91 疑似→确认→已修：配置错误 message 改固定文案，原值仅以类型/长度记结构化日志，health/响应不落原值。
- F6-18（fetcher 部分）已修：整行多字段 null 用例——不抛错、null 透传、coverage 不拒整行。

### 批 5 工具 + 批 6 测试补强 + 批 7 治理登记（wt/p6-batch5-tests-gov）

- F6-77 已修：verify-paprika-coverage 天数改 --day/报告数推导；首行恒输出 RESULT 行；hits<195 退出 1、195–196 WARN 退出 0、≥197 PASS。
- F6-78 证伪（未实际发生）+已加固：现行 candidates 中置信 27 行逐一复核，误配率 0%（slugPart<4 仅 sun/htx 2 行且均为真配）；机制风险属实，仍按报告加 ≥5 长度门 + name slug 前缀门——代价 7 行真配降为无候选交人工，已留痕。
- F6-71（JS 侧）已修：新建 scripts/decode-coins.mjs 单一实现（行长断言），gen/verify 两 Paprika 脚本改 import；index.html/tests 内副本与 Python 侧不在其文件域（Python 侧由批 0 完成；前端 decodeCoinsData 的健全性由 F6-59 覆盖）。
- F6-16 已修：新建 tests/compare-shadow.test.mjs 6/6；新建 tests/quota_check_test.py 按 F6-07 新口径写（批 0 合并前 3/5、合并后集成实测 5/5 转绿、未改用例迁就）。
- F6-79（文档澄清）已办：contract-real-data 文件头区分静态产物契约与 KV blob 契约两条线及各自守护套件。
- F6-81（文档部分）已办：ops/testing/coverage-baseline.md 加 2026-11-23 实跑更正段（93 项全绿、frontend-dom 退出码 0、contract 6 PASS/0 SKIP）。
- F6-92（治理登记）已办：security-baseline §5.1/§5.2 登记 KV 平台读写权限面 + 「functions/ 不得出现 BOARD_KV.put/delete」硬性检查项（契约测试见批 1）。
- F6-94 已办：security-baseline §5.3 登记 SFS 影子模式复核点（下次季度自查二选一留痕）。
- F6-89 遗留（登记已办）：security-baseline §5.4 确认 SRI 现状（全仓无 integrity、Observatory 唯一未过项 −5），维持 W5 增补包既有处置路径、本期不重复施工。
- F6-36 遗留：dual/dualCompare 下线——报告第三节自带分组「并入 G4 规划、不在本轮零敲碎打」，本期未动 dual 逻辑（仅测试 env 适配 F6-03 口径）。

## 集成（协调人）

1. 五分支按批 0→1→2→3→5 顺序合并入 master，无冲突；五份 P6_NOTES.md 内容并入本文后移除。
2. contract-real-data 用例②连带红（F6-03 口径变更预期连带）：env 改显式 {BOARD_READ_MODE:"legacy", COINGECKO_API_KEY:测试值}，转绿 6/6。
3. **生成侧模板同步**（批 2 跟进项）：scripts/render_snapshot.py 与新前端 fmt 口径逐项对齐——fmt_price ≥1000 恒两位小数、负价/零价守卫、fmt_mcap 进位提升万亿、esc 补单引号/反引号、row_html 展开按钮补 aria-controls；test_render_snapshot 8/8 仍绿。
4. **F6-02×F6-18 门禁口径对齐**：合并后 fetcher-branches 用例 20 红（4 行夹具 1 行 null 价 → 75% 触发 price_null_ratio 整 run 拒绝）。定版组合门禁：非 null 比例 <98% 且 null 数 >4 才拒绝；非 null 比例 <50%（多数行无价）任何规模都拒绝。生产 200 行口径与原门禁等价（2%=4），全 null rows 恒命中；board-fetcher 全 null 负向用例与 fetcher-branches 透传用例同时转绿。
5. probe.mjs R3 处置（批 1 跟进项，协调人定）：F6-41 后 upstreamStatus 不再对外，R3 恒不可判读——保留规则（字段再现仍可判读），输出层显式标注「R3 不可判读…上游健康以 /api/health 与 HC4 为准」，脚本头注释同步。上线实测 probe 输出带该注记、verdict PASS。
6. run-tests.sh SUITES 补入 5 个新套件（health、kv-write-guard、coins-list-contract、compare-shadow、quota_check_test.py），deploy 门禁自动覆盖。
7. cron 更新三件（cron.view 读现行 body 后 cron.update 同 id 全量改、排期不变）：
- top200-hc1-hourly-probe：按 probe.sh 新退出码分流（0→success；4=warn→ping /fail 并注明降级；1→fail）。
- top200-quota-daily-check：汇报口径改 G3 形态（legacy=0 判级、verdictNote 转述、口径切换首日回落须注明系口径修正）。
- top200-hc4-shadow-probe：G3 后该链即生产数据链，异常按线上数据故障口径汇总（原文「不影响线上」已改）。
- F6-87 的 env 补齐：核查两支脚本的 cron 本体原本即带 CLOUDFLARE_ACCOUNT_ID，无需补（批 0 提醒系未查 cron 本体的保守提醒）。
8. runbook compare 口径行已按 F6-08 新语义修订（同源自比标注、verdict 上限 conditional、独立验证看 blobDiff 与抽样直查）。
9. gen-headers --variant=on 按合并后 index.html 再生 public/_headers 后部署。
10. 未采纳项：normalizeCgMarkets 的 invalidFields 计数暂无人消费（fetcher 解构忽略、无破坏）——记为后续跟进，不为它冒回归风险。

## 测试总账

- 修复前基线：9 套件 93 项全绿（批 5 在 master 6cb7122 实跑）。
- 修复后：**14 套件 166 项全绿**（scripts/run-tests.sh 统一入口，deploy.sh 门禁同跑）：
board 13、board-v2 21、board-fetcher 15、fetcher-branches 40、frontend-dom 16、contract-real-data 6、snapshot-verify 5、health 12、kv-write-guard 1、coins-list-contract 4、compare-shadow 6、test_render_snapshot 8、weekly_check 14、quota_check 5。净增 73 项。

## 部署后验证（2026-11-22T23:50Z 起，全部实测）

- /api/board：契约 v2、mode=live、source=coingecko、coverage 200/200、freshness.servedFrom=kv、consecutiveFailures=0；fetch 键集恰为 [fetchRunId]（F6-41）。
- /api/health：ok=true、200/200；三安全头（nosniff/CSP/Referrer-Policy）在位（F6-33）。
- Fetcher 新代码首 run（20261122T2350Z-4986）：成功、lastUpstreamStatus=200、consecutiveFailures=0；health.quota.attemptsTotal=2（F6-11 新字段）、creditsUsedEst 2518→2520（markets+global 各 1，含失败记账口径在位）；health.paprikaMappedCount=0（F6-10 门禁字段在位）。
- compare-shadow（新口径）：mode="same-source"、verdict=**conditional**（rc=2，verdictCaps 明示同源上限——此为 F6-08 修复后的正确结果，非故障）；compared 200/200、runGate met（countedRuns 1260≥400）；blobDiff：current vs prev 200 行、价格异动 >5% 为 0、新增 null 字段 0。
- probe.mjs：PASS（rc=0），输出含 R3 不可判读注记；probe.sh：rc=0 全过；deploy.sh 内置 smoke + smoke-headers 子集全过。
- quota-check 新口径实跑：verdict=**OK**（rc=0），scriptVersion 2.0-g3、methodology "g3-aware: planning=legacy0 when kv"、投影月合计 4057.1、击穿天数 38.96、verdictNote 含护栏旁注——G3 后长期 WARNING 假象消除（F6-07 端到端验证）。
- UptimeRobot M1–M4：全部 status=2（up）。
- 用户可见修复线上核对：部署 HTML 含置信度 option 的 value 属性（F6-12）、effMcap（F6-13）、liveLayerFail（F6-14）、delayed 分支（F6-62）代码；行为级验证由 frontend-dom 16 例（含⑦筛选非空、⑨三币形态、⑬延迟横幅）在部署门禁内全绿保证，坏数据实验未触生产 blob（按纪律以合成数据在本地验证）。

## 用户可见修复清单（报告标者）

F6-07（核账判级口径，内部可见）、F6-12（置信度筛选恢复）、F6-13（三币市值主表/详情一致）、F6-54（失败态不丢自选）、F6-55（快照态星标回显）、F6-65（不在榜自选不被删 + 标注）、F6-56（可达的收起入口）、F6-57（展开详情随实时刷新）、F6-60（只看自选时条数按钮正确）、F6-62（延迟横幅文案）、F6-63（价格/市值数字格式）。

## 遗留项与后续

1. **F6-10 映射落库**（门禁已就位）：提案自述 196/200 复点无误、距门槛 197 差 1；tickers 实测命中仅 179/200，距 verify 门槛 195 差 16；落库属 FIELDS23→24 字段规范变更，触及 build.py/check_meta/index.html 解码/board.js getIds/两份契约测试/dataHash 口径 A 共 6+ 组件，且 fetcher 事实源 coins-list.js 与 coins.json 落点未定。立项要点：先定落点与 FIELDS 规范变更流程（与 F6-79 物理收敛同批）、补第 197 映射并逐一归因 17 个 tickers 缺失币、verify 连测 3 天达标后才谈启用。
2. **F6-36**：dual/dualCompare 下线并入 G4 规划（legacy 退役议题）。
3. **F6-89**：SRI 维持 W5 增补包路径（实施或正式接受并在基线销项）。
4. 小项：invalidFields 计数落 health/日志（F6-02 后续）；F6-58 方案边界残余（焦点单元格外按钮仍会被重建）；F6-82 saveWatch 防抖用例的墙钟等待。

## 异常与回滚

- 无部署回滚、无生产事故。集成期发现并处置两起跨组问题：F6-02×F6-18 门禁口径冲突（见集成 4）、F6-86 五组漏接（全覆盖扫查发现，见批 0/4 节）。
- 本期全部 commit 已 push 远端（含评审 commit 6cb7122）。
