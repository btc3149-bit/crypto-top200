# 第八期施工记录（CONSTRUCTION_PHASE8）

- 施工对象：crypto-top200（生产 https://top200.oppcal.com，BOARD_READ_MODE=kv）
- 依据：PHASE8_REVIEW.md（37 条：P0 0 / P1 4 / P2 33；确认 30 / 疑似 7），commit 5d97da6
- 施工方式：五路并行 worktree 施工（Paprika/fetcher、写守卫/测试基建、API、前端、脚本运维）→ 协调人逐路合并 master → 全量测试 → fetcher 与 Pages 部署 → 部署后逐项实测
- 结论：**37 条全部处置：已修 37 / 证伪 0 / 遗留 0**（其中 F8-36、F8-37 为登记落点型处置，性质使然，见逐条说明；疑似 7 条全部先定性：6 条确认后修复、F8-37 确认守卫不可见后以禁令+登记处置）

## 启动前核查（2026-11-23 08:36Z，施工前）

- git 干净，HEAD 5d97da6（评审 commit）；基线全量测试 22/22 套件全绿
- /api/health ok、coverage 200/200、count=coinsCount=200
- /api/board 契约 v2、servedFrom=kv、stale=false、source=coingecko（Paprika 关闭中）
- KV health（check-shadow-health.py）：status=ok、consecutiveFailures=0
- quota-check verdict=OK

## 批 0 · Paprika 门禁真实性（p8-paprika 路）

- **F8-01（P1）已修**：新建身份登记册 `workers/fetcher/src/paprika-registry.js`（由 `scripts/verify-paprika-identity.mjs --write-registry` 经全名复核生成，196 条入仓）；fetcher preflight 改以登记册的 CG 侧 name/symbol 与实时目录全名比对，废除「条目与自身比对」的自洽校验；登记册一致性由 paprika-gate 套件强制校验（篡改映射必红，等效部署门禁强制）。硬验收：F7-01 三旧错配值（pump-pumpbtc / sky-skycoin / skr-saakuru-labs）以运行时形态 {id, paprikaId} 喂入 → identityValid=0（registry_missing×3），旧口径为 3/3 全过；已固化回归用例。
- **F8-02（P1）已修**：三条同资产次级条目改指规范主条目——cosmos→atom-cosmos（主条目 rank 108、市值 $465.1M）、litecoin→ltc-litecoin（rank 30、$3,068.3M）、zcash→zec-zcash（rank 11、$12,954.4M），实测值见 paprika 路碎片；三份 coins.json 仅 3 行变更、逐字节一致、dataHash 按口径 A 重算。门禁新增 plausibility 交叉校验（Paprika 市值 / CG 快照市值 <5% 拦下；三条 -token 条目比值 0.36%–0.75%、主条目 63%–77%），回归用例固化。htx 处置为「登记为例外」：PAPRIKA_PLAUSIBILITY_EXCEPTIONS 附实测证据（Paprika $1,382,000 vs CG $1,370,000,000、比值约 0.001，Paprika 侧无更优条目），命中留痕、不静默放行。
- **F8-16 已修**：fetcher 侧 mapped 计数一律走 isValidPaprikaId / countValidPaprikaMappings，禁止 truthy 计数；畸形串回归用例；shared/board-schema.js 零改动。
- **F8-18（疑似→确认→已修）**：countPaprikaGateStats 对重复 paprikaId 双计经构造定性成立，改为按 paprikaId 去重计数 + 回归用例。
- **F8-21 已修**：门槛双口径收敛——阈值与四计数定义以 shared/paprika-identity.js 为单一事实源；verify-paprika-coverage.mjs 废除 197/195 旧口径，输出标注 `scope=coverage-only notEnablementDecision=true`；当日实跑结论 COVERAGE_BELOW_THRESHOLD（179<188），与 preflight 同向，不再出现相反 PASS。
- **F8-20 已修**：docs/fetcher-runbook.md 的 Paprika 状态段按实测改准（映射 196、四项门禁均 ≥188、保持关闭、登记册再生成要求）。

**Paprika 四计数修复后实测（2026-11-23T08:44Z 实时拉取，目录 62,744 条 / tickers 前 2,000 条，仓库 verify 脚本复跑）**：mapped=196、identityValid=196、activeUsable=195（yzy 已下线）、tickerHit=179；门禁阈值 188、ok=false → **Paprika 保持关闭**（部署绑定实测 PAPRIKA_ENABLED="false"、线上 source=coingecko 实测，门禁未放水）。口径变化仅 tickerHit 新增市值合理性前置条件（F8-02）。

