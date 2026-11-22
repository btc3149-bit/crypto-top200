# P6_NOTES — 第六期批 3（Fetcher）+ 批 5 启用门禁 + 批 7 开关口径 施工记录

施工员：Fetcher 施工员（分支 wt/p6-batch3-fetcher）。范围：workers/fetcher/**、tests/fetcher-branches.test.mjs、tests/coins-list-contract.test.mjs（新建）。
纪律：未部署、未 push、未碰生产 KV、未调线上 /run、测试全走 mock/stub（唯一例外：F6-53 核实按任务授权对 Paprika 免费无密钥端点做了 1 次 GET，未消耗 CoinGecko 额度）。

## 逐条处置

- **F6-11 已修**（index.js）：新增本 run 账本 runLedger——探针/markets/global 的每一次真实上游调用（成功、失败、成功但被丢弃的 global）都记 attempts；CoinGecko 调用另记 credits（Paprika 不计）。finishFail 与成功路径统一经 quotaWithLedger() 并入后再 estimateQuotaMode。**health 新字段口径（请协调人对齐 quota-check 侧）**：
  - `health.quota.creditsUsedEst`：语义不变（自然月累计 CG credits），但自本批起**含失败 run 的真实消耗**，数值会比旧口径偏大——这是修复目的，quota-check.py 的判级阈值/注释若按旧「只记成功」口径写，需同步。
  - `health.quota.attemptsTotal`（**新字段**）：自然月上游调用总次数（含 Paprika、含失败尝试），与 creditsUsedEst 并列；blob 的 `fetchMeta.quota.attemptsTotal` 同步落同一计数快照。
  - 用例 10：global 成功 + markets 失败(500) → creditsUsedEst +2、attemptsTotal +2。
- **F6-47 已修**：kvGetJson 区分键缺失（null）与读异常（抛 KvReadError）；health/sourceState/prevBlob 任一读异常 → run 以 stage=`kv-get`、code=`kv_read_failed` 收尾，**不写 health/sourceState**。用例 11 断言 health/blob 原样、零上游调用。
- **F6-42 已修**：global 429 时消费 UpstreamError.retryAfterSec，记 `health.globalLast429At`（ISO）与 `health.globalSkipUntil`（ISO）；退避期内 globalDue=false 单独跳过 global，markets 照常；global 抓取成功后清 globalSkipUntil。退避无条件尊重 Retry-After（见 F6-45 绕过范围说明）。用例 12。
- **F6-45 已修**：globalDue 改墙钟相位——`floor(now/1800) !== floor(prevAsOf/1800)` 即到期，不再锚定 prev asOf；代码注释注明「最长滞后约 40 分钟」为无故障下限。429 retryUntil / quota 两条整 run 跳过路径中，若 prev global 严重过期（>2h，或有 blob 但 global 段缺失）则绕过跳过、照常抓取（日志 `fetch_run_skip_bypassed_global_stale`）。**绕过范围界定**：只针对整 run 跳过；global 自身的 429 退避（F6-42）不被绕过（上游 Retry-After 优先）。既有用例 2a/2c 的时刻前提按新口径调整为同窗口场景，新增 2d（龄 15min 跨窗口即到期）与 14（skip 绕过）。
- **F6-46 已修 + 口径选择**：skip 改 `health.retryUntil` 时间戳判定（旧 health 的 skipRunsRemaining 仍兼容 honor 并递减）。**429 本 run 是否计入 consecutiveFailures：选择「计入」**——依据 docs/fetcher-runbook.md「429」一行原文只豁免「跳过（的 run）不计连续失败」，且既有 tests/board-fetcher.test.mjs 用例（Retry-After=1200 后 consecutiveFailures=1、「跳过不计入 N」）已锁定此口径；被 retryUntil 跳过的 run 不计。结果对象保留 `skipRunsSet` 兼容字段（=ceil(retryAfterSec/600)，仅信息用，不再落 health 计数）。用例 13：Retry-After=60 → retryUntil=now+60s、+30s 跳过、+61s 恢复（旧口径会停约 20 分钟）。
- **F6-43 已修**：applyOutcome 新增第 4 参 options.paprikaEnabled（缺省 true，既有调用方行为不变）；主流程传 paprikaUsable（开关 && 映射门禁）。未启用时 CG 失败只累积 cgConsecutiveFailures、state 停 CG_DEGRADED 不迁移 PAPRIKA_ACTIVE。health.sourceState 快照的 activeProvider 改以 resolveProvider+门禁后的实际 provider 为准。用例 15a/15b。
- **F6-44 已修 + 口径选择**：estimateQuotaMode 投影改分段速率（DAILY_CREDITS_BY_MODE：normal 192 / saving 120 / critical 48），按 health 中已存 mode 的速率外推；mode 取 max(投影候选, 本月已达 mode)——月内只升不降，消除临界抖动与整月粘滞，跨月重置。**saving 节奏选择「改投影 + 同步注释为实际节奏、不动调度行为」**：quotaSkipMarkets 逻辑不变，注释写明 */10 网格上 saving 实际落点 0/20/40 分钟 = 20 分钟一抓。用例 22。**遗留对齐项**：shared/board-schema.js 的 FETCH_INTERVAL_SEC.saving=900（15min）与实际 markets 节奏 1200s 不符——该文件归 API 施工员，请协调人安排对齐（freshness.nextExpectedFetchAt 会用到）。
- **F6-49 已修 + 决策记录**：/run token 改常量时间比较（双侧 SHA-256 后逐字节 XOR）；新增最小间隔 60s——上次触发时刻记 `health.lastManualRunAt`，间隔内返回 429 `{error:"rate_limited", retryAfterSec}` 并留痕（日志 `manual_run_rejected_interval` + `health.lastManualRunRejectedAt`），不触发抓取。**决策：BOARD_FETCH_DISABLED 时 /run 维持可用**（人工恢复/验证通道；禁用它会使恢复只能改配置重部署），滥用面由 token+60s 间隔+F6-48 在途合并三重兜底；决策已写入 index.js fetch 处理注释与 fetcher README。用例 19a。注：cron 触发不写 lastManualRunAt（仅 opts.trigger==="manual" 写），间隔只约束人工连点。
- **F6-48 疑似→确认→已修**：验证（本地 mock、双 run 并发、首 run markets 人为延迟 300ms）：旧代码下先启的旧 run 后落盘，final blob 为旧 runId（stale overwrite 成立），且 health.creditsUsedEst=2 而非 4（读-改-写丢计数）。修复：runFetch 入口在途合并——同 isolate 内并发调用复用同一 in-flight promise（scheduled 与 /run 共用此入口，天然互斥）；日志 `fetch_run_coalesced`。用例 18（同 runId、上游只打一轮）。
- **F6-50 已修**：coingecko.fetchMarkets 删除死参数 fetchImpl（测试替身一律 stub 全局 fetch，注释已写明）；coingecko.js 与 coinpaprika.js 的 res.json() 均纳入与请求同一 AbortController/超时竞速（计时器 body 读完才清）。
- **F6-51 已修**：新建 tests/coins-list-contract.test.mjs——按 meta.fields zip 解码 data/coins.json（与 scripts/gen-paprika-map.mjs 同口径），断言 COINS id 集合 == coingeckoId 集合（无多无少无重复）、IDS 同序、元素形 {id, paprikaId}。当前 4/4 通过（现状一致，属潜伏防线）。
- **F6-10 启用门禁 已修（落库不归本批）**：常量 PAPRIKA_MIN_MAPPED=197（source-state.js）；主流程每 run 计算 paprikaMappedCount 并落 `health.paprikaMappedCount`；resolveProvider 结果为 coinpaprika 但 paprikaUsable=false（未启用或映射 <197）时强制 coingecko、关探针、push warning 走 source_config_warning 日志。用例 16（全 null 映射 + PAPRIKA_ENABLED=true + BOARD_SOURCE=coinpaprika → provider=coingecko、零 Paprika 调用）。映射落库本身（W2-11）由协调人另行处置。
- **F6-52 fetcher 消费侧 已修（检测形态待对齐）**：本 run 新抓 global 关键字段（totalMarketCapUsd/btcDominancePct/totalMcapChange24h）全 null → 视为抓取失败：不盖新 asOf、沿用 prev 同源 global 及原 asOf，日志 `global_empty_payload`。**检测方式暂用字段直查（globalAllNull）**，未等 shared/board-schema.js validateBlob 的标记——API 施工员若在 validateBlob 给 global 全 null 可识别标记（如 error/warning 码），请协调人集成时把本处切换为消费该标记，并核对 functions 侧读端处理一致。用例 17。
- **F6-53 疑似→确认（默认上限存在）→已修**：核实（授权内单次 GET https://api.coinpaprika.com/v1/tickers?quotes=USD，免费无密钥）：HTTP 200，返回**恰好 2000 条**（末条 rank=2000），默认上限成立——无参数请求对 rank>2000 的映射币会静默截断（当前 top200 映射 rank 远在 2000 内，属潜伏风险）。修复：请求显式带 `limit=5000`；若端点忽略该参数，2000 上限仍覆盖本项目映射范围。rank 口径差异已在 coinpaprika.js fetchMarkets 注释标注（Paprika rank 为其自家排名，与 CG market_cap_rank 切源时跳变）。未做第二、三次请求（按任务只许一次，未抽样比对两源 rank 差，留待启用评审时随 verify-paprika-coverage 一并核对）。
- **F6-84 已修**：BOARD_FETCH_DISABLED 改 fail-closed——未设置/空串/"0" 才启用；任何非空值禁用 scheduled；未知值（不在 1/true/yes/on 内）另记 error 日志 `board_fetch_disabled_unknown_value`（只记类型/长度）。workers/fetcher/README.md 已增三开关（BOARD_FETCH_DISABLED/PAPRIKA_ENABLED/BOARD_SOURCE）取值口径表。用例 19b（"ture" 禁用、"0" 启用；既有 5d "1" 禁用不变）。
- **F6-85 疑似→确认→已修**：验证：直调 resolveProvider 传 BOARD_SOURCE="papirka" → warnings=[]、静默穿落 auto（证实）。修复：未知值 push warning（主流程既有 source_config_warning 通道落日志）。用例 21。
- **F6-91 疑似→确认→已修**：核实：BOARD_TARGET_KEY 非法时 message 含 `JSON.stringify(原值)`，经 finishFail 落 health.lastError.message 并经 /run 响应返回（证实）。修复：message 改固定文案；原值仅以类型/长度记入结构化日志 `board_target_key_invalid`（valueKind/valueLength），health 与响应均不落原值。既有用例 8 仍以 code/stage 断言、通过。
- **F6-18 fetcher 部分 已补**：用例 20——markets 源数据整行多字段为 null（price/rank 缺失、volume24h 缺失）→ run 成功、blob 行三字段如实为 null、coverage 不拒整行（与 F6-02「非数置 null、null 不拒绝整行」口径衔接）。

## 测试结果

- 基线（改前）：tests/fetcher-branches.test.mjs 24/24。
- 改后：tests/fetcher-branches.test.mjs **40/40**；tests/coins-list-contract.test.mjs **4/4**；回归：board-fetcher 8/8、board 9/9、board-v2 13/13、contract-real-data 6/6、frontend-dom 6/6，全绿。

## 需协调人跟进

1. **F6-11 health 新字段**：`health.quota.attemptsTotal` 新增、`creditsUsedEst` 口径含失败消耗——请与批 1 的 quota-check.py（F6-07）对齐判级与注释。
2. **F6-52 检测形态**：本批用字段直查 globalAllNull；API 施工员的 validateBlob 若给出 global 全 null 标记，集成时切换并对齐口径（见上 F6-52 条）。
3. **F6-44 遗留**：shared/board-schema.js FETCH_INTERVAL_SEC.saving=900 与 saving 实际 markets 节奏（1200s）不符，归 API 侧对齐。
4. **F6-10 落库**：Paprika 映射落库（≥197）与 verify 连测归协调人另行处置；门禁已就位，落库达标后无需再改 fetcher。
5. 本批未部署；fetcher 部署须按既有纪律避开整点观察窗并在部署后验证（批 3 依赖注记）。
