#!/usr/bin/env python3
"""quota-check.py — W4-02 CoinGecko 双路总账核账（Muse 侧定时核账实现）。

背景与口径（与 ops/quota-ledger.md 账一、PHASE4_REVIEW W4-02 对齐）：
  - CoinGecko 免费 Demo 档全账号 1 把 key、10,000 credits/月，fetcher 与 legacy
    （/api/board 直连路径）双路共用同一池，不是各 10,000。
  - fetcher 侧可实测：KV v1:meta:health 的 quota.creditsUsedEst（fetcher 自算，自然月累计）。
  - legacy 侧当前无计量（F4-02），只能按场景估算未命中回源（每次未命中 2 credits）：
      0    —— 全命中下界（不现实，仅作区间端点）
      576  —— 规划口径：探针成对同 colo 估算（F4-02 定版，M2/M3 每 300s 触达 /api/board）
      1152 —— 压力口径：PHASE5 复审修正的探针绝对最坏（含 M4 内嵌 board 触达）
    判级（verdict）以规划口径为准；压力口径只作参考列出——它假设 13 天来每次探针
    全部未命中，与「上游仍返回 200、额度未被拒」的实测事实矛盾，不得用它冒充实际消耗。
  - 经验护栏：health.lastUpstreamStatus=200 且 consecutiveFailures=0 ⇒ 真实合计尚未撞顶，
    任何场景若算出「已超额」只能说明该场景高估，报告中必须同时给出此护栏结论。
  - fetcher 向前速率：W4-01 修复后定版 192 credits/天（markets 144 + global 48）；
    quotaMode 非 normal（自动降频）时实际更低，192 仍作保守上界并在报告中注明。

判级（与 quota-ledger §2.1/§3 对齐）：
  - 以「向前投影」为判级基准：已用只认 fetcher 实测值（legacy 本月已耗无计量、不得把
    场景速率回填进已用数——那会把假设冒充事实）；向前日耗 = fetcher 定版 192 + 场景 legacy 日耗。
  - CRITICAL（升级，退出码 2）：向前投影击穿 ≤ 3 天（规划口径）。
  - WARNING（警告，退出码 1）：向前投影击穿 ≤ 7 天，或投影月合计 ≥ 8,500（规划口径）。
  - WATCH（注意，退出码 0，记录但不打扰）：投影月合计 ≥ 7,000。
  - 其余 → OK（退出码 0）。
  - 同时输出「场景自洽口径」（假设场景速率自月初已成立）的击穿天数作参考：该口径与
    上游实测健康矛盾时（见经验护栏），只作风险注脚、不得据此升级判级。
  - 检查本身失败（读不到 KV 等）→ 退出码 3，同样应告警（核账失效=预警失效）。

只读：只 GET KV health，不写任何 KV 键；不调用 CoinGecko，零额度消耗。
每次运行向 ops/quota-log.jsonl 追加一行 JSON（总账可见性载体）。
凭证：从环境变量 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 读（调用方运行时注入），
本脚本不打印、不落盘任何凭证值。
"""
import calendar
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "e6eae7d19e653edfedb12f4bb5e0227d")
NAMESPACE_ID = "ad1b72702c5c4f229999bea5b118d1bc"  # BOARD_KV
HEALTH_KEY = "v1:meta:health"
MONTHLY_CAP = 10_000
FETCHER_FORWARD_PER_DAY = 192  # 定版：markets 144/天 + global 48/天（W4-01 修复后）
LEGACY_SCENARIOS = [
    ("floor_all_hit", 0, "全命中下界（区间端点）"),
    ("planning_probe_paired", 576, "规划口径：探针成对同 colo 估算（F4-02 定版）"),
    ("stress_probe_worst", 1152, "压力口径：探针绝对最坏（PHASE5 修正，含 M4 内嵌触达）"),
]
PLANNING_KEY = "planning_probe_paired"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_PATH = os.path.join(REPO_ROOT, "ops", "quota-log.jsonl")


def fail(msg):
    print(f"quota-check: ERROR {msg}")
    return None


def read_health():
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        return fail("未设置 CLOUDFLARE_API_TOKEN（由调用方运行时注入）")
    try:
        pin = json.load(open(os.path.join(REPO_ROOT, "package.json")))["devDependencies"]["wrangler"]
    except Exception:
        pin = "4.159.0"
    cmd = [
        "npx", f"wrangler@{pin}", "kv", "key", "get", HEALTH_KEY,
        "--namespace-id", NAMESPACE_ID, "--remote",
    ]
    env = dict(os.environ, CLOUDFLARE_ACCOUNT_ID=ACCOUNT_ID)
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=env, cwd=REPO_ROOT)
    except Exception as e:
        return fail(f"wrangler 调用异常：{e}")
    raw = (out.stdout or "").strip()
    start = raw.find("{")
    if out.returncode != 0 or start < 0:
        return fail(f"KV 读取失败 rc={out.returncode}: {(out.stderr or raw)[:300]}")
    try:
        return json.loads(raw[start:])
    except Exception as e:
        return fail(f"health JSON 解析失败：{e}")