## 批 1 · KV 写守卫加固（p8-guard 路，先于批 3 合并）

- **F8-03（P1）已修**：扫描器（tests/helpers/kv-guard-scan.mjs）全面识别可选链 `?.` 与 `?.()`（成员访问/调用/接收者回溯/classify）；可选链红队样本 5/5 被拦。
- **F8-33 已修**：解构改为递归模式解析，覆盖多层嵌套 {BOARD_KV:{put}}、for-of/for-in 解构、形参嵌套解构（fail-closed）；3/3 被拦。
- **F8-34 已修**：tokenizer 对标识符与字符串解码 \uXXXX / \u{...} / \xXX；pu\u0074、BOARD\u005fKV、字符串键转义 3/3 被拦。
- **F8-35 已修**：kv-write-guard 扫描范围扩至 functions/ + shared/ 并加 shared/ 单独断言；现行代码仍只报既有批准例外 1 处（board.js legacy-credits），无误伤。
- **F8-36 落点处置**：Reflect/Proxy 元编程为扫描器已声明边界——security-baseline §5.2 人工评审清单已单列 Reflect/Proxy 检查项，明示守卫不覆盖、靠评审兜底；语料以 offenders=0 固化边界口径。
- **F8-37（疑似→定性→已处置）**：eval/Function 构造内写调用对守卫不可见属实。处置双层：① 守卫扫描范围内（functions/ + shared/）`eval(` / `Function(` 构造一律判 offender（2/2 被拦），该通道无法被静默引入；② security-baseline 登记运行时禁 eval 兜底口径。证据边界如实注明：本环境无本地 Workers 运行时，运行时抛错未实跑实证、按平台口径登记。

**红队复测总账**：新增 23 个 fixture（tests/fixtures/kv-guard/p8-*.js）——负向 22/22 全拦（可选链 5、解构 3、Unicode 3、eval/Function 2、原已拦类别回归 9：模板键/参数传递/返回值传递/数组与对象容器/Proxy 转手/bind/call/混淆等），已登记边界 Reflect 1 个按登记放行；第七期既有 11 个负向样本仍全拦。kv-write-guard 套件 15→39 项。批 3 的 board.js 改动（F8-10 超时包裹保持批准 put 直呼形态）已在合并后由加固守卫复扫通过（套件全绿、批准例外仍恰 1 处）。

## 批 2 · 门禁与测试基础设施（p8-guard 路）

- **F8-04（P1）已修**：新套件 tests/smoke-chain.test.mjs（10 项）离线覆盖冒烟链本体——gen-headers --check 现行一致、沙箱篡改 _headers/index.html 必判不一致、重生成恢复；smoke-headers 对本地 mock（真实 _headers 头集合）全过、对缺 CSP 的 mock 判 FAIL；smoke.sh 对 mock production 全过、对 servedFrom=legacy 判 FAIL、preview 子集全过。
- **F8-27 已修**：suite-manifest 识别口径扩至 *.test.js / *.check.* + tests/ 递归兜底断言 + 临时目录自证；按报告复现法实证：真放 tests/foo.check.mjs（必失败断言）后 suite-manifest 退出 1，移除恢复全绿；现行套件无误伤。
- **F8-28 已修**：fetcher 独立部署豁口已在 deploy.sh 头注、fetcher-runbook、security-baseline §5.6 三处明示；技术拦截（Pages 侧）：wrangler-pinned.sh 对 pages deploy 无 DEPLOY_VIA_DEPLOY_SH=1 标志直调退出 2 拒绝（实测），deploy.sh 已设该标志、主路径实测不受影响（本次 Pages 部署即经此路径成功）；fetcher 部署只警告不硬拦（本次 fetcher 部署实测警告正常输出、部署成功）。
- **F8-29 已修（两路分工）**：守卫路新增 gen-paprika-map.test.mjs（7 项）与 coverage-report.test.mjs（4 项）；Paprika 路新增 paprika-verify-scripts.test.mjs（6 项，两 verify 脚本重构为纯函数导出 + main 守卫，零真实 API）；paprika-gate.test.mjs:5 过期头注释已修正。hc_ping.sh / rollback.sh 按评审口径风险接受（rollback 有真机演练记录）。
- **F8-30 已修**：audit-deps.test.mjs 改从 package.json 动态读 wrangler pin，写死版本号正则已删。
- **F8-31 已修**：wrangler-pinned.test.mjs 补本地二进制缺失走 npx 兜底、lockfile 与 pin 不一致 wrapper 拒绝执行两条用例（4→6 项）。
- **F8-32 已修**：run-tests.sh 逐套件计 ^PASS 行、与 suites-manifest.json 的 expectedPass 登记比对（不一致判失败）、打印自动加总总账；API 路配合将 legacy-credits 第 6 项双子例输出归一为单行 PASS（断言逐个保留）。集成时协调人按合并后实测刷新全部登记值（见测试总账）。

