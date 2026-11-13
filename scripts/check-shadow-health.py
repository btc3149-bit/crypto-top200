#!/usr/bin/env python3
"""check-shadow-health.py — W4-03 影子链新鲜度只读检查。

读 Cloudflare KV `v1:meta:health`（fetcher 每 run 自报的健康元数据），判定影子链是否活着：
  - lastSuccessAt 距今 ≤ 25 分钟（fetcher 节奏 10 分钟，容忍 2 个周期 + 抖动）
  - consecutiveFailures ≤ 2
两条都满足 → 退出 0（OK）；任一不满足 → 退出 1（影子链异常）；
读不到/解析失败 → 退出 2（检查本身失效，同样应告警）。

只读：只 GET KV，不写任何键；不调用 CoinGecko，零额度消耗。
凭证：从环境变量 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 读（由调用方在运行时注入，
本脚本不打印、不落盘任何凭证值）。由 cron top200-hc4-shadow-probe 每小时调用，
结果经 healthchecks HC4-top200-fetcher-shadow 报到（ping 由编排方走 hc_api.py 按名发送）。
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "e6eae7d19e653edfedb12f4bb5e0227d")
NAMESPACE_ID = "ad1b72702c5c4f229999bea5b118d1bc"  # BOARD_KV（与 wrangler.toml 定版一致）
HEALTH_KEY = "v1:meta:health"
MAX_SUCCESS_AGE_SEC = 25 * 60
MAX_CONSEC_FAILURES = 2


def parse_iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main():
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        print("shadow-health: ERROR 未设置 CLOUDFLARE_API_TOKEN（由调用方运行时注入）")
        return 2
    try:
        pin = json.load(open("package.json"))["devDependencies"]["wrangler"]
    except Exception:
        pin = "4.159.0"
    cmd = [
        "npx", f"wrangler@{pin}", "kv", "key", "get", HEALTH_KEY,
        "--namespace-id", NAMESPACE_ID, "--remote",
    ]
    env = dict(os.environ, CLOUDFLARE_ACCOUNT_ID=ACCOUNT_ID)
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=env)
    except Exception as e:
        print(f"shadow-health: ERROR wrangler 调用异常：{e}")
        return 2
    raw = (out.stdout or "").strip()
    # wrangler 可能在 JSON 前打印警告行：从第一个 { 开始截取
    start = raw.find("{")
    if out.returncode != 0 or start < 0:
        print(f"shadow-health: ERROR KV 读取失败 rc={out.returncode}: {(out.stderr or raw)[:300]}")
        return 2
    try:
        health = json.loads(raw[start:])
        last_success = parse_iso(health["lastSuccessAt"])
        consec = int(health.get("consecutiveFailures", 0))
    except Exception as e:
        print(f"shadow-health: ERROR health 解析失败：{e}")
        return 2

    age = (datetime.now(timezone.utc) - last_success).total_seconds()
    problems = []
    if age > MAX_SUCCESS_AGE_SEC:
        problems.append(f"lastSuccessAt 距今 {age / 60:.1f} 分钟 > {MAX_SUCCESS_AGE_SEC // 60} 分钟")
    if consec > MAX_CONSEC_FAILURES:
        problems.append(f"consecutiveFailures={consec} > {MAX_CONSEC_FAILURES}")
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
