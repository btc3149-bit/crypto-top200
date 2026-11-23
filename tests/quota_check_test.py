#!/usr/bin/env python3
"""quota_check_test.py — F6-16 判级逻辑用例（第六期批 5/6 新增）。

为 scripts/quota-check.py 的 verdict/退出码判级建合成输入用例，仿
tests/weekly_check_test.py 的 stub 风格：import 脚本模块后 monkeypatch
其 read_health（不走 wrangler/KV、零额度）、LOG_PATH（写临时文件）与
datetime（冻结到 2026-11-15T12:00Z），只驱动 main() 的判级路径。

口径（重要）：用例按 PHASE6_REVIEW F6-07 的「报告期望新口径」写——
G3 已切 kv 只读，legacy 回源路径退出服务，kv 模式下 legacy=0，
判级向前日耗只认 fetcher 定版 192/天，旧规划口径（legacy 576/天）
场景不参与判级。冻结时点下 days_remaining=15.5，期望投影 = used + 192×15.5。

  used=1000 → 投影 3976、击穿 46.9 天 → OK（0）
  used=4500 → 投影 7476（≥7000 且 <8500）→ WATCH（0）
  used=6000 → 投影 8976（≥8500）→ WARNING（1）
  used=9500 → 击穿 500/192≈2.60 天（≤3）→ CRITICAL（2）
  health 缺 creditsUsedEst → 核账证据不足 → 退出 3（口径无关，恒定）

已知状态（F7-56 修订，2026-11-23）：批 0 的 F6-07 G3 口径改版早已合并，
quota-check.py 现按 kv 口径判级（legacy=0、向前日耗只认 fetcher 192/天），
本套件 6/6 全绿（实跑可复核）。本段原写「脚本仍以 legacy 576 规划口径判级、
OK/WATCH 两例待批 0 合并后转绿」为合并前的预期红状态记录，已过时，勿再
按预期红引用；历史沿革见 P6_NOTES.md F6-16。

运行：python3 tests/quota_check_test.py（全过退出 0）
"""
import importlib.util
import io
import json
import sys
import tempfile
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("quota_check", ROOT / "scripts" / "quota-check.py")
qc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qc)

FIXED_NOW = datetime(2026, 11, 15, 12, 0, 0, tzinfo=timezone.utc)


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return FIXED_NOW


qc.datetime = FixedDateTime
_tmp = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
_tmp.close()
qc.LOG_PATH = _tmp.name

PASS = []
FAIL = []


def ok(name):
    PASS.append(name)
    print(f"PASS {name}")


def check(name, got, want):
    # 收集式断言（不中断）：批 0 合并前已知 ①② 应红，须逐例呈现而非首例即停。
    if got == want:
        ok(name)
    else:
        FAIL.append((name, got, want))
        print(f"FAIL {name}: got={got} want={want}")


def run_case(used, month="2026-11"):
    quota = {"month": month, "quotaMode": "normal"}
    if used is not None:
        quota["creditsUsedEst"] = used
    health = {
        "quota": quota,
        "lastUpstreamStatus": 200,
        "consecutiveFailures": 0,
        "lastRunAt": "2026-11-15T11:50:00Z",
        "lastRunId": "run-test",
        # G3/kv 形态标记：新口径下 legacy=0 的依据（旧脚本忽略此字段，不影响其判级路径）
        "boardReadMode": "kv",
    }
    qc.read_health = lambda: health
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = qc.main()
    record = json.loads(buf.getvalue())
    return record["verdict"], code


# ---------- 新口径四档判级 ----------
check("① kv 口径 used=1000：投影 3976 <7000 → OK / 退出 0（旧规划口径场景不参与判级）",
      run_case(1000), ("OK", 0))
check("② kv 口径 used=4500：投影 7476 ∈[7000,8500) → WATCH / 退出 0",
      run_case(4500), ("WATCH", 0))
check("③ used=6000：投影 8976 ≥8500 → WARNING / 退出 1",
      run_case(6000), ("WARNING", 1))
check("④ used=9500：向前击穿 ≈2.60 天 ≤3 → CRITICAL / 退出 2",
      run_case(9500), ("CRITICAL", 2))

# ---------- 证据不足恒定退出 3（口径无关） ----------
qc.read_health = lambda: {"quota": {"month": "2026-11"}, "lastUpstreamStatus": 200, "consecutiveFailures": 0}
buf = io.StringIO()
with redirect_stdout(buf):
    code = qc.main()
check("⑤ health 缺 creditsUsedEst → 核账证据不足退出 3", code, 3)

