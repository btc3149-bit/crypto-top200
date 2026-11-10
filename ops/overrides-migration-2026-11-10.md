# overrides.json 迁移报告（W2-12，2026-11-10）

- 落值：13 条 active + 2 条 retired（BCAP、SATUSD 随表 B 剔除退役保留溯源），逐条以现行 coins.json 回验 id 一致；`check_meta.py --check-overrides` 全 pass。
- evidenceUrl 验活：CoinGecko 网页对 curl 统一返回 403（机器人墙，非死链）；改以 CoinGecko API markets 按 id 查验，15/15 全部存在且 symbol/name 与登记一致（pearl-2→PEARL、bc-token→BC、sonic-3→S、chutes→SN64、stp-network→AWE 等错位关系均与登记吻合）。
- reviewDue 一律 2027-02-08（verifiedAt 2026-11-10 + 90 天）。

## 二轮补位批（盘点表 #12）逐币复核结论

18 个正式币逐币核对 name/symbol 与 coingeckoId 的对应关系：
- 直观对应（10）：ULTIMA→ultima、YELLOW→yellow、ATH→aethir、H→humanity、PLUME→plume、YZY→yzy、NXM→nxm、AIOT→okzoo、SKR→seeker、DBR→debridge——id 即名/符号的直译，无需登记。
- 全名/旧名可推导（3）：PROM→prometeus（Prom 为 Prometeus 简称，id 为项目全名）、ZEN→zencash（Horizen 前名 ZenCash）、0G→zero-gravity（0G 即 Zero Gravity 全称拼写）——由现行名称可推导，不登记。
- 后缀碰撞但靠「名称精确匹配 + AUDIT_BAND 比值」确定性命中（3）：GENIUS→genius-3、META→meta-2-2、SOON→soon-2——非蒙对，不登记。
- **补登为 active override（2）**：SNX→havven（Synthetix 原名 Havven，id 与现行 name/symbol 毫无字面关联）、EGLD→elrond-erd-2（MultiversX 前身 Elrond 的改名遗留 id 且带后缀）——均按 manual-resolution 登记，使 active 总数达 13 条。
- 备选 4 币（ORCA/RED/GMX/SN4）未启用、不在现行表中，不登记。
