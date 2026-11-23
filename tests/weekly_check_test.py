#!/usr/bin/env python3
"""weekly_check_test.py — W4-09/W4-25 离线单测（文件名带 weekly 前缀）。

只用本地 data/coins.json 与人工构造的模拟输入，不发任何网络请求、
不消耗 CoinGecko 额度、不写生产 state（state.json 只读引用其现有 watchOut 名单）。
运行：python3 tests/weekly_check_test.py   （全过退出 0，任一断言失败退出非零）

验收对应：
  ① 人为构造 markets 缺行（模拟退市）→ 被检出为「疑似下架候选」，且不进移出观察；
     行情拉取失败时不判定缺行（防整表误报）。
  ② 补位币（基线 rankNow>250）不产生假移出候选：以基线自洽的 top250 模拟输入跑
     C1 移出资格判定，结果为零候选；基线内币真实跌出时仍能被检出。
  ③ C6 基数 200：按 symbol 连接 CoinCap（资产 id 故意写成与 CoinGecko id 完全不同
     的命名空间）时 200/200 全比对；单币价格异动能报出偏离。
  附：ISO 自然周计数（同周重跑不累加 / 相邻周 +1 / 隔周重置 / 跨年相邻周）；
      ATH 三类计数与提醒行（W4-25）。
"""
import json, sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import weekly_check as wc  # noqa: E402
import check_meta  # noqa: E402  （W3-22：rows/对象双形态解码）

COINS = check_meta.decode_coins(json.load(open(ROOT / "data/coins.json", encoding="utf-8")))
BY_SYM = {c["symbol"]: c for c in COINS}
PASS = []

def ok(name):
    PASS.append(name)
    print(f"PASS {name}")

# ---------- ① markets 缺行 → 疑似下架 ----------
synth = [
    {"symbol": "AAA", "coingeckoId": "aaa", "rankNow": 10},
    {"symbol": "BBB", "coingeckoId": "bbb", "rankNow": 20},   # 模拟退市：markets 缺行
    {"symbol": "CCC", "coingeckoId": "ccc", "rankNow": 30},
]
by_ids = {"aaa": {"id": "aaa"}, "ccc": {"id": "ccc"}}          # bbb 缺行
miss = wc.find_missing_rows(synth, by_ids, ids_fetch_ok=True, live_ids={"aaa", "ccc"})
assert [r["symbol"] for r in miss] == ["BBB"], miss
assert miss[0]["inCoinList"] is False                          # /coins/list 亦无 → 相互印证
ok("①a 缺行币被检出为疑似下架（且 list 亦缺）")

miss2 = wc.find_missing_rows(synth, by_ids, ids_fetch_ok=True, live_ids={"aaa", "bbb", "ccc"})
assert miss2[0]["inCoinList"] is True                          # list 仍有 → 标注待确认
ok("①b 缺行但 list 仍有此 id 时标注 inCoinList=True（待人工确认）")

assert wc.find_missing_rows(synth, {}, ids_fetch_ok=False, live_ids=set()) == []
ok("①c 行情拉取失败时不判定缺行（防整表误报）")

# 缺行币不得同时进入移出观察：复刻 main() 中 C1 的资格组合
# （watchout_eligible ∧ 不在 top250 ∧ 不在 missing_ids）。
missing_ids = {r["id"] for r in miss}
top250_ids = {"aaa", "ccc"}                                    # bbb 也不在 top250
qual = [c["symbol"] for c in synth
        if wc.watchout_eligible(c) and c["coingeckoId"] not in top250_ids
        and c["coingeckoId"] not in missing_ids]
assert "BBB" not in qual, qual
ok("①d 缺行币只走疑似下架通道，不双计为移出观察")

# ---------- ② 补位币不产生假移出候选 ----------
state = json.load(open(ROOT / "ops/weekly/state.json", encoding="utf-8"))
old_watchout = set(state["watchOut"].keys())
assert len(old_watchout) == 32, len(old_watchout)
refill_outside = [c for c in COINS if isinstance(c.get("rankNow"), int) and c["rankNow"] > 250]
assert len(refill_outside) == 29, len(refill_outside)          # 两轮补位中基线即在 250 外者
assert all(c["dataDate"] == "2026-11-10" for c in refill_outside)
assert all(not wc.watchout_eligible(c) for c in refill_outside)
ok("②a 基线 rankNow>250 的 29 个补位币全部不适用跌出判据")