## 批 3 · API 健壮性（p8-api 路）

- **F8-09 已修**：L3 分支在 blob missingIds 非数组时令 missingIds=全部在场 id，expected−returned == missingIds.length 恒成立（修复前构造复现：190 在场 → {expected:190, returned:0, missingIds:[]} 不守恒；评审记 expected:200 系 F7-13 已将 expected 重算为在场数，落点不同、破裂形态一致）；数组形态仍按 F6-30 只列真缺失。
- **F8-10 已修**：addLegacyCredits 的 get/put 各包 Promise.race 式超时，取 **3500ms**（与 board.js 既有 UPSTREAM_TIMEOUT_MS 完全对齐，代码中直接等值引用）；超时按计数失败吞掉、guarded.catch 兜迟到拒绝、无未处理 rejection；put 保持原直呼形态仅外层包裹。回归：stub put 永不返回 + 上游即时响应 → 约 3500ms 后 200/live 返回。
- **F8-11 已修**：legacy/dual 路径改复用 shared/board-schema.js 的 normalizeCgMarkets（与 fetcher CG 路径同一清洗口径，未另造口径）；五字段全形变回归全置 null、正常值不误伤；坏值计入 invalidFields 并记 warn。
- **F8-12 已修**：列表外 id 处置口径定为**剔除**（不进 coins、不计 count，与 v2/fetcher rows 口径及 health 的 count===returned 不变量对齐）；count 直接绑定 coverage.returned 使不变量结构上恒成立。回归：4 期望 + 1 列表外 → count===returned===4。
- **F8-13 已修**：globalForContract 加未来戳判定——未钳制 rawAgeSec 超 −60s 容差（既有 clockSkewToleranceSec、与 F6-05 board 级同口径）判未来戳；超 6h 置 null、容差至 6h 间保留但 stale:true。回归：asOf +7h → global=null；+2h → 保留且 stale=true。

## 批 4 · fetcher 记账与可观测（p8-paprika 路）

- **F8-14 已修**：coingecko.js fetchMarkets 不再丢弃 invalidFields；fetcher 分源汇总进 health.invalidFields（未抓源为 null）+ total>0 时结构化日志。生产实测（部署后 09:00Z 新代码 run）：invalidFields={coingecko:{price:0,mcapUsd:0,volume24h:0,change24h:0,rank:0,total:0}, coinpaprika:null} 已落盘。
- **F8-15 已修**：paprikaGate 三态可区分——实测完成 {measured:true,...}；未执行/失败 {measured:false, reason, identityValid/activeUsable/tickerHit 为 null}，不再零填充；非候选 run（provider 非 coinpaprika，如生产 PAPRIKA_ENABLED=false 的 CG 稳态 run）维持 null 表示不适用（代码注释明示，部署后 09:00Z run 实测为 null，与设计一致）。消费者盘点：仓库内读者仅 fetcher 与测试，形状扩展向后兼容。
- **F8-17 已修**：fetchGateStats 加 onAttempt 回调按调用发生时记账（finally 中以实际 attempt 数 ledgerCall）；用例：tickers 500 时 attemptsTotal=4（Paprika 2 + CG 2），与 mock 计数一致。

## 批 5 · 前端（p8-frontend 路）

