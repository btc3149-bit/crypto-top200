#!/usr/bin/env python3
"""quota-check.py — W4-02 CoinGecko 双路总账核账（Muse 侧定时核账实现）。

背景与口径（与 ops/quota-ledger.md 账一、PHASE4_REVIEW W4-02 对齐）：
  - CoinGecko 免费 Demo 档全账号 1 把 key、10,000 credits/月，fetcher 与 legacy
    （/api/board 直连路径）双路共用同一池，不是各 10,000。
  - fetcher 侧可实测：KV v1:meta:health 的 quota.creditsUsedEst（fetcher 自算，自然月累计）。
  - legacy 侧实测计量（W5，2026-11-23 激活）：board.js 在 legacy/dual 真正回源时
    对 KV 计数键 v1:meta:legacy-credits 自增（每轮 markets+global = 2 credits，
    结构 {month, credits, updatedAt}；用户 2026-11-23 批准突破「Function 只 get」）。
    本脚本把该实测值读入记录字段 legacyMeasured，与下述建模场景并列呈现；
    判级仍按 F6-07 的 G3 口径（kv 模式 legacy=0），实测值不回填已用、不改判级。
    计数键不存在/读不到时 legacyMeasured.available=false（部署前或恒 kv 时预期）。
  - 建模场景（历史参考，F4-02）：按场景估算未命中回源（每次未命中 2 credits）：
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
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

SCRIPT_VERSION = "2.1-w5-legacy-measured"
METHODOLOGY = "g3-aware: planning=legacy0 when kv; legacyMeasured=v1:meta:legacy-credits alongside modelled scenarios"
# F6-87：账号 ID 改必填环境变量、缺失即 fail-closed（与 TOKEN 同口径，不再有字面量默认值）。
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
NAMESPACE_ID = "ad1b72702c5c4f229999bea5b118d1bc"  # BOARD_KV（wrangler.toml 公开值）
HEALTH_KEY = "v1:meta:health"
LEGACY_CREDITS_KEY = "v1:meta:legacy-credits"  # W5 实测计数键（board.js 唯一可写键）
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


def classify_error(text):
    """F6-90：wrangler stderr 只归类、不原文透传（原文可能含账号/命名空间 ID）。"""
    t = (text or "").lower()
    if any(k in t for k in ("401", "403", "auth", "unauthorized", "forbidden", "token")):
        return "auth"
    if any(k in t for k in ("timeout", "timed out", "enotfound", "econn", "network", "fetch failed", "dns")):
        return "network"
    if any(k in t for k in ("404", "not found", "notfound")):
        return "notfound"
    return "unknown"


def sanitized_debug(text):
    return re.sub(r"\b[0-9a-f]{32}\b", "<redacted-hex>", (text or ""))[:300]


def read_board_mode(health=None):
    """F6-07：判定现行读模式。先读 wrangler.toml [vars]；读不到时回退线上 /api/board 的 servedFrom。"""
    try:
        text = open(os.path.join(REPO_ROOT, "wrangler.toml"), encoding="utf-8").read()
        m = re.search(r"(?m)^\[vars\][ \t]*\n(.*?)(?=^\[|\Z)", text, re.S)
        if m:
            mm = re.search(r'BOARD_READ_MODE\s*=\s*"([^"]*)"', m.group(1))
            if mm:
                return mm.group(1)
    except Exception:
        pass
    try:
        with urllib.request.urlopen("https://top200.oppcal.com/api/board", timeout=15) as r:
            body = json.load(r)
        sf = (body.get("freshness") or {}).get("servedFrom")
        if sf in ("kv", "cache", "memory"):
            return "kv"
        if sf:
            return sf
    except Exception:
        pass
    return None


FALLBACK_WRANGLER_PIN = "4.159.0"  # F8-23：仅 package.json 读不到时的写死回退值（须与 package.json pin 同步）


def _lockfile_wrangler_version():
    try:
        return json.load(open(os.path.join(REPO_ROOT, "package-lock.json")))["packages"]["node_modules/wrangler"]["version"]
    except Exception:
        return None


def wrangler_cmd_prefix():
    """F8-23：wrangler 调用前缀（纯路径决策，供单测）。

    正常路径优先走锁版入口 scripts/wrangler-pinned.sh（F7-45 定版：pin 唯一
    来源 package.json、lockfile 一致性由入口校验）；pin 与 lockfile 不一致时
    先 WARN（入口本身也会拒绝执行）。仅当 package.json 读不到时才回退裸
    `npx wrangler@<写死值>`，且必须 WARN（与 check-shadow-health.py 同口径，
    旧实现静默回退）；回退值再与 lockfile 比对，不一致同样 WARN。
    WARN 一律走 stderr，不污染 stdout 的 JSON 记录。
    """
    try:
        pin = json.load(open(os.path.join(REPO_ROOT, "package.json")))["devDependencies"]["wrangler"]
    except Exception:
        print(f"quota-check: WARN 无法从仓库 package.json 读取 wrangler pin，回退写死值 {FALLBACK_WRANGLER_PIN}（绕过锁版入口 scripts/wrangler-pinned.sh）", file=sys.stderr)
        locked = _lockfile_wrangler_version()
        if locked is not None and locked != FALLBACK_WRANGLER_PIN:
            print(f"quota-check: WARN 回退 pin {FALLBACK_WRANGLER_PIN} 与 package-lock.json 的 wrangler {locked} 不一致，请人工核对", file=sys.stderr)
        return ["npx", f"wrangler@{FALLBACK_WRANGLER_PIN}"]
    locked = _lockfile_wrangler_version()
    if locked is not None and locked != pin:
        print(f"quota-check: WARN package.json 的 wrangler pin {pin} 与 package-lock.json {locked} 不一致，锁版入口将拒绝执行，请先对齐", file=sys.stderr)
    return ["bash", os.path.join(REPO_ROOT, "scripts", "wrangler-pinned.sh")]


def read_kv_key(key, quiet=False):
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        return None if quiet else fail("未设置 CLOUDFLARE_API_TOKEN（由调用方运行时注入）")
    if not ACCOUNT_ID:
        return None if quiet else fail("未设置 CLOUDFLARE_ACCOUNT_ID（F6-87：必填环境变量，缺失即 fail-closed）")
    cmd = wrangler_cmd_prefix() + [
        "kv", "key", "get", key,
        "--namespace-id", NAMESPACE_ID, "--remote",
    ]
    env = dict(os.environ, CLOUDFLARE_ACCOUNT_ID=ACCOUNT_ID)
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=env, cwd=REPO_ROOT)
    except Exception as e:
        return None if quiet else fail(f"wrangler 调用异常：{e}")
    raw = (out.stdout or "").strip()
    start = raw.find("{")
    if out.returncode != 0 or start < 0:
        if quiet:
            return None
        cat = classify_error(out.stderr or raw)
        msg = f"KV 读取失败 rc={out.returncode} category={cat}"
        if os.environ.get("DEBUG"):
            msg += f" detail={sanitized_debug(out.stderr or raw)}"
        return fail(msg)
    try:
        return json.loads(raw[start:])
    except Exception as e:
        return None if quiet else fail(f"health JSON 解析失败：{e}")


def read_health():
    return read_kv_key(HEALTH_KEY)


def read_legacy_credits():
    """W5：读实测计数键；不存在/读不到/形态不对一律返回 None（不阻断核账）。"""
    data = read_kv_key(LEGACY_CREDITS_KEY, quiet=True)
    if not isinstance(data, dict) or not isinstance(data.get("credits"), (int, float)) or not data.get("month"):
        return None
    return data


FUTURE_TOLERANCE_SEC = 300  # F7-27：未来时间戳容差（秒），容忍小幅时钟抖动，超出即判异常

def health_stale_reasons(health, now):
    """F6-24 陈旧判定 + F7-27 双侧化（纯函数）：health.month 须与当前 UTC 月
    一致；lastRunAt 距今 >3h 判陈旧，lastRunAt 在未来超过容差（300s）同样
    判异常（旧实现只查单侧，未来时间戳可假绿）。返回原因列表，空=新鲜。"""
    reasons = []
    month_str = (health.get("quota") or {}).get("month")
    if month_str != now.strftime("%Y-%m"):
        reasons.append(f"health.month={month_str} 与当前 UTC 月 {now.strftime('%Y-%m')} 不一致")
    last_run_raw = health.get("lastRunAt")
    try:
        last_run = datetime.fromisoformat(str(last_run_raw).replace("Z", "+00:00"))
        if last_run.tzinfo is None:
            last_run = last_run.replace(tzinfo=timezone.utc)
        age = (now - last_run).total_seconds()
        if age > 3 * 3600:
            reasons.append(f"lastRunAt={last_run_raw} 距今超过 3 小时")
        elif age < -FUTURE_TOLERANCE_SEC:
            reasons.append(f"lastRunAt={last_run_raw} 在未来 {-age:.0f} 秒，超过未来容差 {FUTURE_TOLERANCE_SEC} 秒（时钟漂移/异常时间戳，F7-27）")
    except Exception:
        reasons.append(f"lastRunAt 不可解析：{last_run_raw!r}")
    return reasons


def build_legacy_measured(counter, month_str):
    """F7-25（纯函数）：组装 legacyMeasured 记录字段。

    仅当计数键存在、month 与核账月一致、credits 为非负数、updatedAt 可解析
    且其年月与核账月一致时 available=True 并带真实值；跨月/陈旧/畸形任一
    情形 → available=False 且 credits/month/updatedAt 全部置空（None），
    只保留 available=false 与 reason——防只读 credits 的引用者把上月累计
    当本月实测引用（旧实现 available 按 month 判定、但三字段无条件取现值）。
    """
    base = {"key": LEGACY_CREDITS_KEY, "available": False, "month": None,
            "credits": None, "updatedAt": None, "reason": None,
            "note": "实测（board.js 回源计数键）；kv 模式不回源，部署后应恒为 0/无键。与建模 scenarios 并列，判级仍按 G3 口径、不回填已用。"}
    if not counter:
        base["reason"] = "counter-missing：计数键不存在/读不到（部署前或恒 kv 形态属预期）"
        return base
    cmonth, credits, updated = counter.get("month"), counter.get("credits"), counter.get("updatedAt")
    if not isinstance(credits, (int, float)) or isinstance(credits, bool) or credits < 0 or not cmonth:
        base["reason"] = f"counter-malformed：计数键形态畸形（month={cmonth!r} credits={credits!r}）"
        return base
    if cmonth != month_str:
        base["reason"] = f"counter-cross-month：计数键 month={cmonth} 与核账月 {month_str} 不一致（跨月未重置/陈旧值，credits 已置空）"
        return base
    if updated is not None:
        try:
            up = datetime.fromisoformat(str(updated).replace("Z", "+00:00"))
            if up.tzinfo is None:
                up = up.replace(tzinfo=timezone.utc)
            if up.strftime("%Y-%m") != month_str:
                base["reason"] = f"counter-stale：计数键 updatedAt={updated} 不在核账月 {month_str} 内（陈旧值，credits 已置空）"
                return base
        except Exception:
            base["reason"] = f"counter-malformed：计数键 updatedAt 不可解析：{updated!r}"
            return base
    base.update({"available": True, "month": cmonth, "credits": credits, "updatedAt": updated})
    return base


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
    # F6-24 前置校验（F7-27 双侧化，逻辑在 health_stale_reasons）：health.month
    # 须与当前 UTC 月一致、lastRunAt 距今 ≤3 小时且不在未来超容差，否则核账
    # 失效——落一条带失效标记的记录并以退出码 3 收尾，不产出正常判级。
    stale_reasons = health_stale_reasons(health, now)
    if stale_reasons:
        rec = {"at": now.isoformat().replace("+00:00", "Z"), "tool": "quota-check",
               "scriptVersion": SCRIPT_VERSION, "methodology": METHODOLOGY,
               "verdict": "INVALID", "staleHealth": True,
               "note": "health 陈旧、核账失效：" + "；".join(stale_reasons)}
        try:
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except Exception as e:
            # F8-22：与正常路径同口径——写日志失败不得静默吞（旧实现 except: pass，
            # 恰在核账失效时失效记录无声丢失）。stderr 报错 + 同一退出码 3 收尾。
            print(f"quota-check: ERROR 写入 {LOG_PATH} 失败：{e}", file=sys.stderr)
        print(f"quota-check: ERROR health 陈旧、核账失效：{'；'.join(stale_reasons)}")
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

    # F6-07 G3 口径：kv 模式下 legacy 回源已退出服务路径，判级规划口径取 legacy=0
    # 场景（floor_all_hit）；576/1152 两场景保留为历史参考列、不参与判级。
    board_mode = read_board_mode(health)
    planning_key = "floor_all_hit" if board_mode == "kv" else PLANNING_KEY
    # W5 实测计量（与建模场景并列）：读计数键；F7-25 跨月/陈旧/畸形时
    # credits/month/updatedAt 置空、只留 available=false 与 reason（build_legacy_measured）。
    legacy_counter = read_legacy_credits()
    legacy_measured = build_legacy_measured(legacy_counter, month_str)
    plan = scenarios[planning_key]
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
    implied_max_legacy = round((MONTHLY_CAP - fetcher_used) / days_elapsed, 1)
    # 护栏旁注：实测上界已低于 576 时，规划场景（576/天）对已过时段已被实测证伪。
    planning_falsified = implied_max_legacy < 576
    verdict_note = ("护栏旁注：impliedMaxAvgLegacyPerDay=%s < 576，576/1152 规划场景对已过时段已被实测证伪（仅作历史参考列）" % implied_max_legacy) if planning_falsified else None
    record = {
        "at": now.isoformat().replace("+00:00", "Z"),
        "tool": "quota-check",
        "scriptVersion": SCRIPT_VERSION,
        "methodology": METHODOLOGY,
        "boardMode": board_mode,
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
        "planningScenario": planning_key,
        "legacyMeasured": legacy_measured,
        "planningScenarioFalsifiedByGuardrail": planning_falsified,
        "verdict": verdict,
        "verdictNote": verdict_note,
        "empiricalGuard": {
            "lastUpstreamStatus": health.get("lastUpstreamStatus"),
            "consecutiveFailures": health.get("consecutiveFailures"),
            "upstreamHealthy": upstream_ok,
            "maxLegacyElapsedConsistentWithHealth": MONTHLY_CAP - fetcher_used,
            "impliedMaxAvgLegacyPerDay": round((MONTHLY_CAP - fetcher_used) / days_elapsed, 1),
            "note": "上游仍 200 ⇒ 真实双路合计尚未撞顶，且 legacy 本月真实已耗 < cap − fetcher 实测（见 maxLegacyElapsedConsistentWithHealth，其日均上界见 impliedMaxAvgLegacyPerDay——弱上界，仅排除「场景速率自月初全额成立」一类与事实矛盾的读法）。场景值是估算区间，不得表述为实测消耗。legacy 侧实测计数（board.js 回源计数键 v1:meta:legacy-credits）已于 2026-11-23 经站长批准激活（W5），其实测值见 legacyMeasured 字段、与本场景估算并列；代码部署前/恒 kv 形态下该字段 available=false 属预期。",
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
