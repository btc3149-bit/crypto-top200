# P6_NOTES — 批 1「API 与校验」施工员逐条处置记录

分支：wt/p6-batch1-api。基线（改前）：board 9/9、board-v2 13/13、board-fetcher 8/8 全绿。
改后：board 13/13、board-v2 21/21、board-fetcher 15/15、health（新）12/12、kv-write-guard（新）1/1、
fetcher-branches 24/24、frontend-dom 6/6、snapshot-verify 5/5、Python render 8/8、weekly 14/14。
唯一连带红：tests/contract-real-data.test.mjs 5/6（见文末「需协调人跟进」第 1 条，属 F6-03 口径变更的预期连带、非本组文件）。

## F6-02 已修（字段级门禁）
- shared/board-schema.js 新增 `FIELD_LIMITS`（price ≤1e12、mcapUsd/volume24h ≤1e18，远高于真实量级、只拦坏值）与 `sanitizeMarketNumber`（typeof number 且有限、非负、不超限才接受，否则置 null 并标记 invalid）。
- `normalizeCgMarkets` 对 price/mcapUsd/volume24h 全量清洗，返回值新增 `invalidFields {price,mcapUsd,volume24h,total}` 计数（fetcher 的 coingecko.js 目前解构 {rows, coverage}、忽略该字段，无破坏；建议 fetcher 组后续把计数落 health/日志）。
- `validateBlob` 返回值新增 `stats`（invalidFields 计数、nullPriceCount、rowCount、uniqueIdCount）；新增 error：`row_field_invalid`（任一行非 null 数值字段为字符串/负数/Infinity/超限）、`price_null_ratio`（price 非 null 比例 <98%，常量 `PRICE_NON_NULL_MIN_RATIO=0.98`，整 blob 判 error）。
- tests/board-fetcher.test.mjs 新增 7 条负向/交叉用例（字符串 price×2 路、负 mcap、1e30/Infinity/字符串 volume、全 null rows、coverage 不一致、global 全 null）。

## F6-52 已修（global 段校验）——★标记形态（交 fetcher 组消费）
- **定版标记：`validateBlob` 在 blob.global 关键字段（totalMarketCapUsd/totalMcapUsd、btcDominancePct/btcDominance、totalMcapChange24h）全为 null 时，errors 数组含字符串 `"global_all_null"`，且 ok=false。**
- fetcher 侧应据此（validate 失败含 global_all_null）沿用 prev global（含原 asOf），不得盖新鲜戳覆写；fetcher 的 index.js 消费动作由 fetcher 施工员在其文件内完成，本组未改 workers/。
- `normalizeCgGlobal` 产出形态未改。

## F6-04 已修（coverage 按实际键集重算）
- board.js `assembleV2`：coverage 改按 rows 实际键集重算（returned=去重 id 数、expected=在场∪自报 missingIds 的并集数、missingIds=并集−在场）；与 blob 自报不符时记结构化日志 `event:"coverage_recomputed"`（含 blobReported 与 recomputed），以重算值为准。
- `validateBlob` 增加交叉校验：`coverage_returned_mismatch`（returned≠rows 去重 id 数）、`coverage_missing_mismatch`（missingIds 与 rows 有交集，或 missingIds∪rows 计数≠expected）——计数坏的 blob 在读端三层（cache/kv/memory）即被拒，落 snapshot，不再端出假 live（board-v2 有回归用例）。
- health.js 增加 count===returned 断言：不符（或 count 缺失）→ 503 `board_count_mismatch`。

## F6-05 已修（未来时间戳假绿）
- health.js：ageSec < -60（与 clockSkewToleranceSec=60 对齐）或 board 自报 freshness.clockSkew=true → 503、reason=`board_clock_skew`。
- board.js：freshnessFor 检出 CLOCK_SKEW 时 freshness 输出 `clockSkew:true`（恒输出布尔），且 level 封顶 L1（原 L0 降 L1、mode=delayed、stale=true）。board-v2 原「时钟钳制→L0」用例已按新口径改写。

