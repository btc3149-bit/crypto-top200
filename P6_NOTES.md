# P6_NOTES — 第六期「门禁与脚本」施工员（批 0 + 批 4 脚本侧 + 批 7 若干）

分支：wt/p6-batch0-scripts。未部署、未 push、未碰生产/KV/Cloudflare（仅只读核查，见 F6-75/F6-23）。

## ⚠ 协调人集成时必办

1. **cron 需补 CLOUDFLARE_ACCOUNT_ID**：F6-87 后 `scripts/quota-check.py` 与 `scripts/check-shadow-health.py` 的 `CLOUDFLARE_ACCOUNT_ID` 改为必填环境变量、缺失即 fail-closed（quota 退出 3 / shadow 退出 2）。调用这两支脚本的 cron 编排指令必须补上该 env，否则核账/影子检查将直接失效退出。
2. **run-tests.sh 套件清单需补入新套件**：统一清单集中定义在 `scripts/run-tests.sh` 的 `SUITES` 数组（唯一台账）。其他施工员新增的 health / quota / compare / coins-list 等套件，集成时按 `"<runner>:<路径>"` 格式补入该数组，`package.json` 的 `test` 与 deploy.sh 门禁即自动覆盖。
3. **runbook compare 口径行未动**：`docs/fetcher-runbook.md`「影子比对失败」表述（约 :43）本轮按分工未改，集成时按 compare 新语义统一修订。
4. deploy.sh 的 smoke-headers 结果以 gate 名 `smoke-headers`、reason 形如 `rc=0/1` 追加 `ops/deploy-log.jsonl`（与其他绕过留痕同文件）。

## 逐条处置