# ---------- W5 实测计数并列呈现 ----------
qc.read_legacy_credits = lambda: {"month": "2026-11", "credits": 42, "updatedAt": "2026-11-15T11:00:00.000Z"}
{
    "quota": {"month": "2026-11", "quotaMode": "normal", "creditsUsedEst": 1000},
    "lastUpstreamStatus": 200, "consecutiveFailures": 0, "lastRunAt": "2026-11-15T11:50:00Z", "lastRunId": "run-test",
}
qc.read_health = lambda: {"quota": {"month": "2026-11", "quotaMode": "normal", "creditsUsedEst": 1000}, "lastUpstreamStatus": 200, "consecutiveFailures": 0, "lastRunAt": "2026-11-15T11:50:00Z", "lastRunId": "run-test"}
_buf = io.StringIO()
with redirect_stdout(_buf):
    _code = qc.main()
_rec = json.loads(_buf.getvalue())
check("⑥ W5 legacyMeasured 实测计数并列呈现（available/credits=42，判级仍 OK）",
      (_rec.get("legacyMeasured", {}).get("available"), _rec.get("legacyMeasured", {}).get("credits"), _rec.get("verdict")),
      (True, 42, "OK"))
qc.read_legacy_credits = lambda: None

# ---------- F7-07：F6-24 陈旧判级 / 非 kv 分支 / legacyMeasured available=false ----------
_orig_board_mode = qc.read_board_mode
_orig_read_legacy = qc.read_legacy_credits


def mk_health(used=1000, month="2026-11", last="2026-11-15T11:50:00Z", drop_last=False):
    h = {
        "quota": {"month": month, "quotaMode": "normal", "creditsUsedEst": used},
        "lastUpstreamStatus": 200,
        "consecutiveFailures": 0,
        "lastRunId": "run-test",
    }
    if not drop_last:
        h["lastRunAt"] = last
    return h


def run_full(health, legacy=None, mode="kv"):
    """驱动 main()：返回 (退出码, stdout 记录或 None, log 末行记录或 None)。"""
    qc.read_health = lambda: health
    qc.read_legacy_credits = lambda: legacy
    qc.read_board_mode = lambda health=None: mode
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = qc.main()
    out = buf.getvalue().strip()
    rec = None
    if out.startswith("{"):
        try:
            rec = json.loads(out)
        except Exception:
            rec = None
    log_rec = None
    try:
        lines = Path(qc.LOG_PATH).read_text(encoding="utf-8").strip().splitlines()
        if lines:
            log_rec = json.loads(lines[-1])
    except Exception:
        log_rec = None
    return code, rec, log_rec


# ⑦ 月份不符（health.month=2026-10 ≠ 当前 2026-11）→ INVALID + 退出 3，不产出正常判级
_code, _rec, _log = run_full(mk_health(month="2026-10"))
check("⑦ F7-07 health.month 与当前月不一致 → verdict=INVALID / 退出 3（F6-24）",
      (_code, _rec, (_log or {}).get("verdict"), (_log or {}).get("staleHealth")),
      (3, None, "INVALID", True))

# ⑧ lastRunAt 陈旧（距今 3h+1s）→ INVALID + 退出 3
_code, _rec, _log = run_full(mk_health(last="2026-11-15T08:59:59Z"))
check("⑧ F7-07 lastRunAt 距今 >3h → verdict=INVALID / 退出 3（F6-24）",
      (_code, (_log or {}).get("verdict")), (3, "INVALID"))

# ⑨ lastRunAt 恰 3h 边界（不 >3h）→ 仍有效，正常判级 OK / 退出 0
_code, _rec, _log = run_full(mk_health(last="2026-11-15T09:00:00Z"))
check("⑨ F7-07 lastRunAt 恰 3h 边界 → 有效、verdict=OK / 退出 0",
      (_code, (_rec or {}).get("verdict")), (0, "OK"))

# ⑩ lastRunAt 在未来 +1h → F7-27 双侧判定（容差 300s）：未来超容差 → INVALID + 退出 3
# （第七期集成时按脚本组 F7-27 修复翻转期望，原为锁定旧单侧校验现状）
_code, _rec, _log = run_full(mk_health(last="2026-11-15T13:00:00Z"))
check("⑩ F7-07/F7-27 lastRunAt 未来 +1h → verdict=INVALID / 退出 3",
      (_code, (_log or {}).get("verdict")), (3, "INVALID"))

# ⑪ lastRunAt 不可解析 / 缺失 → INVALID + 退出 3
_code, _rec, _log = run_full(mk_health(last="not-a-date"))
check("⑪a F7-07 lastRunAt 不可解析 → verdict=INVALID / 退出 3",
      (_code, (_log or {}).get("verdict")), (3, "INVALID"))
_code, _rec, _log = run_full(mk_health(drop_last=True))
check("⑪b F7-07 lastRunAt 缺失 → verdict=INVALID / 退出 3",
      (_code, (_log or {}).get("verdict")), (3, "INVALID"))