assert wc.watchout_eligible(BY_SYM["1INCH"]) is True           # rankNow=250，基线内（边界）
assert BY_SYM["DBR"]["rankNow"] == 293 and not wc.watchout_eligible(BY_SYM["DBR"])
null_rank = [c for c in COINS if not c.get("rankNow")]
assert len(null_rank) == 6 and all(not wc.watchout_eligible(c) for c in null_rank)
ok("②b 边界 rankNow=250 仍适用；无基线排名的 6 币不适用")

# 以基线自洽的 live top250（= 基线 rankNow≤250 的币集）模拟「无任何真实跌出」的运行：
base_top250 = {c["coingeckoId"] for c in COINS if isinstance(c.get("rankNow"), int) and c["rankNow"] <= 250}
qual_all = [c["symbol"] for c in COINS
            if wc.watchout_eligible(c) and c["coingeckoId"] not in base_top250]
assert qual_all == [], qual_all
ok("②c 基线自洽输入下移出观察为零（旧逻辑此处会整批产生假候选）")

# 旧 state 的 32 个中，凡基线在 250 外者新口径下一律不再入选：
still = [s for s in old_watchout
         if wc.watchout_eligible(BY_SYM[s]) and BY_SYM[s]["coingeckoId"] not in base_top250]
assert still == [], still
ok("②d 旧 watchOut 32 个在基线自洽输入下全部清零（清零重建成立）")

# 真实跌出仍可检出：把基线内币 FIL（rankNow=79）从 top250 拿掉 → 应入选：
genuine_top250 = base_top250 - {"filecoin"}
qual_g = [c["symbol"] for c in COINS
          if wc.watchout_eligible(c) and c["coingeckoId"] not in genuine_top250]
assert qual_g == ["FIL"], qual_g
ok("②e 基线内币真实跌出前 250 时仍被检出（FIL）")

# ---------- ISO 自然周计数 ----------
assert wc.advance_watch(None, "2026-W47") == (1, "2026-W47")
assert wc.advance_watch({"weeks": 1, "lastWeek": "2026-W46"}, "2026-W46") == (1, "2026-W46")  # 同周重跑不累加
assert wc.advance_watch({"weeks": 1, "lastWeek": "2026-W46"}, "2026-W47") == (2, "2026-W47")  # 相邻周 +1
assert wc.advance_watch({"weeks": 2, "lastWeek": "2026-W46"}, "2026-W48") == (1, "2026-W48")  # 隔周中断重置
assert wc.advance_watch({"weeks": 1, "lastWeek": "2026-W53"}, "2027-W01") == (2, "2027-W01")  # 跨年相邻周（2026 有 53 个 ISO 周）
assert wc.advance_watch({"weeks": 1}, "2026-W47", fallback_last_week="2026-W46") == (2, "2026-W47")  # 旧条目回退
ok("附A ISO 自然周计数：同周不累加/相邻+1/隔周重置/跨年/旧条目回退")

# ---------- ③ C6 基数 200（symbol 连接键） ----------
by_ids_full, cc_assets = {}, []
for c in COINS:
    price = c.get("snapshotPrice") or 100.0
    by_ids_full[c["coingeckoId"]] = {"id": c["coingeckoId"], "symbol": c["symbol"].lower(),
                                     "name": c["name"], "current_price": price}
    # CoinCap 资产 id 故意使用与 CoinGecko id 完全不同的命名空间（复现键错位场景）：
    cc_assets.append({"id": f"coincap-namespace-{c['symbol'].lower()}", "symbol": c["symbol"],
                      "name": c["name"], "priceUsd": str(price)})
checked, skipped, lines = wc.c6_compare(COINS, by_ids_full, cc_assets)
assert (checked, skipped, lines) == (200, 0, []), (checked, skipped, lines[:2])
ok("③a C6 按 symbol 连接：基数 200/200 全比对（旧 id 连接在此输入下为 0）")

cc_assets[0] = {**cc_assets[0], "priceUsd": str((COINS[0].get("snapshotPrice") or 100.0) * 1.5)}
checked, skipped, lines = wc.c6_compare(COINS, by_ids_full, cc_assets)
assert checked == 200 and len(lines) == 1 and COINS[0]["symbol"] in lines[0], lines
ok("③b 单币价格偏离 >20% 时恰报 1 条偏离")

