# P7_NOTES_API — 第七期批2 API/fetcher 健壮性（分支 p7-api）

范围：F7-08、F7-09、F7-10、F7-11、F7-12、F7-13、F7-42、F7-43、F7-44。
只改本 worktree，未部署、未 push。未改 public/、scripts/、shared/board-schema.js。
KV 写守卫：functions/ 内仍只有 board.js 对 `KV_KEYS.legacyCredits` 的 1 处批准 put
（kv-write-guard 套件实测 PASS）；fetcher 侧新增的专用节流键写在 workers/ 内（见 F7-44），
不属于 functions/ 守卫面。fetcher 改动只触 `fetch` 处理的 /run 节流段，未触 Paprika gate/归一化段。

## F7-08 health 验 coins 本体（functions/api/health.js）
- ok 条件新增 `coinsConsistent`：`board.coins` 必须是非数组对象，其实际键数须与
  coverage.returned 与 count 三方相等；缺失/空/不等一律 503，reason=`board_coins_mismatch`，
  响应新增 `coinsCount` 字段。理由优先级：stale → incomplete → count_mismatch → coins_mismatch，
  既有 reason 不变。
- 测试（tests/health.test.mjs）：`boardBody()` 改为按 count/coverage 生成守恒 coins（此前无 coins
  字段却断言 ok，正是评审实证）；新增 3 例：coins={} 假汇总满格 → 503、coins 缺失 → 503、
  coins 199 vs returned/count 200 → 503。health 套件 12 → 15 例全绿。

## F7-09 HEAD 同过 sfs / 计数口径（functions/api/board.js、health.js）
- `onRequestHead` 先过 `sfsShadowCheck`（被拦时以同状态/头、空 body 应答），再 dispatchGet；
  onRequest 的 HEAD 分支经 onRequestHead 同样覆盖。此前 HEAD 直接 dispatchGet 绕过。
- HEAD 经 dispatchGet 与 GET 同路：legacy/dual 下回源与 legacy-credits 计数与 GET 一致。
- health.js 仅加注释留痕：其 handleGet 内嵌的是对 /api/board 的 **GET** fetch，health 的 HEAD
  探测不会绕过 board 的 sfs/回源/计数。
- 测试：board.test 新增 ⑪b（HEAD 带 Sec-Fetch-Site=cross-site → sfs_shadow 日志出现）；
  legacy-credits 新增例 10（HEAD legacy → +2、body 空）。

## F7-10 / F7-11 / F7-42 legacy-credits 一组（functions/api/board.js）
定版口径保留：每轮真实回源（Cache 未命中、非熔断、key 已配置）计 markets 1 + global 1 = 2，
按已发出计、与成败无关；in-flight 合并一轮只计一次；kv 模式恒不触发。
- F7-10 时点：计数从「两个 fetchWithTimeout 创建之前」移到「创建之后」（请求已发出），
  再 `await addLegacyCredits` 后 allSettled——KV 往返与上游在途重叠，不再串行前置；
  计数后、发请求前终止的多计缝消除。未采用 waitUntil 方案的原因：现有测试 harness 的
  waitUntil 为丢弃型 stub，waitUntil 化会使计数在测试/部分运行时不可观测；「发出后计」
  是任务给定的等价选项。
- F7-11 钳制自愈：prev.credits 仅当有限、≥0、≤ LEGACY_CREDITS_SANITY_MAX(1,000,000) 才作 base；
  负数/异常大/非数/非有限一律 base=0 并记 warn 日志 `legacy_credits_prev_invalid`（含类型/数值）。
  跨月重置与坏 JSON 回退 0 的既有行为不变。注：quota-check.py 侧读入钳制不在本批范围（脚本组）。
- F7-42 写频上限/pending：模块级节流——同 isolate 两次实际 KV 写至少间隔 60s
  （`LEGACY_CREDITS_MIN_WRITE_INTERVAL_MS`，导出供测试）；间隔内增量累积在内存 pending，
  记 `legacy_credits_throttled` 日志，下一次到期计数时把 pending 一并 flush（总量不丢、落盘延迟；
  isolate 被回收时未 flush 的 pending 可能丢失，属「近似计量」定版口径内）。flush 在途合并防并发重复写。
  `addLegacyCredits` 改为具名导出以便单测直测节流（内部调用不变）。
- 与 guard 组 F7-30 对齐：本批未新增任何 functions/ KV put/delete 调用点（仍恰 1 处批准 put），
  节流为运行时频率约束、与静态守卫互补；测试改动集中在 tests/legacy-credits.test.mjs（API 行为部分），
  另 board.test ⑪b/⑪c、health.test、board-v2 各加本批对应用例。
