# P7_NOTES_SCRIPTS — 第七期批 4（脚本与运维工具）施工记录

分支 `p7-scripts`，worktree `~/workspace/phase7-wt/scripts`。只改本 worktree，未部署、未 push。
负责：F7-17、F7-19、F7-20、F7-21、F7-22、F7-23、F7-24、F7-25、F7-27、F7-28。
边界遵守：未改 `scripts/coverage-report.mjs`（guard 组 F7-26/32）；未改 `functions/`、`workers/`、`public/`；
`scripts/deploy.sh` 只改了 deploy_log/审计段（diff hunk 位于约 :30 的 (a0) 段与文件末尾完成提醒两处），
**未改 preview 冒烟段**（(d) 段 `scripts/smoke.sh` 调用一带零改动）。

## 新增测试套件（请协调人纳入 scripts/run-tests.sh 的 SUITES manifest）

| 套件 | runner | 覆盖 |
|---|---|---|
| `tests/build_paprika_map_test.py` | python3 | F7-17（6 项） |
| `tests/probe_http_status_test.mjs` | node | F7-21（3 项） |
| `tests/time_tolerance_test.py` | python3 | F7-27 判定函数 + F7-25（4 项） |

另扩充既有套件 `tests/weekly_check_test.py`（已在 manifest 内，+4 项 F7-22/F7-23，用例总数 14→18）。
`tests/quota_check_test.py` 未改（guard 组补 F7-25 测试；既有 6 项含 W5 legacyMeasured 用例在本批改动后仍全绿）。

全量回归：`npm test` 15/15 套件通过；新增 3 套件单独跑全绿；`bash -n`（deploy/rollback/probe）、
`py_compile`（build/weekly/quota/check-shadow）、`node --check probe.mjs` 全过。

---

## F7-17（疑似→确认）build.py load_paprika_map 排版耦合

**复现（改前）**：对 coins-list.js 内容做排版变体后跑旧切分逻辑
（`split("export const COINS = ")[1].split(";\n")[0]` + json.loads）：
- 「分号后无换行、后续语句同行」形态 → `JSONDecodeError: Extra data: line 1 column 10318`，**确认脆弱性成立**；
- 「多行逐对象」形态旧逻辑靠运气能过（数组内无 `;\n` 序列），非保证。
**修复**（`scripts/build.py`）：新增 `extract_js_array(txt, marker)`——从 marker 后第一个 `[` 起做
括号深度计数（字符串/转义感知）匹配到对应 `]` 再 `json.loads`，与排版无关；提取不到/未闭合抛
ValueError（fail-closed）。`load_paprika_map(path=None)` 改用之，签名兼容（PAPRIKA_MAP 模块级加载不变）。
**测试**：`tests/build_paprika_map_test.py` 6 项全过（现行单行 200 条、多行逐对象、分号无换行、
等号后换行、字符串内方括号/转义、畸形抛错）。

## F7-19 rollback.sh ACCOUNT_ID 字面量默认值 + usage 示例

- 删除 `ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-<字面量>}"` 默认值（grep 复核字面量已清零），
  新增 `require_account_id()`：deployment/mode 子命令执行前缺失即报错退出 3（fail-closed，
  与 quota/check-shadow 的 F6-87 口径一致）；`--help` 不受影响（exit 0）。
- usage 示例与门禁对齐：mode 示例补 `ROLLBACK_MODE_API_ONLY=1`；production 示例补
  `ROLLBACK_MODE_API_ONLY=1 ALLOW_PROD_MODE_ROLLBACK=1`；deployment 示例改 production
  （原 preview 示例与「rollback API 只接受 production」自相矛盾）；环境变量说明改「必填」。
- 实测：无 env 跑 deployment/mode 均 exit 3 且不发任何 API 调用；有 env 无
  ROLLBACK_MODE_API_ONLY 跑 mode 仍被 F6-74 门禁 exit 3 拒绝。

## F7-20 deploy 绕过审计入版本控制

改动段：仅 `scripts/deploy.sh` 的 (a0) `deploy_log()` 段 + 文件末尾完成提醒一行 + `.gitignore` 一行例外。
- `deploy_log()` 在写本地 `ops/deploy-log.jsonl`（行为不变）之外，再向 `ops/deploy-audit.jsonl`
  追加脱敏审计记录 `{at, gate, env, event: gate_bypass|gate_event, reason: <脱敏>}`。
  脱敏规则：长 hex（≥32）打码、`token/secret/password/api-key/bearer` 的 `键=值` 形态打码、
  原因截断 200 字；审计写失败只警告不阻断部署。**不记录任何秘密值**。