# 同 symbol 多资产：name 匹配者优先（首个为同名异币、价格大偏；次个为本币、无偏离）
dup = [{"id": "x1", "symbol": "FIL", "name": "Fake FIL", "priceUsd": "99999"},
       {"id": "x2", "symbol": "FIL", "name": "Filecoin", "priceUsd": str(COINS[0]["snapshotPrice"])}]
one = [COINS[0]]
chk, skp, ln = wc.c6_compare(one, {COINS[0]["coingeckoId"]: by_ids_full[COINS[0]["coingeckoId"]]}, dup)
assert (chk, skp, ln) == (1, 0, []), (chk, skp, ln)
ok("③c CoinCap 同 symbol 多资产时优先 name 匹配者，不误报偏离")

# ---------- W4-25 ATH 计数与提醒行 ----------
counts = wc.ath_flag_counts(COINS)
assert counts == {"verified": 95, "approx": 69, "unverified": 36, "other": 0}, counts
line = wc.ath_reminder_line(COINS, date(2026, 11, 13), quarter_log_exists=False)
assert "verified 95" in line and "unverified 36" in line and "ops/ath-review-plan.md" in line
assert "不自动修改" in line
ok("附B ATH 计数 95/69/36 与提醒行（含计划路径与不自动改数声明）")

# ---------- F7-22 退出码定版（高价值信号纳入，run_void=2 不破坏） ----------
_base = dict(run_void=False, alerts=[], missing_rows=[], cand_in=[], cand_out=[],
             due=[], queue=[], report_url_warn=0, incomplete=[])
assert wc.exit_code_for(**_base) == 0
for field, val in [("alerts", [("S", "i", "p", "a")]), ("missing_rows", [{"symbol": "X"}]),
                   ("cand_in", [("X", 1, 2)]), ("cand_out", [("X", None, 2)]),
                   ("due", ["X"]), ("queue", ["多源偏离 X"]), ("report_url_warn", 1),
                   ("incomplete", ["C3 失败"])]:
    kw = {**_base, field: val}
    assert wc.exit_code_for(**kw) == 1, field
ok("F7-22a 高价值信号（missing/cand_in/cand_out/due/queue/report_url_warn）任一非空 → 退出 1；全空 → 0")
assert wc.exit_code_for(**{**_base, "run_void": True}) == 2
assert wc.exit_code_for(**{**_base, "run_void": True, "missing_rows": [{"symbol": "X"}], "alerts": [1]}) == 2
ok("F7-22b run_void 恒 2 且优先于一切 1 类信号（F6-09 语义不破坏）")

# ---------- F7-23 state 读取/原子写 ----------
import tempfile  # noqa: E402
with tempfile.TemporaryDirectory() as _td:
    _td = Path(_td)
    missing = wc.load_state(_td / "nope.json", "2026-W47")
    assert missing["baselineWeek"] == "2026-W47" and missing["watchOut"] == {}
    good = _td / "state.json"
    good.write_text(json.dumps({"version": 1, "watchOut": {"X": {"weeks": 1}}}), encoding="utf-8")
    assert wc.load_state(good, "2026-W47")["watchOut"]["X"]["weeks"] == 1
    bad = _td / "bad.json"
    bad.write_text('{"version": 1, "watchOut": ', encoding="utf-8")  # 截断 JSON（旧实现在此 traceback exit 1）
    try:
        wc.load_state(bad, "2026-W47")
        raise AssertionError("损坏 state 未抛 StateError")
    except wc.StateError:
        pass
    notdict = _td / "list.json"
    notdict.write_text("[1,2]", encoding="utf-8")
    try:
        wc.load_state(notdict, "2026-W47")
        raise AssertionError("非 dict state 未抛 StateError")
    except wc.StateError:
        pass
ok("F7-23a load_state：缺失→默认；正常→解析；损坏/非 dict→StateError（main 以退出 3 区分，不再 traceback 撞码 1）")

with tempfile.TemporaryDirectory() as _td:
    _td = Path(_td)
    target = _td / "sub" / "report.md"
    wc.atomic_write_text(target, "第一版\n")
    assert target.read_text(encoding="utf-8") == "第一版\n"
    wc.atomic_write_text(target, "第二版\n")
    assert target.read_text(encoding="utf-8") == "第二版\n"
    assert not list(target.parent.glob(".weekly-*")), list(target.parent.iterdir())
ok("F7-23b atomic_write_text：tmp+os.replace 落盘、无临时文件残留、覆盖写一致")

print(f"\nALL {len(PASS)} CHECKS PASSED")
