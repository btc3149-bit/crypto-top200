#!/usr/bin/env python3
"""weekly_check.py — 名单周检（W2-12 §1.3，C1–C7）。只读、只产报告。

红线：永不写 coins.json、永不触发部署。只写 ops/weekly/ 下的周报与 state.json。
用法：python3 scripts/weekly_check.py [--state <path>] [--out <path>] [--date YYYY-MM-DD]
CoinGecko key 只从环境变量 COINGECKO_API_KEY 读（可为空=匿名），禁止写进仓库。
"""
import json, os, subprocess, sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from pipeline_config import AUDIT_BAND, DEVIATION_TOL  # noqa: E402

VERSION = "1.0.0"
CALLS = {"cg_markets_top250": 0, "cg_markets_ids": 0, "cg_list": 0, "coincap_assets": 0}

def fetch_json(url, headers=None, timeout=90):
    cmd = ["curl", "-fsS", "-m", str(timeout)]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"curl failed rc={r.returncode}: {r.stderr.strip()[:200]}")
    return json.loads(r.stdout)

def cg_headers():
    key = os.environ.get("COINGECKO_API_KEY", "")
    return {"x-cg-demo-api-key": key} if key else {}

def main():
    args = sys.argv[1:]
    def opt(name, default):
        return args[args.index(name) + 1] if name in args else default
    run_date = date.fromisoformat(opt("--date", date.today().isoformat()))
    iso = run_date.isocalendar()
    week_label = f"{iso[0]}-W{iso[1]:02d}"
    state_path = Path(opt("--state", str(ROOT / "ops/weekly/state.json")))
    out_path = Path(opt("--out", str(ROOT / f"ops/weekly/{week_label}.md")))
    coins_doc = json.load(open(ROOT / "data/coins.json", encoding="utf-8"))
    coins = coins_doc["coins"]
    overrides = json.load(open(opt("--overrides", str(ROOT / "scripts/overrides.json")), encoding="utf-8"))
    state = json.load(open(state_path, encoding="utf-8")) if state_path.exists() else {
        "version": 1, "baselineWeek": week_label, "watchOut": {}, "watchIn": {}, "driftMarked": []}
    incomplete = []
    alerts, cand_in, cand_out, queue, due = [], [], [], [], []

    # ---- CoinGecko: top250 基准集 + 全量 200 id 行情 + /coins/list ----
    top250, by_ids, live_ids = [], {}, set()
    try:
        CALLS["cg_markets_top250"] += 1
        top250 = fetch_json("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false", cg_headers())
        if not isinstance(top250, list): raise RuntimeError("top250 非 list")
    except Exception as e:
        incomplete.append(f"C1 基准集拉取失败: {e}")
    try:
        CALLS["cg_markets_ids"] += 1
        ids = ",".join(c["coingeckoId"] for c in coins)
        data = fetch_json(f"https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&sparkline=false&ids={ids}", cg_headers())
        if not isinstance(data, list): raise RuntimeError("ids markets 非 list")
        by_ids = {m["id"]: m for m in data}
    except Exception as e:
        incomplete.append(f"C4/C5 行情拉取失败: {e}")
    try:
        CALLS["cg_list"] += 1
        lst = fetch_json("https://api.coingecko.com/api/v3/coins/list", cg_headers(), timeout=120)
        live_ids = {e["id"] for e in lst}
    except Exception as e:
        incomplete.append(f"C3 /coins/list 拉取失败: {e}")

    board_ids = {c["coingeckoId"] for c in coins}
    top250_ids = {m["id"] for m in top250}
    rank_of = {m["id"]: m.get("market_cap_rank") for m in top250}

    # C1 进出差集（连续 2 周规则）
    prev_out, prev_in = state.get("watchOut", {}), state.get("watchIn", {})
    new_out, new_in = {}, {}
    if top250:
        for c in coins:
            if c["coingeckoId"] not in top250_ids:
                w = prev_out.get(c["symbol"], {}).get("weeks", 0) + 1
                new_out[c["symbol"]] = {"weeks": w, "id": c["coingeckoId"]}
                if w >= 2: cand_out.append((c["symbol"], None, w))
        board_syms = {c["symbol"] for c in coins}
        for m in top250:
            if m["id"] not in board_ids and (m.get("market_cap_rank") or 999) <= 200:
                w = prev_in.get(m["symbol"].upper(), {}).get("weeks", 0) + 1
                new_in[m["symbol"].upper()] = {"weeks": w, "id": m["id"], "rank": m.get("market_cap_rank")}
                if w >= 2: cand_in.append((m["symbol"].upper(), m.get("market_cap_rank"), w))
    state["watchOut"], state["watchIn"] = new_out, new_in

    # C3 id 存活（最高优先级告警；list 缺项时不误报，见 incomplete）
    if live_ids:
        for c in coins:
            if c["coingeckoId"] not in live_ids:
                alerts.append((c["symbol"], c["coingeckoId"], "在名单内", "疑似下架/迁移：人工打开币页确认后再处置（须复跑或人工确认才升级）"))

    # C2 排名漂移新越线 / C4 symbol·name 变更 / C5 比值出带
    drift_marked = set(state.get("driftMarked", []))
    new_drift = []
    for c in coins:
        m = by_ids.get(c["coingeckoId"])
        if not m: continue
        if m.get("market_cap_rank") and c.get("rankNow"):
            diff = abs(m["market_cap_rank"] - c["rankNow"])
            if diff > 50:
                if c["symbol"] not in drift_marked:
                    queue.append(f"排名漂移新越线 {c['symbol']}: rankNow={c['rankNow']} → 实时={m['market_cap_rank']}（差 {diff}）")
                    new_drift.append(c["symbol"])
        def _nm(s): return (s or "").replace("​", "").strip().casefold()
        if m.get("symbol", "").upper() != c["symbol"].upper() or _nm(m.get("name")) != _nm(c["name"]):
            queue.append(f"symbol/name 变更 {c['symbol']}: 存档=({c['symbol']},{c['name']}) 实时=({m.get('symbol')},{m.get('name')}) id={c['coingeckoId']}")
        lp, sp = m.get("current_price"), c.get("snapshotPrice")
        if lp and sp:
            r = lp / sp
            if not (AUDIT_BAND[0] <= r <= AUDIT_BAND[1]):
                queue.append(f"比值出带 {c['symbol']}: live/snapshot={r:.2f}（带 {AUDIT_BAND}）live={lp} snapshot={sp}")
    state["driftMarked"] = sorted(drift_marked | set(new_drift))

    # C6 多源偏离（CoinCap；不可用/映射不上 → 跳过并计数，不算失败）
    c6_status, c6_checked, c6_skipped = "ok", 0, 0
    try:
        CALLS["coincap_assets"] += 1
        cc = fetch_json("https://api.coincap.io/v2/assets?limit=2000", timeout=60)
        cc_by = {a["id"]: a for a in cc.get("data", [])}
        for c in coins:
            a = cc_by.get(c["coingeckoId"])
            m = by_ids.get(c["coingeckoId"])
            if not a or not m or not m.get("current_price"):
                c6_skipped += 1; continue
            c6_checked += 1
            cc_price = float(a["priceUsd"])
            dev = abs(cc_price - m["current_price"]) / m["current_price"]
            if dev > DEVIATION_TOL:
                queue.append(f"多源偏离 {c['symbol']}: CoinGecko={m['current_price']} CoinCap={cc_price} 偏离 {dev:.0%}")
    except Exception as e:
        c6_status = f"跳过（接口不可用: {str(e)[:120]}）"
        c6_skipped = len(coins)

    # C7 override 到期
    for e in overrides.get("entries", []):
        if e.get("status") == "active" and e.get("reviewDue", "9999") < run_date.isoformat():
            due.append(e["symbol"])

    state["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    state["lastRunWeek"] = week_label
    state_path.parent.mkdir(parents=True, exist_ok=True)
    json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lines = [
        f"# 名单周检 {week_label}（运行：{now} · 执行：weekly_check.py v{VERSION} · 数据：CoinGecko {'Demo key' if os.environ.get('COINGECKO_API_KEY') else '匿名'}）",
        "",
        "## 结论",
        f"告警 {len(alerts)} 条 / 候选移入 {len(cand_in)} 个 / 候选移出 {len(cand_out)} 个 / 人工队列 {len(queue)} 条 / override 到期 {len(due)} 条" + (f"；incomplete 缺项 {len(incomplete)}：{'；'.join(incomplete)}" if incomplete else ""),
        "",
        "## A. 告警",
        *([f"- {s}（id={i}，上周状态：{p}）：{a}" for s, i, p, a in alerts] or ["- 无"]),
        "",
        "## B. 进出候选",
        "| symbol | 现实时排名 | 连续周数 | 处置状态 |",
        "|---|---|---|---|",
        *[f"| {s} | {r} | {w} | 候选移入（仅占位，无预估） |" for s, r, w in cand_in],
        *[f"| {s} | 跌出前250 | {w} | 候选移出（待人工处置） |" for s, r, w in cand_out],
        *([] if (cand_in or cand_out) else ["| — | — | — | 本周无连续 2 周达标候选 |"]),
        f"观察中（未达 2 周）：watch-in {len(new_in)} 个、watch-out {len(new_out)} 个。",
        "",
        "## C. 人工队列",
        *([f"- {q}" for q in queue] or ["- 无"]),
        "",
        "## D. Override",
        f"到期清单：{('、'.join(due) if due else '无')}（active 共 {sum(1 for e in overrides['entries'] if e['status']=='active')} 条，reviewDue 一律 2027-02-08）",
        "本周已复审登记：无（首跑基准周）",
        "",
        "## E. 运行元信息",
        f"端点调用次数：{json.dumps(CALLS, ensure_ascii=False)}",
        f"C6 CoinCap 第二源：状态={c6_status}，已比对 {c6_checked} 币，跳过 {c6_skipped} 币（跳过不算失败）",
        f"incomplete 缺项：{incomplete if incomplete else '无'}",
        f"state.json 变更摘要：watchOut {len(new_out)} 个、watchIn {len(new_in)} 个、driftMarked 累计 {len(state['driftMarked'])} 个、lastRunWeek={week_label}",
        "注记：本周为首跑基准周（state 以 2026-11-10 名单为第 0 周基准），进出连续计数从 1 起算属预期；周号按 ISO 8601（2026-11-10 属 ISO 第 46 周）。",
    ]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"weekly_check {week_label}: alerts={len(alerts)} cand_in={len(cand_in)} cand_out={len(cand_out)} queue={len(queue)} due={len(due)} incomplete={len(incomplete)}")
    print(f"report -> {out_path}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
