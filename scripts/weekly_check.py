#!/usr/bin/env python3
"""weekly_check.py — 名单周检（W2-12 §1.3，C1–C7）。只读、只产报告。

退出码语义（F6-73 定版，F7-22/F7-23 第七期扩充）：
  0 = 本轮有效且无告警、无 incomplete、无高价值信号；
  1 = 本轮有效，但 alerts>0 或 incomplete 非空，或出现高价值信号——
      missing_rows（疑似下架）、cand_in/cand_out（进出候选）、due（override
      到期）、queue（人工队列，含多源偏离）、report_url_warn（外链 WARN）
      任一非空（F7-22：这些信号此前不影响退出码、易被按码分流者静默放过）；
  2 = 本轮作废（F6-09：关键拉取失败/为空，不覆写 watch、不推进 lastRunWeek；
      作废优先于一切 1 类信号，语义不变）；
  3 = 运行环境错误（F7-23 新增，与 1/2 区分）：state.json 损坏/不可读、
      报告或 state 落盘失败。此码下不保证报告产出、state 不推进。

红线：永不写 coins.json、永不触发部署。只写 ops/weekly/ 下的周报与 state.json。
用法：python3 scripts/weekly_check.py [--state <path>] [--out <path>] [--date YYYY-MM-DD]
CoinGecko key 只从环境变量 COINGECKO_API_KEY 读（缺失即 fail-closed 报错、禁止匿名回退，F6-86；匿名调试须显式 ALLOW_ANONYMOUS_CG=1 留痕），禁止写进仓库。

W4-09 修复（v1.1.0，口径不变：只交付脚本、人工手动运行，绝不自动跑）：
- markets 按 id 拉取缺行不再静默跳过：缺行恰是下架/迁移的表现，单列「疑似下架候选」
  （与按排名跌出的「移出候选」严格区分）；行情拉取本身失败时不做缺行判断，防整表误报。
- watch 连续周数按 ISO 自然周累加（同周重跑不重复计数、间隔超一周则连续性中断重起算），
  不再按运行次数累加；旧口径 state 首次被本版读到时清零重建（watchBasis 标记）。
- 基线 rankNow 已在前 250 之外（两轮补位选入时即如此）或无基线排名的币，不适用
  「跌出前 250」判据，不再整批产生结构性假「移出候选」。
- C6 多源比对的连接键由 CoinGecko id 改为 symbol（CoinCap 与 CoinGecko 的 id 空间不同，
  按 id 连接必然大面积映射不上、比对基数归零）；同 symbol 多资产时优先 name 匹配。
W4-25：报告增加一行 ATH 复核提醒（只提醒，不自动改任何 ATH 数据；计划见 ops/ath-review-plan.md）。
"""
import json, os, subprocess, sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from pipeline_config import AUDIT_BAND, DEVIATION_TOL, REPORT_URL  # noqa: E402
import check_meta  # noqa: E402  （W3-22：rows/对象双形态解码 decode_coins 单一来源）

VERSION = "1.1.0"
WATCH_BASIS = "iso-week-v2"  # watch 计数口径标记：ISO 自然周（W4-09 前为按跑次累加）
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
    if key:
        return {"x-cg-demo-api-key": key}
    # F6-86：key 缺失 fail-closed（与线上口径统一，禁止静默匿名回退连累共享出口限流）；
    # 确需匿名调试须显式设 ALLOW_ANONYMOUS_CG=1，stderr 留痕、报告标注「匿名」。
    # 本函数在各拉取点的 try 内调用，抛错即走 incomplete/本轮作废路径（退出码 2）。
    if os.environ.get("ALLOW_ANONYMOUS_CG") == "1":
        print("WARNING: COINGECKO_API_KEY 缺失，按显式开关 ALLOW_ANONYMOUS_CG=1 匿名调用 CoinGecko（限流与他人共享，勿用于正式周检）", file=sys.stderr)
        return {}
    raise RuntimeError("COINGECKO_API_KEY 缺失：拒绝匿名调用 CoinGecko（fail-closed，F6-86）；注入 key 后重试，或确需匿名调试时显式设 ALLOW_ANONYMOUS_CG=1")

def fetch_http_status(url, timeout=30):
    """只取 HTTP 状态码（跟随重定向，不下载 body），取不到返回 None。供 REPORT_URL 外链健康检查用（W4-26）。"""
    cmd = ["curl", "-sL", "-o", "/dev/null", "-w", "%{http_code}", "-m", str(timeout), url]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        return int(r.stdout.strip())
    except ValueError:
        return None

