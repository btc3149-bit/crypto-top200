# P7_NOTES_DATA — 第七期批 0（Paprika/数据 + fetcher 健壮性子集）施工记录

- Worktree：`~/workspace/phase7-wt/data`，分支 `p7-data`。未部署、未 push。
- 负责条目：F7-01、F7-02、F7-05、F7-14、F7-15、F7-16、F7-18。
- Paprika API 实测日期：**2026-11-23**（约 12:53–13:05 CST / 04:53–05:05 UTC），口径：`/v1/coins` 全量 62,744 条、`/v1/tickers?quotes=USD&limit=5000` 实回 2,000 条（端点上限）。

## F7-01 映射错配修正 + 38 条身份复核

- 修正（事实源 `workers/fetcher/src/coins-list.js`）：`pump-fun: pump-pumpbtc → pump-pumpfun`、`sky: sky-skycoin → sky-sky`、`seeker: skr-saakuru-labs → skr-seeker`。
- 派生数据再生：先跑 `python3 scripts/build.py --emit`——其实测行为是**只为缺失 paprikaId 的旧文档补列、不重同步已落盘值**（emit 成功但三份 coins.json 未变化，已核实源码 `scripts/build.py` emit/migration 段）。故按任务预案改用结构化脚本：以 coins-list.js 为唯一源同步三份 coins.json（`data/`、`public/data/`、`workers/fetcher/`）的 paprikaId 列（每份恰改此 3 条），并按项目既有口径（`check_meta.data_hash`，口径 A：解码后规范对象数组 sha256）重算 `meta.dataHash`：`sha256:73a22ff0…b179 → sha256:0a1382e2…9209`。三份文件再生后逐字节一致，`check_meta` 8/8 PASS，文件格式（单行紧凑 JSON）不变。
- 38 条复核：提案中身份依据仅 `[symbol_exact]`（24 条）或 `[slug_eq_cgid+symbol_exact]`（14 条）、无 name 核对的 accept 共 38 条。用本地 name/symbol（data/coins.json）与 Paprika `/v1/coins` 名录逐条按「symbol 全等（trim+大写）+ 规范化 name 全等或已知别名」复核（脚本 `scripts/verify-paprika-identity.mjs`，逻辑在 `shared/paprika-identity.js`：剥离 Token/Network/Protocol 等通用后缀、驼峰拆分、显式别名表 9 条）。结果：除已修正 3 条外其余 35 条均为同资产异名变体、身份成立（评审结论复核一致），无新增留空。别名通过 9 条（immutable-x、eigenlayer、floki、syrup、polygon-ecosystem-token、elrond-erd-2、hedera-hashgraph、prometeus、leo-token），脚本输出逐条标注。
- 附带发现（未改值、留档）：cosmos→`atom-cosmos-token`（名 Cosmos Token，rank 1112）与 litecoin→`ltc-litecoin-token`（rank 423）在 Paprika 均另有同资产主条目（`atom-cosmos` rank 108 / `ltc-litecoin` rank 30，价格与现映射条目差 <0.2%、symbol/name 核心一致），属同资产重复条目、身份成立；是否改指主条目建议后续按 F7-18 rank 优先口径单独定夺，本批未动（任务只指定修正 3 条）。
- **重报四项计数（2026-11-23 实测，修正后）**：映射非空 **mapped=196/200**；身份有效 **identityValid=196/200**；活跃可用 **activeUsable=195/200**（`yzy→yzy-yzy` 已下线 `is_active=false`、rank 0，不计）；tickers 实测命中 **tickerHit=179/200**（存在且报价有效口径；`scripts/verify-paprika-coverage.mjs` 独立复跑同得 179，presentInvalidQuote=0）。未命中 21 = 未映射 4 + 已映射未进 tickers 前 2000 共 17（逐条清单见身份脚本输出，如 ape-and-pepe rank 5811 等）。

## F7-02 启用门禁四项化

- `workers/fetcher/src/source-state.js` 新增纯函数 `evaluatePaprikaGate(stats,total)` + `paprikaGateThreshold`：mapped / identityValid / activeUsable / tickerHit **四项均须 ≥ ceil(94%×total)**（与发布覆盖门禁 COVERAGE_RATIO=0.94 对齐，200 币即 188）。旧 `PAPRIKA_MIN_MAPPED=197` 保留为历史常量并注明不再是放行条件。
- `workers/fetcher/src/index.js`：mapped 只认非空字符串（畸形真值不计）；provider 候选为 Paprika 时才做 candidate preflight（`providers/coinpaprika.js` 新增 `fetchGateStats`：拉 `/v1/coins` + tickers limit=5000、经 `shared/paprika-identity.js countPaprikaGateStats` 计四项）；mapped 本地已低于门槛时跳过 preflight（零 Paprika 调用，兼容 F6-10 旧用例口径）；任一计数不足或 preflight 失败 → 同 run 强制 CG 并 warning。四项计数分开落 `health.paprikaGate {mapped, identityValid, activeUsable, tickerHit, threshold, total, ok, checkedAt}`（成功与失败路径均写），`health.paprikaMappedCount` 保留兼容。
- CG 正常路径零额外风险：`PAPRIKA_ENABLED=false`（生产现状）时 provider 恒 CG、不触发 preflight（新套件有用例断言零 Paprika 调用、paprikaGate=null）。
- 运行时身份口径说明：fetcher COINS 只有 {id, paprikaId}，运行时 identityValid 为「目录存在 + 目录 symbol 与 paprikaId 前缀一致」；全名身份由落库复核脚本（持本地 name/symbol）强制，二者共用 `shared/paprika-identity.js`。
- **生产仍保持关闭**：wrangler.toml `PAPRIKA_ENABLED="false"` 未动；实测 tickerHit=179 < 188，门禁不放行。