- 测试（legacy-credits 5 → 10 例）：例 6 markets 失败仍 +2（已发出即计）；例 7 prev=-50/1e12/"999"
  三坏值均钳制后 +2=2；例 8 直测 addLegacyCredits 节流（首写 +2、间隔内不写、+61s 后 flush 至 6）；
  例 9 dual +2；例 10 HEAD +2。熔断不计数由 board.test ④既有「第二次不打上游」+ 计数点只在
  fetchUpstreamInternal 内共同保证（熔断路径不进入该函数）。

## F7-12 fail-closed 改 503（functions/api/board.js）
- `snapshotV2Response` 增加 opts.failClosed：未知/缺失 BOARD_READ_MODE 时返回 HTTP 503 且
  body 带 `error: "board_mode_unknown"`，body 其余仍为 snapshot 契约 v2；health 收到 board 503
  走 board_http_error 503，口径一致。
- 合法 kv 模式无 blob 的 snapshot 仍 200（board-v2 既有「无 blob → L3 snapshot 200」用例不误伤、实测绿）。
- 测试：board.test ⑧/⑧b 期望由 200 改为 503 + error 标记断言。

## F7-13 missingIds 守恒（疑似→确认；functions/api/board.js assemble 层）
- 验证（施工前实测）：构造 rows=190、coverage={expected:200, returned:190, missingIds:"oops"} 的 blob，
  `validateBlob` 返回 ok:true（其互补校验仅在 Array.isArray 时执行）；旧 assemble 后备分支会产出
  expected 200 / returned 190 / missingIds [] 的矛盾 coverage。确认成立。
- 处置（不改 shared/board-schema.js，按任务优先 assemble 层）：missingIds 非数组时记 error 日志
  `coverage_missing_ids_invalid`，coverage 重算为 expected=returned=在场 id 数、missingIds=[]，
  恒满足 expected-returned == missingIds.length；缺失 id 本不可知，不臆造。health 因 expected≠200 仍判红。
  missingIds 为数组的既有路径（present ∪ missing 重算）不变。
- 测试：board-v2 新增 1 例（200 期望/190 在场/missingIds 改字符串 → 响应 coverage={190,190,[]} 且守恒）。

## F7-43 getIds 超时（functions/api/board.js）
- `getIds` 的同源 fetch 改走既有 `fetchWithTimeout`（UPSTREAM_TIMEOUT_MS=3500，AbortController +
  Promise.race 兜底），与上游抓取同口径；失败仍走既有回退路径。
- 提醒（frontdocs 组）：前端 public/index.html init 的 `fetch("data/coins.json")` 无超时一项不在本批，
  需 frontdocs 组给该 fetch 加 AbortController（同页 loadBoard 已有 10s 定版可参照）。
- 测试：board.test 新增 ⑪c（coins.json fetch 永不返回、仅响应 abort → 约 3.5s 超时后回退 snapshot，<8s）。

## F7-44 fetcher /run 节流 fail-closed + 回写竞态（workers/fetcher/src/index.js，仅 fetch /run 段）
- 验证（施工前实测）：stub KV 使 health get 抛错后 POST /run（正确令牌）——旧代码 catch 吞错、
  节流整体跳过并进入 runFetch（返回其 kv-get 502），即节流层 fail-open 属实（瞬时抖动下
  节流检查与 runFetch 两次读之间存在绕过窗口）；拒绝路径以检查时旧 health 整对象回写，
  与并发 cron writeHealth 无版本校验、可覆盖新值，竞态属实。
- 处置：① 节流读 health 抛错 → 立即 503 `{error:"throttle_check_failed"}` + 日志
  `manual_run_throttle_check_failed`，不进入 runFetch；health 键缺失（get 返回 null）不算失败、照常放行。
  ② 拒绝回写改：先写专用节流键 `v1:meta:manual-run-throttle`（{lastManualRunRejectedAt, retryAfterSec}，
  单字段、无其他写方），再**重读**最新 health、仅合并 lastManualRunRejectedAt 后回写；重读失败跳过
  health 回写。旧快照整对象回写消除。
- 测试（fetcher-branches 新增 23a/23b，套件 40 → 42 例）：23a health get 抛错 → 503、零上游、无 blob；
  23b 两次 health get 分别返回旧/新对象（模拟 cron 并发更新）→ 最终 health 保留新对象
  consecutiveFailures=7/status=failing 且合并拒绝留痕、专用节流键落盘。既有 19a（连点 429 + health 留痕）仍绿。

## 测试结果
- 相关套件：board 15/15、board-v2 22/22、health 15/15、legacy-credits 10/10、
  kv-write-guard 1/1、fetcher-branches 42/42、board-fetcher 15/15。
- 全量：`bash scripts/run-tests.sh` → 15/15 套件全绿（2026-11-23 本 worktree 实跑）。
