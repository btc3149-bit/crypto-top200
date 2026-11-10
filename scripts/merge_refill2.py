#!/usr/bin/env python3
"""Merge round-2 refill (18 formal + 4 backups) into coins.json.

- Parses the round-2 report: facts tables (§1.2 formal 18, §1.3 backups 4)
  and the estimate table (§2.2, 22 rows).
- Dedups each candidate against the existing 182 by symbol / normalized name
  (and later by resolved CoinGecko id). A duplicated formal pick is skipped
  and replaced in order by the next backup, until exactly 18 additions bring
  the board to exactly 200 unique, estimable coins.
- CoinGecko ids resolved like round 1 (name+symbol match against
  /coins/markets, verified by live price vs report snapshot price).
- impliedMcap lo/hi derived as estLo/estHi x 2029 supply assumption
  (round-2 report publishes only the midpoint implied mcap; the midpoint
  is cross-checked against the derivation).
Outputs data/coins.json and public/data/coins.json (identical).
"""
import json, re, subprocess, sys, time, unicodedata

ROOT = "/home/hatch/workspace/cloudflare-top200-site"
REPORT = "/home/hatch/workspace/research_notes/top-200-refill-round2-to-200-20261110-0906/report.md"

# Manual id resolutions if the automatic pass cannot settle a coin.
OVERRIDES = {}

def curl(url, timeout=90):
    r = subprocess.run(["curl", "-s", "-m", str(timeout), url], capture_output=True, text=True)
    return json.loads(r.stdout)

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").lower()
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", s)

def num(s):
    return float(s.replace(",", "").replace("≈", "").strip())

text = open(REPORT, encoding="utf-8").read()
lines = text.splitlines()

# ---------------- parse facts tables (§1.2 formal, §1.3 backups) ----------------
def parse_facts(start_marker, end_marker):
    start = next(i for i, l in enumerate(lines) if start_marker in l)
    end = next(i for i, l in enumerate(lines) if end_marker in l)
    rows = []
    for l in lines[start:end]:
        if not l.startswith("|"):
            continue
        cells = [c.strip() for c in l.strip().strip("|").split("|")]
        if len(cells) != 7 or not cells[2].isdigit():
            continue
        m = re.match(r"^(.+?)（(.+?)）$", cells[1])
        if not m:
            continue
        name, symbol = m.group(1), m.group(2)
        rank_now = int(cells[2])
        price = num(re.search(r"\$([\d.,]+)", cells[3]).group(1))
        mcap_usd = num(re.search(r"\$([\d.,]+)", cells[4]).group(1))
        ath_cell = cells[6]
        ath_approx = ath_cell.startswith("≈") or "未核实" in ath_cell or "分歧" in ath_cell
        am = re.search(r"\$([\d.,]+)(?:\s*[-–]\s*\$?([\d.,]+))?", ath_cell)
        ath_price = num(am.group(1))  # range case (SOON): first value, flagged approx
        dm = re.search(r"（(\d{4})-(\d{2})(?:-(\d{2}))?", ath_cell)
        if dm and dm.group(3):
            ath_date = f"{dm.group(1)}-{dm.group(2)}-{dm.group(3)}"
        elif dm:
            ath_date = f"{dm.group(1)}-{dm.group(2)}"
        else:
            ym = re.search(r"(\d{4})\s*年", ath_cell)
            ath_date = ym.group(1) if ym else None
        rows.append({"name": name, "symbol": symbol, "rankNow": rank_now,
                     "snapshotPrice": price, "snapshotMcapUsd": mcap_usd,
                     "athPrice": ath_price, "athDate": ath_date,
                     "athFlag": "approx" if ath_approx else "verified"})
    return rows

formal = parse_facts("### 1.2 正式补入", "### 1.3 备选")
backups = parse_facts("### 1.3 备选", "### 1.4")
print(f"facts parsed: formal={len(formal)} backups={len(backups)}")
assert len(formal) == 18 and len(backups) == 4, (len(formal), len(backups))

