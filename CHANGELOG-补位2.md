# 变更记录：第二轮补位 18 币凑满 200 + 部署上线（2026-11-10）

依据：第二轮补位研究报告《市值预估榜单第二轮补位研究》（`~/workspace/research_notes/top-200-refill-round2-to-200-20261110-0906/report.md`）。
执行脚本：`scripts/merge_refill2.py`（解析第二轮报告 → 三重去重比对 → 映射 CoinGecko id 并以实时价复核 → 合并重排 → 写出 data/coins.json 与 public/data/coins.json）。
部署：`scripts/deploy.sh`（Wrangler 直推 + custom.cloudflare 受限令牌通道，只触碰 crypto-top200），git commit `0bede09`、tag `v1.2.0-refill200`。

## 加入：正式 18 个（顺延序 1–18，CoinGecko 市值第 271–293 位）

Ultima（ULTIMA → ultima）、Yellow（YELLOW → yellow）、Prom（PROM → prometeus）、Genius（GENIUS → genius-3）、MultiversX（EGLD → elrond-erd-2）、Synthetix（SNX → havven）、Horizen（ZEN → zencash）、Aethir（ATH → aethir）、Humanity（H → humanity）、Plume（PLUME → plume）、MetaDAO（META → meta-2-2）、0G（0G → zero-gravity）、YZY（YZY → yzy）、Nexus Mutual（NXM → nxm）、OKZOO（AIOT → okzoo）、SOON（SOON → soon-2）、Seeker（SKR → seeker）、deBridge（DBR → debridge）。顺延中跳过的 7 个锚定类：ACRED、FRXUSD、SPCXX、USDON、GGBR、JPYC、MAG7.SSI。

## 去重与替补情况

- **零重复、零替补**：正式 18 个逐个与现有 182 条按名称 / 代码 / CoinGecko id 三重比对，全部无命中，直接加入；备选 4 个（ORCA、RED、GMX、SN4）**未启用**，不在表中。
- 全表唯一性断言通过：200 条的 symbol 与 coingeckoId 各 200 个互不重复。

## CoinGecko id 覆盖率

- 新增 18 币 id 覆盖 **18/18（100%）**，无未核定项：全部经名称精确匹配（namesim=1.0）+ 实时价复核（实时价/报告快照价比率 0.987–1.010，实时排名与报告名次逐一吻合，±2 内属小币日内漂移）。
- 本地 /api/board 实测（Node 直调 onRequest + 本地 coins.json + 真实 CoinGecko 上游）：HTTP 200、mode=live、**coverage expected=200 / returned=200 / missingIds=[]**，coins 对象键集合与 200 个 id 完全一致，/global 正常。

## 数据口径

- 新币 dataDate=2026-11-10（CoinGecko 实盘核验）；全表现 dataDate 分布：2026-11-08 老币 139 条、2026-11-10 补位批 61 条（第一轮 43 + 第二轮 18）。
- 第二轮报告只发布隐含市值中点，条目 impliedMcapLo/Hi 按「预估价区间 × 2029 供应假设」推导，中点与报告值逐币交叉校验（偏差均 <15%，无警告）。
- ATH 约值处理：SOON 的 ATH 各源分歧（$4.85–5.54），取 $4.85 并标 athFlag=approx、日期 2025-11；GENIUS 的 ATH ≈$0.96、日期未核实，athDate 记「2026」并标 approx。报告标 ※（无完整历史周期数据）的 15 个新币，已在 reason 末尾标注「（※无完整历史周期数据）」。
- 全表 estRank 已按预估倍数中点（(multLo+multHi)/2，与前两轮同一口径）统一降序重排（1–200 连续）；前 5 名不变：FIL（10.75×）、WIF（8.75×）、BONK（8.75×）、APEPE（8.5×）、THETA（8.5×）；新币最高为 SNX（7.5×，第 22 位）。

## 前端文案同步

public/index.html：总数 182 → 200（副标题、榜单徽章「预估排名（200）」、构成与计数说明补记第二轮顺延/跳过/去重结论）；「两份研究报告」→「三份研究报告」（副标题、页脚）；数据日期差异段更新为补位批共 61 个（43 + 18）。

## 最终 200 构成

- 139 个：原表 A 老币（2026-11-08 快照口径，含 XTZ/SHFL 拆行）
- 43 个：第一轮补位批条目（其中 19 个为按补位数据更新的原条目、24 个新增，dataDate=2026-11-10）
- 18 个：第二轮补位正式名单（本轮新增，dataDate=2026-11-10）
- 合计 **200 个不重复币种，全部可预估、无锚定类**（原表 B 43 个锚定类已于第一轮全部剔除）

## 自测与部署验收

- `node --check`：functions/api/board.js 与前端内联脚本均通过；tests/board.test.mjs 故障矩阵 7/7 PASS（board.js 本轮未改）。
- 三处一致：data/coins.json 与 public/data/coins.json 经 cmp 完全一致（deploy.sh 门禁亦通过）；线上 /data/coins.json 实测 200 条。
- 部署：预览 `f51daaeb-ba8f-4353-8530-eef29c16b045` → 生产 **`ce0ad025-9baa-467f-bf7b-14ae8eabf08e`**（2026-11-10T09:33:37Z，stage success），https://top200.oppcal.com 已为 200 币新版（首页文案、/data/coins.json 条数均在线核验通过）。
- 冒烟（scripts/smoke.sh）：③（无 DOCTYPE 冒充）⑤（首页）⑥（数据 JSON）PASS；①②④ FAIL 的唯一原因是 /api/board 返回 503 收敛错误体 `{"error":"upstream_unavailable"}`——即 CoinGecko 对 Cloudflare 出口 IP 的匿名拦截（U2 待办：补 CoinGecko Demo key 后转 live），函数本身在岗、契约正确、页面如实标注快照模式。**此为已知现状、非本次回归**，与 CONSTRUCTION_P0.md 记录一致。
