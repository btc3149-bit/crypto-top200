# 第八期修复 · 批 3 API 健壮性施工记录（api 路）

- 分支：p8-api（worktree ~/workspace/phase8-wt/api）；不部署、不 push、不 merge。
- 范围：F8-09、F8-10、F8-11、F8-12、F8-13，外加 F8-32 配合一小步。
- 生产口径：BOARD_READ_MODE=kv，五条均为 legacy/dual 潜伏或契约失真项，kv 主链不触发，按报告修净。
- 全量验证：`./scripts/run-tests.sh` 实跑 **22/22 套件通过**（基线 22 套件）。
  - tests/board-v2.test.mjs：25/25 passed
  - tests/board.test.mjs：17/17 passed
  - tests/legacy-credits.test.mjs：15 行 PASS / 自报 15/15（见 F8-32）
  - tests/kv-write-guard.test.mjs：15/15 PASS（现行守卫口径下 board.js 批准 put 仍唯一且形态不变；集成时由他路加固守卫复扫）

## F8-09 L3 降级分支 coverage 守恒破裂 — 已修（commit 013b0bf）

- 复现（修复前，本地构造 blob）：200 期望、190 在场、coverage.missingIds 改为字符串 `"not-an-array"`、老化至 L3（+7h）→ 应答 coverage 实测 `{"expected":190,"returned":0,"missingIds":[]}`，`expected−returned (190) ≠ missingIds.length (0)`，且 returned:0 却 missingIds 为空。注：评审原文记 expected:200，本次复现因 assemble 层 F7-13 已把 expected 重算为在场数 190，数值落点不同但破裂形态一致（returned:0 / missingIds:[] / 不守恒）。
- 根因：functions/api/board.js L3 分支直接取 `recomputedCoverage.missingIds`；missingIds 非数组时 recomputed 在 F7-13 守恒处理中被置 `[]`（该处理只适用于非 L3 的 returned=在场数形态），L3 把 coins 全部扣下后未做相应换算。
- 修复：L3 分支区分形态——missingIds 为数组（正常形态）仍按 F6-30 只列真缺失；在场 id 不入列；missingIds 非数组时，missingIds = 全部在场 id（`[...presentIds]`），因为这些 id 在 L3 应答中确被扣下、属本应答的缺失，且 recomputed expected 已退化为在场数，于是 `expected − 0 == missingIds.length` 恒成立。
- 验证：新增 board-v2 回归用例（190 在场 + missingIds 非数组 + 老化 7h）断言 expected=190、returned=0、missingIds 长 190 且含 coin-0/coin-189、守恒等式成立；修复后该用例 PASS，原 F6-30（数组形态只列 10 个真缺失）与 F7-13（非 L3 守恒）用例仍 PASS。

## F8-10 legacy-credits 计数 KV 往返无超时 — 已修（commit 9647f19）

- 复现（评审证据 + 本路回归构造）：stub KV put 永不返回、上游即时响应时请求无限期 pending（评审实测 5s 仍 pending）。
- 超时取值依据：**3500ms**。与本文件既有上游单请求超时 `UPSTREAM_TIMEOUT_MS = 3500`（fetchWithTimeout 的 AbortController + Promise.race 口径，board.js 与 fetcher CG 适配器同名常量中 Function 侧取值）完全对齐——代码中直接令 `LEGACY_CREDITS_KV_TIMEOUT_MS = UPSTREAM_TIMEOUT_MS`，不另立数值。理由：计数是旁路计量，其单次 KV 往返可容忍延迟不应超过一次上游请求本身。
- 修复：新增 `withLegacyKvTimeout()`（Promise.race 式超时），分别包裹 addLegacyCredits 内的 KV get 与 KV put：
  - get 超时 → 内层 catch 置 prev=null（按计数基数未知处理），继续尝试 put；
  - put 超时 → 外层 catch 吞掉（计数失败绝不影响主流程），行情应答照常返回；
  - 底层 promise 以 `guarded.catch(() => {})` 兜住迟到拒绝，不留未处理 rejection；计时器在 race 结算后 clearTimeout。
  - **写守卫约束遵守**：put 调用形态保持原样——源码仍为直呼 `env.BOARD_KV.put(KV_KEYS.legacyCredits, JSON.stringify(next))`，仅在其外层套 `withLegacyKvTimeout(...)`，未改成别名/解构/可选链等异形写。现行 kv-write-guard 套件实跑 15/15 PASS、批准写仍恰 1 处。
- 验证：新增 legacy-credits 第 15 项回归——stub put 永不返回 + 上游即时响应，断言应答 200/live、实测耗时 ≥3000ms 且 <8000ms（约 3500ms 超时后返回）、无 unhandledRejection；套件全绿。

## F8-11 legacy/dual 路径 coins 值零清洗 — 已修（commit a4540fa）

