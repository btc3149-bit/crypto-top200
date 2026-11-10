# 变更记录：剔除锚定类 + 顺延补位 43 币（2026-11-10）

依据：补位研究报告《市值前 200 预估榜单补位研究》（`~/workspace/research_notes/top-200-refill-43-non-stablecoins-20261110-0856/report.md`）。
执行脚本：`scripts/merge_refill.py`（解析补位报告 → 映射 CoinGecko id → 合并重排 → 写出 data/coins.json 与 public/data/coins.json）。未执行任何部署。

## 删除：原表 B 全部 43 个锚定类条目

类别构成：法币稳定币、收益型/算法稳定币、外币（欧元/日元计价）稳定币、代币化基金/国债/货币市场基金份额、黄金等锚定及包装/质押衍生类。明细：
Tether（USDT）、USDC（USDC）、USDS（USDS）、Ethena USDe（USDE）、Dai（DAI）、World Liberty USD（USD1）、PayPal USD（PYUSD）、Global Dollar（USDG）、Ripple USD（RLUSD）、Ondo US Dollar Yield（USDY）、Circle USYC（USYC）、Spiko Amundi Fund（EURSAFO）、United Stables（U）、USDD（USDD）、BFUSD（BFUSD）、Blockchain Capital（BCAP）、USDGO（USDGO）、GHO（GHO）、Invesco Fund（USTB）、Janus Henderson（JAAA）、Usual USD（USD0）、EURC（EURC）、TrueUSD（TUSD）、Spiko EU T-Bills（EUTBL）、YLDS（YLDS）、Re Protocol reUSD（REUSD）、apxUSD（APXUSD）、First Digital USD（FDUSD）、Spiko Amundi（SAFO）、Legacy Frax（FRAX）、USX（USX）、EUR CoinVertible（EURCV）、USAT（USAT）、Spiko US T-Bills（USTBL）、Tradable SSTN（PC0000033）、USDai（USDAI）、AUSD（AUSD）、Satoshi Stablecoin（SATUSD）、Gemini Dollar（GUSD）、crvUSD（CRVUSD）、apyUSD（APYUSD）、Tradable SSTN（PC0000097）、CASH（CASH）。

前端同步去掉表 B 切换与锚定类表格，全站改为单一可预估榜单；相关计数与说明文案（副标题、方法论「构成与计数说明」「数据日期差异」、页脚）已更新。

## 加入：补位报告 43 个非锚定币

取自 CoinGecko 市值第 203–269 位区间顺延筛选（其间另跳过 26 个锚定类）：
Sonic（S）、Bedrock（BR）、Axie Infinity（AXS）、SwissBorg（BORG）、Theta Network（THETA）、coco（COCO）、Decentraland（MANA）、lium（SN51）、edgeX（EDGE）、Useless Coin（USELESS）、MX Token（MX）、NEO（NEO）、Vaulta（A）、The Sandbox（SAND）、Vision（VSN）、Kinetiq（KNTQ）、Onyxcoin（XCN）、Ozone Chain（OZO）、BCGame Coin（BC）、Railgun（RAIL）、AWE Network（AWE）、Quack AI（Q）、Sentient（SENT）、BUILDon（B）、Fartcoin（FARTCOIN）、Chiliz（CHZ）、eCash（XEC）、AIOZ Network（AIOZ）、DGrid AI（DGAI）、Non-Playable Coin（NPC）、SoSoValue（SOSO）、1inch（1INCH）、Rollbit Coin（RLB）、Immutable（IMX）、Pons（PONS）、SuperVerse（SUPER）、Reserve Rights（RSR）、SafePal（SFP）、DoubleZero（2Z）、ApeCoin（APE）、Golem（GLM）、ZKsync（ZK）、Chutes（SN64）。

## 重要口径说明：19 个重合币的去重处理

补位 43 币中有 **19 个与原表 A 尾部币种重复**（S、AXS、BORG、THETA、COCO、MANA、SN51、USELESS、MX、NEO、A、SAND、VSN、KNTQ、OZO、BC、RAIL、AWE、FARTCOIN；其中 BC 与原榜的 BCG 为同一币 BCGame Coin，CoinGecko 代码为 BC）。原因：原榜排名为 SectorAlpha 2026-11-08 收盘口径（这些币列 180–200 位），补位研究为 CoinGecko 2026-11-10 实盘口径（同批币列 203–269 位）。处理原则：**不重复计数**——这 19 个币保留单一一条，按补位报告的最新事实与预估（2026-11-10 核验）更新原条目，CoinGecko id 沿用原已审计值；其余 **24 个为真正新增**。

## 总数变化

- 变更前：201 条 = 表 A 158（可预估） + 表 B 43（锚定类，不预估）
- 变更后：**182 条，全部可预估、无锚定类、无重复币种**（139 个老币原样保留 + 19 个按补位数据更新 + 24 个新增）
- 若要凑满 201 个不重复币种，还需再顺延研究约 19 个币（市值约第 270 位之后）并做同口径预估——属新的研究任务，本次未做，未以任何数据凑数。

## 数据日期

- 老币（139 个未重合）：快照价/市值为 CoinGecko 口径 **2026-11-08 日收盘**（dataDate=2026-11-08）
- 补位批 43 个（含 19 个更新条目）：事实数据为 **2026-11-10 CoinGecko 实盘核验**（dataDate=2026-11-10，前端在「报告现排名」列以“11-10核验”标记）
- 预估窗口与方法论不变：2029 年 9 月下旬 ~ 10 月中旬；全表 estRank 已按各报告预估倍数中点统一降序重排（1–182 连续）。

## CoinGecko id

- 新增 24 币 id 覆盖率 24/24：全部经名称+代码匹配并以实时价与补位快照价复核（比率 0.996–1.004，实时排名与补位报告名次逐一吻合），无未核定项。易混项：BR → bedrock-token、XCN → chain-2、B → build-on、SUPER → superfarm、SN64 → chutes。
- 19 个更新条目沿用原审计 id（如 S → sonic-3、AWE → stp-network、BC → bc-token）。

## 打包与自测

- dist-upload/ 已按原结构更新（index.html、data/coins.json、functions/api/board.js），upload.zip 已重打。
- node --check：前端内联脚本、functions/api/board.js 均通过。
- /api/board 本地实测（Node 直调 onRequest + 本地静态托管 coins.json）：HTTP 200、非缓存回退，**182/182 个币全部返回实时价**，/global 正常。
