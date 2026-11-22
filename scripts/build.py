#!/usr/bin/env python3
"""build.py — 可复现构建管线（W2-11）：研究报告 → data/coins.json（源）+ public/data/coins.json（产物）。

单一事实源：data/coins.json 为唯一可编辑源，public/ 为构建产物禁止手改。
六阶段：parse → resolve → merge → validate(G1–G10) → audit → emit。
用法：
  python3 scripts/build.py --reports <主报告.md> [--refill <补位.md>] [--refill2 <二轮.md>] [--offline] [--prior <旧coins.json>]
  python3 scripts/build.py --emit        # 只校验+拷贝（check_meta + data→public），不联网
退出码：0 成功；1 校验门禁失败；2 输入/环境错误。
路径全部相对仓库根；报告路径由参数或 meta.sourceReports 给出。
"""
import hashlib, json, re, subprocess, sys, time, unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from pipeline_config import AUDIT_BAND, EXPECTED_TOTAL, MULT_DRIFT_TOL  # noqa: E402
import check_meta  # noqa: E402
import render_snapshot  # noqa: E402  （W2-17：emit 后把榜单快照静态注入 public/index.html）

VERSION = "2.0.0"
BUILD_DIR = ROOT / "build"
REPORTS_DIR = ROOT / "ops/build-reports"
# 报告符号 → 现行表符号别名（BCG 为主报告原符号，现行表与 overrides 以 BC 登记，见 overrides.json）
SYMBOL_ALIASES = {"BCG": "BC"}

class GateFail(Exception):
    pass

def fail(gate, where, msg):
    raise GateFail(f"FAIL [{gate}] {where} {msg}")

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").lower()
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", s)

def fetch_json(url, headers=None, retries=2):
    """curl -fsS 带重试（429/5xx 最多 2 次，间隔 5/15s）；失败抛环境错误。"""
    cmd = ["curl", "-fsS", "-m", "60"]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    cmd.append(url)
    last = ""
    for attempt in range(retries + 1):
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            try:
                return json.loads(r.stdout)
            except Exception:
                raise EnvironmentError(f"上游返回非 JSON: {r.stdout[:200]}")
        last = (r.stderr or r.stdout)[:200]
        if attempt < retries:
            time.sleep(5 if attempt == 0 else 15)
    raise EnvironmentError(f"fetch failed after retries: {last}")

def cg_headers():
    import os, sys
    key = os.environ.get("COINGECKO_API_KEY", "")
    if key:
        return {"x-cg-demo-api-key": key}
    # F6-86：key 缺失 fail-closed（与线上口径统一，禁止静默匿名回退连累共享出口限流）；
    # 确需匿名调试须显式设 ALLOW_ANONYMOUS_CG=1，stderr 留痕、周检报告标注「匿名」。
    if os.environ.get("ALLOW_ANONYMOUS_CG") == "1":
        print("WARNING: COINGECKO_API_KEY 缺失，按显式开关 ALLOW_ANONYMOUS_CG=1 匿名调用 CoinGecko（限流与他人共享，勿用于正式构建/周检）", file=sys.stderr)
        return {}
    raise RuntimeError("COINGECKO_API_KEY 缺失：拒绝匿名调用 CoinGecko（fail-closed，F6-86）；注入 key 后重试，或确需匿名调试时显式设 ALLOW_ANONYMOUS_CG=1")

def data_hash(coins):
    return check_meta.data_hash(coins)

def clean_date(d):
    if not d: return None
    m = re.match(r"^(\d{4}-\d{2}(?:-\d{2})?)", d)
    return m.group(1) if m else d

def as_int(v):
    if v is None: return None
    return int(round(v))

# ================= parse =================
def parse_num(s):
    if s is None: return None
    s = s.replace(",", "").replace("~", "").replace("†", "").strip()
    if not s or s in ("—", "-", "未披露"): return None
    try: return float(s)
    except ValueError: return None

def parse_range(s):
    if s is None: return (None, None)
    parts = s.replace(",", "").split("–")
    if len(parts) != 2: return (None, None)
    try: return (float(parts[0].strip()), float(parts[1].strip()))
    except ValueError: return (None, None)

def parse_mcap_yi(s):
    raw = s.strip()
    if "未披露" in raw: return (raw, None, None)
    m = re.search(r"\$\s*([\d.,]+)\s*(?:–\s*([\d.,]+))?\s*亿", raw)
    if not m: return (raw, None, None)
    lo = float(m.group(1).replace(",", "")) * 1e8
    hi = float(m.group(2).replace(",", "")) * 1e8 if m.group(2) else lo
    return (raw, lo, hi)

def split_name_symbol(cell):
    parts = cell.strip().rsplit(" ", 1)
    if len(parts) == 2: return parts[0].strip(), parts[1].strip()
    return cell.strip(), ""