- 复现（评审证据）：fetchUpstreamInternal 逐字透传上游 current_price/market_cap/market_cap_rank/change/total_volume，字符串价、负市值、字符串 rank 原样进入应答。
- 修复：删除手写透传，改复用 `shared/board-schema.js` 的 `normalizeCgMarkets(markets, ids)`——即 fetcher CG 路径在用的同一套清洗（price/mcapUsd/volume24h 走 sanitizeMarketNumber 非负上限、change24h 走 sanitizeSignedNumber、rank 走 sanitizeRank，形变值置 null），未另造第二套口径。清洗坏值计数 invalidFields.total>0 时记 `legacy_upstream_invalid_fields` warn 日志留痕；coins 字典由 normalized.rows 构建。
- 验证：新增 board.test ⑫ 回归——bitcoin 五字段全形变（价 `"100"` 字符串、市值 -5、rank `"1"` 字符串、change `"1.5"` 字符串、量 -10）断言全部置 null，ethereum 正常值不误伤；PASS。

## F8-12 legacy 应答 count 与 coverage.returned 不一致 — 已修（commit 7ef4627）

- 复现（评审证据）：mock 上游追加 1 个列表外 id 时 count=3（字典键数）、coverage={expected:2, returned:2}，破坏 count===returned。
- 列表外 id 处置口径：**剔除**（不进入 coins、不计入 count）。依据：与 v2 侧一致——normalizeCgMarkets 的 rows 本就只保留期望列表内行、fetcher 落盘与 kv 组装均按此口径，health 对 v2 强制 count===returned 不变量；legacy 若保留列表外 id 则 dual 比对与消费方口径分叉，故选剔除而非「保留但不计 count」。
- 修复：① coins 来源改为 normalized.rows（F8-11 落地，列表外 id 天然不入字典）；② 返回体 `count` 由 `Object.keys(coins).length` 改为直接取 `coverage.returned`，使不变量在结构上同源恒成立，而非靠两处计数巧合相等。
- 验证：新增 board.test ⑬ 回归——上游返回 4 个期望 id + 1 个 `not-in-list`，断言 count===coverage.returned===4、coins 键数 4、且 `not-in-list` 不在 coins 中；PASS。

## F8-13 global 子字段未来时间戳盲区 — 已修（commit d38018d）

- 复现（评审证据）：构造 fetchedAt 新鲜、global.asOf=+7h 的 blob，globalForContract 以 `Math.max(0,…)` 钳制年龄后输出 stale:false 照常端出。
- 修复（shared/board-schema.js `globalForContract`，仅该函数）：先算未钳制的 rawAgeSec，再按既有 time_tolerance 口径判定——
  - rawAgeSec < −clockSkewToleranceSec（60s，FRESHNESS_THRESHOLDS 既有值，与 board 级 F6-05 freshnessFor 的 clockSkew 判定同容差）视为未来戳/clockSkew；
  - 未来幅度超过 globalNullSec（21600s/6h）→ 与超龄同口径返回 `{global:null, globalStale:true}`；
  - 容差与 6h 之间 → 保留值但 `stale:true` / globalStale:true（与 board 级 clockSkew 时判 stale 同精神）；
  - 容差内的小幅未来戳（≤60s）维持原钳制行为，不误伤时钟微偏。
- 验证：新增 board-v2 两条回归——① fetchedAt 新鲜（L0）、global.asOf 为 served 时刻 +7h → global=null、整表仍 L0、count=4；② asOf 未来 2h → global 保留且 stale=true。均 PASS；原 global 解耦两例（2h 前 stale=true / 7h 前 null）仍 PASS。

## F8-32 配合项：legacy-credits 计数口径归一 — 已修（commit cacd6c6）

- 问题：tests/legacy-credits.test.mjs 第 6 项含 HTTP 500 / 网络抛错两子例、每子例各打一行 PASS，自报 14 项却有 15 行 PASS。
- 修复：两子例的断言仍逐个执行（任一失败照常抛错使整项 FAIL），仅把 console.log 移出循环、合并为单行 `PASS 6 markets 失败（HTTP 500/网络抛错）仍计数 +2`。
- 验证：本路 F8-10 新增第 15 项后，实测 `grep -c "^PASS"` = **15 行**，与套件自报 `=== 15/15 passed ===` 一致（修复前同状态为 16 行 PASS 对 15/15 自报）。

## 提交清单（p8-api，逐条 commit）

| commit | 条目 |
|---|---|
| 013b0bf | F8-09 |
| 9647f19 | F8-10 |
| a4540fa | F8-11 |
| 7ef4627 | F8-12 |
| d38018d | F8-13 |
| cacd6c6 | F8-32（配合项） |

## 文件边界遵守

- 改动仅限：functions/api/board.js、shared/board-schema.js（仅 globalForContract）、tests/board.test.mjs、tests/board-v2.test.mjs、tests/legacy-credits.test.mjs 及本记录文件。
- 未改：tests/helpers/kv-guard-scan.mjs、tests/kv-write-guard.test.mjs、public/**、workers/**、scripts/**、coins-list.js、tests/suites-manifest.json、tests/paprika-gate.test.mjs、tests/health.test.mjs、tests/time_tolerance_test.py（后两者无需改动，实跑全绿）。
- 未部署、未 push、未 merge、未动 master。