- **F8-05已修**：≤640 手机档排序按钮 min-height 36px→44px。CSSOM 级联实测：修前 360/390/640px 三档计算值均 36px（同档其余控件 44px），修后均 44px；修复写入基础规则之后的第二 ≤640 媒体块（避开第一块被基础规则同特异性覆盖的级联陷阱——即 W5 命中域同类教训）；桌面细指针仍 36px、粗指针 ≥641 仍 44px。布局回归：手机五列总宽修前修后均 326px 逐项不变、表头行高由折行内容主导不被抬高。线上实测：部署后首页 HTML 含.th-sort{min-height:44px} 规则。
- **F8-06（疑似→确认→已修）**：计数桩实测同状态连续 render 3 次横幅 textContent 被写入 3 次（值不变亦重写属实）；applyBoardState 改为先算 bannerText、仅实际变化才写；修后同状态 3 次 render 额外写入 0 次、状态切换仍正常更新。
- **F8-07（疑似→确认→已修）**：注入 coingeckoId="a'b" 复现 Escape 拼出 [data-exp='a'b'] 抛 SyntaxError、关闭失效；新增 escSelStr()（CSS.escape 优先、否则手写等价转义）用于该拼接点；修后畸形 id 不抛错、关闭与焦点回位正常，正常 id 行为不变。
- **F8-08（疑似→确认→已修）**：隐私页修前 <main>=0、跳过链接=0（首页各 1）属实；div.wrap 改为 <main class="wrap" id="mainWrap">（样式原样、视觉不变），补与首页同文案同锚点跳过链接。线上实测：/privacy/ 含 <main> 与 skip 链接。

派生产物：public/_headers 已跑 gen-headers --variant=on 再生并 --check 通过；ops/headers/_headers.report-only.txt 按仓库脚本 --report-only --variant=on 再生。

## 批 6 · 脚本运维（p8-scripts 路）

- **F8-19 已修**：build.py _stage_and_land 落盘保留原权限（目标存在沿用其 mode、不存在用 0666 & ~umask，与旧 write_text 一致）；复现 0644 经落盘变 0600 → 修后仍 0644；用例入 tests/build_paprika_map_test.py（6→7 项）。
- **F8-22 已修**：quota-check.py INVALID 路径日志写失败不再 except: pass 静默——改 stderr 报错、退出码维持 3（与正常路径同口径）；只读目录构造复现验证；用例入 quota_check_test.py。
- **F8-23 已修**：quota-check.py 与 check-shadow-health.py 同口径加 wrangler_cmd_prefix()——正常走 scripts/wrangler-pinned.sh 锁版入口，pin 与 lockfile 不一致先 WARN；仅 package.json 读不到才回退写死值且必 WARN（再比对 lockfile）。pin 4.159.0 与 package.json 一致属实、现行路径未改坏；用例覆盖回退/警告分支（quota ⑰a–d + time_tolerance ④）。
- **F8-24 已修**：probe.sh 写 ops/probe-log.jsonl 失败被检出。消费方核查结论：HC1 cron 按 0/4/1 三分流（0 success、4/1 均 ping /fail，4 附降级注记）、deploy.sh 只判非零告警不改判、无其他码值消费方。据此定版：日志写失败 verdict 不变、stderr 明示 + stdout `log_write: fail` 行，pass 时升 warn 级退出 4、fail/warn 码不变，绝不升 fail 级 1；新语义写入 probe.sh 文件头，日志路径新增 PROBE_LOG_FILE 覆盖（默认不变）。实跑验证：pass+不可写→exit 4，pass+可写→exit 0 且日志落行。协调人集成时另在 ops/probe-config.md 的 HC1 行补记该语义对齐（该路文件边界外）。
- **F8-25（疑似→确认→已修）**：本地 mock 返回 503 + 伪造 v2 体（200 币同 run 同价）时旧 compare-shadow 实测 verdict=pass、compared=200、exit=0，污染成立；修后 fetch 先判状态，非 2xx 输出 verdict=fail + liveHttpStatus + 状态码、退出 1（与 F7-21 同口径）；同场景复测 fail/503/exit 1；用例入 compare-shadow.test.mjs（13→14 项）。
- **F8-26（疑似→确认→已修）**：同一时刻（UTC 2026-11-22 周日 12:00）本地口径在 TZ=Pacific/Auckland 得周标签 2026-W48、UTC 得 W47，相差一周属实；weekly_check.py 新增 utc_today()、默认日期改 UTC 口径，显式 --date 不变；用例含冻结时钟 + 三时区断言恒 W47，TZ=Auckland 下整套件实跑亦全过（weekly_check 18→19 项）。

## 集成（协调人）

- 合并顺序：p8-guard（批 1/2）→ p8-paprika（批 0/4）→ p8-api（批 3）→ p8-frontend（批 5）→ p8-scripts（批 6），均 --no-ff。冲突仅 1 处：tests/suites-manifest.json（守卫路重构登记结构 × Paprika 路追加新套件），手工合流为 26 套件并保留 expectedPass 结构。
- 合并后首跑全量：唯一失败为 F8-32 计数比对（各路增例后登记值过期，机制按设计判红、无功能失败）；协调人按实测刷新 9 个套件的 expectedPass（board 17、board-v2 25、frontend-dom 24、compare-shadow 14、weekly_check 19、quota_check 27、paprika-gate 16、build_paprika_map 7、time_tolerance 5），复跑全绿。
- ops/probe-config.md HC1 行补记 F8-24 退出语义（脚本路建议、其文件边界外，协调人代行）。
- 五份分路碎片（CONSTRUCTION_PHASE8-{paprika,guard,api,frontend,scripts}.md）内容已并入本记录并删除，逐条细节与 commit 链以 git 历史为准。

## 测试总账

- 基线（第七期定版）：22 套件 / 273 项（项数口径；PASS 行口径 274，差 1 为 legacy-credits 双子例，F8-32 已归一）
- 修复后（合并 master 实跑，run-tests.sh 自动总账）：**26 套件 / 356 PASS 行，登记期望合计 356，26/26 全绿**
- 新增套件 4：smoke-chain（10）、gen-paprika-map（7）、coverage-report（4）、paprika-verify-scripts（6）
- 主要增例套件：kv-write-guard 15→39、paprika-gate 9→16、frontend-dom 20→24、quota_check 22→27、board-v2 22→25、board 15→17

## 部署

- Fetcher Worker Version：`4e51ca5f-a726-4147-a30c-c742f5aa2128`（wrangler-pinned.sh deploy；绑定实测 PAPRIKA_ENABLED="false"、BOARD_TARGET_KEY="current"；F8-28 豁口警告按设计输出）
- Pages production 部署：`8af5f204-bba2-4bee-87c2-d6d070fa3f77`（上一部署 17e3be31），经新 deploy.sh 全门禁一次通过（测试门禁 + gen-headers 校验 + smoke-headers 全断言 + probe verdict=pass）
- HC2-top200-deploy 已报 success（HTTP 200）
- **无回滚、无生产事故**；ops/deploy-audit.jsonl 本次留痕已随收尾 commit 入库

## 部署后验证（全部实测，2026-11-23 08:53–09:02Z）

- /api/health：ok=true、coverage 200/200、count=coinsCount=200
- /api/board：契约 v2、source=coingecko、stale=false、missingIds=[]
- compare-shadow（--shadow-key current）：mode=same-source、verdict=conditional（同源自比如实降级）、compared=200、failReasons=[]、blobDiff 价格异动 >5% 为 0、新增 null 字段 0
- quota-check：verdict=OK（consecutiveFailures=0、upstreamHealthy=true）
- UptimeRobot M1–M4：status 均为 2（up）
- KV health（新代码 09:00Z run，lastRunId 20261123T0900Z-ebc5）：status=ok、consecutiveFailures=0、paprikaMappedCount=196、invalidFields 已落盘（见 F8-14）、quota.attemptsTotal=76
- Paprika 线上一致性：线上 /data/coins.json paprikaId 非空 196；cosmos→atom-cosmos、litecoin→ltc-litecoin、zcash→zec-zcash；旧 -token 值与 F7-01 旧错配值线上命中均为 0
- 用户可见修复线上抽查：首页 HTML 含 ≤640.th-sort{min-height:44px}（F8-05）；/privacy/ 含 <main> 与跳过链接（F8-08）

## 用户可见修复清单

- F8-05：手机端（≤640）排序按钮点击高度 36px→44px，与同档其余控件一致
- F8-06：状态横幅不再每次渲染重复写入（读屏不再可能重复播报整段横幅）
- F8-07：畸形 id 数据下 Escape 关闭详情不再失效（健壮性，现行 200 币无触发）
- F8-08：隐私页补 <main> 地标与跳过链接（读屏地标导航可达正文）
- 其余 33 条为门禁/守卫/记账/测试/文档层修复，用户不可见但已逐条在上文留痕
