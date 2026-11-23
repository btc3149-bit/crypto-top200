# 第八期施工记录 · 写守卫/测试基建路（CONSTRUCTION_PHASE8-guard）

- 分支：p8-guard（worktree ~/workspace/phase8-wt/guard）；未部署、未 push、未 merge。
- 全量实测（2026-11-23，本分支最终状态）：`./scripts/run-tests.sh` 退出 0，
  **25/25 套件通过，PASS 行总账 325/325**（基线 22 套件 / 274 PASS 行；
  新增 3 套件、kv 守卫 +24 行、wrangler-pinned +2 行、suite-manifest +4 行等）。

## 逐条处置

### 批 1 · KV 写守卫

- **F8-03（P1）已修**：扫描器（tests/helpers/kv-guard-scan.mjs）成员访问判定
  扩至可选链——`.` 与 `?.` 同等处理、调用形态含 `kv.put?.()` 与别名
  `put?.()`、接收者回溯与来源 classify 均识别 `?.`。红队样本
  p8-optional-{direct,method,delete,computed,extract}.js 共 5 个全被拦。
- **F8-33 已修**：解构处理改为递归模式解析——多层嵌套
  `{BOARD_KV:{put}}`、for-of/for-in 解构、形参嵌套解构（来源不可判定按
  fail-closed 登记写方法别名）均纳入。样本 p8-{nested-destruct,
  forof-destruct,param-destruct}.js 共 3 个全被拦。
- **F8-34 已修**：tokenizer 标识符扫描与字符串扫描均解码 `\uXXXX`/`\u{...}`/
  `\xXX` 转义后再判定。样本 p8-unicode-{method,binding,string-key}.js
  共 3 个全被拦（`pu\u0074`、`BOARD\u005fKV`、`"pu\u0074"` 计算键）。
- **F8-35 已修**：tests/kv-write-guard.test.mjs 的 walk 扩到仓库根
  functions/ + shared/；新增用例 ⑧ 单独断言 shared/ 零 offender、零批准写。
  现行全仓扫描仍只报既有批准例外 1 处（board.js addLegacyCredits），无误伤。
- **F8-36 已处置（落点登记）**：ops/security/security-baseline.md §5.2 新增
  Reflect/Proxy 人工检查项，明示守卫不覆盖元编程写路径、靠评审 grep 逐处
  复核兜底。语料 p8-boundary-reflect.js 以「offenders=0」固化边界口径
  （套件用例 ⑦），边界变化须同步改登记。
- **F8-37 已处置（疑似→双层禁令）**：①守卫层——扫描范围内 `eval(` /
  `Function(` 构造一律 offender（样本 p8-{eval,function-ctor}.js 全被拦，
  以构造本身为拦点，字符串内写调用通道无法静默引入）；②登记层——
  security-baseline §5.2 登记 Workers 运行时禁止 eval 为第二层兜底。
  证据边界：本期未在本地 wrangler dev 实跑验证运行时抛错（本环境无可用
  本地 Workers 运行时证据），该层以平台公开口径登记、未实测，已在
  baseline 与本碎片明示；若运行时口径变化本条须升级重新定级。

#### 红队语料规模与复测结果（tests/fixtures/kv-guard/p8-*.js，共 23 个）

| 类别 | 样本数 | 结果 |
|---|---|---|
| 可选链（F8-03） | 5 | 拦 5 / 放 0 |
| 嵌套/循环/形参解构（F8-33） | 3 | 拦 3 / 放 0 |
| Unicode 转义（F8-34） | 3 | 拦 3 / 放 0 |
| eval / Function 构造（F8-37） | 2 | 拦 2 / 放 0（以禁止构造为拦点） |
| 原已拦类别回归（模板键/参数传递/返回值传递/数组容器/对象容器/Proxy/bind/call/注释+拼接混淆） | 9 | 拦 9 / 放 0 |
| 已登记边界（Reflect 抽取，F8-36） | 1 | 放 1（按登记，靠人工评审兜底） |
| 合计 | 23 | 负向 22/22 全拦；边界 1 按登记放行 |

另：第七期既有负向 fixture 11 个仍全被拦、正向 3 个（批准形/non-KV）仍
正确放行；kv-write-guard 套件由 15 项增至 **39 项全 PASS**。

### 批 2 · 门禁与测试基础设施

