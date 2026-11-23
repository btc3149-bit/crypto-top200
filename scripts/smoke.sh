#!/usr/bin/env bash
# smoke.sh — P0-2 部署冒烟断言（固化版，与 §6.2 探针同源）
# 用法：bash scripts/smoke.sh [基址] [production|preview]（默认基址 https://top200.oppcal.com、模式 production）
# F7-04 模式分流：preview 按 README 定版定位只做静态/UI 冒烟（断言 ⑤⑥），
#   不要求 /api/board v2 成功（preview 不注入 CoinGecko key、board 必然 stale/503），
#   board 相关断言 ①②③④⑦⑧ 整组跳过并逐项打印 SKIP；production 维持全量断言。
# 断言（任一失败 → 非零退出并打印失败项；全部通过 → 逐项打印 PASS）：
#   1. GET /api/board 返回 200 且 Content-Type 含 application/json
#   2. /api/board body 可解析为 JSON 且含 keys：coins、updatedAt、coverage
#   3. /api/board body 不含 "<!DOCTYPE html"（负向断言，防 HTML 冒充接口——2026-11-10 故障形态）
#   4. coverage.returned 与币数一致性：returned ≥ 期望数的 94%（期望数 = 基址 /data/coins.json 的 coins 长度）
#   5. GET / 返回 200 且含 "市值前 200 币种" 字样
#   6. GET /data/coins.json 返回 200 且 JSON 可解析
#   7.（F6-06）/api/board freshness.servedFrom ∈ {kv, cache, memory}
#   8.（F6-27）v2 契约字段：contractVersion===2、freshness 与 fetch.fetchRunId 存在、coverage.returned 与 coins 键数一致
set -uo pipefail

BASE="${1:-https://top200.oppcal.com}"
BASE="${BASE%/}"
MODE="${2:-production}"
case "$MODE" in
  production|preview) ;;
  *) echo "用法：bash scripts/smoke.sh [基址] [production|preview]" >&2; exit 2 ;;
esac
TMPDIR_SMOKE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SMOKE"' EXIT
FAILURES=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }
skip() { echo "SKIP: $1"; }

fetch() {
  # $1=路径 $2=body 输出文件；打印 HTTP 状态码；响应头写入 $TMPDIR_SMOKE/last.headers
  curl -sS -m 30 -D "$TMPDIR_SMOKE/last.headers" -o "$2" -w "%{http_code}" "${BASE}$1" 2>"$TMPDIR_SMOKE/curl.err" || echo "000"
}

# ---- 拉取端点（preview 不拉 /api/board：其 stale/503 为定版预期，不作断言输入） ----
BOARD_BODY="$TMPDIR_SMOKE/board.json"
BOARD_CODE="SKIP"
if [ "$MODE" = "production" ]; then
  BOARD_CODE="$(fetch /api/board "$BOARD_BODY")"
  cp "$TMPDIR_SMOKE/last.headers" "$TMPDIR_SMOKE/board.headers" 2>/dev/null || true
else
  : > "$BOARD_BODY"
  echo "[smoke] 模式=preview：仅静态/UI 子集（⑤⑥），/api/board 相关断言整组跳过（F7-04）"
fi

HOME_BODY="$TMPDIR_SMOKE/home.html"
HOME_CODE="$(fetch / "$HOME_BODY")"

DATA_BODY="$TMPDIR_SMOKE/coins.json"
DATA_CODE="$(fetch /data/coins.json "$DATA_BODY")"

if [ "$MODE" = "preview" ]; then
  skip "①②③④⑦⑧ /api/board 相关断言（preview 定版不验 board，见 README preview 定位）"
else
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

# ---- 断言 4：coverage.returned ≥ 期望币数（/data/coins.json 的 coins 长度）的 94% ----
COVERAGE_RESULT="$(python3 - "$BOARD_BODY" "$DATA_BODY" <<'PY'
import json, sys
try:
    _d = json.load(open(sys.argv[2], encoding="utf-8"))
    expected = len(_d.get("coins") or _d.get("rows") or [])
except Exception as e:
    print(f"SKIP:期望数不可得（/data/coins.json 解析失败：{e}）")
    sys.exit(0)
try:
    board = json.load(open(sys.argv[1], encoding="utf-8"))
    returned = board["coverage"]["returned"]
except Exception as e:
    print(f"FAIL:coverage.returned 不可得（{e}）；期望币数={expected}")
    sys.exit(0)
threshold = expected * 0.94
if returned >= threshold:
    print(f"OK:returned={returned} 期望={expected} 阈值(94%)={threshold:.1f}")
else:
    print(f"FAIL:returned={returned} < 期望 {expected} 的 94%（{threshold:.1f}）")
PY
)"
case "$COVERAGE_RESULT" in
  OK:*)   pass "④ coverage 一致性（$COVERAGE_RESULT）" ;;
  SKIP:*) fail "④ coverage 一致性无法校验（$COVERAGE_RESULT）" ;;
  *)      fail "④ coverage 一致性（$COVERAGE_RESULT）" ;;
esac

# ---- 断言 7（F6-06）：/api/board freshness.servedFrom ∈ {kv, cache, memory} ----
SERVED_RESULT="$(python3 - "$BOARD_BODY" <<'PY'
import json, sys
try:
    body = json.load(open(sys.argv[1], encoding="utf-8"))
    sf = (body.get("freshness") or {}).get("servedFrom")
except Exception as e:
    print(f"FAIL:board JSON 解析失败（{e}）"); sys.exit(0)
if sf in ("kv", "cache", "memory"):
    print(f"OK:servedFrom={sf}")
else:
    print(f"FAIL:servedFrom={sf!r} 不在 {{kv, cache, memory}}（模式可能已回落 legacy/snapshot）")
PY
)"
case "$SERVED_RESULT" in
  OK:*) pass "⑦ servedFrom 断言（$SERVED_RESULT）" ;;
  *)    fail "⑦ servedFrom 断言（$SERVED_RESULT）" ;;
esac

# ---- 断言 8（F6-27）：v2 契约字段（contractVersion/freshness/fetchRunId/coverage 与 coins 键数一致） ----
V2_RESULT="$(python3 - "$BOARD_BODY" <<'PY'
import json, sys
try:
    body = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception as e:
    print(f"FAIL:board JSON 解析失败（{e}）"); sys.exit(0)
problems = []
if body.get("contractVersion") != 2:
    problems.append(f"contractVersion={body.get('contractVersion')!r}!=2")
if "freshness" not in body:
    problems.append("freshness 字段缺失")
fetch = body.get("fetch") or {}
if "fetchRunId" not in fetch:
    problems.append("fetch.fetchRunId 字段缺失")
coins = body.get("coins") or {}
returned = (body.get("coverage") or {}).get("returned")
if returned != len(coins):
    problems.append(f"coverage.returned={returned} 与 coins 键数 {len(coins)} 不一致")
print("OK:v2 契约字段齐全且 coverage.returned 与 coins 键数一致" if not problems else "FAIL:" + "；".join(problems))
PY
)"
case "$V2_RESULT" in
  OK:*) pass "⑧ v2 契约字段断言（$V2_RESULT）" ;;
  *)    fail "⑧ v2 契约字段断言（$V2_RESULT）" ;;
esac

fi # /api/board 断言组（production）

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
  echo "SMOKE FAILED: $BASE（模式=$MODE）共 $FAILURES 项断言失败" >&2
  exit 1
fi
echo "SMOKE OK: $BASE（模式=$MODE）全部断言通过"
