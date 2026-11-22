#!/usr/bin/env python3
"""Build final data/coins.json from parsed report + CoinGecko id mapping, then audit all ids by live price."""
import sys as _sys
print("[已退役] 本脚本为归档旧管线，禁止执行：误跑可能覆盖现行数据。如需参考逻辑请只读代码。", file=_sys.stderr)
_sys.exit(2)
import json, re, subprocess, sys, time

raw = json.load(open("/tmp/coins_raw.json", encoding="utf-8"))
pass1 = { (r["table"], r["symbol"]): r["id"] for r in json.load(open("/tmp/id_pass1.json"))["results"] }

OVERRIDES = {  # resolved manually in pass 2 (see scripts/ID_NOTES in README / build log)
    ("A", "TEL"): "telcoin-2",          # 'telcoin' is the dead [OLD] contract; live one is telcoin-2 (ratio 0.97)
    ("A", "WFI"): "wefi",               # ratio 1.000
    ("A", "BCG"): "bc-token",           # CoinGecko symbol is BC, price/mcap match (0.99 / $1.24亿 vs $1.26亿)
    ("A", "PRL"): "pearl-2",            # CoinGecko symbol PEARL, price 1.66 vs 1.71, mcap $6.23亿 vs $6.08亿
    ("B", "BCAP"): "blockchain-capital",# ratio 0.999
    ("B", "SATUSD"): "satoshi-stablecoin",  # ratio 1.000
}

def clean_date(d):
    if not d: return None
    m = re.match(r"^(\d{4}-\d{2}(?:-\d{2})?)", d)
    return m.group(1) if m else d

coins = []
for c in raw["tableA"]:
    cid = OVERRIDES.get(("A", c["symbol"])) or pass1.get(("A", c["symbol"]))
    coins.append({
        "table": "A", "estRank": c["estRank"], "rankNow": c["rankNow"], "rankNote": c["rankNote"],
        "name": c["name"], "symbol": c["symbol"], "coingeckoId": cid,
        "snapshotPrice": c["snapshotPrice"], "snapshotMcapUsd": c["mcapUsd"], "snapshotMcapRaw": c["mcapRaw"],
        "athPrice": c["athPrice"], "athDate": clean_date(c["athDate"]), "athFlag": c["athFlag"],
        "estLo": c["estLo"], "estHi": c["estHi"], "multLo": c["multLo"], "multHi": c["multHi"],
        "impliedMcapLoUsd": c["implLo"], "impliedMcapHiUsd": c["implHi"], "impliedMcapRaw": c["implRaw"],
        "confidence": c["confidence"], "reason": c["reason"]})
for c in raw["tableB"]:
    cid = OVERRIDES.get(("B", c["symbol"])) or pass1.get(("B", c["symbol"]))
    coins.append({
        "table": "B", "estRank": None, "rankNow": c["rankNow"], "rankNote": None,
        "name": c["name"], "symbol": c["symbol"], "coingeckoId": cid,
        "snapshotPrice": c["snapshotPrice"], "snapshotMcapUsd": c["mcapUsd"], "snapshotMcapRaw": c["mcapRaw"],
        "noEstimateReason": c["noEstimateReason"]})

missing = [c["symbol"] for c in coins if not c["coingeckoId"]]
print("ids missing:", missing)
out = {
    "meta": {
        "generatedAt": "2026-11-10",
        "source": "《市值前 200 加密货币下一轮牛市高点预估排名》研究报告（2026-11-10），价格/市值快照为 CoinGecko 口径 2026-11-08 日收盘",
        "estimateWindow": "2029 年 9 月下旬 ~ 10 月中旬（下一轮牛市高点推算窗口）",
        "totalCoins": len(coins), "tableA": 158, "tableB": 43,
        "note": "表A第157行为 XTZ/SHFL 合并行，本地拆为两条（estRank 157/158），故表A共158条、两表合计201条，与研究报告覆盖币数一致。"
    },
    "coins": coins}
json.dump(out, open("/home/hatch/workspace/cloudflare-top200-site/data/coins.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("coins.json written:", len(coins))

# ---- audit: one markets call for all ids, compare live vs snapshot price ----
def curl(url):
    r = subprocess.run(["curl", "-s", "-m", "90", url], capture_output=True, text=True)
    return json.loads(r.stdout)

ids = [c["coingeckoId"] for c in coins if c["coingeckoId"]]
time.sleep(3)
data = curl("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&sparkline=false&ids=" + ",".join(ids))
if not isinstance(data, list):
    print("markets audit call failed:", str(data)[:200]); sys.exit(0)
live = {m["id"]: m for m in data}
print(f"audit: markets returned {len(live)}/{len(ids)} ids")
flagged = []
for c in coins:
    m = live.get(c["coingeckoId"])
    if not m or not m.get("current_price") or not c["snapshotPrice"]:
        flagged.append((c["symbol"], c["coingeckoId"], "no-live-price")); continue
    r = m["current_price"] / c["snapshotPrice"]
    if not (0.35 <= r <= 2.8):
        flagged.append((c["symbol"], c["coingeckoId"], f"ratio={r:.2f} live={m['current_price']} snap={c['snapshotPrice']} cgname={m['name']}"))
print("flagged:", len(flagged))
for f in flagged: print("  !", f)
json.dump({"returned": len(live), "flagged": flagged}, open("/tmp/id_audit.json", "w"), ensure_ascii=False)