def main():
    health = read_health()
    if health is None:
        return 3
    now = datetime.now(timezone.utc)
    quota = health.get("quota") or {}
    fetcher_used = quota.get("creditsUsedEst")
    month_str = quota.get("month")
    if not isinstance(fetcher_used, (int, float)) or not month_str:
        print("quota-check: ERROR health.quota 缺 creditsUsedEst/month，核账证据不足")
        return 3
    year, mon = int(month_str[:4]), int(month_str[5:7])
    days_in_month = calendar.monthrange(year, mon)[1]
    month_start = datetime(year, mon, 1, tzinfo=timezone.utc)
    days_elapsed = max((now - month_start).total_seconds() / 86400.0, 0.04)
    days_remaining = max(days_in_month - days_elapsed, 0.0)

    scenarios = {}
    for key, legacy_daily, label in LEGACY_SCENARIOS:
        forward_daily = FETCHER_FORWARD_PER_DAY + legacy_daily
        # 向前投影（判级基准）：已用只认 fetcher 实测，legacy 已耗不回填假设
        projected_total = fetcher_used + forward_daily * days_remaining
        remaining_measured = MONTHLY_CAP - fetcher_used
        dte_forward = (remaining_measured / forward_daily) if forward_daily > 0 else None
        # 场景自洽口径（参考）：假设场景速率自月初已成立
        total_if_held = fetcher_used + legacy_daily * days_elapsed
        dte_if_held = ((MONTHLY_CAP - total_if_held) / forward_daily) if forward_daily > 0 else None
        scenarios[key] = {
            "label": label,
            "legacyPerDay": legacy_daily,
            "forwardPerDay": forward_daily,
            "projectedMonthTotal": round(projected_total, 1),
            "daysToExhaust": round(dte_forward, 2) if dte_forward is not None else None,
            "daysToExhaustIfScenarioHeldAllMonth": round(dte_if_held, 2) if dte_if_held is not None else None,
            "totalUsedIfScenarioHeldAllMonth": round(total_if_held, 1),
        }

    plan = scenarios[PLANNING_KEY]
    dte = plan["daysToExhaust"]
    if dte is not None and dte <= 3:
        verdict, code = "CRITICAL", 2
    elif (dte is not None and dte <= 7) or plan["projectedMonthTotal"] >= 8500:
        verdict, code = "WARNING", 1
    elif plan["projectedMonthTotal"] >= 7000:
        verdict, code = "WATCH", 0
    else:
        verdict, code = "OK", 0

    upstream_ok = health.get("lastUpstreamStatus") == 200 and int(health.get("consecutiveFailures", 0)) == 0
    record = {
        "at": now.isoformat().replace("+00:00", "Z"),
        "tool": "quota-check",
        "workpackage": "W4-02",
        "month": month_str,
        "cap": MONTHLY_CAP,
        "fetcher": {
            "creditsUsedEst": fetcher_used,
            "quotaMode": quota.get("quotaMode"),
            "forwardPerDayAssumed": FETCHER_FORWARD_PER_DAY,
            "lastRunAt": health.get("lastRunAt"),
            "lastRunId": health.get("lastRunId"),
            "monthToDateAvgPerDay": round(fetcher_used / days_elapsed, 1),
        },
        "daysElapsedInMonth": round(days_elapsed, 2),
        "daysRemainingInMonth": round(days_remaining, 2),
        "scenarios": scenarios,
        "planningScenario": PLANNING_KEY,
        "verdict": verdict,
        "empiricalGuard": {
            "lastUpstreamStatus": health.get("lastUpstreamStatus"),
            "consecutiveFailures": health.get("consecutiveFailures"),
            "upstreamHealthy": upstream_ok,
            "maxLegacyElapsedConsistentWithHealth": MONTHLY_CAP - fetcher_used,
            "impliedMaxAvgLegacyPerDay": round((MONTHLY_CAP - fetcher_used) / days_elapsed, 1),
            "note": "上游仍 200 ⇒ 真实双路合计尚未撞顶，且 legacy 本月真实已耗 < cap − fetcher 实测（见 maxLegacyElapsedConsistentWithHealth，其日均上界见 impliedMaxAvgLegacyPerDay——弱上界，仅排除「场景速率自月初全额成立」一类与事实矛盾的读法）。场景值是估算区间，不得表述为实测消耗。legacy 侧实测计数（board.js 回源计数键）属待站长复核的约定突破项，未激活前本核账以场景估算代行。",
        },
    }
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"quota-check: ERROR 写入 {LOG_PATH} 失败：{e}")
        return 3
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())
