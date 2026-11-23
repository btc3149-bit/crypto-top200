# crypto-top200-fetcher（W2-01）

全球唯一抓取 Worker：Cron `*/10 * * * *` → CoinGecko markets（每 run）/ global（30min）
→ 覆盖率 ≥94% + 结构校验通过才写 KV `BOARD_KV` 的 `v1:board:current` 单 blob；
失败绝不覆写，只更新 `v1:meta:health`。Pages Function 只读（见 `functions/api/board.js`）。

## 当前形态：G3 终局（2026-11-19 起，现行）

- **Cron 已启用**：`wrangler.toml` 已注册 `[triggers] crons=["*/10 * * * *"]`，`BOARD_TARGET_KEY="current"` 直写生产键，**无** `BOARD_FETCH_DISABLED`（未设置 = 启用抓取）。
- fetcher 侧 `COINGECKO_API_KEY`：**已注入**（`wrangler secret put`，值经保险箱流程，不入仓库/聊天）。与 Pages Secret 是两处独立注入。
- `MANUAL_RUN_TOKEN`：已注入（值不在任何文件/日志中）。调用：`POST https://crypto-top200-fetcher.<account-subdomain>.workers.dev/run`，头 `x-manual-token: <值>`；其余路径/方法一律 404。
- Paprika 备源：`PAPRIKA_ENABLED="false"` **保持关闭**。启用门禁（第七期 F7-02）为四项计数（mapped / identityValid / activeUsable / tickerHit）均 ≥94%（188/200），2026-11-23 实测 tickerHit=179 未达标——不得以改小门禁或只数映射条数的方式放行。
- 事故处置要点：紧急停抓置 `BOARD_FETCH_DISABLED="1"` 后重新部署；**不要**把 `BOARD_TARGET_KEY` 改回 `"shadow"`——那会冻结生产行情更新（影子键无人消费）。

## 历史（G0/G1，2026-11-10～11-19，仅存档、不得作为操作步骤）

> 以下为已结束阶段的历史记录：G0 期 Cron 禁用（`BOARD_FETCH_DISABLED="1"` 且未注册 triggers）、G1 期曾以 `BOARD_TARGET_KEY="shadow"` 启用影子 Cron 并每小时跑 `scripts/compare-shadow.mjs` 比对。G3 已完成 current 直写切换，上述步骤**全部失效**，照此操作会把生产打回影子链。

## 开关取值口径（P6 F6-84/F6-85 统一，2026-11-23；Paprika 门禁第七期 F7-02 更新）

| 开关 | 取值 | 语义 |
|---|---|---|
| `BOARD_FETCH_DISABLED` | 未设置 / 空串 / `"0"` | 启用抓取（scheduled 正常跑） |
| | `"1"` / `"true"` / `"yes"` / `"on"` | 禁用 scheduled（紧急停抓） |
| | 任何其他非空值（误写等） | **按禁用处理（fail-closed）** + 记 error 日志 `board_fetch_disabled_unknown_value` |
| `PAPRIKA_ENABLED` | 精确 `"true"` | 允许进入 Paprika 候选（仍须过下方四项门禁 preflight） |
| | 其余任何值 | 未启用（fail-closed），强制 CoinGecko |
| `BOARD_SOURCE` | `"auto"` / `"coingecko"` / `"coinpaprika"` | 按值执行（`coinpaprika` 另受 `PAPRIKA_ENABLED` 与门禁约束） |
| | 未知值（拼写错误等） | 回落 `auto` + warning 日志 `source_config_warning`（F6-85，不再静默） |

补充口径：

- Paprika 启用门禁（F7-02，代 F6-10 单一计数口径）：候选 run 先做 preflight，按 `shared/paprika-identity.js` 口径算四项计数——mapped（paprikaId 非空字符串）、identityValid（目录 symbol + 身份一致）、activeUsable（身份通过且 `is_active`，已下线条目如 yzy 不计）、tickerHit（tickers 存在且报价有效）——四项均须 ≥ `ceil(94% × 总数)`（与发布覆盖门禁对齐，200 币即 188）才放行；任一不足或 preflight 失败即同 run 强制 CoinGecko。四项计数分开落 `health.paprikaGate`（另保留 `health.paprikaMappedCount` 兼容）。CG 正常路径不做 preflight、无额外调用。
- 身份复核（F7-01）：落库映射的身份以 `node scripts/verify-paprika-identity.mjs` 按 symbol + 规范化 name/已知别名逐条复核为准，价差不作身份证据。
- `BOARD_FETCH_DISABLED` 只停 scheduled；手动 `POST /run` 在禁用时**维持可用**（人工恢复/验证通道，F6-49 决策），其滥用面由 token 常量时间校验 + 60 秒最小间隔（`health.lastManualRunAt`）+ 并发在途合并兜底。
- `BOARD_TARGET_KEY` 口径不变：仅精确 `"shadow"` / `"current"`，其余 fail-closed 拒写（W5-02）。生产恒为 `"current"`。

## coins 同步
`coins.json` 为 `data/coins.json` 的构建期副本；`src/coins-list.js` 由它生成（id + paprikaId 数组）。
三者不一致时以 `data/coins.json` 为准，重新复制并重生成 coins-list.js（生成命令见文件头注释的等价脚本，施工记录在 CONSTRUCTION_PHASE2）。
注意：`scripts/build.py --emit` 只为**缺失** paprikaId 的旧文档补列，不会重同步已落盘的 paprikaId 值；修正映射须先改 `src/coins-list.js` 事实源，再同步三份 coins.json 的 paprikaId 列并按 check_meta 口径 A 重算 `meta.dataHash`（第七期批 0 即按此结构化脚本执行，见 P7_NOTES_DATA.md）。
