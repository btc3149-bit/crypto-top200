# P7_NOTES_GUARD — 第七期批 1（守卫与门禁/测试）施工记录

分支 `p7-guard`（独立 worktree，未部署、未 push）。负责：F7-03、F7-04、F7-06、F7-07、F7-29、F7-30、F7-31、F7-32，顺带 F7-26。
禁区遵守：未改 `functions/api/board.js`、`workers/fetcher`、`public/index.html`。

## 总测试结果

`npm test`（经新 manifest 驱动，16 套件）：**15/16 套件通过**。唯一失败 = `tests/frontend-dom.test.mjs` 的 ⑰ 定版断言（见 F7-31 节：该断言按与前端组商定的定版口径书写，红的原因是批 3 的 F7-34 修复尚未合入本分支，属预期跨批红，断言本身已实证能精确检出 4px 侵入）。

## F7-03｜KV 写守卫重构（先行完成）

- 新增 `tests/helpers/kv-guard-scan.mjs`：token 级扫描器（自研 tokenizer，剥离注释/字符串/正则内容；无新依赖）。机制：
  - 来源追踪迭代至不动点：`env`/`context.env` 派生、直接别名、链式别名、解构（含重命名）、括号取绑定 `env["BOARD_KV"]`、计算属性 `kv["put"]`/`kv["pu"+"t"]`、方法别名 `const p = kv.put`、解构方法 `const {put} = env.BOARD_KV` 均可识别。
  - fail-closed：接收者来源不可判定（未声明标识符、函数形参）的 put/delete 调用、KV 接收者上不可静态求值的计算属性键，一律 offender。
  - 已证明非 KV 的接收者不拦（`caches.default` 派生的 `cache.put` 为现行合法代码，有正向 fixture 与现行全仓扫描双证）。
  - 唯一批准写五项全合才放行：文件 = `functions/api/board.js`、接收者恰为 `env.BOARD_KV`、方法 = put、第一实参恰为 `KV_KEYS.legacyCredits`、调用点位于 `addLegacyCredits` 函数体内（括号配平定位）。对批准键的 delete、错键、错文件同形调用均拦。
- `tests/kv-write-guard.test.mjs` 重写：现行 functions/ 全仓扫描（恰 1 处批准、零 offender）+ 11 个负向 fixture（`tests/fixtures/kv-guard/*.js`，逐一对应评审绕过样本：alias/destruct-method/computed/indirect-alias/method-alias/destruct-rename/bracket-binding/wrong-key/delete-approved-key/unknown-receiver/computed-dynamic）+ 3 个正向 fixture。**15/15 PASS**。
- 已知边界（如实登记于扫描器文件头）：经函数返回值间接取得的 KV 无法静态判定来源——此类调用会被 fail-closed 拦下，须过评审登记后放行；Reflect/Proxy 元编程写路径不在静态口径内，靠评审兜底。

## F7-04｜preview 冒烟分流

- `scripts/smoke.sh` 新增第二参数 `[production|preview]`（默认 production）：preview 只拉首页与 `/data/coins.json`、只跑断言 ⑤⑥，board 断言 ①②③④⑦⑧ 整组 SKIP 且不拉取 board；production 全量不变。
- `scripts/deploy.sh`：preview 传 preview 模式且**无论成败不发 HC2 success/fail ping**（HC2 仅记生产部署）；production 维持全量冒烟 + HC2 原口径。
- 实测（只读 GET）：`smoke.sh https://preview.crypto-top200.pages.dev preview` → ⑤⑥ PASS、exit 0（评审实测的 5 项 FAIL 已消除）；`smoke.sh https://top200.oppcal.com production` → 8 项全 PASS；同一 preview 址以 production 模式跑仍 5 项 FAIL，证明分流点正确。
- README 仅改手动冒烟示例一行（preview 命令补 `preview` 参数）。注：README 第 52 行 deploy 流程描述与现状的脱节属 F7-55（文档组），本批未动、请文档组对齐时一并带上 smoke 模式参数。

## F7-06｜compare-shadow 上限用例

- `tests/compare-shadow.test.mjs` 6 例 → **13 例全绿**。新增：⑦ same-source（servedFrom=kv 同 run）上限 conditional；⑧ `--shadow-key current` 显式同源；⑨ runGate 未达标（countedRuns=2<10）；⑩ runGate 无证据（countedRuns=null/met=null）；⑪ live null price 恰 1 → 上限；⑫ live null mcap 恰 2 → 上限（用尾部币隔离 top20 判据）；⑬ live null 3 → fail。
- 变异验证：临时删脚本 sameSource 上限一行 → ⑦⑧ 变红（11 PASS/2 FAIL），恢复后 13/13。删其余上限逻辑同理被 ⑨⑩⑪⑫ 覆盖。

## F7-07｜quota-check 判级用例

- `tests/quota_check_test.py` 6 例 → **22 例全绿**。新增：⑦ 月份不符 → INVALID/3；⑧ lastRunAt >3h → INVALID/3；⑨ 恰 3h 边界 → 有效 OK；⑩ 未来 +1h → 现状 OK（见下方给协调人项）；⑪ 不可解析/缺失 → INVALID/3；⑫ 非 kv 分支（legacy 与 mode=None 两形）→ 规划口径 576/天 WARNING/1；⑬ legacyMeasured 键缺失 → available=false/credits=null；⑭ 跨月 → available=false（credits 现状见下）；⑮ `read_legacy_credits` 本体畸形过滤 5 形 + 合法形态（另载全新模块实例取原函数，避免 monkeypatch 污染）。
- **给协调人（脚本缺陷，只记录未改 quota-check.py）**：
  1. **F7-25 实证**：计数键跨月时记录出现 `available=false` 但 `credits=42`（上月值）、`month=2026-10` 的组合——⑭ 已锁定现状并注明，脚本组修 F7-25（跨月 credits 置空）后须把 ⑭ 期望改为 credits=None。
  2. **F7-27（quota 侧）实证**：`lastRunAt` 在未来（+1h）不触发陈旧判级（单侧校验），⑩ 锁定现状；脚本组双侧化后须改 ⑩ 期望为 INVALID/3。