## F6-03 已修（dispatch fail-closed）
- board.js `dispatchGet`：BOARD_READ_MODE 缺失或未知值 → 不再走 legacy，返回 snapshot 契约 v2 应答（尽力取 ids 填 coverage.expected）+ error 级结构化日志 `event:"board_mode_unknown", fallback:"snapshot_v2"`。显式 "legacy" 仍合法。
- legacy 分支：`fetchUpstreamInternal` 在 COINGECKO_API_KEY 缺失时抛 config 错误（errorType=config_missing_key）走既有回退路径，禁止匿名抓取；文件头注释同步。
- health.js 增加 contractVersion===2 断言：非 2（含缺失）→ 503 `board_contract_version`。
- tests/board.test.mjs：用例⑧改写为 fail-closed 新口径，新增⑧b（缺失 mode）、⑧c（legacy 无 key 不匿名）；其余 legacy 用例的 ctx 改为显式 env {BOARD_READ_MODE:"legacy", COINGECKO_API_KEY:"test-key-not-real"}（原 env:{} 在新口径下本就应被 fail-closed 拦截）。

## F6-08 已修（compare 同源检测）
- compare-shadow.mjs：同源判定 = `--shadow-key current` 显式声明，或 live 应答 freshness.servedFrom ∈ {kv, memory} 且 live 与比对输入 fetchRunId 相同。同源时输出 `mode:"same-source"`、verdict 上限 conditional（永不许 pass），verdictNote 明示「同源自比、非独立验证」；非同源输出 `mode:"independent"`。
- 附带信息段 `blobDiff`（仅当提供 --shadow-prev）：current 输入 vs prev 输入的字段级 diff 摘要（价格变动 >5% 币数、price/mcapUsd/volume24h 由非 null 变 null 的字段数与样本），仅信息、不进 verdict。
- fatal() 输出经 `redact()` 对 32 位 hex 串脱敏为 `[redacted-hex32]`（F6-90 的 compare 部分）。
- 实测：kv 同 run → same-source/conditional（退出码 2）；servedFrom=cache 同 run 对齐 → independent/pass；--shadow-key 用法见脚本头注释。

## F6-20 已修（runGate 压上限）
- compare-shadow.mjs：runGate.met !== true（含无证据 met=null）时 verdict 上限 conditional，降级原因记入 `verdictCaps`。与 F6-08/F6-21 的上限取更严者（任一命中即 conditional，fail 判据优先）。
- 实测：无 --health 且 shadow 无 quota 快照 → conditional（旧行为为 pass）。

## F6-21 已修（live 侧 null 门禁）
- compare-shadow.mjs：liveNullPrice/liveNullMcap 取大者 >2 → fail（failReasons 明示两计数）；1–2 → verdict 上限 conditional（记入 verdictCaps）。
- compared 改为分母口径：两侧同 id 配对总数（含任一侧 price 为 null 的配对）；另输出 `priceCompared` 为实际算出价差的配对数，输出中列明。
- 实测：live 3 币 null → fail、compared=200/priceCompared=197；live 1 币 null → conditional。

## F6-22 已修（probe v2 缺字段判 FAIL）
- probe.mjs：contractVersion===2 时 freshness/staleAgeSec/fetch 任一缺失 → verdict=FAIL、退出码 1，输出 `missingFields` 数组并在 note 注明缺失字段；「不可判读」按字段缺失触发。本地 mock 实测：{contractVersion:2, mode:"live", coins:{}} → FAIL rc=1（旧行为 PASS rc=0）；完整 v2 → PASS rc=0。
- 连带提示：F6-41 后 board 对外 fetch 不再含 upstreamStatus，probe 的 R3（fetch.upstreamStatus.markets）将恒为不可判读（marketsStatus=null），R1/R2 不受影响。R3 口径是否调整请协调人定（probe.mjs 本条只按任务改了缺字段判 FAIL，未动 R3）。

## F6-23 已修（probe.sh warn 退出码 4）
- probe.sh：退出码三档 pass=0 / fail=1 / warn=4，脚本头注释写明；本地 mock 实测 stale 形态 → rc=4、fresh → rc=0。
- ops/probe-config.md：HC1 行已同步注明「warn→退出 4、编排须按 4 分流 ping /fail」。**编排 cron（top200-hc1-hourly-probe）本体不在仓库，须协调人集成时更新其分流逻辑，否则 warn 仍可能被旧编排当非 fail 处理。**

## F6-30 已修（L3 missingIds 语义）
- board.js assembleV2 的 L3 分支：missingIds 改用重算 coverage 的真缺失（自报缺失 ∪ 期望全集−在场集），在场 id 绝不入列。board-v2 新增回归：200 期望/190 在场/老化 7h → missingIds 恰为 10 个真缺失 id。

## F6-31 已修（board HEAD）
- board.js 新增 `onRequestHead`（照 health.js 模式：复用 dispatchGet 的状态与头、body 置空），onRequest 对 HEAD 分流；405 的 Allow 头同步改为 "GET, HEAD"。board.test 新增用例⑪。

