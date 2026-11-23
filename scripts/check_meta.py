#!/usr/bin/env python3
"""check_meta.py — meta v2 复验（W2-10 R1–R4）+ overrides 校验（W2-12）。

用法：
  python3 scripts/check_meta.py data/coins.json [--reports-root <dir>]
  python3 scripts/check_meta.py --check-overrides [coins.json] [overrides.json]

纯标准库。任一 fail 退出码 1，全 pass 退出码 0。
"""
import hashlib, json, sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def data_hash(coins):
    payload = json.dumps(coins, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()

def decode_coins(doc):
    """W3-22 双形态解码：对象形态（doc["coins"]）直通；rows 紧凑形态按
    meta.fields 字段序 zip 成规范对象数组（字段序动态读取，FIELDS23 旧数据与 FIELDS24 新数据（含 paprikaId 列）同走此路，向后兼容）。dataHash 口径 A：哈希对象恒为
    解码后的规范对象数组，与线缆编码无关（形态切换前后 dataHash 不变）。"""
    if isinstance(doc, dict):
        coins = doc.get("coins")
        if isinstance(coins, list):
            return coins
        fields = (doc.get("meta") or {}).get("fields")
        rows = doc.get("rows")
        if isinstance(fields, list) and isinstance(rows, list):
            # F6-71：行长断言——len(row) != len(fields) 直接报错，不再 zip 静默截断。
            out = []
            for i, r in enumerate(rows):
                if len(r) != len(fields):
                    raise ValueError(
                        f"decode_coins: 第 {i} 行行长 {len(r)} != fields 数 {len(fields)}（行被截断/错位，拒绝静默解码）")
                out.append(dict(zip(fields, r)))
            return out
    return []

def check_meta(path, reports_root=None):
    fails, oks = [], []
    def ok(m): oks.append(m)
    def fail(m): fails.append(m)
    try:
        doc = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        print(f"FAIL [load] {path}: {e}"); return 1
    meta, coins = doc.get("meta", {}), decode_coins(doc)
    # schemaVersion
    if meta.get("schemaVersion") == 2: ok("schemaVersion == 2")
    else: fail(f"schemaVersion 应为 2，实际 {meta.get('schemaVersion')!r}")
    # R1 generatedAt：带时区的 ISO 8601，禁止仅日期字面量
    ga = meta.get("generatedAt", "")
    try:
        dt = datetime.fromisoformat(ga)
        if dt.tzinfo is None: fail(f"R1 generatedAt 无时区: {ga}")
        elif len(ga) <= 10: fail(f"R1 generatedAt 仅日期字面量: {ga}")
        else: ok(f"R1 generatedAt ISO8601 带时区: {ga}")
    except Exception:
        fail(f"R1 generatedAt 不可解析: {ga!r}")
    # R2 dataHash
    expect = data_hash(coins)
    if meta.get("dataHash") == expect: ok("R2 dataHash 与 coins 规范化哈希一致")
    else: fail(f"R2 dataHash 不符: meta={meta.get('dataHash')} 计算={expect}")
    # R3 counts 全部重算
    counts = {
        "totalCoins": len(coins),
        "tableA": sum(1 for c in coins if c.get("table") == "A"),
        "tableB": sum(1 for c in coins if c.get("table") == "B"),
        "byAthFlag": dict(Counter(c.get("athFlag") for c in coins)),
        "byDataDate": dict(Counter(c.get("dataDate") for c in coins)),
        "withRankNote": sum(1 for c in coins if c.get("rankNote")),
    }
    if meta.get("counts") == counts: ok("R3 counts 与数据重算一致")
    else: fail(f"R3 counts 不符: meta={meta.get('counts')} 计算={counts}")
    for k in ("totalCoins", "tableA", "tableB"):
        if meta.get(k) == counts[k]: ok(f"R3 平铺镜像 {k} 一致")
        else: fail(f"R3 平铺镜像 {k} 不符: {meta.get(k)} != {counts[k]}")
    # R4 sourceReports sha256：文件在场则现算比对；不在场仅警告（底稿不入库）
    base = Path(reports_root) if reports_root else ROOT.parent
    for r in meta.get("sourceReports", []):
        p = base / r.get("path", "")
        recorded = r.get("sha256")
        if not p.exists():
            print(f"WARN [R4] 报告不在场，跳过 sha256 复验: {r.get('path')}")
            continue
        actual = hashlib.sha256(p.read_bytes()).hexdigest()
        if recorded == actual: ok(f"R4 {r.get('path')} sha256 一致")
        else: fail(f"R4 {r.get('path')} sha256 不符: 记录={recorded} 现算={actual}")
    gen = meta.get("generator", {})
    if gen.get("script") and gen.get("version"): ok("generator 在位")
    else: fail("generator 缺失")
    for m in oks: print("PASS", m)
    for m in fails: print("FAIL", m)
    print(f"check_meta: {len(oks)} pass, {len(fails)} fail")
    return 1 if fails else 0

OVERRIDE_TYPES = {"dead-contract-successor", "symbol-mismatch", "id-suffix-collision", "manual-resolution"}

def check_overrides(coins_path=None, overrides_path=None):
    coins_path = Path(coins_path) if coins_path else ROOT / "data/coins.json"
    overrides_path = Path(overrides_path) if overrides_path else ROOT / "scripts/overrides.json"
    fails = []
    try:
        ov = json.load(open(overrides_path, encoding="utf-8"))
        doc = json.load(open(coins_path, encoding="utf-8"))
    except Exception as e:
        print(f"FAIL [load] {e}"); return 1
    live = {c["symbol"]: c["coingeckoId"] for c in decode_coins(doc)}
    n_active = n_retired = 0
    for e in ov.get("entries", []):
        sym = e.get("symbol")
        for f in ("symbol", "coingeckoId", "type", "reason", "evidenceUrl", "verifiedAt", "reviewDue", "status"):
            if not e.get(f): fails.append(f"{sym}: 字段缺失 {f}")
        if e.get("type") not in OVERRIDE_TYPES: fails.append(f"{sym}: type 枚举非法 {e.get('type')}")
        if e.get("status") not in ("active", "retired"): fails.append(f"{sym}: status 非法 {e.get('status')}")
        try:
            gap = (datetime.fromisoformat(e["reviewDue"]) - datetime.fromisoformat(e["verifiedAt"])).days
            if not (0 < gap <= 90): fails.append(f"{sym}: reviewDue-verifiedAt={gap} 天，应在 (0,90]")
        except Exception:
            fails.append(f"{sym}: 日期不可解析")
        if e.get("status") == "active":
            n_active += 1
            if live.get(sym) != e.get("coingeckoId"):
                fails.append(f"{sym}: active 条目 id 与 coins.json 不符: overrides={e.get('coingeckoId')} coins={live.get(sym)}")
        elif e.get("status") == "retired":
            n_retired += 1
    print(f"check_overrides: active={n_active} retired={n_retired}")
    for m in fails: print("FAIL", m)
    print(f"check_overrides: {len(fails)} fail")
    return 1 if fails else 0

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--check-overrides" in sys.argv:
        sys.exit(check_overrides(*(args[:2] if args else [None, None])))
    rr = None
    if "--reports-root" in sys.argv:
        rr = sys.argv[sys.argv.index("--reports-root") + 1]
    sys.exit(check_meta(args[0] if args else str(ROOT / "data/coins.json"), rr))
