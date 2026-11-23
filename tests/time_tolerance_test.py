#!/usr/bin/env python3
"""time_tolerance_test.py — F7-27 时间判定双侧化 + F7-25 legacyMeasured 置空 离线单测
（第七期批 4 新增套件）。

覆盖三个判定点的纯函数：
  ① check-shadow-health.judge：lastSuccessAt 未来 +1h → FAIL 级 problems
     （旧实现 age 为负直接 OK，评审验证方法要求的 fixture）；容差内未来
     （+120s）不报；过旧/连续失败仍报。
  ② quota-check.health_stale_reasons：lastRunAt 未来 +1h → 陈旧/异常原因；
     容差内未来不报；>3h 过旧仍报；月份不一致仍报。
  ③ quota-check.build_legacy_measured（F7-25）：跨月/陈旧/畸形时
     credits/month/updatedAt 全部置空、available=False 且带 reason；
     当月正常值 available=True 并保留原值。
probe.sh 的同形判定为 bash 内嵌代码、无纯函数入口，其 fixture 证据
（本地 mock 服务 + updatedAt=+1h 实跑 probe.sh）见 P7_NOTES_SCRIPTS.md。

运行：python3 tests/time_tolerance_test.py（全过退出 0）
注：本套件尚未列入 scripts/run-tests.sh 的 SUITES 清单，请协调人纳入 manifest。
"""
import importlib.util, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def load(mod_name, rel):
    spec = importlib.util.spec_from_file_location(mod_name, ROOT / rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

shadow = load("check_shadow_health", "scripts/check-shadow-health.py")
quota = load("quota_check", "scripts/quota-check.py")

PASS = []
def ok(name):
    PASS.append(name)
    print(f"PASS {name}")

# ---------- ① check-shadow judge ----------
assert shadow.judge(600, 0) == []
assert shadow.judge(-120, 0) == []                      # 容差内未来（+120s）不报
p = shadow.judge(-3600, 0)                              # fixture：lastSuccessAt = +1h
assert p and "未来" in p[0], p
assert shadow.judge(1501, 0) != []                      # 过旧仍报
assert shadow.judge(60, 3) != []                        # 连续失败仍报
ok("① check-shadow：未来 +1h → 判异常（旧实现 OK）；容差内未来/正常 → 无问题；过旧/连续失败仍报")

# ---------- ② quota health_stale_reasons ----------
NOW = datetime(2026, 11, 15, 12, 0, 0, tzinfo=timezone.utc)
def health(last_run, month="2026-11"):
    return {"quota": {"month": month, "creditsUsedEst": 1}, "lastRunAt": last_run}
assert quota.health_stale_reasons(health("2026-11-15T11:50:00Z"), NOW) == []
assert quota.health_stale_reasons(health("2026-11-15T12:02:00Z"), NOW) == []   # +120s 容差内
r = quota.health_stale_reasons(health("2026-11-15T13:00:00Z"), NOW)            # +1h 未来
assert r and "未来" in r[0], r
assert quota.health_stale_reasons(health("2026-11-15T08:00:00Z"), NOW) != []   # >3h 过旧
assert quota.health_stale_reasons(health("2026-11-15T11:50:00Z", month="2026-10"), NOW) != []
ok("② quota：lastRunAt 未来 +1h → 核账失效原因（旧实现 OK）；容差内/正常 → 无；过旧/跨月仍报")

# ---------- ③ quota build_legacy_measured（F7-25） ----------
good = quota.build_legacy_measured({"month": "2026-11", "credits": 42, "updatedAt": "2026-11-15T11:00:00.000Z"}, "2026-11")
assert (good["available"], good["credits"], good["month"], good["updatedAt"]) == (True, 42, "2026-11", "2026-11-15T11:00:00.000Z"), good
ok("③a legacyMeasured 当月正常：available=True 且 credits/month/updatedAt 保留")

for name, counter in [
    ("跨月", {"month": "2026-10", "credits": 999, "updatedAt": "2026-10-31T23:00:00Z"}),
    ("陈旧 updatedAt", {"month": "2026-11", "credits": 999, "updatedAt": "2026-10-31T23:00:00Z"}),
    ("畸形 credits", {"month": "2026-11", "credits": "999", "updatedAt": "2026-11-15T11:00:00Z"}),
    ("畸形 updatedAt", {"month": "2026-11", "credits": 9, "updatedAt": "not-a-date"}),
    ("无键", None),
]:
    m = quota.build_legacy_measured(counter, "2026-11")
    assert m["available"] is False and m["credits"] is None and m["month"] is None \
        and m["updatedAt"] is None and m["reason"], (name, m)
ok("③b legacyMeasured 跨月/陈旧/畸形/无键：credits/month/updatedAt 全置空、available=False 带 reason")

print(f"\nALL {len(PASS)} CHECKS PASSED")
