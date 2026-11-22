#!/usr/bin/env python3
"""Parse report.md tables A & B into coins_raw.json (no CoinGecko ids yet)."""
import sys as _sys
print("[已退役] 本脚本为归档旧管线，禁止执行：误跑可能覆盖现行数据。如需参考逻辑请只读代码。", file=_sys.stderr)
_sys.exit(2)
import json, re, sys

SRC = "/home/hatch/workspace/research_notes/top-200-coins-next-bull-run-estimates-20261110-0737/report.md"
OUT = "/tmp/coins_raw.json"

text = open(SRC, encoding="utf-8").read()
lines = text.splitlines()

def clean(s): return s.strip()

def parse_num(s):
    """Parse a plain number possibly containing commas / ~ / †; return float or None."""
    if s is None: return None
    s = s.replace(",", "").replace("~", "").replace("†", "").strip()
    if not s or s in ("—", "-", "未披露"): return None
    try: return float(s)
    except ValueError: return None

def parse_range(s):
    """'5.0–11.0' -> (5.0, 11.0); handles commas."""
    if s is None: return (None, None)
    parts = s.replace(",", "").split("–")
    if len(parts) != 2: return (None, None)
    try: return (float(parts[0].strip()), float(parts[1].strip()))
    except ValueError: return (None, None)

def parse_mcap_yi(s):
    """'$6.4亿' / '~$45–100亿' / '未披露' -> (raw, lo_usd, hi_usd) with 亿=1e8 USD."""
    raw = s.strip()
    if "未披露" in raw: return (raw, None, None)
    m = re.search(r"\$\s*([\d.,]+)\s*(?:–\s*([\d.,]+))?\s*亿", raw)
    if not m: return (raw, None, None)
    lo = float(m.group(1).replace(",", "")) * 1e8
    hi = float(m.group(2).replace(",", "")) * 1e8 if m.group(2) else lo
    return (raw, lo, hi)

def split_name_symbol(cell):
    """'Filecoin FIL' -> ('Filecoin','FIL'); 'POL (ex-MATIC) POL' -> ('POL (ex-MATIC)','POL')."""
    cell = clean(cell)
    parts = cell.rsplit(" ", 1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return cell, ""

# ---------- Table A ----------
a_start = next(i for i, l in enumerate(lines) if l.startswith("### 表 A"))
b_start = next(i for i, l in enumerate(lines) if l.startswith("### 表 B"))
tableA, tableB = [], []

for l in lines[a_start:b_start]:
    if not l.startswith("|") or "---" in l or "预估排名" in l:
        continue
    cells = [clean(c) for c in l.strip().strip("|").split("|")]
    if len(cells) != 11:
        print("A row skipped (cells=%d): %s" % (len(cells), l[:80]), file=sys.stderr); continue
    rank_est_raw, name_sym, rank_now_raw, price_raw, mcap_raw, ath_raw, est_raw, mult_raw, impl_raw, conf, reason = cells
    if rank_est_raw == "157":
        # combined XTZ / SHFL row — split manually per report text
        tableA.append({
            "estRank": 157, "name": "Tezos", "symbol": "XTZ", "nameRaw": "Tezos XTZ（157行拆分）",
            "rankNow": 120, "rankNote": None, "snapshotPrice": 0.248,
            "mcapRaw": "$2.74亿", "mcapUsd": 2.74e8,
            "athPrice": 9.57, "athDate": "2021-10", "athFlag": "approx",
            "estLo": 0.99, "estHi": 1.98, "multLo": 3.5, "multHi": 8.0,
            "implRaw": "~$10–19亿", "implLo": 1.0e9, "implHi": 1.9e9,
            "confidence": "低", "reason": "XTZ：老牌PoS公链，治理活跃但市值逐轮衰减（157行与SHFL合并行拆分）"})
        tableA.append({
            "estRank": 158, "name": "Shuffle", "symbol": "SHFL", "nameRaw": "Shuffle SHFL（157行拆分）",
            "rankNow": 152, "rankNote": None, "snapshotPrice": 0.3678,
            "mcapRaw": "$1.86亿", "mcapUsd": 1.86e8,
            "athPrice": None, "athDate": None, "athFlag": "unverified",
            "estLo": 1.29, "estHi": 2.94, "multLo": 3.5, "multHi": 8.0,
            "implRaw": "~$6.5–13亿", "implLo": 6.5e8, "implHi": 1.3e9,
            "confidence": "低", "reason": "SHFL：博彩平台新币，史短（157行与XTZ合并行拆分）"})
        continue
    name, symbol = split_name_symbol(name_sym)
    # current rank: '79' | '—（CMC口径55）' | '51（CMC口径44）'
    m = re.match(r"^(\d+)", rank_now_raw)
    rank_now = int(m.group(1)) if m else None
    rank_note = None if rank_now_raw.isdigit() else rank_now_raw
    # ATH: '236.84 / 2021-04-01' | '~2.61 / 2025-01' | '†' | '†（2025上市）'
    ath_flag = "verified"
    if ath_raw.startswith("~"): ath_flag = "approx"
    if "†" in ath_raw: ath_flag = "unverified"
    ath_price = ath_date = None
    if "/" in ath_raw:
        p, d = ath_raw.split("/", 1)
        ath_price = parse_num(p); ath_date = d.strip()
    est_lo, est_hi = parse_range(est_raw)
    mult_lo, mult_hi = parse_range(mult_raw.replace("×", ""))
    mcap_r, mcap_usd, _ = parse_mcap_yi(mcap_raw)
    impl_r, impl_lo, impl_hi = parse_mcap_yi(impl_raw)
    tableA.append({
        "estRank": int(rank_est_raw), "name": name, "symbol": symbol, "nameRaw": name_sym,
        "rankNow": rank_now, "rankNote": rank_note,
        "snapshotPrice": parse_num(price_raw),
        "mcapRaw": mcap_r, "mcapUsd": mcap_usd,
        "athPrice": ath_price, "athDate": ath_date, "athFlag": ath_flag,
        "estLo": est_lo, "estHi": est_hi, "multLo": mult_lo, "multHi": mult_hi,
        "implRaw": impl_r, "implLo": impl_lo, "implHi": impl_hi,
        "confidence": conf, "reason": reason})

# ---------- Table B ----------
for l in lines[b_start:]:
    if not l.startswith("|") or "---" in l or "币种" in l:
        continue
    cells = [clean(c) for c in l.strip().strip("|").split("|")]
    if len(cells) != 5:
        print("B row skipped (cells=%d): %s" % (len(cells), l[:80]), file=sys.stderr); continue
    rank_raw, name_sym, price_raw, mcap_raw, reason = cells
    name, symbol = split_name_symbol(name_sym)
    mcap_r, mcap_usd, _ = parse_mcap_yi(mcap_raw)
    tableB.append({
        "rankNow": int(rank_raw) if rank_raw.isdigit() else None,
        "name": name, "symbol": symbol, "nameRaw": name_sym,
        "snapshotPrice": parse_num(price_raw),
        "mcapRaw": mcap_r, "mcapUsd": mcap_usd,
        "noEstimateReason": reason})

out = {"tableA": tableA, "tableB": tableB}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"tableA={len(tableA)} tableB={len(tableB)} total={len(tableA)+len(tableB)}")
bad = [c["symbol"] for c in tableA if c["snapshotPrice"] is None or c["estLo"] is None]
print("A rows with missing price/est:", bad)
badb = [c["symbol"] for c in tableB if c["snapshotPrice"] is None]
print("B rows with missing price:", badb)