- **F6-01（P0）已修**：新增 `scripts/run-tests.sh`（SUITES 数组串联 Node 7 + Python 2 共 9 套件，任一非零整体失败）+ `package.json` 增加 `"test": "bash scripts/run-tests.sh"`。deploy.sh 在数据门禁前调用 `npm test`，失败中止；`DEPLOY_SKIP_TESTS=1` 绕过须 `DEPLOY_SKIP_REASON` 非空且自动追加 `ops/deploy-log.jsonl`（时间/门禁/原因/env），无理由拒绝（已实测 rc=1 拒绝）。去掉 `--commit-dirty=true`；脏工作区默认中止，`DEPLOY_ALLOW_DIRTY=1`+理由+落 log 才放行。验证：run-tests.sh 实跑 9/9 通过。
- **F6-80 已修**：统一入口同 F6-01；`scripts/coverage-report.mjs` 自动发现范围补上 Python 两套件（实跑并解析计数纳入汇总表：test_render_snapshot 8/8、weekly_check 14，退出码纳入 --strict 判定）。验证：coverage-report 实跑输出含两行 Python 套件及计数。
- **F6-06 已修**：deploy.sh 增加模式门禁——行首锚定解析 wrangler.toml `[vars]`（注意：文件注释中先出现 `[vars]` 字样，正则已锚定 `^\[vars\]`，quota-check 同修此坑），production 期望 `kv`，不符中止；`DEPLOY_ALLOW_MODE_OVERRIDE=1`+理由+落 log 才放行。smoke.sh 追加断言⑦ servedFrom ∈ {kv, cache, memory}（取 `freshness.servedFrom`）。验证：线上 smoke 全过、servedFrom=kv。
- **F6-07 已修**：quota-check.py 读 wrangler.toml `[vars]` BOARD_READ_MODE（读不到回退线上 /api/board 的 servedFrom：kv/cache/memory→kv）；kv 模式判级规划口径取 legacy=0 场景（floor_all_hit），576/1152 保留为 scenarios 参考列、不参与判级；护栏 `impliedMaxAvgLegacyPerDay < 576` 时 record 置 `planningScenarioFalsifiedByGuardrail=true` 并在 `verdictNote` 旁注。退出码语义不变。验证：stub wrangler（已用 5000）实跑 → verdict=OK、planningScenario=floor_all_hit、boardMode=kv（旧口径同数据为 WARNING）。
- **F6-24 已修**：quota-check.py 前置校验：health.month 与当前 UTC 月不一致、或 lastRunAt 距今 >3h（或不可解析）→ 退出 3 并注明「health 陈旧、核账失效」。落盘选择：**落一条带失效标记的记录**（verdict="INVALID"、staleHealth=true），不落正常判级记录。验证：stub 旧 lastRunAt 实跑 rc=3、log 末行即 INVALID 记录。
- **F6-25 已修**：record 增加 `scriptVersion="2.0-g3"`（脚本内常量）与 `methodology="g3-aware: planning=legacy0 when kv"`（含 INVALID 记录）。
- **F6-26 已修**：DEPLOY_SKIP_META_CHECK 绕过改走统一 `require_bypass_reason`：须 DEPLOY_SKIP_REASON 非空 + 自动追加 ops/deploy-log.jsonl，否则拒绝。
- **F6-27 已修**：smoke.sh 追加断言⑧ v2 契约字段（contractVersion===2、freshness 存在、fetch.fetchRunId 字段存在、coverage.returned 与 coins 键数一致）；deploy.sh 在 smoke 后追加 `node ops/headers/smoke-headers.mjs <base> --variant=on --only=S1,S2,S4,S6`，结果落 deploy-log，非零时部署末尾醒目提示 + 非零退出（部署已发生、不假装未部署）。验证：线上 smoke ⑦⑧ PASS。
- **F6-09 已修**：weekly_check.py——top250 拉取失败或为空 → 本轮作废：不覆写 watchOut/watchIn（保留旧值）、不推进 lastRunWeek（只记 lastAttemptWeek）、报告头醒目标记「本轮作废」、退出码 2。验证：monkeypatch fetch_json 使 top250 抛错实跑 main() → rc=2、旧 watch 原样保留、lastRunWeek 未动、报告含作废标记。
- **F6-72 已修**：ids 返回行数 <180（`ids_rows_complete` 纯函数）判 incomplete：ids_fetch_ok 保持 False、本节不产出下架候选，incomplete 与报告 A2 均注明「大面积缺行（疑似拉取异常）」，与个别缺行区分。
- **F6-73 已修（按协调人代站长确认口径实施）**：退出码语义——作废=2；alerts>0 或 incomplete 非空=1；其余=0；报告内容不变，脚本头注释已写明。
- **F6-69 已修**：build.py 两条路径（--emit 与全量）统一走 `emit_and_render()`：全部产物先渲染到临时目录（临时 coins 过 check_meta + render_snapshot 渲染到临时 html），全部成功后才一并落盘（os.replace/write）；渲染失败 return 1 且现行产物逐字节不变。验证：`build.py --emit` 实跑后三产物 sha256 与跑前逐字节一致（幂等）。
- **F6-70 已修**：emit 编码前断言每币字段集恰等于 FIELDS23（多/少都 GateFail 并列 symbol）；落盘后对落盘文件再跑 check_meta，通过才返回 0。验证：构造多一字段的 doc → GateFail 列出该 symbol。
- **F6-71（Python 侧）已修**：check_meta.decode_coins 增加行长断言（len(row) != len(fields) 抛 ValueError 并注明行号），build/render/weekly 共用路径同步受益；JS 侧未动。验证：短行构造 → ValueError。
- **F6-74 已修**：rollback.sh mode 子命令默认拒绝（退出 3）；须显式 ROLLBACK_MODE_API_ONLY=1 才执行，输出第一行即打印「此操作不改变线上行为…」；成功文案改为「mode API 配置层已设置（不改变线上行为）」；production 的 ALLOW_PROD_MODE_ROLLBACK=1 保留。验证：无 env 实跑 → 首行声明 + rc=3、未发任何 API 调用。
- **F6-75 已修（核实+防御）**：核实——经 custom.cloudflare 只读 API 查 production 24 条、preview 17 条部署，latest_stage.status **全部为 success**，当前列表中不存在非 success 条目（风险为潜伏项，未被现行数据证伪/证实有实际命中）。防御性修复已做：自动选择时过滤 latest_stage.status=success（在当前部署之后取第一个 success），确认输出打印目标 stage；--to 显式指定非 success 时打印警告。
- **F6-76 已修**：scripts/archive/ 下全部 6 个 .py（merge_refill.py、merge_refill2.py、legacy-pipeline/build_coins_json.py、map_ids.py、migrate_meta_v2.py、parse_report.py）在 shebang/docstring 之后第一条可执行语句加退役守卫（打印退役提示 + sys.exit(2)），代码保留可读。验证：逐个实跑均 rc=2。
- **F6-28 已修**：check-shadow-health.py 改 REPO_ROOT 拼路径读 package.json、subprocess 传 cwd=REPO_ROOT、pin 回退写死值时打印 WARN。验证：从 /tmp 以绝对路径调用正常。
- **F6-29 已确认并修复**：复现——stub wrangler（PATH 前置 npx 替身）输出无时区 lastSuccessAt，旧脚本抛 TypeError traceback、退出 1（应为 2）。修复：parse_iso 对 naive 结果补 timezone.utc，且 age 计算纳入 try。复测：同一 stub → 无 traceback、正常判读退出。
- **F6-87 已修**：两脚本 CLOUDFLARE_ACCOUNT_ID 改必填环境变量、缺失即 fail-closed（quota rc=3 / shadow rc=2），删除字面量默认值。NAMESPACE_ID 保留字面量——其为 wrangler.toml 公开值（BOARD_KV namespace id 已印在 wrangler.toml），风险低。**cron 需补该 env，见文首提醒。**验证：缺 env 实跑两脚本均 fail-closed。
- **F6-90 已确认并修复**：复现——stub wrangler stderr 含账号/命名空间 ID 形态时，旧两脚本均原样透传前 300 字符（ID 明文出现在输出中）。修复：错误输出只保留 rc + 错误类别（auth/network/notfound/unknown 归类映射）；原文仅 DEBUG 环境变量开启时打印且先把 32 位 hex 串脱敏为 `<redacted-hex>`。验证：复测输出仅 `category=auth`；DEBUG=1 时 detail 中 ID 已脱敏。
- **F6-37 已修**：gen-headers.mjs --check 失败处置提示改为完整命令 `node ops/headers/gen-headers.mjs --variant=on`；生成目标为 public/_headers 且未显式传 --variant 时报错拒绝（rc=2）。验证：无 --variant 生成 rc=2；--check（默认 off）失败提示含 --variant=on；--check --variant=on 通过。
- **F6-88 已修**：.gitignore 补 `.env`、`.env.*`（保留 `!.env.example`）、`*.pem`、`*.key`、`*.p12`。
- **F6-93 已修**：ops/security/key-ledger.md 中 CoinGecko 账号邮箱改为脱敏形态（仅保留域名 + 注「账号见保险箱连接备注」，共 1 处），key 名称保留。原值未抄入本笔记与 commit message。
- **F6-23 仅核实（结论：成立）**：只读核对 HC1 编排 cron 指令（top200-hc1-hourly-probe）：其步骤 2 明文「退出码为 0（全过或仅 warn）→ ping success」，**未对 probe 的 warn 形态单独分流**（不解析 verdict=warn、不按 warn ping /fail）。即 stale ≤3600s 的 warn 档在 HC1 维度被报成 success，与报告疑似结论一致。probe.sh 本体按分工未动，修复（probe warn 单独退出码或编排分流）待协调人安排。
- **F6-10 runbook 标注已做**：docs/fetcher-runbook.md 已加 Paprika 备源状态行「当前不可用：映射未落库（0/200）、启用门禁未达，禁止置 PAPRIKA_ENABLED=true」。
- **compare 口径行提醒**：runbook 中 compare 相关口径行（约 :43「影子比对失败」）本轮未动，集成时按新语义统一改（见文首第 3 条）。

## 测试

改前基线与改后均跑全量：`bash scripts/run-tests.sh`（npm test）9/9 套件通过（Node 71 项 + Python 22 项口径，含 snapshot-verify 5/5、render 8/8、weekly 14/14）。另有针对性验证见各条目（stub wrangler、monkeypatch、线上只读 smoke）。
