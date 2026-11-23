# CONSTRUCTION_PHASE8-scripts.md — 第八期修复 · 批 6 脚本运维路施工记录

- 分支：`p8-scripts`（worktree `~/workspace/phase8-wt/scripts`），基线 22 套件。
- 范围：F8-19、F8-22、F8-23、F8-24（确认）+ F8-25、F8-26（疑似，先验证定性）。
- 纪律：未部署、未 push、未 merge、未动 master；测试均走临时路径，未污染仓库内 `ops/*.jsonl`（全量跑后 `git status` 干净可证）。
- 验收：`./scripts/run-tests.sh` 全量 **22/22 套件通过、退出 0**（与基线套件数一致，无新增套件、无 manifest 改动）。

## 逐条处置

### F8-19（确认 → 已修）build.py 原子落盘权限被收紧为 0600
- 复现（改前实测）：目标文件 0644 经 `_stage_and_land` 落盘后变为 **0600**；新目标同样 0600。
- 修法（`scripts/build.py` `_stage_and_land`）：暂存文件落盘前 `os.chmod` 到目标原权限——目标存在则沿用其 mode，不存在则用 `0666 & ~umask`（与改前 `write_text` 新建行为一致，umask 022 时即 0644）；备份文件同样 chmod，回滚落盘也保留原权限。
- 验证：实测 0644 目标经 build 后仍 **0644**；用例入既有套件 `tests/build_paprika_map_test.py`（同主题：测 build.py 函数，未新建设套件、未改 suites-manifest）：覆盖 0644 沿用、0640 沿用、新目标 `0666 & ~umask` 三形态。套件 6 → **7 项全过**。
- Commit：`ca1d012`

### F8-22（确认 → 已修）quota-check INVALID 路径静默吞日志写失败
- 复现（改前实测）：陈旧 health（month 不符）走 INVALID 路径且 `LOG_PATH` 指向不存在目录时，退出码虽为 3，但 stderr **为空**——日志写失败无任何提示，失效记录无声丢失，与正常路径「写失败 → 报错 exit 3」口径不一致。
- 修法（`scripts/quota-check.py`）：INVALID 路径的 `except Exception: pass` 改为 stderr 打印 `quota-check: ERROR 写入 <LOG_PATH> 失败：<err>`，退出码维持同一码 **3**。
- 验证：用例入 `tests/quota_check_test.py` ⑯（LOG_PATH 指向不存在目录 + 陈旧 health）：断言退出 3、stderr 含「写入」与日志文件名、stdout 仍有核账失效报错。套件 20 → **23 项全过**（含本路 F8-23 的 4 项后为 27，见下）。
- Commit：`15fef1c`

### F8-23（确认 → 已修）wrangler pin 回退无警告且绕过锁版入口
- 复现（改前实测）：package.json 不可读时，quota-check 静默以裸 `npx wrangler@4.159.0` 调用（stdout/stderr 均无 WARN）；check-shadow-health 有 WARN 但同样走裸 npx。当前 pin 4.159.0 与 package.json 一致属实，未改动该值。
- 修法（两脚本同口径，各加 `wrangler_cmd_prefix()`）：
  - 正常路径：优先走锁版入口 `scripts/wrangler-pinned.sh`（pin 唯一来源 package.json、lockfile 一致性由入口校验）；调用前先比对 package-lock.json，不一致时 stderr WARN（入口本身亦会拒绝执行）。
  - 回退路径（仅 package.json 读不到）：裸 `npx wrangler@4.159.0` + stderr WARN 明示「回退写死值、绕过锁版入口」；回退值再与 lockfile 比对，不一致再 WARN。
  - WARN 一律走 stderr（check-shadow 原 stdout WARN 随之统一），不污染 quota 的 stdout JSON 记录。现行可用路径不变：真实仓库实测前缀为 wrangler-pinned.sh 且无 WARN。
- 验证：`tests/quota_check_test.py` ⑰a–⑰d（回退 WARN、正常走锁版入口、lockfile 不一致 WARN、read_kv_key 回退端到端组装）；`tests/time_tolerance_test.py` ④（check-shadow 同三分支——该套件已加载 check-shadow 模块，为本路允许文件且不新建套件）。quota 套件 → **27 项全过**，time_tolerance 套件 4 → **5 项全过**。
- Commit：`1f051c9`