- `.gitignore`：`ops/*.jsonl` 后加 `!ops/deploy-audit.jsonl`。验证：`git check-ignore
  ops/deploy-audit.jsonl` 退出 1（未被忽略）、`git status` 显示 `??`、`git add --dry-run` 可加；
  deploy-log/quota-log 仍被忽略（check-ignore 命中 :13）。
- 提示 commit：`deploy_log()` 每次留痕后 echo 提醒，脚本成功收尾再 echo 一次
  「请将 ops/deploy-audit.jsonl 随本次部署一并 git add/commit」。
- 行为验证：在 /tmp 副本单独抽 `deploy_log` 函数实跑，本地与审计两文件均落行，
  审计行含 `event=gate_bypass`；脱敏函数单元验证（运行时拼装的假 token/hex 串）确认明文不入审计。

## F7-21 probe.mjs HTTP 状态码判定

- 改前复现：本地 mock 返回 503 + v1 形态错误体 `{"error":...}`，旧 probe.mjs 输出
  `verdict: PASS`、exit 0（与评审证据一致）。
- 修复：fetch 后先判状态——非 2xx 立即输出 `{httpStatus, verdict:"FAIL",
  reason:"http_status_<code>：非 2xx 应答，错误体不判读"}` 并 exit 1，错误体不参与
  规则判读；2xx 但体非 JSON 走原 fetch_failed FAIL；输出新增 `httpStatus` 字段。
- 测试：新增 `tests/probe_http_status_test.mjs`（同进程 mock + 异步 spawn 子进程；
  首版 spawnSync 阻塞同进程服务器事件循环致死锁，已改异步并在文件内注明）3 项全过：
  503+v1 错误体→FAIL/1、200+v1 正常体→PASS/0、500+v2 完整体→FAIL/1。

## F7-22 weekly_check 退出码覆盖高价值信号

- 新增纯函数 `exit_code_for(...)` 并定版：run_void→2（优先，F6-09 语义不破坏）；
  alerts / missing_rows / cand_in / cand_out / due / queue / report_url_warn / incomplete
  任一非空→1；全空→0。脚本头退出码文档同步更新。
- 测试：weekly_check_test.py 新增 F7-22a（每类信号单独触发→1、全空→0）、
  F7-22b（run_void 恒 2 且优先于 1 类信号）。

## F7-23 weekly_check 写序与原子写、state 损坏区分

- 写序改版：state 的推进先在内存组装，**报告经原子写成功落盘后才写 state**；
  报告写失败→退出 3、state 不推进（可重跑重建）；state 写失败→退出 3 并注明报告已落盘。
- 原子写：新增 `atomic_write_text()`（同目录 mkstemp + os.replace），报告与 state 两处落盘均经之。
- state 损坏：新增 `load_state()` + `StateError`——文件缺失→默认 state；JSON 损坏/顶层非 dict
  → StateError，main 捕获后打印可区分错误并**退出 3**（新增码，脚本头已定义；旧实现
  traceback exit 1 与「有效但有告警」撞码）。
- 测试：weekly_check_test.py 新增 F7-23a（load_state 四形态）、F7-23b（原子写无残留/覆盖一致）；
  端到端实测：损坏 state 文件跑 `weekly_check.py --state <bad>` → exit 3、无报告产出、无 traceback。

## F7-24 build.py 落盘段原子化

- 新增 `_stage_and_land(pairs)`：全部产物先暂存到「目标同目录」临时文件（同盘保证
  os.replace 原子）、为已存在目标留同目录备份、依次 replace；任一步失败用备份回滚
  已替换目标后原样抛出；成功/失败均清理暂存与备份。
- `emit_and_render` 落盘段改用之：data/coins.json、public/data/coins.json（旧实现为
  非原子 write_text）、DO_NOT_EDIT.md、public/index.html 四目标同一事务；
  docstring 同步注明 F7-24。
- 验证：① `_stage_and_land` 单元场景——正常落盘无残留；暂存期失败时先行目标逐字节
  不变；replace 期失败（第二目标为目录）时已替换的第一目标被备份恢复。
  ② 实跑 `python3 scripts/build.py --emit` 成功，四目标哈希一致
  （data 与 public/data 同 sha256）、与改前产物逐字节相同、无 `.land-/.bak-` 残留。

## F7-25 quota-check legacyMeasured 跨月置空

