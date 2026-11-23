#!/usr/bin/env python3
"""check-shadow-health.py — W4-03 影子链新鲜度只读检查。

读 Cloudflare KV `v1:meta:health`（fetcher 每 run 自报的健康元数据），判定影子链是否活着：
  - lastSuccessAt 距今 ≤ 25 分钟（fetcher 节奏 10 分钟，容忍 2 个周期 + 抖动）
  - consecutiveFailures ≤ 2
两条都满足 → 退出 0（OK）；任一不满足 → 退出 1（影子链异常）；
读不到/解析失败 → 退出 2（检查本身失效，同样应告警）。

只读：只 GET KV，不写任何键；不调用 CoinGecko，零额度消耗。
凭证：从环境变量 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 读（由调用方在运行时注入，
本脚本不打印、不落盘任何凭证值）。F6-87：CLOUDFLARE_ACCOUNT_ID 为必填环境变量，
缺失即 fail-closed 退出 2（不再有字面量默认值）。由 cron top200-hc4-shadow-probe 每小时调用，
结果经 healthchecks HC4-top200-fetcher-shadow 报到（ping 由编排方走 hc_api.py 按名发送）。
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

# F6-87：账号 ID 改必填环境变量、缺失即 fail-closed（与 TOKEN 同口径）。
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
NAMESPACE_ID = "ad1b72702c5c4f229999bea5b118d1bc"  # BOARD_KV（与 wrangler.toml 公开值一致）
HEALTH_KEY = "v1:meta:health"
MAX_SUCCESS_AGE_SEC = 25 * 60
MAX_CONSEC_FAILURES = 2
FUTURE_TOLERANCE_SEC = 300  # F7-27：未来时间戳容差（秒），超出即判异常（双侧判定）


def judge(age_sec, consec):
    """新鲜度判定（纯函数，供单测/fixture）：age 过大、未来超容差、连续失败
    超限任一 → problems 非空。旧实现只查 age>上限单侧，lastSuccessAt 在
    未来时 age 为负直接 OK（F7-27 盲区）。"""
    problems = []
    if age_sec > MAX_SUCCESS_AGE_SEC:
        problems.append(f"lastSuccessAt 距今 {age_sec / 60:.1f} 分钟 > {MAX_SUCCESS_AGE_SEC // 60} 分钟")
    elif age_sec < -FUTURE_TOLERANCE_SEC:
        problems.append(f"lastSuccessAt 在未来 {-age_sec / 60:.1f} 分钟，超过未来容差 {FUTURE_TOLERANCE_SEC} 秒（时钟漂移/异常时间戳，F7-27）")
    if consec > MAX_CONSEC_FAILURES:
        problems.append(f"consecutiveFailures={consec} > {MAX_CONSEC_FAILURES}")
    return problems
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def parse_iso(s):
    # F6-29：naive（无时区）结果补 timezone.utc，避免与 aware now 相减抛 TypeError。
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


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


def main():
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        print("shadow-health: ERROR 未设置 CLOUDFLARE_API_TOKEN（由调用方运行时注入）")
        return 2
    if not ACCOUNT_ID:
        print("shadow-health: ERROR 未设置 CLOUDFLARE_ACCOUNT_ID（F6-87：必填环境变量，缺失即 fail-closed）")
        return 2
    # F6-28：以 REPO_ROOT 拼路径读 pin，与 cwd 无关；回退写死值时打印 WARN。
    try:
        pin = json.load(open(os.path.join(REPO_ROOT, "package.json")))["devDependencies"]["wrangler"]
    except Exception:
        pin = "4.159.0"
        print("shadow-health: WARN 无法从仓库 package.json 读取 wrangler pin，回退写死值 4.159.0")
    cmd = [
        "npx", f"wrangler@{pin}", "kv", "key", "get", HEALTH_KEY,
        "--namespace-id", NAMESPACE_ID, "--remote",
    ]
    env = dict(os.environ, CLOUDFLARE_ACCOUNT_ID=ACCOUNT_ID)
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=env, cwd=REPO_ROOT)
    except Exception as e:
        print(f"shadow-health: ERROR wrangler 调用异常：{e}")
        return 2
    raw = (out.stdout or "").strip()
    # wrangler 可能在 JSON 前打印警告行：从第一个 { 开始截取
    start = raw.find("{")
    if out.returncode != 0 or start < 0:
        cat = classify_error(out.stderr or raw)
        msg = f"shadow-health: ERROR KV 读取失败 rc={out.returncode} category={cat}"
        if os.environ.get("DEBUG"):
            msg += f" detail={sanitized_debug(out.stderr or raw)}"
        print(msg)
        return 2
    try:
        health = json.loads(raw[start:])
        last_success = parse_iso(health["lastSuccessAt"])
        consec = int(health.get("consecutiveFailures", 0))
        # F6-29：age 计算纳入 try，任何时间解析/计算异常都按「检查失效」退出 2，不抛 traceback。
        age = (datetime.now(timezone.utc) - last_success).total_seconds()
    except Exception as e:
        print(f"shadow-health: ERROR health 解析失败：{e}")
        return 2

    problems = judge(age, consec)
    summary = (
        f"lastRunAt={health.get('lastRunAt')} lastSuccessAt={health.get('lastSuccessAt')} "
        f"consecutiveFailures={consec} status={health.get('status')} "
        f"quotaCreditsUsedEst={(health.get('quota') or {}).get('creditsUsedEst')}"
    )
    if problems:
        print(f"shadow-health: FAIL {'; '.join(problems)} | {summary}")
        return 1
    print(f"shadow-health: OK age={age / 60:.1f}m | {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
