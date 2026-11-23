# Paprika 映射落库记录（W5 独立子项，2026-11-23）

## 落点定版

- **事实源**：`workers/fetcher/src/coins-list.js` 的 `COINS`（`{id, paprikaId}` 标准形，与 F5-01 形变口径一致）。理由：fetcher 运行时直接消费此表（门禁计数 `paprikaMappedCount` 即数它），且既有契约测试已守护其与 coins.json 的 id 集一致；映射若另立事实源会出现双源漂移。
- **管线透传**：`scripts/build.py` 从事实源解析映射（`load_paprika_map()`，不在 build.py 另立映射表），全量构建的 `record_*` 与 `--emit` 迁移均按 `coingeckoId` 透传，生成 coins.json 新列。
- **字段规范**：FIELDS23 → **FIELDS24** = FIELDS23 + `paprikaId`（追加末尾）。三份 coins.json（`data/`、`public/data/`、`workers/fetcher/`）同字节切换。

## 提案校验（落入前逐条核）

提案 `docs/paprika-mapping-proposal.json` 200 条：`coingeckoId` 与 COINS/coins.json 的 id 集**逐一全对上（无对不上、无重复）**；196 个非空 paprikaId 全部通过格式校验 `^[a-z0-9]+-[a-z0-9-]+$` 且无重复；4 条 null 与提案自述一致。无静默丢弃。

## 向后兼容（同 W3-22 一次性切换先例）

全部解码端按 `meta.fields` 动态解码（`scripts/check_meta.py decode_coins`、前端 `decodeCoinsData`、`functions/api/board.js getIds`、`scripts/decode-coins.mjs`），逻辑零改动、仅补注释。契约测试新增 R3：FIELDS23 旧形态文档仍可解码 200 行且不多出 paprikaId 键。`build.py --emit` 对无 paprikaId 键的旧文档自动按事实源补齐后再按 FIELDS24 编码。`--emit` 实跑成功（sha256 d0a4e96a…）。

## dataHash（口径 A）

口径 A 不变（解码后规范对象数组的 sha256）。因规范对象**新增了 paprikaId 键**，哈希必然变化：`sha256:264c2b20…beaac4` → `sha256:73a22ff0…b179`（emit 前值；emit 重写后文件哈希另计）。这是数据内容新增一列的预期变化，非口径变更。

## 实测（2026-11-23 01:40 UTC，本地）

- **coins.json paprikaId 非空数：196/200**（三份文件一致；契约测试 ⑤ 与 coins-list-contract 新断言双守护）。
- **tickers 命中：178/200**。方法：单次 GET `/v1/tickers?quotes=USD&limit=5000`（实回 2000 条，端点上限即 2000，与 fetcher 批量口径一致）按 paprikaId 匹配计数；`scripts/verify-paprika-coverage.mjs` 独立复跑同得 178（RESULT: FAIL hits=178）。第六期基线 179/200，本轮 178。
- **未命中 22 = 未映射 4 + 已映射未命中 18**，逐一归因（以 `/v1/coins` 全量 62,744 条核对）：
  - 17 个已映射币在 Paprika 侧**活跃但自家 rank 3683–6944，超出 tickers 前 2000 列表**，批量端点够不着（抽查 rail/zama/sn64/dbr 的单币 `/v1/tickers/{id}` 均有报价）：ape-and-pepe(4671)、railgun(5520)、zama(4964)、chutes(4455)、meta-2-2(5936)、wefi(3683)、bnb48-club-token(5866)、coco-2(4334)、kinetiq(4858)、bc-token(4839)、debridge(4375)、pearl-2(6944)、ozone-chain(4602)、pons(4956)、okzoo(5493)、soon-2(4551)、yellow(4028)。括号内为 Paprika rank。
  - 1 个已下线：yzy（`yzy-yzy`，`is_active=false`、rank 0）。
  - 4 个未映射（见下）。

## 4 个未映射币与候选核查（全部留空，不猜填）

| coingeckoId | symbol/name | 候选核查（/v1/coins 全量，2026-11-23） | 结论 |
|---|---|---|---|
| hash-2 | HASH / Provenance | `hash-provenance-blockchain`（名 "Provenance Blockchain"、symbol HASH）已 `is_active=false`、rank 0、无报价；提案原候选 `hash-hash-2` 同为 inactive 且名仅 "Hash" | 留空 |
| celium | SN51 / lium | 全量表中无 SN51 symbol、无 lium 名条目 | 留空（无候选） |
| genius-3 | GENIUS / Genius | `genius-genius` 名/symbol 双对上但 `is_active=false`、rank 0；`genius-genius-terminal` 活跃但名为 "Genius Terminal" 非全等 | 留空 |
| nxm | NXM / Nexus Mutual | 全量表中无 NXM symbol 条目，仅 `wnxm-wrapped-nxm`（Wrapped，非同一资产） | 留空 |

## 门禁结论（红线未动）

`PAPRIKA_MIN_MAPPED=197` 与 verify 门槛（195/197）**一字未改**，fetcher 备源开关默认值未动。

- 差距一：映射 196 < 197，**差 1**。
- 差距二：tickers 命中 178 < verify 门槛 195，**差 17**（距启用门槛 197 差 19）。

**结论：Paprika 保持关闭。** 落库后 fetcher 的 `paprikaMappedCount` 将由 0 变为 196，门禁仍会强制走 CoinGecko 并 warning——这是预期行为。

## 测试总账

`./scripts/run-tests.sh`：14/14 套件、**169 项全绿**（基线 166 + 新增 3：contract-real-data ⑤ 落库断言、R3 旧形态兼容、coins-list-contract 映射同步断言；fetcher-branches 9a 改为显式全 null 形以保留原回归意图）。