# ---------------- parse estimate table (§2.2) ----------------
estart = next(i for i, l in enumerate(lines) if "### 2.2 总表" in l)
eend = next(i for i, l in enumerate(lines) if l.startswith("### 2.3"))
est = {}
for l in lines[estart:eend]:
    if not l.startswith("|"):
        continue
    cells = [c.strip() for c in l.strip().strip("|").split("|")]
    if len(cells) != 10:
        continue
    m = re.match(r"^(?:备选\s*\d+|[\d]+)$", cells[0])
    if not m:
        continue
    nm = re.match(r"^(.+?)（(.+?)）(※)?$", cells[1])
    if not nm:
        print("est name parse fail:", cells[1], file=sys.stderr); continue
    name, symbol, star = nm.group(1), nm.group(2), bool(nm.group(3))
    em = re.match(r"^\$([\d.,]+)–([\d.,]+)", cells[3])
    est_lo, est_hi = num(em.group(1)), num(em.group(2))
    mm = re.match(r"^([\d.]+)–([\d.]+)×", cells[4])
    mult_lo, mult_hi = float(mm.group(1)), float(mm.group(2))
    sm = re.search(r"≈([\d.,]+)\s*(万|亿)", cells[5])
    supply29 = float(sm.group(1).replace(",", "")) * (1e4 if sm.group(2) == "万" else 1e8)
    im = re.search(r"\$([\d.]+)\s*亿", cells[6])
    impl_mid_report = float(im.group(1)) * 1e8
    conf = cells[8].replace("*", "").strip()
    est[symbol] = {"estLo": est_lo, "estHi": est_hi, "multLo": mult_lo, "multHi": mult_hi,
                   "supply29": supply29, "implMidReport": impl_mid_report,
                   "confidence": conf, "reason": cells[9], "noCycle": star}
print(f"estimates parsed: {len(est)}")
assert len(est) == 22, len(est)

# ---------------- merge facts + estimates ----------------
cands = []
for group, rows in (("formal", formal), ("backup", backups)):
    for r in rows:
        e = est[r["symbol"]]
        assert abs(e["estLo"] / r["snapshotPrice"] - e["multLo"]) < 0.35, (r["symbol"], "multLo drift")
        impl_lo, impl_hi = e["estLo"] * e["supply29"], e["estHi"] * e["supply29"]
        impl_mid = (e["estLo"] + e["estHi"]) / 2 * e["supply29"]
        drift = abs(impl_mid - e["implMidReport"]) / e["implMidReport"]
        if drift > 0.15:
            print(f"WARN implied-mid drift {r['symbol']}: derived {impl_mid/1e8:.2f}亿 vs report {e['implMidReport']/1e8:.2f}亿 ({drift:.0%})")
        mcap_raw = "$" + (f"{r['snapshotMcapUsd']/1e8:.2f}".rstrip("0").rstrip(".")) + "亿"
        def fmt_yi(v):
            s = f"{v/1e8:.1f}".rstrip("0").rstrip(".")
            return s
        cands.append({**r, **e,
                      "group": group,
                      "snapshotMcapRaw": mcap_raw,
                      "impliedMcapLoUsd": round(impl_lo), "impliedMcapHiUsd": round(impl_hi),
                      "impliedMcapRaw": f"~${fmt_yi(impl_lo)}–{fmt_yi(impl_hi)}亿"})
print("candidates:", [(c["symbol"], c["group"]) for c in cands])

# ---------------- dedup against existing 182 ----------------
old = json.load(open(f"{ROOT}/data/coins.json", encoding="utf-8"))
existing = old["coins"]
print("existing total:", len(existing))
assert len(existing) == 182
old_by_symbol = {c["symbol"].upper(): c for c in existing}
old_by_name = {norm(c["name"]): c for c in existing}
old_ids = {c["coingeckoId"] for c in existing if c.get("coingeckoId")}

selected, skipped = [], []
pool = [c for c in cands if c["group"] == "formal"] + [c for c in cands if c["group"] == "backup"]
for c in pool:
    if len(selected) >= 18:
        break
    hit = old_by_symbol.get(c["symbol"].upper()) or old_by_name.get(norm(c["name"]))
    if hit:
        skipped.append((c, f"duplicates existing {hit['name']}({hit['symbol']})"))
        continue
    selected.append(c)
print(f"selected after name/symbol dedup: {len(selected)} -> {[c['symbol'] for c in selected]}")
print("skipped:", [(c["symbol"], why) for c, why in skipped])
assert len(selected) == 18, len(selected)