# ---------- 纯函数（无网络/无写盘，供 tests/weekly_check_test.py 离线单测） ----------

def week_monday(week_label):
    """ISO 周标签 '2026-W46' → 该周周一日期。"""
    y, w = week_label.split("-W")
    return date.fromisocalendar(int(y), int(w), 1)

def utc_today():
    """F8-26：默认运行日期取 UTC 口径（纯函数，供单测）。

    旧实现用 date.today()（运行机本地时区），与 quota/check-shadow 的 UTC
    月/周判定不一致：周边界（如 UTC 周日中午 = Auckland 周一凌晨）时同一
    时刻会得出相差一周的 week_label、state 的 ISO 周推进随之错位。
    显式 --date 传参路径不经此函数、不受影响。"""
    return datetime.now(timezone.utc).date()

def advance_watch(prev_entry, week_label, fallback_last_week=None):
    """按 ISO 自然周推进连续周数，返回 (weeks, lastWeek)。

    - 无历史条目 → (1, 本周)
    - 上次计数就在本周（同周重复运行）→ 周数不变，不按跑次累加
    - 上次计数恰在前一自然周 → +1（连续）
    - 间隔超过一周（漏跑/条件曾中断）→ 归 1，连续性重新起算
    旧条目无 lastWeek 字段时以 fallback_last_week（state.lastRunWeek）代之。
    """
    if not prev_entry:
        return 1, week_label
    prev_weeks = int(prev_entry.get("weeks", 0) or 0)
    last = prev_entry.get("lastWeek") or fallback_last_week
    if not last:
        return 1, week_label
    if last == week_label:
        return max(prev_weeks, 1), week_label
    try:
        gap = (week_monday(week_label) - week_monday(last)).days
    except (ValueError, IndexError):
        return 1, week_label
    if gap == 7:
        return prev_weeks + 1, week_label
    return 1, week_label

def watchout_eligible(coin):
    """C1 移出判据（跌出前 250）的适用性：仅基线时位于前 250 内的币适用。

    两轮补位选入的币中有一批基线 rankNow 已 >250（选入时即在 250 外），
    它们「不在前 250」是基线状态而非跌出信号；无基线排名（rankNow 为空）
    同理无从判定跌出。两者均不进 watchOut，避免结构性假候选。
    """
    r = coin.get("rankNow")
    return isinstance(r, int) and r <= 250

IDS_MIN_ROWS = 180  # F6-72：ids 行情完整性下限，低于此判 incomplete（疑似拉取异常）

def ids_rows_complete(n, minimum=IDS_MIN_ROWS):
    """ids 行情返回行数完整性判定（纯函数）：< minimum 判 incomplete，本节不产出下架候选。"""
    return n >= minimum

def find_missing_rows(coins, by_ids, ids_fetch_ok, live_ids=None):
    """markets 按 id 拉取成功却缺行的币 = 疑似下架/迁移候选（W4-09 修复点 1）。

    拉取本身失败（ids_fetch_ok=False）时一律不判定：by_ids 为空会让全表
    看起来都缺行。返回 [{symbol, id, inCoinList}]；inCoinList 表示该 id
    是否仍在 /coins/list 内（在 list 内但 markets 无行，多为无行情/待确认；
    两处皆缺则与 C3 告警相互印证）。
    """
    if not ids_fetch_ok:
        return []
    out = []
    for c in coins:
        cid = c["coingeckoId"]
        if cid not in by_ids:
            out.append({"symbol": c["symbol"], "id": cid,
                        "inCoinList": (cid in live_ids) if live_ids else None})
    return out