## F6-32 已修（Cache-Control 分级）
- board.js：live/stale 应答维持现行长头；snapshot（mode=snapshot 的 200）、503、405 一律 `no-store`（去掉 stale-if-error）。board.test ④（503）与 board-v2 无 blob 用例（snapshot）已加断言。

## F6-33 已修（安全头单一定义）
- 新建 `shared/http.js` 导出 `SECURITY_HEADERS`，board.js 与 health.js 共同 import（board 删除本地副本）；health.js 的 jsonResponse/405 均补齐 nosniff/CSP/Referrer-Policy 三头。health.test 已断言三头在位。

## F6-34 已修（getIds 对账）
- board.js getIds：解码后统计缺 id 行数与重复数，去重后与源行数对账；任一不符记 error 结构化日志（event=ids_parse_failed，含 sourceRows/decodedIds/missingIdCount/duplicateCount）并抛 ids_parse_failed 走既有回退路径，不再静默吞。board.test 新增用例⑩（rows 形态缺 id、对象形态重复 id 两情形）。

## F6-35 已修（疑似→确认存在，health 侧对齐）
- 修前探针（旧代码 /tmp 复刻实证）：fetchedAt 为当前、marketsUpdatedAt 为 2h 前的 blob，旧 board 判 live/L0 而旧 health 按 updatedAt 算龄 ageSec=7200 → 503，**判定分裂确认**。
- 选择：改 health 侧（侵入小）——health 判龄优先用 board 应答的 `staleAgeSec`（按 fetchedAt 计算、与 board freshness 同源），缺失时才回退 updatedAt 算龄。**未动 assembleV2 的 updatedAt 语义**（仍取 marketsUpdatedAt，前端可能消费其做展示）。
- 回归：health.test「F6-35」用例（updatedAt 2h 前 + staleAgeSec=60 → 200 ok）与 board-v2「F6-35（board 侧）」用例（live/L0、staleAgeSec=600、updatedAt 仍为旧值）双向锁定。

## F6-38 已修（疑似→确认存在，health fetch 超时）
- 修前探针：旧 health 对永不 resolve 的 mock fetch 挂起 >2s 未返回（确认）。
- health.js 内部 fetch 加 AbortController 超时，默认 **8s**（5–10s 区间取值，代码常量 BOARD_FETCH_TIMEOUT_MS=8000 注明；env HEALTH_BOARD_TIMEOUT_MS 仅供测试覆写），超时走既有 catch → 503 board_unreachable_or_invalid。health.test 有回归（50ms 覆写、永不 resolve 的 fetch 在超时内 503）。

## F6-39 已修（无 blob snapshot 语义）
- board.js snapshotV2Body：staleAgeSec 改 null（未知）；coverage.expected 改为可得的真实期望——handleKv/ fail-closed 路径经 snapshotV2Response 尽力 getIds，取到用 ids 数（missingIds=全集），取不到为 null。fetch 只留 fetchRunId（随 F6-41）。board-v2 无 blob 用例已加断言（staleAgeSec=null、expected=4）。

## F6-40 已修（疑似→确认存在，内存回退不对称）
- 修前探针（旧代码实证）：isolate 仅命中 Cache（从未命中 KV）时 MEM_BLOB 为空，Cache 过期+KV 故障即直落 snapshot（servedFrom=snapshot）；MEM_HEALTH 出错分支无年龄上限属代码直读确认。
- board.js：Cache 命中分支同步回填 MEM_BLOB；readHealthSummary 出错分支给 MEM_HEALTH 加 10 分钟年龄上限（超龄视为 null）。
- board-v2 新增回归：kv→cache→（双坏）memory 三段 servedFrom 序列断言。

## F6-41 已修（疑似→确认存在，fetch 透传收敛）——★grep 结论
- 修前 curl 线上 /api/board 实证：fetch 含 upstreamStatus/attempts/durationMs（在位确认），servedFrom=kv。
- **grep public/index.html：三字段名（upstreamStatus/attempts/durationMs）零命中，前端未消费**，故按任务收敛：对外 fetch 只保留 fetchRunId；三字段改记结构化日志 `event:"board_fetch_meta"`。snapshotV2Body 的 fetch 同步收敛为 {fetchRunId:null}。
- 连带：probe.mjs 的 R3 依赖 fetch.upstreamStatus（见 F6-22 条连带提示）。