- 新增纯函数 `build_legacy_measured(counter, month_str)`（脚本本体改动，测试由 guard 组补）：
  仅计数键存在、month==核账月、credits 为非负数、updatedAt 可解析且年月==核账月时
  available=True 并保留真实 month/credits/updatedAt；跨月/陈旧/畸形/无键任一情形 →
  available=False 且 **credits/month/updatedAt 全部置 None**，新增 `reason` 字段说明
  （counter-missing / counter-cross-month / counter-stale / counter-malformed 前缀）。
  main 改用该函数；既有 quota_check_test.py 6 项仍全绿（当月正常形态行为不变）。
- **建议的 quota cron 汇报字段（供协调人用 cron 工具改 `top200-quota-daily-check` 本体）**：
  日报汇总须固定包含 `legacyMeasured` 一节，字段为：
  `legacyMeasured.available`、`legacyMeasured.credits`（仅 available=true 时报数值，
  false 时只报「不可用」）、`legacyMeasured.month`、`legacyMeasured.updatedAt`、
  `legacyMeasured.reason`（available=false 时必报）；汇报规则：available=true 时报
  「legacy 实测本月 X credits（截至 updatedAt）」；available=false 时报 reason 原文；
  reason 或 available 状态较昨日变化时视为判级外独立信号、即使 verdict 不变也要提及。
  判级口径不变（仍按 G3：kv 模式 legacy=0，实测值不回填已用、不改判级）。

## F7-27（疑似→确认）未来时间戳双侧判定

**改前验证（三处全部假绿，确认成立）**：以 +1h 未来时间戳代入三处判定式——
probe.sh `age=-3600 ≤ 900` → pass；check-shadow `age=-3600 不 >1500` → OK；
quota `(now-lastRunAt)=-3600 不 >3h` → 不判陈旧。
**修复（统一容差 FUTURE_TOLERANCE_SEC=300s，未来超容差不得 pass/OK，容差内按正常处理）**：
- `scripts/probe.sh`：新鲜度判定链新增 `age < -300 → fail:updatedAt 在未来 …超过未来容差 300s`，
  pass 分支年龄显示改 `max(age,0)`；脚本头判定说明同步。
- `scripts/check-shadow-health.py`：判定抽纯函数 `judge(age_sec, consec)`，新增
  `age < -300` → problems（FAIL/exit 1）；main 改用 judge。
- `scripts/quota-check.py`：陈旧判定抽纯函数 `health_stale_reasons(health, now)`，
  新增 lastRunAt 未来超 300s → 核账失效原因（走原 INVALID 记录 + exit 3 路径）；main 改用之。
**fixture/测试证据**：
- `tests/time_tolerance_test.py` ①②：judge/health_stale_reasons 对 +1h 未来均判异常、
  +120s 容差内不报、过旧/跨月/连续失败仍报，全过。
- probe.sh 端到端 fixture（/tmp 副本 + 本地 mock 服务）：board 的 updatedAt=+1h →
  `freshness: fail (updatedAt 在未来 3598s，超过未来容差 300s…)`、verdict fail、exit 1；
  updatedAt=当前时刻 → freshness pass、exit 0（不误伤）。

## F7-28 cron delivery 核对（仓库侧）

- **仓库内无 cron 配置副本**：全仓检索 `*cron*` 文件名、cron 相关 json/yaml/toml 与
  `delivery` 字段（评审文档外）均无命中——cron 本体不在仓库，无法在仓库侧核对，
  本批**未声称已验证平台 cron**。
- **请协调人用 cron 工具核对的 job 清单**（名称抄自仓库文档 ops/probe-config.md、
  CONSTRUCTION_PHASE4.md 与评审 F7-28 证据）：
  | job 名称 | 现状（据评审实读） | 预期投递目标 |
  |---|---|---|
  | `top200-hc1-hourly-probe` | delivery 已明确带目标 chat（对照基准） | 用户主会话（与本体一致即可，不需改） |
  | `top200-hc4-shadow-probe` | delivery 为空数组，本体要求失败时向用户发汇总 | 应与 HC1 同一投递目标（用户主会话）；请核对空 delivery 的默认投递语义，若非主会话请补齐 |
  | `top200-quota-daily-check` | delivery 为空数组，本体要求判级变化时向用户汇报 | 同上；且本体需按 F7-25 上节补 legacyMeasured 汇报字段 |
  核对方法建议（评审原文）：查一条历史 HC4/quota 失败 run 的 result 投递记录，
  或在 cron 层确认空 delivery 的默认投递语义。

## 其他说明

- `scripts/deploy.sh` 的 HEADERS_RC 收尾段引用了 deploy-log 字样的一行报错文案未动（非审计载体本身）。
- 本批未触碰线上、未运行 deploy.sh/rollback.sh 的真实路径（rollback 仅跑门禁前路径，
  deploy_log 仅在 /tmp 副本抽函数验证）。
