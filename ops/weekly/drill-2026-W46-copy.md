# 副本演练记录（2026-11-10，临时副本 /tmp/wdrill，不污染正式 state）

演练1：state 副本中仅 IMX 的 watchOut.weeks 预置 1（其余归零）后重跑 → IMX 以连续 2 周出现在候选移出，其余不达标。
演练2：overrides 副本中 TEL 的 reviewDue 改为 2026-01-01（已过期）→ 同一副本报告 D 节到期清单出现 TEL。

## 演练副本报告全文

# 名单周检 2026-W46（运行：2026-11-10T10:17:27+00:00 · 执行：weekly_check.py v1.0.0 · 数据：CoinGecko 匿名）

## 结论
告警 0 条 / 候选移入 0 个 / 候选移出 1 个 / 人工队列 9 条 / override 到期 1 条

## A. 告警
- 无

## B. 进出候选
| symbol | 现实时排名 | 连续周数 | 处置状态 |
|---|---|---|---|
| IMX | 跌出前250 | 2 | 候选移出（待人工处置） |
观察中（未达 2 周）：watch-in 63 个、watch-out 32 个。

## C. 人工队列
- symbol/name 变更 EIGEN: 存档=(EIGEN,EigenCloud) 实时=(eigen,EigenCloud (prev. EigenLayer)) id=eigenlayer
- symbol/name 变更 币安人生: 存档=(币安人生,BinanceLife) 实时=(币安人生,币安人生 (BinanceLife)) id=bianrensheng
- symbol/name 变更 AERO: 存档=(AERO,Aerodrome) 实时=(aero,Aero) id=aero
- symbol/name 变更 HASH: 存档=(HASH,Provenance) 实时=(hash,Provenance Blockchain) id=hash-2
- symbol/name 变更 MX: 存档=(MX,MX Token) 实时=(mx,MX) id=mx-token
- symbol/name 变更 GOMINING: 存档=(GOMINING,GoMining) 实时=(gomining,GoMining Token) id=gmt-token
- symbol/name 变更 GRAM: 存档=(GRAM,Gram (原Toncoin)) 实时=(gram,Gram (prev. Toncoin)) id=the-open-network
- symbol/name 变更 PRL: 存档=(PRL,Pearl) 实时=(pearl,Pearl) id=pearl-2
- symbol/name 变更 LEO: 存档=(LEO,UNUS SED LEO) 实时=(leo,LEO Token) id=leo-token

## D. Override
到期清单：TEL（active 共 13 条，reviewDue 一律 2027-02-08）
本周已复审登记：无（首跑基准周）

## E. 运行元信息
端点调用次数：{"cg_markets_top250": 1, "cg_markets_ids": 1, "cg_list": 1, "coincap_assets": 1}
C6 CoinCap 第二源：状态=跳过（接口不可用: curl failed rc=52: curl: (52) Empty reply from server），已比对 0 币，跳过 200 币（跳过不算失败）
incomplete 缺项：无
state.json 变更摘要：watchOut 32 个、watchIn 63 个、driftMarked 累计 0 个、lastRunWeek=2026-W46
注记：本周为首跑基准周（state 以 2026-11-10 名单为第 0 周基准），进出连续计数从 1 起算属预期；周号按 ISO 8601（2026-11-10 属 ISO 第 46 周）。
