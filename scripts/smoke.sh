#!/usr/bin/env bash
# smoke.sh — P0-2 部署冒烟断言（固化版，与 §6.2 探针同源）
# 用法：bash scripts/smoke.sh [基址]（默认 https://top200.oppcal.com）
# 断言（任一失败 → 非零退出并打印失败项；全部通过 → 逐项打印 PASS）：
#   1. GET /api/board 返回 200 且 Content-Type 含 application/json
#   2. /api/board body 可解析为 JSON 且含 keys：coins、updatedAt、coverage
#   3. /api/board body 不含 "<!DOCTYPE html"（负向断言，防 HTML 冒充接口——2026-11-10 故障形态）
#   4. coverage.returned 与币数一致性：returned ≥ 期望数 × passRatio（期望数 = 基址 /data/coins.json 的 coins 长度；
#      passRatio 自 shared/health-thresholds.json 读，W4-06 定版 1.0，即 returned 必须等于期望数，
#      与 /api/health 同口径，不再保留旧 94% 容忍——门禁不得比监控松，见 ops/health-thresholds.md）
#   5. GET / 返回 200 且含 "市值前 200 币种" 字样
#   6. GET /data/coins.json 返回 200 且 JSON 可解析
set -uo pipefail

BASE="${1:-https://top200.oppcal.com}"
BASE="${BASE%/}"
TMPDIR_SMOKE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SMOKE"' EXIT
FAILURES=0

# W4-06：覆盖率阈值与 health.js / probe.sh 共用同一口径源 shared/health-thresholds.json。
# 读不到 JSON 时 fail-closed 取 1.0（最严），绝不回退旧 94% 容忍。
REPO_ROOT_SMOKE="$(cd "$(dirname "$0")/.." && pwd)"
COVERAGE_PASS_RATIO="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1],encoding='utf-8'))['coverage']['passRatio'])" "$REPO_ROOT_SMOKE/shared/health-thresholds.json" 2>/dev/null || echo 1.0)"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }

fetch() {
  # $1=路径 $2=body 输出文件；打印 HTTP 状态码；响应头写入 $TMPDIR_SMOKE/last.headers
  curl -sS -m 30 -D "$TMPDIR_SMOKE/last.headers" -o "$2" -w "%{http_code}" "${BASE}$1" 2>"$TMPDIR_SMOKE/curl.err" || echo "000"
}

# ---- 拉取三个端点 ----
BOARD_BODY="$TMPDIR_SMOKE/board.json"
BOARD_CODE="$(fetch /api/board "$BOARD_BODY")"
cp "$TMPDIR_SMOKE/last.headers" "$TMPDIR_SMOKE/board.headers" 2>/dev/null || true

HOME_BODY="$TMPDIR_SMOKE/home.html"
HOME_CODE="$(fetch / "$HOME_BODY")"

DATA_BODY="$TMPDIR_SMOKE/coins.json"
DATA_CODE="$(fetch /data/coins.json "$DATA_BODY")"

# ---- 断言 1：状态码 + Content-Type ----
BOARD_CT="$(grep -i '^content-type:' "$TMPDIR_SMOKE/board.headers" 2>/dev/null | tr -d '\r' || true)"
if [ "$BOARD_CODE" = "200" ] && echo "$BOARD_CT" | grep -qi 'application/json'; then
  pass "① /api/board 返回 200 且 Content-Type 含 application/json（实际：$BOARD_CT）"
else
  fail "① /api/board 期望 200 + application/json，实际状态=$BOARD_CODE，$BOARD_CT"
fi

# ---- 断言 2：JSON 可解析且含 coins / updatedAt / coverage ----
if BOARD_KEYS="$(python3 - "$BOARD_BODY" <<'PY'
import json, sys
try:
    body = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception as e:
    print(f"UNPARSEABLE:{e}")
    sys.exit(0)
missing = [k for k in ("coins", "updatedAt", "coverage") if k not in body]
if missing:
    print("MISSING:" + ",".join(missing))
else:
    print("OK")
PY
)"; then :; fi
case "$BOARD_KEYS" in
  OK) pass "② /api/board body 为 JSON 且含 coins、updatedAt、coverage" ;;
  *)  fail "② /api/board body JSON/keys 校验失败（$BOARD_KEYS）" ;;
esac

# ---- 断言 3：负向断言，body 不含 <!DOCTYPE html ----
if python3 -c "import sys; sys.exit(0 if '<!doctype html' in open('$BOARD_BODY', encoding='utf-8', errors='ignore').read().lower() else 1)"; then
  fail "③ /api/board body 含 <!DOCTYPE html —— HTML 冒充接口（2026-11-10 故障形态复发）"
else
  pass "③ /api/board body 不含 <!DOCTYPE html"
fi

# ---- 断言 4：coverage.returned ≥ 期望币数（/data/coins.json 的 coins 长度）× passRatio（JSON 定版 1.0） ----
COVERAGE_RESULT="$(python3 - "$BOARD_BODY" "$DATA_BODY" "$COVERAGE_PASS_RATIO" <<'PY'
import json, sys
try:
    expected = len(json.load(open(sys.argv[2], encoding="utf-8"))["coins"])
except Exception as e:
    print(f"SKIP:期望数不可得（/data/coins.json 解析失败：{e}）")
    sys.exit(0)
try:
    board = json.load(open(sys.argv[1], encoding="utf-8"))
    returned = board["coverage"]["returned"]
except Exception as e:
    print(f"FAIL:coverage.returned 不可得（{e}）；期望币数={expected}")
    sys.exit(0)
ratio = float(sys.argv[3])
threshold = expected * ratio
if returned >= threshold:
    print(f"OK:returned={returned} 期望={expected} 阈值(passRatio={ratio})={threshold:.1f}")
else:
    print(f"FAIL:returned={returned} < 期望 {expected} × passRatio {ratio}（{threshold:.1f}）")
PY
)"
case "$COVERAGE_RESULT" in
  OK:*)   pass "④ coverage 一致性（$COVERAGE_RESULT）" ;;
  SKIP:*) fail "④ coverage 一致性无法校验（$COVERAGE_RESULT）" ;;
  *)      fail "④ coverage 一致性（$COVERAGE_RESULT）" ;;
esac

# ---- 断言 5：首页 200 且含标题关键字 ----
if [ "$HOME_CODE" = "200" ] && grep -q "市值前 200 币种" "$HOME_BODY"; then
  pass "⑤ GET / 返回 200 且含「市值前 200 币种」"
else
  fail "⑤ GET / 期望 200 且含「市值前 200 币种」，实际状态=$HOME_CODE"
fi

# ---- 断言 6：/data/coins.json 200 且 JSON 可解析 ----
if [ "$DATA_CODE" = "200" ] && python3 -c "import json; json.load(open('$DATA_BODY', encoding='utf-8'))" 2>/dev/null; then
  pass "⑥ GET /data/coins.json 返回 200 且 JSON 可解析"
else
  fail "⑥ GET /data/coins.json 期望 200 且 JSON 可解析，实际状态=$DATA_CODE"
fi

# ---- 汇总 ----
if [ "$FAILURES" -gt 0 ]; then
  echo "SMOKE FAILED: $BASE 共 $FAILURES 项断言失败" >&2
  exit 1
fi
echo "SMOKE OK: $BASE 全部断言通过"