def parse_main(path):
    """主报告表 A/B；全程保留报告原文行号（1-based）。"""
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    a_start = next(i for i, l in enumerate(lines) if l.startswith("### 表 A"))
    b_start = next(i for i, l in enumerate(lines) if l.startswith("### 表 B"))
    fixture = json.load(open(ROOT / "scripts/fixtures/xtz_shfl_split.json", encoding="utf-8"))
    tableA, tableB = [], []
    for idx in range(a_start, b_start):
        l, lineno = lines[idx], idx + 1
        if not l.startswith("|") or "---" in l or "预估排名" in l: continue
        cells = [c.strip() for c in l.strip().strip("|").split("|")]
        if len(cells) != 11:
            fail("G2", f"{path}:{lineno}", f"表 A 列数 {len(cells)} != 11")
        rank_est_raw, name_sym, rank_now_raw, price_raw, mcap_raw, ath_raw, est_raw, mult_raw, impl_raw, conf, reason = cells
        if rank_est_raw == "157":
            for row in fixture["rows"]:
                tableA.append({**row, "_line": lineno, "_src": "fixture:xtz_shfl_split"})
            continue
        name, symbol = split_name_symbol(name_sym)
        m = re.match(r"^(\d+)", rank_now_raw)
        rank_now = int(m.group(1)) if m else None
        rank_note = None if rank_now_raw.isdigit() else rank_now_raw
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
        tableA.append({"estRank": int(rank_est_raw), "name": name, "symbol": symbol,
                       "rankNow": rank_now, "rankNote": rank_note, "snapshotPrice": parse_num(price_raw),
                       "mcapRaw": mcap_r, "mcapUsd": mcap_usd, "athPrice": ath_price, "athDate": ath_date,
                       "athFlag": ath_flag, "estLo": est_lo, "estHi": est_hi, "multLo": mult_lo, "multHi": mult_hi,
                       "implRaw": impl_r, "implLo": impl_lo, "implHi": impl_hi,
                       "confidence": conf, "reason": reason, "_line": lineno, "_src": "main"})
    b_end = next((i for i in range(b_start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    for idx in range(b_start, b_end):
        l, lineno = lines[idx], idx + 1
        if not l.startswith("|") or "---" in l or "币种" in l: continue
        cells = [c.strip() for c in l.strip().strip("|").split("|")]
        if len(cells) != 5:
            fail("G2", f"{path}:{lineno}", f"表 B 列数 {len(cells)} != 5")
        rank_raw, name_sym, price_raw, mcap_raw, reason = cells
        name, symbol = split_name_symbol(name_sym)
        mcap_r, mcap_usd, _ = parse_mcap_yi(mcap_raw)
        tableB.append({"rankNow": int(rank_raw) if rank_raw.isdigit() else None, "name": name, "symbol": symbol,
                       "snapshotPrice": parse_num(price_raw), "mcapRaw": mcap_r, "mcapUsd": mcap_usd,
                       "noEstimateReason": reason, "_line": lineno, "_src": "mainB"})
    return tableA, tableB

def parse_refill(path):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    start = next(i for i, l in enumerate(lines) if "43 行总表" in l)
    end = next(i for i, l in enumerate(lines) if l.startswith("### 三"))
    refill = []
    for idx in range(start, end):
        l, lineno = lines[idx], idx + 1
        if not l.startswith("|") or "---" in l: continue
        cells = [c.strip() for c in l.strip().strip("|").split("|")]
        if len(cells) != 9:
            fail("G2", f"{path}:{lineno}", f"补位表列数 {len(cells)} != 9")
        if not cells[0].isdigit(): continue  # 表头
        _, name_cell, fact_cell, ath_cell, est_cell, mult_cell, impl_cell, conf, reason = cells
        m = re.match(r"^(.+?)（(.+?)）#(\d+)$", name_cell)
        if not m: fail("G2", f"{path}:{lineno}", f"补位 name 解析失败: {name_cell}")
        name, symbol, rank_now = m.group(1), m.group(2), int(m.group(3))
        fm = re.match(r"^\$([\d.,]+)\s*/\s*\$([\d.,]+)M\s*/", fact_cell)
        if not fm: fail("G2", f"{path}:{lineno}", f"补位 fact 解析失败: {fact_cell}")
        price = float(fm.group(1).replace(",", ""))
        mcap_usd = float(fm.group(2).replace(",", "")) * 1e6
        mcap_raw = "$" + (f"{mcap_usd/1e8:.2f}".rstrip("0").rstrip(".")) + "亿"
        ath_flag = "approx" if (ath_cell.startswith("~") or "※" in ath_cell) else "verified"
        pm = re.search(r"\$\s*([\d.,]+)", ath_cell)
        ath_price = float(pm.group(1).replace(",", "")) if pm else None
        dm = re.search(r"(\d{4})-(\d{2})-(\d{2})", ath_cell) or re.search(r"(\d{4})-(\d{2})", ath_cell)
        if dm: ath_date = dm.group(0)
        else:
            ym = re.search(r"(\d{4})\s*年", ath_cell)
            ath_date = ym.group(1) if ym else None
        em = re.match(r"^\$([\d.,]+)–([\d.,]+)$", est_cell)
        if not em: fail("G2", f"{path}:{lineno}", f"补位 est 解析失败: {est_cell}")
        est_lo, est_hi = float(em.group(1).replace(",", "")), float(em.group(2).replace(",", ""))
        mm = re.match(r"^([\d.]+)–([\d.]+)×", mult_cell)
        if not mm: fail("G2", f"{path}:{lineno}", f"补位 mult 解析失败: {mult_cell}")
        mult_lo, mult_hi = float(mm.group(1)), float(mm.group(2))
        im = re.search(r"\$([\d.]+)–([\d.]+)\s*亿", impl_cell)
        if not im: fail("G2", f"{path}:{lineno}", f"补位 impl 解析失败: {impl_cell}")
        impl_lo, impl_hi = float(im.group(1)) * 1e8, float(im.group(2)) * 1e8
        impl_raw = "~$" + im.group(1) + "–" + im.group(2) + "亿"
        refill.append({"name": name, "symbol": symbol, "rankNow": rank_now, "snapshotPrice": price,
                       "snapshotMcapUsd": mcap_usd, "snapshotMcapRaw": mcap_raw, "athPrice": ath_price,
                       "athDate": ath_date, "athFlag": ath_flag, "estLo": est_lo, "estHi": est_hi,
                       "multLo": mult_lo, "multHi": mult_hi, "impliedMcapLoUsd": impl_lo,
                       "impliedMcapHiUsd": impl_hi, "impliedMcapRaw": impl_raw,
                       "confidence": conf.replace("*", ""), "reason": reason, "_line": lineno, "_src": "refill"})
    return refill

def _r2_num(s):
    return float(s.replace(",", "").replace("≈", "").strip())

def parse_refill2(path):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    def parse_facts(start_marker, end_marker):
        s = next(i for i, l in enumerate(lines) if start_marker in l)
        e = next(i for i, l in enumerate(lines) if end_marker in l)
        rows = []
        for idx in range(s, e):
            l, lineno = lines[idx], idx + 1
            if not l.startswith("|") or "---" in l: continue
            cells = [c.strip() for c in l.strip().strip("|").split("|")]
            if len(cells) != 7:
                fail("G2", f"{path}:{lineno}", f"二轮 facts 列数 {len(cells)} != 7")
            if not cells[2].isdigit(): continue  # 表头
            m = re.match(r"^(.+?)（(.+?)）$", cells[1])
            if not m: fail("G2", f"{path}:{lineno}", f"二轮 facts name 解析失败: {cells[1]}")
            name, symbol = m.group(1), m.group(2)
            price = _r2_num(re.search(r"\$([\d.,]+)", cells[3]).group(1))
            mcap_usd = _r2_num(re.search(r"\$([\d.,]+)", cells[4]).group(1))
            ath_cell = cells[6]
            ath_approx = ath_cell.startswith("≈") or "未核实" in ath_cell or "分歧" in ath_cell
            am = re.search(r"\$([\d.,]+)(?:\s*[-–]\s*\$?([\d.,]+))?", ath_cell)
            if not am: fail("G2", f"{path}:{lineno}", f"二轮 ATH 解析失败: {ath_cell}")
            ath_price = _r2_num(am.group(1))
            dm = re.search(r"（(\d{4})-(\d{2})(?:-(\d{2}))?", ath_cell)
            if dm and dm.group(3): ath_date = f"{dm.group(1)}-{dm.group(2)}-{dm.group(3)}"
            elif dm: ath_date = f"{dm.group(1)}-{dm.group(2)}"
            else:
                ym = re.search(r"(\d{4})\s*年", ath_cell)
                ath_date = ym.group(1) if ym else None
            rows.append({"name": name, "symbol": symbol, "rankNow": int(cells[2]), "snapshotPrice": price,
                         "snapshotMcapUsd": mcap_usd, "athPrice": ath_price, "athDate": ath_date,
                         "athFlag": "approx" if ath_approx else "verified", "_line": lineno, "_src": "refill2"})
        return rows
    formal = parse_facts("### 1.2 正式补入", "### 1.3 备选")
    backups = parse_facts("### 1.3 备选", "### 1.4")
    estart = next(i for i, l in enumerate(lines) if "### 2.2 总表" in l)
    eend = next(i for i, l in enumerate(lines) if l.startswith("### 2.3"))
    est = {}
    for idx in range(estart, eend):
        l, lineno = lines[idx], idx + 1
        if not l.startswith("|") or "---" in l: continue
        cells = [c.strip() for c in l.strip().strip("|").split("|")]
        if len(cells) != 10:
            fail("G2", f"{path}:{lineno}", f"二轮 est 列数 {len(cells)} != 10")
        if not re.match(r"^(?:备选\s*\d+|[\d]+)$", cells[0]): continue  # 表头
        nm = re.match(r"^(.+?)（(.+?)）(※)?$", cells[1])
        if not nm: fail("G2", f"{path}:{lineno}", f"二轮 est name 解析失败: {cells[1]}")
        name, symbol, star = nm.group(1), nm.group(2), bool(nm.group(3))
        em = re.match(r"^\$([\d.,]+)–([\d.,]+)", cells[3])
        mm = re.match(r"^([\d.]+)–([\d.]+)×", cells[4])
        if not em or not mm: fail("G2", f"{path}:{lineno}", f"二轮 est/mult 解析失败: {cells[3]} / {cells[4]}")
        est_lo, est_hi = _r2_num(em.group(1)), _r2_num(em.group(2))
        mult_lo, mult_hi = float(mm.group(1)), float(mm.group(2))
        sm = re.search(r"≈([\d.,]+)\s*(万|亿)", cells[5])
        supply29 = float(sm.group(1).replace(",", "")) * (1e4 if sm.group(2) == "万" else 1e8)
        im = re.search(r"\$([\d.]+)\s*亿", cells[6])
        impl_mid_report = float(im.group(1)) * 1e8
        est[symbol] = {"estLo": est_lo, "estHi": est_hi, "multLo": mult_lo, "multHi": mult_hi,
                       "supply29": supply29, "implMidReport": impl_mid_report,
                       "confidence": cells[8].replace("*", "").strip(), "reason": cells[9], "noCycle": star,
                       "_line": lineno}
    return formal, backups, est

# ================= resolve =================
class Resolver:
    def __init__(self, offline, prior_coins):
        self.offline = offline
        self.prior = {c["symbol"].upper(): c["coingeckoId"] for c in prior_coins if c.get("coingeckoId")}
        self.prior_by_name = {norm(c["name"]): c["coingeckoId"] for c in prior_coins if c.get("coingeckoId")}
        ov = json.load(open(ROOT / "scripts/overrides.json", encoding="utf-8"))
        self.overrides = {e["symbol"]: e["coingeckoId"] for e in ov["entries"] if e["status"] == "active"}
        self.methods = Counter()
        self.cglist, self.markets = [], {}
        self.by_symbol = {}
        if offline:
            cache = BUILD_DIR / "cg_list.json"
            if cache.exists():
                self.cglist = json.load(open(cache, encoding="utf-8"))
            for e in self.cglist:
                self.by_symbol.setdefault(e["symbol"].lower(), []).append(e)
            return
        BUILD_DIR.mkdir(exist_ok=True)
        cache = BUILD_DIR / "cg_list.json"
        if cache.exists() and time.time() - cache.stat().st_mtime < 24 * 3600:
            self.cglist = json.load(open(cache, encoding="utf-8"))
        else:
            self.cglist = fetch_json("https://api.coingecko.com/api/v3/coins/list", cg_headers())
            json.dump(self.cglist, open(cache, "w"))
        for e in self.cglist:
            self.by_symbol.setdefault(e["symbol"].lower(), []).append(e)
        for page in (1, 2, 3):
            data = fetch_json(f"https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page={page}&sparkline=false", cg_headers())
            if isinstance(data, list):
                for mk in data:
                    self.markets[mk["id"]] = mk
            time.sleep(1)
        json.dump(self.markets, open(BUILD_DIR / "cg_markets.json", "w"))

    def pick(self, coin):
        sym = coin["symbol"]
        cur = SYMBOL_ALIASES.get(sym, sym)
        if cur in self.overrides:
            self.methods["override"] += 1
            return self.overrides[cur]
        scored = []
        for e in self.by_symbol.get(sym.lower(), []):
            namesim = 1.0 if norm(e["name"]) == norm(coin["name"]) else (0.5 if norm(coin["name"]) in norm(e["name"]) or norm(e["name"]) in norm(coin["name"]) else 0.0)
            mk = self.markets.get(e["id"])
            lp = mk.get("current_price") if mk else None
            ratio = (lp / coin["snapshotPrice"]) if (lp and coin.get("snapshotPrice")) else None
            scored.append((namesim, ratio, e))
        scored.sort(key=lambda t: (-t[0], abs((t[1] if t[1] is not None else 99) - 1)))
        for namesim, ratio, e in scored:
            if self.offline:
                if namesim == 1.0:
                    self.methods["offline-name-exact"] += 1
                    return e["id"]
            elif e["id"] in self.markets and ratio is not None and AUDIT_BAND[0] <= ratio <= AUDIT_BAND[1]:
                self.methods["live-markets"] += 1
                return e["id"]
        if sym.upper() in self.prior:
            self.methods["prior-board"] += 1
            return self.prior[sym.upper()]
        if norm(coin["name"]) in self.prior_by_name:
            self.methods["prior-board-name"] += 1
            return self.prior_by_name[norm(coin["name"])]
        self.methods["unresolved"] += 1
        return None

# ================= merge =================
def record_main(c, cid):
    return {"table": "A", "estRank": c["estRank"], "rankNow": c["rankNow"], "rankNote": c["rankNote"],
            "name": c["name"], "symbol": c["symbol"], "coingeckoId": cid, "snapshotPrice": c["snapshotPrice"],
            "snapshotMcapUsd": as_int(c["mcapUsd"]), "snapshotMcapRaw": c["mcapRaw"], "athPrice": c["athPrice"],
            "athDate": clean_date(c["athDate"]), "athFlag": c["athFlag"], "estLo": c["estLo"], "estHi": c["estHi"],
            "multLo": c["multLo"], "multHi": c["multHi"], "impliedMcapLoUsd": as_int(c["implLo"]),
            "impliedMcapHiUsd": as_int(c["implHi"]), "impliedMcapRaw": c["implRaw"],
            "confidence": c["confidence"], "reason": c["reason"], "dataDate": "2026-11-08"}

def record_refill(r, cid):
    return {"table": "A", "estRank": None, "rankNow": r["rankNow"], "rankNote": None,
            "name": r["name"], "symbol": r["symbol"], "coingeckoId": cid, "snapshotPrice": r["snapshotPrice"],
            "snapshotMcapUsd": round(r["snapshotMcapUsd"]), "snapshotMcapRaw": r["snapshotMcapRaw"],
            "athPrice": r["athPrice"], "athDate": r["athDate"], "athFlag": r["athFlag"],
            "estLo": r["estLo"], "estHi": r["estHi"], "multLo": r["multLo"], "multHi": r["multHi"],
            "impliedMcapLoUsd": round(r["impliedMcapLoUsd"]), "impliedMcapHiUsd": round(r["impliedMcapHiUsd"]),
            "impliedMcapRaw": r["impliedMcapRaw"], "confidence": r["confidence"], "reason": r["reason"],
            "dataDate": "2026-11-10"}

def mid(c):
    return (c["multLo"] + c["multHi"]) / 2.0

def rerank(coins):
    coins.sort(key=lambda c: -mid(c))
    for i, c in enumerate(coins, 1):
        c["estRank"] = i

# ================= validate =================
FIELDS23 = ["table", "estRank", "rankNow", "rankNote", "name", "symbol", "coingeckoId", "snapshotPrice",
            "snapshotMcapUsd", "snapshotMcapRaw", "athPrice", "athDate", "athFlag", "estLo", "estHi",
            "multLo", "multHi", "impliedMcapLoUsd", "impliedMcapHiUsd", "impliedMcapRaw",
            "confidence", "reason", "dataDate"]

def validate(coins, overrides_entries):
    for c in coins:
        sym = c.get("symbol", "?")
        missing = [f for f in FIELDS23 if f not in c]
        if missing:
            fail("G3", sym, f"字段缺失 {missing}")
        if c["confidence"] not in ("高", "中", "低"):
            fail("G3", sym, f"confidence 非法 {c['confidence']}")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", c["dataDate"] or ""):
            fail("G3", sym, f"dataDate 非法 {c['dataDate']}")
        for lo, hi in (("estLo", "estHi"), ("multLo", "multHi")):
            if c[lo] is None or c[hi] is None or c[lo] > c[hi]:
                fail("G4", sym, f"{lo}>{hi} 或为空")
        # 隐含市值允许双 None（报告「未披露」，如 WFI）；单边 None 或倒置才拦
        ilo, ihi = c["impliedMcapLoUsd"], c["impliedMcapHiUsd"]
        if (ilo is None) != (ihi is None) or (ilo is not None and ilo > ihi):
            fail("G4", sym, "impliedMcapLoUsd/impliedMcapHiUsd 单边为空或倒置")
        if not c["snapshotPrice"] or c["snapshotPrice"] <= 0:
            fail("G4", sym, "snapshotPrice <= 0")
        if c["athFlag"] not in ("verified", "approx", "unverified"):
            fail("G6", sym, f"athFlag 非法 {c['athFlag']}")
        if c["athFlag"] == "verified" and c["athPrice"] is None:
            fail("G6", sym, "verified 但 athPrice 为空")
        if c["athFlag"] == "unverified" and c["athPrice"] is None and not c["reason"]:
            fail("G6", sym, "unverified 无 athPrice 且无 reason 注记")
    ids = [c["coingeckoId"] for c in coins]
    if any(not i for i in ids):
        fail("G5", "board", f"id 为空: {[c['symbol'] for c in coins if not c['coingeckoId']]}")
    if len(set(ids)) != len(ids):
        fail("G5", "board", "coingeckoId 重复")
    syms = [c["symbol"].upper() for c in coins]
    if len(set(syms)) != len(syms):
        fail("G5", "board", "symbol 重复（大小写不敏感）")
    warnings = []
    for e in overrides_entries:
        if e["status"] != "active":
            continue
        match = next((c for c in coins if c["symbol"] == e["symbol"]), None)
        if match and match["coingeckoId"] != e["coingeckoId"]:
            fail("G8", e["symbol"], f"override id {e['coingeckoId']} 与 coins 中 {match['coingeckoId']} 冲突")
        if not match:
            warnings.append(f"G8 override {e['symbol']} 指向不存在的 symbol（可能已退役，须人工确认转 retired）")
    return warnings

# ================= emit =================
def build_meta(coins, report_paths):
    counts = {"totalCoins": len(coins), "tableA": sum(1 for c in coins if c["table"] == "A"),
              "tableB": sum(1 for c in coins if c["table"] == "B"),
              "byAthFlag": dict(Counter(c["athFlag"] for c in coins)),
              "byDataDate": dict(Counter(c["dataDate"] for c in coins)),
              "withRankNote": sum(1 for c in coins if c.get("rankNote"))}
    titles = [("市值前 200 加密货币下一轮牛市高点预估排名", report_paths[0]),
              ("市值前 200 预估榜单补位研究", report_paths[1]),
              ("市值预估榜单第二轮补位研究", report_paths[2])]
    reports, warnings = [], []
    for title, p in titles:
        if p is None:
            continue
        pp = Path(p)
        try:
            rel = str(pp.resolve().relative_to(ROOT.parent))
        except Exception:
            rel = str(p)
        sha = hashlib.sha256(pp.read_bytes()).hexdigest() if pp.exists() else None
        if sha is None:
            warnings.append(f"report-missing: {rel}")
        reports.append({"title": title, "date": "2026-11-10", "path": rel, "sha256": sha})
    meta = {"schemaVersion": 2, "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "dataHash": data_hash(coins),
            "fields": FIELDS23,
            "estimateWindow": "2029 年 9 月下旬 ~ 10 月中旬（下一轮牛市高点推算窗口）",
            "sourceReports": reports,
            "generator": {"script": "scripts/build.py", "version": VERSION,
                          "python": f"{sys.version_info.major}.{sys.version_info.minor}"},
            "counts": counts,
            "note": "全表 200 个不重复可预估币、锚定类清零；数据日期双口径：老币 2026-11-08 快照、补位币 2026-11-10 核验（见各条 dataDate）。变更史见 CHANGELOG 与 CHANGELOG-补位*.md。",
            "source": " + ".join(f"《{r['title']}》（{r['date']}）" for r in reports),
            "totalCoins": counts["totalCoins"], "tableA": counts["tableA"], "tableB": counts["tableB"]}
    return meta, warnings

def emit(doc):
    """只编码+校验，不落盘（F6-69/F6-70）：返回 (sha256, text)。

    F6-70：编码前断言每币字段集恰等于 FIELDS23，多/少都 GateFail 并列出 symbol
    （旧实现以 c.get(f) 静默丢弃多余字段且不重算 dataHash，产物自洽性被破坏）。
    """
    BUILD_DIR.mkdir(exist_ok=True)
    # W3-22：落盘统一编码为 rows 紧凑形态（meta.fields 字段序 + 位置数组行）。
    # 入参 doc 内部恒为规范对象形态（{"meta","coins"}）；--emit 重读已落盘的
    # rows 文档时先经 check_meta.decode_coins 解码（口径 A：dataHash 不变）。
    coins = check_meta.decode_coins(doc)
    want = set(FIELDS23)
    bad = []
    for c in coins:
        keys = set(c.keys())
        if keys != want:
            bad.append(f"{c.get('symbol', '?')}(多:{sorted(keys - want)} 少:{sorted(want - keys)})")
    if bad:
        fail("G10", "emit", f"字段集 != FIELDS23：{bad}")
    meta = dict(doc.get("meta") or {})
    meta["fields"] = FIELDS23
    out = {"meta": meta, "rows": [[c.get(f) for f in FIELDS23] for c in coins]}
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest(), text


def emit_and_render(doc):
    """F6-69：全部产物（coins.json 两份 + DO_NOT_EDIT + index.html 快照）先渲染到
    临时位置，全部成功后才一并落盘；任一步失败抛 GateFail/SnapshotError，
    现行产物逐字节不变。F6-70：临时 coins 先过 check_meta、落盘后再对落盘
    文件复跑 check_meta，通过才返回哈希。"""
    import os, shutil, tempfile
    h, text = emit(doc)
    BUILD_DIR.mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="emit-", dir=str(BUILD_DIR)))
    try:
        tmp_coins = tmp / "coins.json"
        tmp_coins.write_text(text, encoding="utf-8")
        if check_meta.check_meta(str(tmp_coins)) != 0:
            fail("G10", "emit", "临时产物 check_meta 未通过，不落盘")
        tmp_html = tmp / "index.html"
        shutil.copyfile(ROOT / "public/index.html", tmp_html)
        render_snapshot.run(tmp_coins, tmp_html)  # 失败抛 SnapshotError，現行产物不动
        tmp_note = tmp / "DO_NOT_EDIT.md"
        tmp_note.write_text(
            "构建产物，勿手改。源在 `data/coins.json`，由 `scripts/build.py` 生成（`python3 scripts/build.py --emit` 只校验+拷贝）。\n", encoding="utf-8")
        # 全部成功 → 一并落盘（同盘 os.replace 原子替换）
        os.replace(tmp_coins, ROOT / "data/coins.json")
        (ROOT / "public/data/coins.json").write_text(text, encoding="utf-8")
        os.replace(tmp_note, ROOT / "public/data/DO_NOT_EDIT.md")
        os.replace(tmp_html, ROOT / "public/index.html")
    finally:
        import shutil as _sh
        _sh.rmtree(tmp, ignore_errors=True)
    h1 = hashlib.sha256((ROOT / "data/coins.json").read_bytes()).hexdigest()
    h2 = hashlib.sha256((ROOT / "public/data/coins.json").read_bytes()).hexdigest()
    if h1 != h2:
        fail("G10", "emit", "双目标哈希不一致")
    # F6-70：落盘后对落盘文件再跑一次 check_meta，通过才算成功
    if check_meta.check_meta(str(ROOT / "data/coins.json")) != 0:
        fail("G10", "emit", "落盘后 check_meta 未通过")
    return h1

def diff_vs_prior(prior, new):
    old = {c["symbol"]: c for c in prior}
    cur = {c["symbol"]: c for c in new}
    lines = []
    for s in sorted(set(cur) - set(old)):
        lines.append(f"新增 {s}")
    for s in sorted(set(old) - set(cur)):
        lines.append(f"删除 {s}")
    for s in sorted(set(old) & set(cur)):
        for k in FIELDS23:
            if old[s].get(k) != cur[s].get(k):
                lines.append(f"{s}: {k} {old[s].get(k)}→{cur[s].get(k)}")
    return lines

# ================= main =================
def main():
    args = sys.argv[1:]

    def opt(name, default=None):
        return args[args.index(name) + 1] if name in args else default

    if "--emit" in args or "--emit-only" in args:
        doc = json.load(open(ROOT / "data/coins.json", encoding="utf-8"))
        rc = check_meta.check_meta(str(ROOT / "data/coins.json"))
        if rc != 0:
            print("FAIL [emit] check_meta 未通过，不拷贝", file=sys.stderr)
            return 1
        # W4-10：--emit 路径补跑字段级 validate（G3–G8 门禁组），与全量构建同口径，
        # 防手改 typo 绕过字段校验直接拷贝上线（此前 --emit 只跑 check_meta）。
        try:
            ov = json.load(open(ROOT / "scripts/overrides.json", encoding="utf-8"))
            validate(check_meta.decode_coins(doc), ov["entries"])
        except GateFail as e:
            print(f"FAIL [emit] 字段级 validate 未通过，不拷贝：{e}", file=sys.stderr)
            return 1
        try:
            h = emit_and_render(doc)
        except GateFail as e:
            print(f"FAIL [emit] {e}", file=sys.stderr)
            return 1
        except render_snapshot.SnapshotError as e:
            print(f"FAIL [render-snapshot] {e}（现行产物未改动）", file=sys.stderr)
            return 1
        print(f"emit ok sha256={h} (+render-snapshot 静态注入)")
        return 0
    offline = "--offline" in args
    prior_path = Path(opt("--prior", str(ROOT / "data/coins.json")))
    prior_doc = json.load(open(prior_path, encoding="utf-8")) if prior_path.exists() else {"coins": [], "meta": {}}
    prior_coins = check_meta.decode_coins(prior_doc)
    meta_reports = [ROOT.parent / r["path"] for r in prior_doc.get("meta", {}).get("sourceReports", [])]
    main_p = opt("--reports", str(meta_reports[0]) if len(meta_reports) > 0 else None)
    refill_p = opt("--refill", str(meta_reports[1]) if len(meta_reports) > 1 else None)
    refill2_p = opt("--refill2", str(meta_reports[2]) if len(meta_reports) > 2 else None)
    for p in (main_p, refill_p, refill2_p):
        if not p or not Path(p).exists():
            print(f"FAIL [input] 报告缺失: {p}", file=sys.stderr)
            return 2
    gates, warnings = [], []
    file_hash = None
    merged = []
    try:
        tableA, tableB = parse_main(main_p)
        if len(tableA) != 158:
            fail("G1", f"{main_p}", f"表 A 解析 {len(tableA)} != 158（含 XTZ/SHFL 拆分）")
        if len(tableB) != 43:
            fail("G1", f"{main_p}", f"表 B 解析 {len(tableB)} != 43")
        gates.append("G1 主表行数 A=158 B=43 通过")
        refill = parse_refill(refill_p)
        if len(refill) != 43:
            fail("G1", f"{refill_p}", f"补位解析 {len(refill)} != 43")
        formal, backups, est2 = parse_refill2(refill2_p)
        if len(formal) != 18 or len(backups) != 4:
            fail("G1", f"{refill2_p}", f"二轮 facts formal={len(formal)} backups={len(backups)}")
        if len(est2) != 22:
            fail("G1", f"{refill2_p}", f"二轮 est {len(est2)} != 22")
        gates.append("G1 补位 43 / 二轮 18+4 / est 22 通过；G2 列数严格（解析期逐行校验，报错带报告行号）通过")
        BUILD_DIR.mkdir(exist_ok=True)
        json.dump({"tableA": tableA, "tableB": tableB}, open(BUILD_DIR / "coins_raw.json", "w"), ensure_ascii=False, indent=1)
        resolver = Resolver(offline, prior_coins)
        unresolved = []
        main_records = []
        for c in tableA:
            cid = resolver.pick(c)
            if not cid:
                unresolved.append(c["symbol"])
            main_records.append(record_main(c, cid))
        json.dump({"methods": dict(resolver.methods), "unresolved": unresolved}, open(BUILD_DIR / "id_pass1.json", "w"), ensure_ascii=False)
        old_by_symbol = {c["symbol"]: c for c in main_records}
        old_by_name = {norm(c["name"]): c for c in main_records}
        dups, news = [], []
        for r in refill:
            hit = old_by_symbol.get(r["symbol"]) or old_by_name.get(norm(r["name"]))
            (dups if hit else news).append((r, hit))
        merged = []
        dup_ids = {id(h) for _, h in dups}
        for c in main_records:
            if id(c) not in dup_ids:
                merged.append(c)
        for r, hit in dups:
            merged.append(record_refill(r, hit["coingeckoId"]))
        for r, _ in news:
            cid = resolver.pick(r)
            if not cid:
                unresolved.append(r["symbol"])
            merged.append(record_refill(r, cid))
        rerank(merged)
        gates.append(f"merge refill: 重复更新 {len(dups)}、新增 {len(news)}、合计 {len(merged)}")
        cands = []
        for group, rows in (("formal", formal), ("backup", backups)):
            for r in rows:
                e = est2[r["symbol"]]
                if abs(e["estLo"] / r["snapshotPrice"] - e["multLo"]) >= MULT_DRIFT_TOL:
                    fail("G4", r["symbol"], f"二轮倍数漂移超容差 {MULT_DRIFT_TOL}")
                impl_lo, impl_hi = e["estLo"] * e["supply29"], e["estHi"] * e["supply29"]
                impl_mid = (e["estLo"] + e["estHi"]) / 2 * e["supply29"]
                if e["implMidReport"] and abs(impl_mid - e["implMidReport"]) / e["implMidReport"] > 0.15:
                    warnings.append(f"二轮隐含市值中点漂移 {r['symbol']}: 推导 {impl_mid/1e8:.2f}亿 vs 报告 {e['implMidReport']/1e8:.2f}亿")

                def fmt_yi(v):
                    return f"{v/1e8:.1f}".rstrip("0").rstrip(".")

                cands.append({**r, **e, "group": group,
                              "snapshotMcapRaw": "$" + (f"{r['snapshotMcapUsd']/1e8:.2f}".rstrip("0").rstrip(".")) + "亿",
                              "impliedMcapLoUsd": round(impl_lo), "impliedMcapHiUsd": round(impl_hi),
                              "impliedMcapRaw": f"~${fmt_yi(impl_lo)}–{fmt_yi(impl_hi)}亿"})
        ex_by_symbol = {c["symbol"].upper(): c for c in merged}
        ex_by_name = {norm(c["name"]): c for c in merged}
        ex_ids = {c["coingeckoId"] for c in merged if c.get("coingeckoId")}
        selected, skipped = [], []
        for c in [x for x in cands if x["group"] == "formal"] + [x for x in cands if x["group"] == "backup"]:
            if len(selected) >= 18:
                break
            hit = ex_by_symbol.get(c["symbol"].upper()) or ex_by_name.get(norm(c["name"]))
            if hit:
                skipped.append(c["symbol"])
                continue
            selected.append(c)
        if len(selected) != 18:
            fail("G1", f"{refill2_p}", f"二轮去重后 selected {len(selected)} != 18")
        for r in selected:
            cid = resolver.pick(r)
            if not cid:
                unresolved.append(r["symbol"])
            elif cid in ex_ids:
                fail("G5", r["symbol"], f"二轮 id {cid} 与现行表重复")
            reason = r["reason"]
            if r["noCycle"] and "※" not in reason:
                reason = reason.rstrip("。") + "（※无完整历史周期数据）。"
            merged.append({"table": "A", "estRank": None, "rankNow": r["rankNow"], "rankNote": None,
                           "name": r["name"], "symbol": r["symbol"], "coingeckoId": cid,
                           "snapshotPrice": r["snapshotPrice"], "snapshotMcapUsd": round(r["snapshotMcapUsd"]),
                           "snapshotMcapRaw": r["snapshotMcapRaw"], "athPrice": r["athPrice"], "athDate": r["athDate"],
                           "athFlag": r["athFlag"], "estLo": r["estLo"], "estHi": r["estHi"], "multLo": r["multLo"],
                           "multHi": r["multHi"], "impliedMcapLoUsd": r["impliedMcapLoUsd"],
                           "impliedMcapHiUsd": r["impliedMcapHiUsd"], "impliedMcapRaw": r["impliedMcapRaw"],
                           "confidence": r["confidence"], "reason": reason, "dataDate": "2026-11-10"})
        rerank(merged)
        if unresolved:
            fail("G5", "resolve", f"未决 id 清单: {unresolved}（只许经 overrides.json 或修报告解决）")
        if len(merged) != EXPECTED_TOTAL:
            fail("G1", "merge", f"终表 {len(merged)} != EXPECTED_TOTAL {EXPECTED_TOTAL}")
        gates.append(f"G1 终表 == {EXPECTED_TOTAL} 通过；resolve 方式计数 {dict(resolver.methods)}")
        ov = json.load(open(ROOT / "scripts/overrides.json", encoding="utf-8"))
        warnings += validate(merged, ov["entries"])
        gates.append("G3/G4/G5/G6/G8 校验通过")
        if offline:
            warnings.append("【未做在线审计】--offline 构建：G7 跳过，本产物禁止带未审计状态走生产部署，须人工签核把关")
            gates.append("G7 跳过（--offline）")
        else:
            ids = [c["coingeckoId"] for c in merged]
            data = fetch_json("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&sparkline=false&ids=" + ",".join(ids), cg_headers())
            if not isinstance(data, list):
                fail("G7", "audit", "markets 返回非 list")
            live = {m["id"]: m for m in data}
            json.dump({"returned": len(live)}, open(BUILD_DIR / "id_audit.json", "w"))
            if len(live) < len(ids):
                missing = [f"{c['symbol']}({c['coingeckoId']})" for c in merged if c["coingeckoId"] not in live]
                fail("G7", "audit", f"markets 返回 {len(live)} < 请求 {len(ids)}；缺失: {missing}")
            audit_flagged = []
            for c in merged:
                m = live.get(c["coingeckoId"])
                if not m or not m.get("current_price"):
                    audit_flagged.append((c["symbol"], "no-live-price"))
                    continue
                r = m["current_price"] / c["snapshotPrice"]
                if not (AUDIT_BAND[0] <= r <= AUDIT_BAND[1]):
                    audit_flagged.append((c["symbol"], f"ratio={r:.2f}"))
            if audit_flagged:
                fail("G7", "audit", f"比值出带: {audit_flagged}")
            gates.append("G7 在线核价审计：返回数 == 请求数、出带 0")
        meta, mwarn = build_meta(merged, [main_p, refill_p, refill2_p])
        warnings += mwarn
        doc = {"meta": meta, "coins": merged}
        if meta["dataHash"] != data_hash(merged):
            fail("G9", "emit", "dataHash 自检不符")
        if meta["counts"]["totalCoins"] != len(merged):
            fail("G9", "emit", "counts 自检不符")
        gates.append("G9 meta 自洽通过")
        try:
            file_hash = emit_and_render(doc)
        except render_snapshot.SnapshotError as e:
            fail("G10", "render-snapshot", str(e))
        gates.append("G10 双目标哈希一致通过")
        gates.append("render-snapshot 静态注入 200 行通过（W2-17）")
    except GateFail as e:
        print(str(e), file=sys.stderr)
        return 1
    except EnvironmentError as e:
        print(f"FAIL [env] {e}", file=sys.stderr)
        return 2
    today = datetime.now(timezone.utc).date().isoformat()
    for e in json.load(open(ROOT / "scripts/overrides.json", encoding="utf-8"))["entries"]:
        if e["status"] == "active" and e["reviewDue"] < today:
            warnings.append(f"override 到期未复审: {e['symbol']} reviewDue={e['reviewDue']}")
    diff = diff_vs_prior(prior_coins, merged)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = [f"# 构建报告 {ts}（build.py v{VERSION}）", "",
              "输入报告 sha256：" + "；".join(f"{Path(p).name}={hashlib.sha256(Path(p).read_bytes()).hexdigest()[:12]}…" for p in (main_p, refill_p, refill2_p)),
              f"模式：{'offline（未做在线审计，见警告）' if offline else 'online'}",
              "", "## 门禁结果", *[f"- {g}" for g in gates],
              "", "## 增/删/改清单（与上一版按 symbol diff）",
              *([f"- {d}" for d in diff] or ["- 无差异"]),
              "", "## 警告", *([f"- {w}" for w in warnings] or ["- 无"]),
              "", f"dataHash：上一版 {prior_doc.get('meta', {}).get('dataHash')} → 本版 {data_hash(merged)}",
              f"双目标 sha256：{file_hash}",
              "", "## 签核（未签核禁止打 tag、禁止生产部署）",
              "签核人：________ 日期：________"]
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    rp = BUILD_DIR / f"build-report-{ts}.md"
    rp.write_text("\n".join(report) + "\n", encoding="utf-8")
    (REPORTS_DIR / rp.name).write_text("\n".join(report) + "\n", encoding="utf-8")
    print(f"build ok: coins={len(merged)} dataHash={data_hash(merged)} report={rp.name} diff_lines={len(diff)} warnings={len(warnings)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