def c6_compare(coins, by_ids, cc_assets):
    """C6 多源偏离比对（纯函数）。连接键 = symbol（W4-09 修复点 4）。

    CoinCap 的资产 id 与 CoinGecko id 是两套命名空间（如 theta-token vs theta），
    旧代码按 coingeckoId 查 CoinCap id 表必然大面积落空、比对基数归零。
    板内 symbol 全表唯一，按 symbol 连接安全；CoinCap 侧同 symbol 多资产时
    优先取 name 与 CoinGecko markets name 归一化一致者，否则取首个（CoinCap
    按 rank 序返回，首个为该 symbol 下排名最高者）。
    返回 (checked, skipped, deviation_lines)。
    """
    def _nm(s): return (s or "").replace("​", "").strip().casefold()
    cc_by_symbol = {}
    for a in cc_assets:
        cc_by_symbol.setdefault((a.get("symbol") or "").upper(), []).append(a)
    checked, skipped, lines = 0, 0, []
    for c in coins:
        m = by_ids.get(c["coingeckoId"])
        cands = cc_by_symbol.get(c["symbol"].upper(), [])
        if not m or not m.get("current_price") or not cands:
            skipped += 1
            continue
        a = next((x for x in cands if _nm(x.get("name")) == _nm(m.get("name"))), cands[0])
        checked += 1
        try:
            cc_price = float(a["priceUsd"])
        except (TypeError, ValueError, KeyError):
            continue
        dev = abs(cc_price - m["current_price"]) / m["current_price"]
        if dev > DEVIATION_TOL:
            lines.append(f"多源偏离 {c['symbol']}: CoinGecko={m['current_price']} CoinCap={cc_price} 偏离 {dev:.0%}")
    return checked, skipped, lines

class StateError(Exception):
    """state.json 损坏/不可读（F7-23）：与「有效但有告警」(1)、「本轮作废」(2)
    区分，main 捕获后以退出码 3 收尾且不覆写 state。"""

def load_state(state_path, week_label):
    """读 state（纯 IO 封装，供单测）：文件不存在 → 默认初始 state；
    存在但 JSON 损坏/顶层非 dict → 抛 StateError（旧实现 json.load 未捕获、
    traceback exit 1 与「有效但有告警」撞码，F7-23）。"""
    if not state_path.exists():
        return {"version": 1, "baselineWeek": week_label, "watchOut": {}, "watchIn": {}, "driftMarked": []}
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise StateError(f"state 文件损坏/不可读：{state_path}：{e}")
    if not isinstance(state, dict):
        raise StateError(f"state 文件顶层非对象：{state_path}")
    return state

def atomic_write_text(path, text):
    """同目录 tmp + os.replace 原子写（F7-23）：中途崩溃不留截断文件。"""
    import tempfile
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".weekly-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise

def exit_code_for(run_void, alerts, missing_rows, cand_in, cand_out, due, queue, report_url_warn, incomplete):
    """退出码定版（F7-22，纯函数）：作废恒 2（优先）；高价值信号
    （alerts/missing_rows/cand_in/cand_out/due/queue/report_url_warn）
    或 incomplete 任一非空 → 1；全空 → 0。"""
    if run_void:
        return 2
    if alerts or missing_rows or cand_in or cand_out or due or queue or report_url_warn or incomplete:
        return 1
    return 0

def ath_flag_counts(coins):
    """ATH 三类标记计数（W4-25 提醒用；字段 athFlag: verified/approx/unverified）。"""
    counts = {"verified": 0, "approx": 0, "unverified": 0, "other": 0}
    for c in coins:
        f = c.get("athFlag")
        counts[f if f in counts else "other"] += 1
    return counts

def ath_reminder_line(coins, run_date, quarter_log_exists):
    """W4-25 ATH 复核提醒（单行；只提醒，绝不自动改 ATH 数据）。"""
    n = ath_flag_counts(coins)
    q = (run_date.month - 1) // 3 + 1
    log_state = "本季留痕已见" if quarter_log_exists else "本季留痕未见，请按计划抽查"
    return (f"ATH 复核提醒：verified {n['verified']} / approx† {n['approx']} / unverified {n['unverified']}"
            f"（另有未分类 {n['other']}）；{run_date.year}-Q{q} unverified 季度抽查：{log_state}"
            f"（节奏与留痕见 ops/ath-review-plan.md，留痕目录 ops/ath-review/；本提醒不自动修改任何 ATH 数据）")

