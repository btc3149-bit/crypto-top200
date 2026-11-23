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

已知状态（2026-11-23 本批实跑）：quota-check.py 本体正由批 0 按 F6-07
改 G3 口径、尚未合并到本分支，当前脚本仍以 legacy 576 规划口径判级，
故 OK/WATCH 两例在本分支实跑为 WARNING（不符新口径期望）——这是预期内
的「待批 0 合并后转绿」，不得为迁就旧口径而改用例。WARNING/CRITICAL/
证据不足三例在新旧口径下结论恰一致、当前即绿。详见 P6_NOTES.md F6-16。

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

print(f"\nquota_check: {len(PASS)} PASS / {len(FAIL)} FAIL")
if FAIL:
    print("未过用例（批 0 的 F6-07 新口径合并后应转绿，见文件头与 P6_NOTES F6-16）：")
    for name, got, want in FAIL:
        print(f"  - {name}: got={got} want={want}")
    sys.exit(1)
print(f"ALL {len(PASS)} CHECKS PASSED")
