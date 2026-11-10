# CoinPaprika 覆盖率实测 2026-11-10（第 1 天）

- 映射来源：docs/paprika-mapping-proposal.json（提案，未落库）
- 映射非空：196/200
- tickers 命中：**179/200** → 未达门槛（<195，禁止启用）
- 价差分布（命中且双边有价 179 币）：中位数 0.156%、P95 0.652%、最大 1.927%
- 价差 >5% 的币：无

## 缺失清单

- ape-and-pepe（apepe-ape-and-pepe）：映射存在但不在免费层 tickers 前 2000（或已下线）
- railgun（rail-railgun）：映射存在但不在免费层 tickers 前 2000（或已下线）
- zama（zama-zama）：映射存在但不在免费层 tickers 前 2000（或已下线）
- hash-2：无映射（paprikaId=null，见提案未决清单）
- celium：无映射（paprikaId=null，见提案未决清单）
- chutes（sn64-chutes）：映射存在但不在免费层 tickers 前 2000（或已下线）
- meta-2-2（meta-metadao-new）：映射存在但不在免费层 tickers 前 2000（或已下线）
- bnb48-club-token（koge-bnb48-club-token）：映射存在但不在免费层 tickers 前 2000（或已下线）
- coco-2（coco-coco）：映射存在但不在免费层 tickers 前 2000（或已下线）
- kinetiq（kntq-kinetiq）：映射存在但不在免费层 tickers 前 2000（或已下线）
- bc-token（bc-bcgame-coin）：映射存在但不在免费层 tickers 前 2000（或已下线）
- debridge（dbr-debridge）：映射存在但不在免费层 tickers 前 2000（或已下线）
- pearl-2（prl-pearl-1）：映射存在但不在免费层 tickers 前 2000（或已下线）
- ozone-chain（ozo-ozone-chain）：映射存在但不在免费层 tickers 前 2000（或已下线）
- genius-3：无映射（paprikaId=null，见提案未决清单）
- pons（pons-pons）：映射存在但不在免费层 tickers 前 2000（或已下线）
- nxm：无映射（paprikaId=null，见提案未决清单）
- okzoo（aiot-okzoo）：映射存在但不在免费层 tickers 前 2000（或已下线）
- yzy（yzy-yzy）：映射存在但不在免费层 tickers 前 2000（或已下线）
- soon-2（soon-soon-1）：映射存在但不在免费层 tickers 前 2000（或已下线）
- yellow（yellow1-yellow）：映射存在但不在免费层 tickers 前 2000（或已下线）

## 说明

- 本期要求连测 3 天（方案 W2-03 §2），本文件为第 1 天；第 2/3 天由协调者在后续日期补跑并另存 `paprika-coverage-<日期>.md`。
- 即使覆盖达标，启用仍须 U8（站长书面确认个人非商业运营）+ 映射落库（W2-11）；当前 PAPRIKA_ENABLED=false 不变。
- 命中币 last_updated 示例：filecoin=2026-11-10T10:31:16Z；dogwifcoin=2026-11-10T10:31:16Z；bonk=2026-11-10T10:31:16Z
