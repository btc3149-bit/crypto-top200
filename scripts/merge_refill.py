#!/usr/bin/env python3
"""Merge the refill-43 research into coins.json.

- Drops all table-B (anchored) entries.
- Parses the refill report's 43-row table; coins already present in table A
  (rank-caliber/date drift between the two reports) are updated in place with
  the refill report's fresher 2026-11-10 live-verified data instead of being
  duplicated; genuinely new coins are appended.
- Re-ranks estRank for the whole board by report multiple midpoint, desc.
- Fills CoinGecko ids for new coins (name+symbol match, verified by live
  price vs the refill snapshot price); duplicates reuse the audited old ids.
Outputs data/coins.json and public/data/coins.json (identical).
"""
import json, re, subprocess, sys, time, unicodedata

ROOT = "/home/hatch/workspace/cloudflare-top200-site"
REFILL = "/home/hatch/workspace/research_notes/top-200-refill-43-non-stablecoins-20261110-0856/report.md"

# Manual id resolutions for new coins that the automatic pass cannot settle.
OVERRIDES = {}

def curl(url, timeout=90):
    r = subprocess.run(["curl", "-s", "-m", str(timeout), url], capture_output=True, text=True)
    return json.loads(r.stdout)

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").lower()
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", s)

# ---------------- parse refill table ----------------
text = open(REFILL, encoding="utf-8").read()
lines = text.splitlines()
start = next(i for i, l in enumerate(lines) if "43 行总表" in l)
end = next(i for i, l in enumerate(lines) if l.startswith("### 三"))
refill = []
for l in lines[start:end]:
    if not l.startswith("|"):
        continue
    cells = [c.strip() for c in l.strip().strip("|").split("|")]
    if len(cells) != 9 or not cells[0].isdigit():
        continue
    idx, name_cell, fact_cell, ath_cell, est_cell, mult_cell, impl_cell, conf, reason = (
        int(cells[0]), cells[1], cells[2], cells[3], cells[4], cells[5], cells[6], cells[7], cells[8])
    m = re.match(r"^(.+?)（(.+?)）#(\d+)$", name_cell)
    if not m:
        print("name parse fail:", name_cell, file=sys.stderr); continue
    name, symbol, rank_now = m.group(1), m.group(2), int(m.group(3))
    fm = re.match(r"^\$([\d.,]+)\s*/\s*\$([\d.,]+)M\s*/", fact_cell)
    price = float(fm.group(1).replace(",", ""))
    mcap_usd = float(fm.group(2).replace(",", "")) * 1e6
    mcap_raw = "$" + (f"{mcap_usd/1e8:.2f}".rstrip("0").rstrip(".")) + "亿"
    # ATH: approx if marked ~ or ※
    ath_flag = "approx" if (ath_cell.startswith("~") or "※" in ath_cell) else "verified"
    pm = re.search(r"\$\s*([\d.,]+)", ath_cell)
    ath_price = float(pm.group(1).replace(",", "")) if pm else None
    dm = re.search(r"(\d{4})-(\d{2})-(\d{2})", ath_cell)
    if dm:
        ath_date = dm.group(0)
    else:
        dm = re.search(r"(\d{4})-(\d{2})", ath_cell)
        if dm:
            ath_date = dm.group(0)
        else:
            dm = re.search(r"(\d{4})\s*年", ath_cell)
            ath_date = dm.group(1) if dm else None
    em = re.match(r"^\$([\d.,]+)–([\d.,]+)$", est_cell)
    est_lo, est_hi = float(em.group(1).replace(",", "")), float(em.group(2).replace(",", ""))
    mm = re.match(r"^([\d.]+)–([\d.]+)×", mult_cell)
    mult_lo, mult_hi = float(mm.group(1)), float(mm.group(2))
    im = re.search(r"\$([\d.]+)–([\d.]+)\s*亿", impl_cell)
    impl_lo, impl_hi = float(im.group(1)) * 1e8, float(im.group(2)) * 1e8
    impl_raw = "~$" + im.group(1) + "–" + im.group(2) + "亿"
    refill.append({
        "name": name, "symbol": symbol, "rankNow": rank_now,
        "snapshotPrice": price, "snapshotMcapUsd": mcap_usd, "snapshotMcapRaw": mcap_raw,
        "athPrice": ath_price, "athDate": ath_date, "athFlag": ath_flag,
        "estLo": est_lo, "estHi": est_hi, "multLo": mult_lo, "multHi": mult_hi,
        "impliedMcapLoUsd": impl_lo, "impliedMcapHiUsd": impl_hi, "impliedMcapRaw": impl_raw,
        "confidence": conf.replace("*", ""), "reason": reason})
print(f"refill parsed: {len(refill)}")
assert len(refill) == 43, len(refill)

# ---------------- load existing, split duplicates vs new ----------------
old = json.load(open(f"{ROOT}/data/coins.json", encoding="utf-8"))
old_a = [c for c in old["coins"] if c["table"] == "A"]
old_b = [c for c in old["coins"] if c["table"] == "B"]
old_by_symbol = {c["symbol"]: c for c in old_a}
old_by_name = {norm(c["name"]): c for c in old_a}

dups, news = [], []
for r in refill:
    hit = old_by_symbol.get(r["symbol"]) or old_by_name.get(norm(r["name"]))
    (dups if hit else news).append((r, hit))
print(f"duplicates (update in place): {len(dups)} -> {[r['symbol'] for r, _ in dups]}")
print(f"genuinely new: {len(news)} -> {[r['symbol'] for r, _ in news]}")

# ---------------- map CoinGecko ids for new coins ----------------
cglist = curl("https://api.coingecko.com/api/v3/coins/list")
json.dump(cglist, open("/tmp/cg_list2.json", "w"))
by_symbol = {}
for e in cglist:
    by_symbol.setdefault(e["symbol"].lower(), []).append(e)