- **F8-04（P1）已修**：新增 tests/smoke-chain.test.mjs（10 PASS 行）离线
  验证冒烟链本体——gen-headers --check 对现行 _headers 判一致、在 /tmp
  沙箱副本上篡改 _headers / index.html 均判不一致且重新生成后恢复一致；
  smoke-headers 对本地 mock（响应头取自真实 public/_headers、--only=
  S1,S2,S4,S6）判全过、对缺 CSP 的 mock 判 FAIL；smoke.sh 对本地 mock
  production 全过、对 servedFrom=legacy 的 mock 判 FAIL、preview 静态
  子集全过。已登记 manifest。实现注意：mock 与被测子进程同进程时须异步
  spawn（spawnSync 会阻塞事件循环致 mock 死锁，套件内已注明）。
- **F8-27 已修**：suite-manifest 识别口径扩至 *.test.js / *.check.mjs /
  *.check.js，并新增 tests/ 递归扫描兜底断言（除 fixtures/ 外子目录亦
  纳入，未登记即红）+ 临时目录自证用例。按报告复现法实证：在 tests/
  真放 foo.check.mjs 后 suite-manifest 退出 1（①④ 两项 FAIL），移除后
  恢复全绿。现行 25 套件无误伤。
- **F8-28 已修（明示 + Pages 侧轻量拦截）**：①明示——deploy.sh 头注释、
  docs/fetcher-runbook.md（wrangler 锁版段后新增 F8-28 豁口段，与 Paprika
  状态段不同位置）、ops/security/security-baseline.md §5.6 均登记
  「fetcher 经 wrangler-pinned.sh 单独部署、不经 deploy.sh 测试门禁」为
  已知豁口及操作纪律；②拦截——wrangler-pinned.sh 对 `pages deploy`
  要求 DEPLOY_VIA_DEPLOY_SH=1（deploy.sh 部署步已设置），直调退出 2 并
  指引走 deploy.sh；fetcher 部署（`deploy …`）只打印醒目警告、不硬拦。
  实测：直调 pages deploy → rc=2 被拒；带标志 → 正常进入锁版执行路径；
  fetcher deploy → 警告输出且正常执行。deploy.sh 主路径仅改部署步一行
  环境标志 + 头注释，bash -n 与 wrangler-pinned 套件全绿静态核对无影响。
- **F8-29（本路部分）已修**：新增 tests/gen-paprika-map.test.mjs（7 项，
  沙箱副本 + --import 桩 fetch + fixture 币表，断言高/中-同名多条/中-slug/
  无候选四档与非活跃过滤）与 tests/coverage-report.test.mjs（4 项，沙箱
  manifest 只登记桩套件，断言报告生成、Python 计数纳入、默认 fail-closed
  退出 1 与 --report-only 退出 0），均登记 manifest、均不打真实网络、
  均未改被测脚本本体。verify-paprika 两脚本套件由 Paprika 路负责，本路未碰。
- **F8-30 已修**：tests/audit-deps.test.mjs 删除写死 `/wrangler@4\.159\.0/`
  正则，改为从 package.json 动态读 pin 构造正则（对齐 wrangler-pinned
  套件做法）；套件 4 项全 PASS。
- **F8-31 已修**：tests/wrangler-pinned.test.mjs 补 ⑤本地二进制缺失走
  npx@pin 兜底（桩 npx 记录验证）、⑥lockfile 与 pin 不一致时 wrapper
  拒绝执行且未调用 npx（临时沙箱改 lockfile，不碰仓库）；套件 4→6 项全 PASS。
- **F8-32（机制部分）已修**：scripts/run-tests.sh 逐套件按 ^PASS 行计数、
  与 manifest 的 expectedPass 比对（不一致判该套件失败）、打印总账
  （实跑合计/登记合计自动加总）；tests/suites-manifest.json 为全部 25
  套件登记 expectedPass（本分支当前实测值，合计 325）；suite-manifest
  新增 ⑥登记完整性断言与 ⑦实跑其余套件逐个比对计数（自身计数由
  run-tests 外层比对，避免递归）。刷新登记只需改 manifest 数字。
  legacy-credits 本分支登记 15（其实跑 PASS 行数；其自报 14 与双子例
  归一由 API 路在其套件内处理，集成时协调人按最终实测刷新）。

## 新套件清单

| 套件 | PASS 行 | 覆盖 |
|---|---|---|
| tests/smoke-chain.test.mjs | 10 | F8-04 smoke.sh / gen-headers / smoke-headers 本体离线判定 |
| tests/gen-paprika-map.test.mjs | 7 | F8-29 gen-paprika-map.mjs 本体（沙箱+桩 fetch） |
| tests/coverage-report.test.mjs | 4 | F8-29 coverage-report.mjs 本体（沙箱 manifest） |

套件总数 22 → 25；PASS 行总账 274 → 325（run-tests 实测打印
「总账：PASS 行合计 325 / 登记期望合计 325」）。