### F8-24（确认 → 已修）probe.sh 写探针日志无失败检查
- **退出码消费方核查结论**（仓库内证据）：① HC1 cron `top200-hc1-hourly-probe` 按退出码三分流——0 → success ping、4（warn）→ ping `/fail` 附降级注记、1（fail）→ ping `/fail`（`ops/probe-config.md` HC1 行与 F6-23 定版逐字一致，第七期已核 cron 本体）；② `scripts/deploy.sh:251` 部署后调用只判非零与否，未全过只告警不改判部署成败；③ 无其他仓库内消费方依赖 probe.sh 的具体码值（grep cron/runbook/脚本引用核毕）。
- 复现（改前实测）：副本中日志路径为不可写（目录冒充文件）+ 本地 mock 基址全 pass 时，python 写日志抛 IsADirectoryError，但脚本 **仍 exit 0**、verdict=pass，留痕静默丢失。
- 修法（`scripts/probe.sh`）：日志写命令加失败检出；处置与现行语义兼容——**verdict 不变**，stderr 明示「探针日志写入失败…verdict 不变，留痕丢失」并在 stdout 加 `log_write: fail` 行；退出码：fail → 1 不变、warn → 4 不变、**pass + 日志失败 → warn 级 4**（HC1 按降级 /fail 附注记上报，留痕丢失可见），**绝不升为 fail 级 1**，不把本地留痕故障误报为站点故障。新语义已写进脚本文件头注释。另：日志路径支持环境变量 `PROBE_LOG_FILE` 覆盖（默认 `ops/probe-log.jsonl` 不变），供测试指向临时/不可写路径。
- 关于 runbook：`ops/probe-config.md` 不在本路文件边界内，未擅改；建议协调人在 HC1 行补一句「probe 日志写失败时 pass 以退出 4 上报（降级注记含 log_write fail）」与脚本头对齐。
- 验证（本地 mock 基址实跑）：pass + 日志不可写 → **exit 4**、stdout 有 `log_write: fail`、stderr 有明示；pass + 日志可写（临时路径）→ **exit 0**、日志正常落 1 行。
- Commit：`d62ef87`

### F8-25（疑似 → **确认** → 已修）compare-shadow 拉 live 不判 HTTP 状态
- 定性证据（改前实测）：本地 mock 对 `/api/board` 返回 **HTTP 503 + 伪造 v2 体**（200 币、与 shadow 同 run、同价、coverage 满格），旧脚本输出 `verdict=pass, compared=200, failReasons=[], exit=0`——错误体被当 live 数据一路判 pass，污染成立，疑似转确认（compared 下限兜底在此形态下不触发，因伪造体自带完整 coins）。
- 修法（`scripts/compare-shadow.mjs`）：fetch 后先判状态，非 2xx 即输出 `verdict=fail` + `liveHttpStatus` + failReasons 注明状态码、退出 1，错误体不进入任何判读（与 F7-21 probe 修法同口径）。
- 验证：同一 mock 场景改后实测 → `verdict=fail, liveHttpStatus=503, exit=1`；用例入 `tests/compare-shadow.test.mjs` ⑭（进程内起 503 mock 服务、异步子进程驱动脚本）。套件 13 → **14 项全过**。
- Commit：`8331f70`

### F8-26（疑似 → **确认** → 已修）weekly_check 默认日期用本地时区
- 定性证据（改前实测）：同一时刻 UTC 2026-11-22（周日）12:00，`date.today()` 本地口径在 Pacific/Auckland 下得 2026-11-23 → 周标签 **2026-W48**，UTC 口径得 **2026-W47**，相差一周——跨周边界且运行机非 UTC 时 week_label 与 state 的 ISO 周推进错位成立，疑似转确认（quota/check-shadow 均为 UTC 口径）。
- 修法（`scripts/weekly_check.py`）：新增纯函数 `utc_today()`（`datetime.now(timezone.utc).date()`），main 默认日期改经此函数；显式 `--date` 传参路径不经此函数、不受影响。
- 验证：用例入 `tests/weekly_check_test.py`（固定时刻 UTC 周日/Auckland 周一，冻结模块时钟后在 TZ=Pacific/Auckland、UTC、America/New_York 三时区下断言默认日期恒 2026-11-22、标签恒 2026-W47）；另以 `TZ=Pacific/Auckland` 整套件实跑亦全过。套件 18 → **19 项全过**。
- Commit：`6830feb`

## 汇总

| 条目 | 定性 | 处置 | 用例落点 | commit |
|---|---|---|---|---|
| F8-19 | 确认 | 已修 | build_paprika_map_test.py（7 项） | ca1d012 |
| F8-22 | 确认 | 已修 | quota_check_test.py ⑯ | 15fef1c |
| F8-23 | 确认 | 已修 | quota_check_test.py ⑰a–d、time_tolerance_test.py ④ | 1f051c9 |
| F8-24 | 确认 | 已修 | 本地 mock 实跑验证（probe.sh 无既有套件，未新建） | d62ef87 |
| F8-25 | 疑似→确认 | 已修 | compare-shadow.test.mjs ⑭（14 项） | 8331f70 |
| F8-26 | 疑似→确认 | 已修 | weekly_check_test.py（19 项） | 6830feb |

全量：`./scripts/run-tests.sh` **22/22 套件通过**（基线 22 套件不变）；无证伪条目；未改禁改文件（deploy.sh、run-tests.sh、smoke.sh、wrangler-pinned.sh、verify-paprika-*、functions/**、public/**、shared/**、workers/**、suites-manifest.json、kv-write-guard.test.mjs 均未动）。