## F7-29｜FIELDS24 第 24 列负向用例

- `shared/board-schema.js` 新增校验接口（纯函数，未动 functions 主逻辑）：`isValidPaprikaId(v)`（仅 null 或 `^[a-z0-9]+-[a-z0-9-]+$` 合法）、`countValidPaprikaMappings(coins)`（只计合法非空字符串，取代 truthy 计数口径）。
- `tests/contract-real-data.test.mjs` 新增 R4/R5/R6（套件 11 例全绿）：
  - R4 行长 23/25（fields 声明 24）→ 前端 `decodeCoinsData` throw（行形校验）走快照兜底。
  - R5 board `getIds` 定版行为：只按名取 coingeckoId 列，行长 23/25 不影响 200 id 全量提取（实测捕获 markets 请求 ids 断言）。
  - R6 paprikaId 为数字/对象/空串：解码层原样透传（定版不在解码层校验）、门禁接口判畸形且不计入 mapped；真实数据 `countValidPaprikaMappings == 196` 与落库口径对账一致。

## F7-30｜legacy-credits 计数时机用例

- `tests/legacy-credits.test.mjs` 5 例 → **11 例全绿**：⑥ markets HTTP 500 与网络抛错两形失败仍 +2（按已发出计）；⑦ 熔断：首轮 429 计 +2 且 503、熔断期内第二轮短路 503 且不再计；⑧ dual 模式计 +2；⑨ 旧键 credits 为字符串 → 回退 0 基数；⑩ 旧键 JSON 损坏 → 回退 0 基数；⑪ 旧键为 JSON 字符串形态 → 二次解析后累加（40+2=42）。
- **行为与明文口径全部相符，无缺陷需报 API 组**（board.js 未改）。

## F7-31｜命中域测试升级为行为/计算断言

- `tests/frontend-dom.test.mjs` ⑰ 由 CSS 文本正则改为微型 CSSOM：把 `<style>` 解析为有序规则表，按媒体条件求值（max/min-width、pointer:coarse）+ 同特异性后写覆盖的级联语义，计算三场景（桌面细指针 1280 / 粗指针 1024 / ≤640 移动 390）下 `.exp`、`.exp::after`、`.star` 的有效声明并断言几何：
  - `.exp` position:relative（::after 锚点，旧正则时代删之不红、现必红）；::after position:absolute + content 在位；桌面纵向命中 ≥44；粗指针档与 ≤640 档经级联本体恰 44 且 ::after inset 收回 0（级联顺序以计算结果验证，非 indexOf）。
  - 桌面星标不侵入定版：::after 右侧外扩不得越过 margin-right 间隙进入 .star 盒。
- **预期跨批红**：本分支 `frontend-dom` 18/19，⑰ 仅「桌面星标不侵入」一项红，实测值与 F7-34 评审证据逐字吻合（外扩 8px − 间隙 4px = 侵入 4px）。`public/index.html` 属前端组（F7-34，本批禁区），其修复合入后本断言应转绿；请协调人在批 3 合并后复跑本套件确认。

## F7-32｜套件集合单一事实源

- 新增 `tests/suites-manifest.json`（16 套件，含新增的 suite-manifest 自身）：`scripts/run-tests.sh` 与 `scripts/coverage-report.mjs` 改为共用该清单（coverage 的 Python 清单不再硬编码，quota_check_test.py 已纳入——实跑报告显示 13 Node + 3 Python）。
- 新增 `tests/suite-manifest.test.mjs`（3/3）：manifest ↔ tests/ 套件文件双向一致、条目存在/runner 匹配/无重复、两消费方均读 manifest 且 coverage 无硬编码 pySuites。

## F7-26｜coverage-report fail-closed

- `scripts/coverage-report.mjs`：默认任一套件失败即退出 1（与 run-tests 口径一致）；显式 `--report-only` 才只报告（输出中明示）；`--strict` 保留兼容（默认已 fail-closed，无额外作用），文件头口径已同步。
- 实证：临时注入一个必红套件并登记 manifest → 默认运行 exit 1、`--report-only` exit 0；临时套件与 manifest 条目已还原清除（suite-manifest 复跑 3/3）。

## 改动文件清单

- 新增：`tests/helpers/kv-guard-scan.mjs`、`tests/fixtures/kv-guard/*.js`（13 个）、`tests/suites-manifest.json`、`tests/suite-manifest.test.mjs`、`P7_NOTES_GUARD.md`
- 修改：`tests/kv-write-guard.test.mjs`、`tests/compare-shadow.test.mjs`、`tests/quota_check_test.py`、`tests/contract-real-data.test.mjs`、`tests/legacy-credits.test.mjs`、`tests/frontend-dom.test.mjs`、`shared/board-schema.js`（仅新增校验接口）、`scripts/run-tests.sh`、`scripts/coverage-report.mjs`、`scripts/smoke.sh`、`scripts/deploy.sh`、`README.md`（仅 preview 冒烟示例一行）
