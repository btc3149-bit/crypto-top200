# fetcher 运维要点（W2-01/W2-02 摘要）
- 数据流：Cron fetcher（唯一抓取）→ KV BOARD_KV `v1:board:current` → Pages Function 只读组装契约 v2。
- 手动补抓：POST /run + x-manual-token（见 workers/fetcher/README.md）。
- 额度：定版节奏月耗约 5,760 credits；health.quota.quotaMode 自动降频 normal→saving(>8500 预估)→critical(>9500)。
- 429：按 Retry-After 跳过 K 个 run（health.skipRunsRemaining），跳过不计连续失败。
- 故障判读：scripts/probe.mjs（consecutiveFailures≥3 / staleAgeSec>1800 / 组合规则）。
- 回滚：Pages 侧置 BOARD_READ_MODE=legacy 即回旧路径（应急 ≤24h）；fetcher 侧关 Cron 即停抓。