# ⑫ 非 kv 分支：legacy 模式规划口径取 576/天 → used=1000 投影 12904 ≥8500 → WARNING / 退出 1
_code, _rec, _log = run_full(mk_health(), mode="legacy")
check("⑫a F7-07 非 kv（legacy）分支：规划口径 576/天 → WARNING / 退出 1、planningScenario=planning_probe_paired",
      (_code, (_rec or {}).get("verdict"), (_rec or {}).get("planningScenario")),
      (1, "WARNING", "planning_probe_paired"))
# ⑫b 模式未知（None）同样走非 kv 规划口径（fail-safe 取保守口径）
_code, _rec, _log = run_full(mk_health(), mode=None)
check("⑫b F7-07 boardMode=None（未知）→ 非 kv 规划口径 → WARNING / 退出 1",
      (_code, (_rec or {}).get("verdict")), (1, "WARNING"))

# ⑬ legacyMeasured：计数键缺失（read 返回 None）→ available=false、credits=null，判级不受影响
_code, _rec, _log = run_full(mk_health(), legacy=None)
_lm = (_rec or {}).get("legacyMeasured", {})
check("⑬ F7-07 legacyMeasured 计数键缺失 → available=false / credits=null / verdict=OK",
      (_code, _lm.get("available"), _lm.get("credits"), (_rec or {}).get("verdict")),
      (0, False, None, "OK"))

# ⑭ legacyMeasured：计数键跨月（month=2026-10）→ available=false 且 credits/month/updatedAt 全置空
# （F7-25 已由脚本组修复，第七期集成时翻转期望，原为锁定旧缺陷现状）
_code, _rec, _log = run_full(mk_health(), legacy={"month": "2026-10", "credits": 42, "updatedAt": "2026-10-31T00:00:00.000Z"})
_lm = (_rec or {}).get("legacyMeasured", {})
check("⑭ F7-07/F7-25 legacyMeasured 跨月 → available=false / credits=None / month=None",
      (_lm.get("available"), _lm.get("credits"), _lm.get("month")),
      (False, None, None))

# ⑮ legacyMeasured 读入层畸形过滤：read_legacy_credits 本体对非 dict / credits 非数 / 缺 month 一律 None
# （qc 的 read_legacy_credits 已被上文用例 monkeypatch，故另载一份全新模块实例取原函数）
qc.read_board_mode = _orig_board_mode
_spec2 = importlib.util.spec_from_file_location("quota_check_pristine", ROOT / "scripts" / "quota-check.py")
qc2 = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(qc2)
_shapes = [
    ("字符串", "junk"),
    ("credits 为字符串", {"month": "2026-11", "credits": "42"}),
    ("缺 credits", {"month": "2026-11"}),
    ("缺 month", {"credits": 42}),
    ("列表", [1, 2]),
]
for _label, _shape in _shapes:
    qc2.read_kv_key = lambda key, quiet=False, _s=_shape: _s
    check(f"⑮ F7-07 read_legacy_credits 畸形（{_label}）→ None", qc2.read_legacy_credits(), None)
qc2.read_kv_key = lambda key, quiet=False: {"month": "2026-11", "credits": 42, "updatedAt": "2026-11-15T11:00:00.000Z"}
check("⑮ F7-07 read_legacy_credits 合法形态 → 原样返回",
      (qc2.read_legacy_credits() or {}).get("credits"), 42)

# ---------- F8-22：INVALID 路径写日志失败不得静默吞 ----------
from contextlib import redirect_stderr  # noqa: E402
_orig_log_path = qc.LOG_PATH
qc.LOG_PATH = "/nonexistent-dir-f8-22/quota-log.jsonl"  # 父目录不存在 → open 必失败（等价只读目录）
qc.read_health = lambda: mk_health(month="2026-10")  # 陈旧 → INVALID 路径
qc.read_board_mode = _orig_board_mode
_out_buf, _err_buf = io.StringIO(), io.StringIO()
with redirect_stdout(_out_buf), redirect_stderr(_err_buf):
    _code = qc.main()
qc.LOG_PATH = _orig_log_path
check("⑯ F8-22 INVALID 路径写日志失败 → stderr 报错（含「写入」与 LOG_PATH）+ 退出 3（与正常路径同码，不静默吞）",
      (_code, "写入" in _err_buf.getvalue(), "quota-log.jsonl" in _err_buf.getvalue(),
       "核账失效" in _out_buf.getvalue()),
      (3, True, True, True))

print(f"\nquota_check: {len(PASS)} PASS / {len(FAIL)} FAIL")
if FAIL:
    print("未过用例（批 0 的 F6-07 新口径合并后应转绿，见文件头与 P6_NOTES F6-16）：")
    for name, got, want in FAIL:
        print(f"  - {name}: got={got} want={want}")
    sys.exit(1)
print(f"ALL {len(PASS)} CHECKS PASSED")