markets = {}
for page in (1, 2, 3):
    data = curl(f"https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page={page}&sparkline=false")
    if isinstance(data, list):
        for mk in data:
            markets[mk["id"]] = mk
    time.sleep(2)
print("markets fetched:", len(markets), file=sys.stderr)

def pick_id(r):
    if r["symbol"] in OVERRIDES:
        return OVERRIDES[r["symbol"]], "override"
    cands = [e for e in by_symbol.get(r["symbol"].lower(), []) if e["id"] in markets]
    scored = []
    for e in cands:
        mk = markets[e["id"]]
        lp = mk.get("current_price")
        ratio = (lp / r["snapshotPrice"]) if (lp and r["snapshotPrice"]) else None
        namesim = 1.0 if norm(e["name"]) == norm(r["name"]) else (0.5 if norm(r["name"]) in norm(e["name"]) or norm(e["name"]) in norm(r["name"]) else 0.0)
        scored.append((namesim, ratio, e, mk))
    scored.sort(key=lambda t: (-t[0], abs((t[1] or 99) - 1)))
    for namesim, ratio, e, mk in scored:
        if ratio is not None and 0.35 <= ratio <= 2.8:
            return e["id"], f"markets(namesim={namesim},ratio={ratio:.3f},live={mk.get('current_price')},rank={mk.get('market_cap_rank')})"
    return None, f"unresolved cands={[(e['id'], markets[e['id']].get('current_price')) for _, _, e, _ in scored]}"

id_map, unresolved = {}, []
for r, _ in news:
    cid, how = pick_id(r)
    id_map[r["symbol"]] = cid
    print(("OK  " if cid else "??  ") + f"{r['symbol']:10s} -> {cid}  [{how}]")
    if not cid:
        unresolved.append(r["symbol"])

# ---------------- build merged coin list ----------------
def refill_record(r, cid):
    return {
        "table": "A", "estRank": None, "rankNow": r["rankNow"], "rankNote": None,
        "name": r["name"], "symbol": r["symbol"], "coingeckoId": cid,
        "snapshotPrice": r["snapshotPrice"], "snapshotMcapUsd": round(r["snapshotMcapUsd"]),
        "snapshotMcapRaw": r["snapshotMcapRaw"],
        "athPrice": r["athPrice"], "athDate": r["athDate"], "athFlag": r["athFlag"],
        "estLo": r["estLo"], "estHi": r["estHi"], "multLo": r["multLo"], "multHi": r["multHi"],
        "impliedMcapLoUsd": round(r["impliedMcapLoUsd"]), "impliedMcapHiUsd": round(r["impliedMcapHiUsd"]),
        "impliedMcapRaw": r["impliedMcapRaw"],
        "confidence": r["confidence"], "reason": r["reason"],
        "dataDate": "2026-11-10"}

merged = []
dup_old_ids = {id(hit) for _, hit in dups}
for c in old_a:
    if id(c) in dup_old_ids:
        continue  # replaced by refill record below
    c = dict(c)
    c.setdefault("dataDate", "2026-11-08")
    merged.append(c)
for r, hit in dups:
    merged.append(refill_record(r, hit["coingeckoId"]))
for r, _ in news:
    merged.append(refill_record(r, id_map[r["symbol"]]))

# ---------------- re-rank by multiple midpoint desc ----------------
def mid(c):
    return (c["multLo"] + c["multHi"]) / 2.0
merged.sort(key=lambda c: -mid(c))
for i, c in enumerate(merged, 1):
    c["estRank"] = i

out = {
    "meta": {
        "generatedAt": "2026-11-10",
        "source": "主研究报告《市值前 200 加密货币下一轮牛市高点预估排名》（2026-11-10，老币价格/市值快照为 CoinGecko 口径 2026-11-08 日收盘）+ 补位研究《市值前 200 预估榜单补位研究》（2026-11-10，补位币为 CoinGecko 实盘核验 2026-11-10）",
        "estimateWindow": "2029 年 9 月下旬 ~ 10 月中旬（下一轮牛市高点推算窗口）",
        "totalCoins": len(merged), "tableA": len(merged), "tableB": 0,
        "note": ("全表单一榜：原表B 43 个锚定类（稳定币/黄金代币/代币化基金/包装资产等）已按规则全部剔除，"
                 "并按市值排名顺延补入补位研究的 43 个非锚定币（CoinGecko 市值第 203–269 位区间筛选）。 "
                 "其中 19 个与原表A尾部币种重复（两份报告排名口径与日期不同：原榜为 SectorAlpha 11-08 收盘口径、补位为 CoinGecko 11-10 实盘口径），"
                 "已按补位报告的最新数据更新原条目、不重复计数；实际新增 24 个，全表共 %d 个不重复可预估币种。"
                 "另：原表A第 157 行 XTZ/SHFL 合并行已拆为两条。数据日期：老币 2026-11-08 快照、补位币 2026-11-10 核验（见各条 dataDate）。" % len(merged)),
    },
    "coins": merged}
for path in (f"{ROOT}/data/coins.json", f"{ROOT}/public/data/coins.json"):
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"coins.json written: total={len(merged)} (old kept {len(merged)-len(refill)}, refill applied {len(refill)})")
print("unresolved ids:", unresolved)
print("top5:", [(c["estRank"], c["symbol"], round(mid(c), 2)) for c in merged[:5]])
json.dump({"unresolved": unresolved,
           "dups": [r["symbol"] for r, _ in dups],
           "news": [r["symbol"] for r, _ in news],
           "idMap": id_map}, open("/tmp/refill_merge.json", "w"), ensure_ascii=False)
