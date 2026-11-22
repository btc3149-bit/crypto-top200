# crypto-top200-fetcher（W2-01）

全球唯一抓取 Worker：Cron `*/10 * * * *` → CoinGecko markets（每 run）/ global（30min）
→ 覆盖率 ≥94% + 结构校验通过才写 KV `BOARD_KV` 的 `v1:board:current` 单 blob；
失败绝不覆写，只更新 `v1:meta:health`。Pages Function 只读（见 `functions/api/board.js`）。

## 当前形态：G0（2026-11-10）
- 已部署，Cron 禁用：`BOARD_FETCH_DISABLED="1"` 且 wrangler.toml 未注册 triggers（二选一取双保险，记录在此）。
- fetcher 侧 `COINGECKO_API_KEY`：**待协调者注入**（`wrangler secret put COINGECKO_API_KEY -c workers/fetcher/wrangler.toml`，值经保险箱流程，不入仓库/聊天）。
  未注入时手动 /run 必然走配置错误路径——G0 正用此验证「失败不覆写 + health 落盘」。
- `MANUAL_RUN_TOKEN`：已由施工方生成并以 wrangler secret put 注入（值不在任何文件/日志中）；
  协调者接管后应轮换为自有值。调用：`POST https://crypto-top200-fetcher.<account-subdomain>.workers.dev/run`，头 `x-manual-token: <值>`；其余路径/方法一律 404。

## G1 启用影子 Cron（协调者，key 注入后）
1. `wrangler.toml`：删 `BOARD_FETCH_DISABLED`、加回 `[triggers] crons=["*/10 * * * *"]`、置 `BOARD_TARGET_KEY="shadow"`。
2. `npx wrangler deploy -c workers/fetcher/wrangler.toml`（凭据通道见仓库根 CONSTRUCTION_PHASE2 与 Cloudflare 连接文档）。
3. 每小时跑 `node scripts/compare-shadow.mjs` 比对影子与线上（按 fetchRunId 对齐，容忍 90s 传播窗）。

## 开关取值口径（P6 F6-84/F6-85 统一，2026-11-23）

| 开关 | 取值 | 语义 |
|---|---|---|
| `BOARD_FETCH_DISABLED` | 未设置 / 空串 / `"0"` | 启用抓取（scheduled 正常跑） |
| | `"1"` / `"true"` / `"yes"` / `"on"` | 禁用 scheduled（紧急停抓） |
| | 任何其他非空值（误写等） | **按禁用处理（fail-closed）** + 记 error 日志 `board_fetch_disabled_unknown_value` |
| `PAPRIKA_ENABLED` | 精确 `"true"` | 允许启用 Paprika（仍须过下方映射门禁） |
| | 其余任何值 | 未启用（fail-closed），强制 CoinGecko |
| `BOARD_SOURCE` | `"auto"` / `"coingecko"` / `"coinpaprika"` | 按值执行（`coinpaprika` 另受 `PAPRIKA_ENABLED` 约束） |
| | 未知值（拼写错误等） | 回落 `auto` + warning 日志 `source_config_warning`（F6-85，不再静默） |

补充口径：

- Paprika 映射门禁（F6-10）：即使 `PAPRIKA_ENABLED="true"`，COINS 中 `paprikaId` 非 null 数 < 197（`PAPRIKA_MIN_MAPPED`）时仍强制 CoinGecko 并记 warning；每 run 的映射数落 `health.paprikaMappedCount`。
- `BOARD_FETCH_DISABLED` 只停 scheduled；手动 `POST /run` 在禁用时**维持可用**（人工恢复/验证通道，F6-49 决策），其滥用面由 token 常量时间校验 + 60 秒最小间隔（`health.lastManualRunAt`）+ 并发在途合并兜底。
- `BOARD_TARGET_KEY` 口径不变：仅精确 `"shadow"` / `"current"`，其余 fail-closed 拒写（W5-02）。

## coins 同步
`coins.json` 为 `data/coins.json` 的构建期副本；`src/coins-list.js` 由它生成（id + paprikaId 数组）。
三者不一致时以 `data/coins.json` 为准，重新复制并重生成 coins-list.js（生成命令见文件头注释的等价脚本，施工记录在 CONSTRUCTION_PHASE2）。
