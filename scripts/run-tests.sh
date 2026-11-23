#!/usr/bin/env bash
# run-tests.sh — 统一测试入口（F6-01/F6-80）：串联全部测试套件，任一非零即整体失败。
# 用法：bash scripts/run-tests.sh（或 npm test）
#
# 套件清单单一事实源（F7-32）：tests/suites-manifest.json（条目 {runner, path, expectedPass}，
# runner ∈ node|python3）。新增/删除套件只改 manifest；tests/suite-manifest.test.mjs
# 做 manifest ↔ tests/ 目录双向一致性断言，coverage-report.mjs 共用同一清单。
#
# F8-32 计数总账：逐套件捕获输出、按 ^PASS 行计项数，与 manifest 登记的
# expectedPass 比对（不一致即该套件判失败），最后打印总账（实跑合计 vs 登记
# 合计自动加总，不再靠人工对表）。增删用例后只须同步改 manifest 的数字。
set -uo pipefail
cd "$(dirname "$0")/.."

mapfile -t SUITES < <(python3 -c "
import json
m = json.load(open('tests/suites-manifest.json', encoding='utf-8'))
for s in m['suites']:
    print(f\"{s['runner']}:{s['path']}:{s.get('expectedPass', '')}\")
")
if [ "${#SUITES[@]}" -eq 0 ]; then
  echo "[test] 错误：tests/suites-manifest.json 未读出任何套件，拒绝以空集合假绿" >&2
  exit 1
fi

FAILED=()
TOTAL_PASS=0
TOTAL_EXPECTED=0
TMPOUT="$(mktemp)"
trap 'rm -f "$TMPOUT"' EXIT
for entry in "${SUITES[@]}"; do
  runner="${entry%%:*}"
  rest="${entry#*:}"
  file="${rest%:*}"
  expected="${rest##*:}"
  echo "===== [test] $runner $file ====="
  "$runner" "$file" 2>&1 | tee "$TMPOUT"
  rc="${PIPESTATUS[0]}"
  count="$(grep -cE '^PASS([[:space:]:]|$)' "$TMPOUT" || true)"
  TOTAL_PASS=$((TOTAL_PASS + count))
  if [ -n "$expected" ]; then
    TOTAL_EXPECTED=$((TOTAL_EXPECTED + expected))
    echo "[test] 项数 $file：PASS 行 $count / 登记期望 expectedPass=$expected"
    if [ "$count" != "$expected" ]; then
      echo "[test] 错误：$file 实跑 PASS 行 $count 与 manifest 登记 $expected 不一致（增删项须同步改 manifest，F8-32）" >&2
      rc=1
    fi
  else
    echo "[test] 项数 $file：PASS 行 $count（未登记 expectedPass，跳过比对）"
  fi
  if [ "$rc" -eq 0 ]; then
    echo "[test] PASS $file"
  else
    echo "[test] FAIL $file" >&2
    FAILED+=("$file")
  fi
done

echo "===== [test] 汇总：$(( ${#SUITES[@]} - ${#FAILED[@]} ))/${#SUITES[@]} 套件通过 ====="
echo "[test] 总账：PASS 行合计 $TOTAL_PASS / 登记期望合计 $TOTAL_EXPECTED（F8-32，自动加总）"
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '[test] 失败套件：%s\n' "${FAILED[*]}" >&2
  exit 1
fi
echo "[test] 全部套件通过"
