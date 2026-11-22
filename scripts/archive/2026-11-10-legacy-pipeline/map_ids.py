#!/usr/bin/env python3
"""Map parsed coins to CoinGecko ids; verify by live price vs report snapshot price."""
import sys as _sys
print("[已退役] 本脚本为归档旧管线，禁止执行：误跑可能覆盖现行数据。如需参考逻辑请只读代码。", file=_sys.stderr)
_sys.exit(2)
import json, re, subprocess, sys, time, unicodedata

RAW = "/tmp/coins_raw.json"
LIST = "/tmp/cg_list.json"

def curl(url):
    r = subprocess.run(["curl", "-s", "-m", "60", url], capture_output=True, text=True)
    return json.loads(r.stdout)

raw = json.load(open(RAW, encoding="utf-8"))
cglist = json.load(open(LIST, encoding="utf-8"))
by_symbol = {}
for e in cglist:
    by_symbol.setdefault(e["symbol"].lower(), []).append(e)

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").lower()
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", s)

# 1) live markets top-500 (2 pages x 250)
markets = {}
for page in (1, 2):
    data = curl(f"https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page={page}&sparkline=false")
    for m in data:
        markets[m["id"]] = m
    time.sleep(2)
print("markets fetched:", len(markets), file=sys.stderr)
json.dump(markets, open("/tmp/cg_markets.json", "w"))

def price_ratio(coin, m):
    sp, lp = coin.get("snapshotPrice"), m.get("current_price")
    if not sp or not lp: return None
    return lp / sp

results, unresolved = [], []
all_coins = [("A", c) for c in raw["tableA"]] + [("B", c) for c in raw["tableB"]]
for table, c in all_coins:
    sym = c["symbol"].lower()
    cands = [e for e in by_symbol.get(sym, []) if e["id"] in markets]
    pick, how = None, None
    # exact markets hit: prefer name similarity, then price ratio sanity
    scored = []
    for e in cands:
        m = markets[e["id"]]
        r = price_ratio(c, m)
        namesim = 1.0 if norm(e["name"]) == norm(c["name"]) else (0.5 if norm(c["name"]) in norm(e["name"]) or norm(e["name"]) in norm(c["name"]) else 0.0)
        scored.append((namesim, e, m, r))
    scored.sort(key=lambda t: -t[0])
    if scored:
        namesim, e, m, r = scored[0]
        if r is None or 0.2 <= r <= 5:
            pick, how = e["id"], f"markets(namesim={namesim},ratio={r if r is None else round(r,3)})"
    if not pick:
        unresolved.append((table, c))
    results.append({"table": table, "symbol": c["symbol"], "name": c["name"], "id": pick, "how": how})

json.dump({"results": results, "unresolved": [(t, c["symbol"], c["name"]) for t, c in unresolved]},
          open("/tmp/id_pass1.json", "w"), ensure_ascii=False, indent=1)
ok = sum(1 for r in results if r["id"])
print(f"pass1 matched {ok}/{len(results)}; unresolved {len(unresolved)}")
for t, c in unresolved: print("  ?", t, c["symbol"], c["name"])