## F7-14 verify-paprika-coverage.mjs

- tickers 拉取加 `limit=5000`（与 fetcher F6-53 同口径）；命中须报价有效（`paprikaQuoteValid`：price 有限正数，与 fetcher 清洗口径一致），存在但报价无效单列 `presentInvalidQuote` 并计入缺失说明、不计 hit。
- 输出分项计数：RESULT 行与正文均含 mapped / present / validQuoteHit / presentInvalidQuote / missing。2026-11-23 实跑：`RESULT: FAIL hits=179 mapped=196 present=179 validQuoteHit=179 presentInvalidQuote=0 missing=21`（<195 禁止启用，结论不变）。

## F7-15 Paprika 归一化清洗对齐（shared/board-schema.js）

- 新增 `sanitizeSignedNumber`（change24h，|v|≤1e6）、`sanitizeRank`（正整数 ≤1e6）、`makeFieldCleaner`/`emptyInvalidFields`。
- `normalizePaprikaTickers`：price/mcapUsd/volume24h 走非负上限清洗、change24h 带符号清洗、rank 正整数清洗，坏值置 null 并计 `invalidFields {price,mcapUsd,volume24h,change24h,rank,total}`，返回值新增 invalidFields（provider `fetchMarkets` 透传）。单币坏字段不再靠 validateBlob 整 blob 拒绝拖垮整轮。
- `normalizeCgMarkets` 同步补 change24h/rank 清洗（两路对齐）；`validateBlob` 新增 change24h/rank 类型门禁并计入 stats.invalidFields。

## F7-16 注释同步

- `workers/fetcher/wrangler.toml` 头注释改为现行 G3 形态（Cron 已启用、BOARD_TARGET_KEY="current"、无 BOARD_FETCH_DISABLED、key 已注入），G0/G1 内容降为明确标注的历史注记。
- `workers/fetcher/src/coins-list.js` 头注释更新日期行与现状（W5 落库 + 第七期 F7-01 修正 + 新门禁口径）。

## F7-18（疑似）验证结论 + 生成器修正

- 统计（2026-11-23 /v1/coins 全量）：活跃条目中「同 symbol + 同规范化 name、多 id」组共 **118 组**，风险属实。本表 200 币涉及 3 组：pepe（pepe-pepe rank 53 vs pepe-pepe2 rank 5637+）、instadapp/Fluid（inst-instadapp rank 292 vs fluid-fluid rank 4670+）、midnight-3（night-midnight2 rank 81 vs night-midnight rank 9198+）——现映射 3 条恰均为组内 rank 最优，**未发现由此产生的错配**（与评审「疑似」定级一致）。
- `scripts/gen-paprika-map.mjs`：候选统一按活跃优先、rank 升序排序；name 全等候选恰 1 个才给「高」置信；多条时取 rank 最优作候选但标记 `ambiguousNameGroup`、置信降「中-同名多条」交人工核定，rank 并列最优则不给候选（「无候选-同名歧义」），且歧义时不再落入子串匹配。CSV 新增 `ambiguousNameGroup` 列，detail 新增 `nameEqualCandidates`。
- 验证（/tmp 副本实跑，未改仓库内审查表）：置信分布 高 159 / 中 19 / 中-同名多条 3 / 无候选 19；3 组歧义的最优候选与现映射一致（pepe-pepe、inst-instadapp、night-midnight2），且 pump-fun/sky/seeker 候选恰为修正值（pump-pumpfun 高、sky-sky 高、skr-seeker 高）。

## F7-05 fetcher README 重写

- 顶部改为现行 G3 现状（Cron 已启用、current 直写、key 已注入、Paprika 保持关闭及新门禁数字、事故处置要点：停抓用 BOARD_FETCH_DISABLED、**禁止**改回 shadow）。
- G0/G1 段移入「历史（仅存档、不得作为操作步骤）」专节并明确标注失效；开关口径表保留并更新 Paprika 门禁为 F7-02 四项口径；coins 同步节补 `--emit` 不重同步已落盘 paprikaId 的注意事项。

## 测试

- 新增套件 **`tests/paprika-gate.test.mjs`（9 项，全绿）**——覆盖 F7-01 身份判定、F7-02 四项计数/94% 门禁/主流程 preflight 三态、F7-15 清洗与 validateBlob。**请协调人将其登记进 `scripts/run-tests.sh` 的 SUITES 清单**（该文件不在本路改动范围，未动）。
- `bash scripts/run-tests.sh`：**15/15 套件通过**（含 fetcher-branches 40/40、coins-list-contract 5/5、contract-real-data 8 PASS——映射非空仍 196、未映射仍 4 币，旧断言无需改）。
- 身份/覆盖实测命令：`node scripts/verify-paprika-identity.mjs`（实时）与 `--coins-file/--tickers-file` 缓存模式均得 mapped=196 identityValid=196 activeUsable=195 tickerHit=179、gate ok=false（仅 tickerHit 不足，退出码 1 为预期）；`node scripts/verify-paprika-coverage.mjs` 得 hits=179 FAIL（预期）。

## 未改动范围确认

未改 `functions/`、`scripts/weekly`、`scripts/quota-check.py`、`scripts/run-tests.sh`、`scripts/build.py`、`public/index.html`；`public/data/coins.json` 仅由上述结构化同步脚本按管线口径更新 paprikaId 列与 dataHash。未部署、未 push。
