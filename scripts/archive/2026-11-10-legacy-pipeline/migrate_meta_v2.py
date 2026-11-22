#!/usr/bin/env python3
"""migrate_meta_v2.py — 一次性迁移：meta v1 → v2（W2-10 §1.4）。

硬约束：迁移前后 coins 数组 dataHash 必须相等，否则弃产物退出 1。
迁移完成后本脚本随旧脚本归档（W2-11 §5），勿再运行。
"""
import sys as _sys
print("[已退役] 本脚本为归档旧管线，禁止执行：误跑可能覆盖现行数据。如需参考逻辑请只读代码。", file=_sys.stderr)
_sys.exit(2)
import hashlib, json, sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WS = ROOT.parent
REPORTS = [
    {"title": "市值前 200 加密货币下一轮牛市高点预估排名", "date": "2026-11-10",
     "path": "research_notes/top-200-coins-next-bull-run-estimates-20261110-0737/report.md"},
    {"title": "市值前 200 预估榜单补位研究", "date": "2026-11-10",
     "path": "research_notes/top-200-refill-43-non-stablecoins-20261110-0856/report.md"},
    {"title": "市值预估榜单第二轮补位研究", "date": "2026-11-10",
     "path": "research_notes/top-200-refill-round2-to-200-20261110-0906/report.md"},
]

def data_hash(coins):
    payload = json.dumps(coins, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()

def main():
    src = ROOT / "data/coins.json"
    doc = json.load(open(src, encoding="utf-8"))
    coins, old_meta = doc["coins"], doc["meta"]
    before = data_hash(coins)
    reports = []
    for r in REPORTS:
        p = WS / r["path"]
        sha = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
        if sha is None: print(f"WARN report-missing: {r['path']}", file=sys.stderr)
        reports.append({**r, "sha256": sha})
    counts = {
        "totalCoins": len(coins),
        "tableA": sum(1 for c in coins if c.get("table") == "A"),
        "tableB": sum(1 for c in coins if c.get("table") == "B"),
        "byAthFlag": dict(Counter(c.get("athFlag") for c in coins)),
        "byDataDate": dict(Counter(c.get("dataDate") for c in coins)),
        "withRankNote": sum(1 for c in coins if c.get("rankNote")),
    }
    meta = {
        "schemaVersion": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataHash": before,
        "estimateWindow": old_meta.get("estimateWindow"),
        "sourceReports": reports,
        "generator": {"script": "scripts/build.py", "version": "2.0.0",
                      "python": f"{sys.version_info.major}.{sys.version_info.minor}"},
        "counts": counts,
        "note": "全表 200 个不重复可预估币、锚定类清零；数据日期双口径：老币 2026-11-08 快照、补位币 2026-11-10 核验（见各条 dataDate）。变更史见 CHANGELOG 与 CHANGELOG-补位*.md。",
        # 兼容字段（保留至 schemaVersion 3 或 2027-03-31 先到者）
        "source": " + ".join(f"《{r['title']}》（{r['date']}）" for r in reports),
        "totalCoins": counts["totalCoins"], "tableA": counts["tableA"], "tableB": counts["tableB"],
    }
    out = {"meta": meta, "coins": coins}
    assert data_hash(out["coins"]) == before, "coins dataHash 迁移前后不一致，弃产物"
    for path in (ROOT / "data/coins.json", ROOT / "public/data/coins.json"):
        json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"migrated: dataHash={before} counts={counts}")

if __name__ == "__main__":
    main()