def main():
    args = sys.argv[1:]
    def opt(name, default):
        return args[args.index(name) + 1] if name in args else default
    run_date = date.fromisoformat(opt("--date", utc_today().isoformat()))  # F8-26：默认 UTC 口径；--date 显式传参不变
    iso = run_date.isocalendar()
    week_label = f"{iso[0]}-W{iso[1]:02d}"
    state_path = Path(opt("--state", str(ROOT / "ops/weekly/state.json")))
    out_path = Path(opt("--out", str(ROOT / f"ops/weekly/{week_label}.md")))
    coins_doc = json.load(open(ROOT / "data/coins.json", encoding="utf-8"))
    coins = check_meta.decode_coins(coins_doc)
    overrides = json.load(open(opt("--overrides", str(ROOT / "scripts/overrides.json")), encoding="utf-8"))
    try:
        state = load_state(state_path, week_label)
    except StateError as e:
        # F7-23：state 损坏以可区分的退出码 3 收尾，不 traceback、不覆写 state。
        print(f"weekly_check: ERROR {e}（本轮未运行、state 未改动；请人工修复或移走损坏文件后重跑）", file=sys.stderr)
        return 3
    incomplete = []
    alerts, cand_in, cand_out, queue, due = [], [], [], [], []
    missing_rows = []       # 疑似下架候选（markets 缺行；与 cand_out 移出候选严格区分）
    baseline_out = []       # 基线即在前 250 外/无基线排名、不适用跌出判据的币（仅计数说明）
    migrated = False        # 本次运行是否执行了 W4-09 旧 state 清零重建

    # ---- CoinGecko: top250 基准集 + 全量 200 id 行情 + /coins/list ----
    top250, by_ids, live_ids = [], {}, set()
    top250_fetch_failed = False
    try:
        CALLS["cg_markets_top250"] += 1
        top250 = fetch_json("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false", cg_headers())
        if not isinstance(top250, list): raise RuntimeError("top250 非 list")
    except Exception as e:
        top250_fetch_failed = True
        incomplete.append(f"C1 基准集拉取失败: {e}")
    # F6-09：关键拉取失败或 top250 为空 → 本轮作废（不覆写 watch、不推进 lastRunWeek）
    run_void = top250_fetch_failed or not top250
    ids_fetch_ok = False
    ids_low_rows = False
    try:
        CALLS["cg_markets_ids"] += 1
        ids = ",".join(c["coingeckoId"] for c in coins)
        data = fetch_json(f"https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&sparkline=false&ids={ids}", cg_headers())
        if not isinstance(data, list): raise RuntimeError("ids markets 非 list")
        by_ids = {m["id"]: m for m in data}
        # F6-72：返回行数低于完整性下限 → 判 incomplete（大面积缺行、疑似拉取异常），不产出下架候选
        if ids_rows_complete(len(data)):
            ids_fetch_ok = True
        else:
            ids_low_rows = True
            incomplete.append(f"C4/C5 行情残缺: ids 返回 {len(data)} 行 < {IDS_MIN_ROWS}（大面积缺行，疑似拉取异常），本节不产出下架候选")
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

    # 疑似下架候选：markets 按 id 拉取成功却缺行（下架/迁移恰表现为缺行）。
    # 与 C1 移出候选（排名跌出前 250）严格区分，单独成列、不进 watchOut 计数。
    missing_rows = find_missing_rows(coins, by_ids, ids_fetch_ok, live_ids)
    missing_ids = {r["id"] for r in missing_rows}

    # W4-09 清零重建：旧 state 的 watch 计数按「跑次」累加且含结构性假候选，
    # 与新口径（ISO 自然周 + 基线适用性）不可比。首次读到旧口径 state 时
    # 一次性清零，由本次运行按新口径重建；之后以 watchBasis 标记为准，不再重复清零。
    if state.get("watchBasis") != WATCH_BASIS:
        migrated = True
        state["watchOut"], state["watchIn"] = {}, {}

    # C1 进出差集（连续 2 个自然周规则；计数按 ISO 周推进，见 advance_watch）
    prev_out, prev_in = state.get("watchOut", {}), state.get("watchIn", {})
    prev_run_week = state.get("lastRunWeek")
    new_out, new_in = {}, {}
    if top250:
        for c in coins:
            if c["coingeckoId"] in missing_ids:
                continue  # 已列入疑似下架候选，不再同时计移出观察
            if not watchout_eligible(c):
                if c["coingeckoId"] not in top250_ids:
                    baseline_out.append(c["symbol"])
                continue  # 基线即在前 250 外/无基线排名：不在 250 是基线状态，非跌出
            if c["coingeckoId"] not in top250_ids:
                w, lw = advance_watch(prev_out.get(c["symbol"]), week_label, prev_run_week)
                new_out[c["symbol"]] = {"weeks": w, "id": c["coingeckoId"], "lastWeek": lw}
                if w >= 2: cand_out.append((c["symbol"], None, w))
        board_syms = {c["symbol"] for c in coins}
        for m in top250:
            if m["id"] not in board_ids and (m.get("market_cap_rank") or 999) <= 200:
                w, lw = advance_watch(prev_in.get(m["symbol"].upper()), week_label, prev_run_week)
                new_in[m["symbol"].upper()] = {"weeks": w, "id": m["id"], "rank": m.get("market_cap_rank"), "lastWeek": lw}
                if w >= 2: cand_in.append((m["symbol"].upper(), m.get("market_cap_rank"), w))
    if run_void:
        # F6-09 本轮作废：保留旧 watch 不变（不以空/残缺结果覆写连续周计数）
        new_out, new_in = prev_out, prev_in
    else:
        state["watchOut"], state["watchIn"] = new_out, new_in
    state["watchBasis"] = WATCH_BASIS

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
        if not m: continue  # 缺行已在上方记为疑似下架候选，此处无行情可比对，跳过属预期
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
    # 连接键为 symbol（c6_compare 内）；旧版按 CoinGecko id 查 CoinCap id 表属键错位，基数恒近 0。
    c6_status, c6_checked, c6_skipped = "ok", 0, 0
    try:
        CALLS["coincap_assets"] += 1
        cc = fetch_json("https://api.coincap.io/v2/assets?limit=2000", timeout=60)
        c6_checked, c6_skipped, c6_lines = c6_compare(coins, by_ids, cc.get("data", []))
        queue.extend(c6_lines)
    except Exception as e:
        c6_status = f"跳过（接口不可用: {str(e)[:120]}）"
        c6_skipped = len(coins)

    # C7 override 到期
    for e in overrides.get("entries", []):
        if e.get("status") == "active" and e.get("reviewDue", "9999") < run_date.isoformat():
            due.append(e["symbol"])

    # REPORT_URL 外链健康（W4-26 / F4-40）：只读检查，不影响名单进出逻辑、不写任何生产数据。
    # REPORT_URL 唯一控制点在 pipeline_config.py；为空表示未配置回链，记跳过、不算 WARN。
    report_url_warn = 0
    if not REPORT_URL:
        report_url_line = "未配置（REPORT_URL 为空，跳过）"
    else:
        report_status = fetch_http_status(REPORT_URL)
        if report_status == 200:
            report_url_line = "OK（HTTP 200）"
        else:
            report_url_warn = 1
            report_url_line = f"WARN（HTTP {report_status if report_status is not None else '无响应/请求失败'}，非 200）"

    state["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if run_void:
        state["lastAttemptWeek"] = week_label  # F6-09：作废轮只记尝试周，不推进 lastRunWeek
    else:
        state["lastRunWeek"] = week_label
    # F7-23：写序定版——先把报告成功落盘，之后才写 state 推进计数；
    # 报告写失败则 state 不推进（旧实现先写 state 后写报告，报告失败即丢周
    # 且计数已推进）。两处落盘均经 atomic_write_text（tmp+os.replace）。

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lines = [
        f"# 名单周检 {week_label}（运行：{now} · 执行：weekly_check.py v{VERSION} · 数据：CoinGecko {'Demo key' if os.environ.get('COINGECKO_API_KEY') else '匿名'}）",
        *([ "", "## ⚠ 本轮作废", "关键拉取失败或 top250 为空：本轮结论无效，watch 连续周计数与 lastRunWeek 均未推进（仅记 lastAttemptWeek）。" ] if run_void else []),
        "",
        "## 结论",
        f"告警 {len(alerts)} 条 / 疑似下架 {len(missing_rows)} 个 / 候选移入 {len(cand_in)} 个 / 候选移出 {len(cand_out)} 个 / 人工队列 {len(queue)} 条 / override 到期 {len(due)} 条" + (f"；外链 WARN {report_url_warn} 条（REPORT_URL 非 200，见运行元信息）" if report_url_warn else "") + (f"；incomplete 缺项 {len(incomplete)}：{'；'.join(incomplete)}" if incomplete else ""),
        "",
        "## A. 告警",
        *([f"- {s}（id={i}，上周状态：{p}）：{a}" for s, i, p, a in alerts] or ["- 无"]),
        "",
        "## A2. 疑似下架候选（markets 缺行，与移出候选区分）",
        "说明：以下币在按 id 拉取的 markets 行情中无对应行（下架/迁移恰表现为缺行）。与 B 节「移出候选」（排名跌出前 250 满 2 个自然周）是不同信号，处置前须人工打开币页确认；行情拉取失败时本节不判定（见 incomplete）。",
        *([f"注记：本轮 ids 行情大面积缺行（返回行数 < {IDS_MIN_ROWS}，疑似拉取异常），本节不产出下架候选；与「个别缺行」（真实疑似下架信号）严格区分。"] if ids_low_rows else []),
        *([f"- {r['symbol']}（id={r['id']}）：markets 缺行" + (f"；/coins/list 内{'仍有' if r['inCoinList'] else '亦无'}此 id" if r["inCoinList"] is not None else "") + "，疑似下架/迁移，待人工确认" for r in missing_rows] or ["- 无"]),
        "",
        "## B. 进出候选",
        "| symbol | 现实时排名 | 连续周数 | 处置状态 |",
        "|---|---|---|---|",
        *[f"| {s} | {r} | {w} | 候选移入（仅占位，无预估） |" for s, r, w in cand_in],
        *[f"| {s} | 跌出前250 | {w} | 候选移出（待人工处置） |" for s, r, w in cand_out],
        *([] if (cand_in or cand_out) else ["| — | — | — | 本周无连续 2 周达标候选 |"]),
        f"观察中（未达 2 周）：watch-in {len(new_in)} 个、watch-out {len(new_out)} 个。",
        f"基线外不适用跌出判据：{len(baseline_out)} 个（基线 rankNow 已在前 250 外或无基线排名，其不在前 250 属基线状态、不计移出观察" + (f"：{'、'.join(sorted(baseline_out))}" if baseline_out else "") + "）。",
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
        f"C6 CoinCap 第二源：状态={c6_status}，已比对 {c6_checked} 币，跳过 {c6_skipped} 币（跳过不算失败；连接键=symbol）",
        ath_reminder_line(coins, run_date, (ROOT / "ops" / "ath-review" / f"{run_date.year}-Q{(run_date.month - 1) // 3 + 1}.md").exists()),
        f"REPORT_URL 外链健康：{report_url_line}（控制点 scripts/pipeline_config.py，非 200 记 WARN 并计入结论提示）",
        f"incomplete 缺项：{incomplete if incomplete else '无'}",
        f"state.json 变更摘要：watchOut {len(new_out)} 个、watchIn {len(new_in)} 个、driftMarked 累计 {len(state['driftMarked'])} 个、" + (f"本轮作废：lastRunWeek 未推进（保持 {prev_run_week}）、lastAttemptWeek={week_label}" if run_void else f"lastRunWeek={week_label}"),
        *([f"注记：本次运行执行 W4-09 清零重建——旧 state 的 watch 计数按跑次累加且含结构性假候选，与新口径不可比，已清零并按 ISO 自然周 + 基线适用性重新起算（watchBasis={WATCH_BASIS}）。"] if migrated else []),
        "注记：周号按 ISO 8601；watch 连续周数按自然周累加（同周重复运行不重复计数，间隔超一周重新起算）。",
    ]
    try:
        atomic_write_text(out_path, "\n".join(lines) + "\n")
    except OSError as e:
        # F7-23：报告落盘失败 → 退出 3 且 state 不推进，本周可重跑重建。
        print(f"weekly_check: ERROR 报告落盘失败：{e}（state 未推进，本周未计入连续周计数，可重跑）", file=sys.stderr)
        return 3
    try:
        atomic_write_text(state_path, json.dumps(state, ensure_ascii=False, indent=1))
    except OSError as e:
        print(f"weekly_check: ERROR state 落盘失败：{e}（报告已落盘 {out_path}，但 state 未推进，下轮将按旧 state 重算）", file=sys.stderr)
        return 3
    print(f"weekly_check {week_label}: alerts={len(alerts)} missing={len(missing_rows)} cand_in={len(cand_in)} cand_out={len(cand_out)} queue={len(queue)} due={len(due)} incomplete={len(incomplete)} report_url_warn={report_url_warn} void={run_void}")
    print(f"report -> {out_path}")
    # 退出码定版（见脚本头与 exit_code_for）：作废=2；高价值信号/incomplete=1；运行环境错误=3；其余=0。
    return exit_code_for(run_void, alerts, missing_rows, cand_in, cand_out, due, queue, report_url_warn, incomplete)

if __name__ == "__main__":
    sys.exit(main())