## F6-15 已修（health 套件新建）
- 新建 tests/health.test.mjs（12 例）：正常 ok、降级（stale）、down（coverage 不全 / board 503 / snapshot 应答）、负 ageSec 与 clockSkew（F6-05）、count 断言（F6-04）、contractVersion 断言（F6-03）、判龄口径（F6-35）、超时（F6-38）、响应敏感字段 grep（key/token 字样零命中）、安全头、HEAD。

## F6-17 已修（kv 五字段断言）
- board-v2 kv 用例（六时刻非 L3 格）对首行 price/mcapUsd/rank/change24h/volume24h 逐项断言（makeBlob 行补 volume24h=5000+i）；新增「volume24h 缺失（旧 blob）→ 输出 null 且键在位」用例。

## F6-18 已修（board 部分）
- board-v2 新增「整行多字段 null」用例：100 行 blob 中 1 行 rank/price/volume24h 均 null（price 非 null 比例 99%，在 F6-02 的 98% 门禁内），断言 board 应答 200、不抛错、该行五字段占位正确（null 原样透传）。fetcher 与前端部分由他人负责。

## F6-83 已修（board 部分）
- board-v2 新增 200 行 blob kv 用例（count/coverage/coins 键数均 200）。
- dual 价差用例：dual 用例实际位于 tests/board-v2.test.mjs（board.test.mjs 无 dual 用例）——已在该 dual 用例中把 legacy 侧价格设为 KV 侧的 1.01 倍，断言 dual_compare 日志 priceDiffMedian = 1/101 ≈ 0.00990099（非零期望值）、compared=4。

## F6-79 已修（board-v2 部分）
- board-v2.test.mjs 的 FIELDS23 硬编码副本改为运行时与 data/coins.json 的 meta.fields 做 deepEqual 对账断言（漂移即红）；本次对账一致，副本未变。

## F6-92 已修（KV 写守卫契约测试）
- 新建 tests/kv-write-guard.test.mjs：递归扫描 functions/ 全部文件，正则 `BOARD_KV\s*\.\s*(put|delete)\s*\(` 命中即失败，文件头注释写明这是 F6-92 硬性检查项。当前 functions/ 共 2 文件、零命中。

## F6-44 跨组对齐（schema 侧，Fetcher 组发现）
- FETCH_INTERVAL_SEC.saving：900 → **1200**。理由：saving 模式 fetcher 在 */10 网格上以 age<15min 跳过 markets，实际节奏为 20 分钟一抓，900 与实际不符（Fetcher 组已同步其注释/投影口径）。
- 消费点核查：全仓 grep `FETCH_INTERVAL_SEC` 仅两处——定义（shared/board-schema.js）与 functions/api/board.js assembleV2（计算 freshness.nextExpectedFetchAt=fetchedAt+interval）。compare-shadow.mjs 的 intervalSec 是其独立 CLI 参数（默认 600），不消费本常量。无测试断言 900 或 nextExpectedFetchAt 的具体值。处置：直接改值，nextExpectedFetchAt 在 saving 期随之变为真实的 +1200s，无其他连带。

## 明确未做
- F6-36（dual/dualCompare 下线）：按任务书不碰 dual 分支逻辑（仅在 dual 测试 env 补了显式 key 以适配 F6-03 新口径，未改 dualCompare 逻辑）。

## 需协调人跟进
1. **contract-real-data.test.mjs 连带红（5/6）**：其用例②以 env:{} 驱动 board.js 期望 legacy live——F6-03 fail-closed 后正确地返回 snapshot。该文件非本组所有，请其归属方把 env 改为 {BOARD_READ_MODE:"legacy", COINGECKO_API_KEY:<测试值>}（与 board.test 的 ctx 口径一致）。这是口径变更的预期连带，不是 board.js 回归（基线该套件为 6/6）。
2. **F6-52 标记形态**：validateBlob errors 含 `"global_all_null"`（见上）——请通知 fetcher 施工员在其 index.js 写 blob 前消费（沿用 prev global 原 asOf）。
3. **F6-41 grep 结论**：public/index.html 未消费 upstreamStatus/attempts/durationMs，已收敛对外 fetch；probe.mjs 的 R3 因此恒不可判读，请协调人定 R3 口径去留。
4. **F6-23 编排**：HC1 的 cron（top200-hc1-hourly-probe）本体须按退出码 4 分流 ping /fail，仓库内已改 probe.sh 与 ops/probe-config.md，cron 更新由协调人集成时完成。
5. normalizeCgMarkets 新增返回值 `invalidFields` 计数目前无人消费（fetcher 解构忽略），建议 fetcher 组后续落 health/日志，本组未改 workers/。