# ---------------- map CoinGecko ids (round-1 method) ----------------
cglist = curl("https://api.coingecko.com/api/v3/coins/list")
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
    cands_e = [e for e in by_symbol.get(r["symbol"].lower(), []) if e["id"] in markets]
    scored = []
    for e in cands_e:
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
for r in selected:
    cid, how = pick_id(r)
    id_map[r["symbol"]] = cid
    print(("OK  " if cid else "??  ") + f"{r['symbol']:8s} -> {cid}  [{how}]")
    if not cid:
        unresolved.append(r["symbol"])
    elif cid in old_ids:
        print(f"ERROR id-level duplicate: {r['symbol']} -> {cid} already in board", file=sys.stderr)
        unresolved.append(r["symbol"] + ":id-dup")
print("unresolved:", unresolved)

# ---------------- build records & merge ----------------
def record(r, cid):
    reason = r["reason"]
    if r["noCycle"] and "※" not in reason:
        reason = reason.rstrip("。") + "（※无完整历史周期数据）。"
    return {
        "table": "A", "estRank": None, "rankNow": r["rankNow"], "rankNote": None,
        "name": r["name"], "symbol": r["symbol"], "coingeckoId": cid,
        "snapshotPrice": r["snapshotPrice"], "snapshotMcapUsd": round(r["snapshotMcapUsd"]),
        "snapshotMcapRaw": r["snapshotMcapRaw"],
        "athPrice": r["athPrice"], "athDate": r["athDate"], "athFlag": r["athFlag"],
        "estLo": r["estLo"], "estHi": r["estHi"], "multLo": r["multLo"], "multHi": r["multHi"],
        "impliedMcapLoUsd": r["impliedMcapLoUsd"], "impliedMcapHiUsd": r["impliedMcapHiUsd"],
        "impliedMcapRaw": r["impliedMcapRaw"],
        "confidence": r["confidence"], "reason": reason,
        "dataDate": "2026-11-10"}

merged = [dict(c) for c in existing]
for r in selected:
    merged.append(record(r, id_map[r["symbol"]]))

# uniqueness guards
syms = [c["symbol"].upper() for c in merged]
ids = [c["coingeckoId"] for c in merged if c.get("coingeckoId")]
assert len(merged) == 200, len(merged)
assert len(set(syms)) == 200, "symbol not unique"
assert len(set(ids)) == len(ids) == 200, (len(ids), len(set(ids)))

def mid(c):
    return (c["multLo"] + c["multHi"]) / 2.0
merged.sort(key=lambda c: -mid(c))
for i, c in enumerate(merged, 1):
    c["estRank"] = i

sub_note = ""
if skipped:
    sub_note = ("第二轮正式名单中 " + "、".join(f"{c['symbol']}（{why}）" for c, why in skipped) +
                " 与已有条目重复，已跳过并按备选顺位替补 " +
                "、".join(c["symbol"] for c in selected if c["group"] == "backup") + "。")
else:
    sub_note = "第二轮正式 18 个经名称/代码/CoinGecko id 三重比对与现有 182 条零重复，备选 4 个未启用。"

meta = dict(old["meta"])
meta["generatedAt"] = "2026-11-10"
meta["source"] = old["meta"]["source"] + " + 第二轮补位研究《市值预估榜单第二轮补位研究》（2026-11-10，第 270 位起顺延，同为 CoinGecko 实盘核验 2026-11-10）"
meta["totalCoins"] = 200
meta["tableA"] = 200
meta["tableB"] = 0
meta["note"] = old["meta"]["note"] + (
    " 第二轮补位（2026-11-10）：自 CoinGecko 市值第 270 位继续顺延，跳过 7 个锚定类（ACRED、FRXUSD、SPCXX、USDON、GGBR、JPYC、MAG7.SSI），"
    "于第 271–293 位区间取 18 个普通币补入，全表凑满 200 个不重复可预估币种；" + sub_note +
    " 第二轮新币事实数据同为 2026-11-10 CoinGecko 实盘核验（dataDate=2026-11-10）。")

out = {"meta": meta, "coins": merged}
for path in (f"{ROOT}/data/coins.json", f"{ROOT}/public/data/coins.json"):
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"coins.json written: total={len(merged)} (existing 182 + new {len(selected)})")
print("new coins:", [(c["symbol"], id_map[c["symbol"]], c["group"]) for c in selected])
print("top5:", [(c["estRank"], c["symbol"], round(mid(c), 2)) for c in merged[:5]])
json.dump({"unresolved": unresolved, "skipped": [c["symbol"] for c, _ in skipped],
           "selected": [{"symbol": c["symbol"], "group": c["group"], "id": id_map[c["symbol"]]} for c in selected],
           "idMap": id_map}, open("/tmp/refill2_merge.json", "w"), ensure_ascii=False)
