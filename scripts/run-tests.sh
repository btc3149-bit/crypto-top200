#!/usr/bin/env bash
# run-tests.sh — 统一测试入口（F6-01/F6-80）：串联全部测试套件，任一非零即整体失败。
# 用法：bash scripts/run-tests.sh（或 npm test）
#
# 套件清单单一事实源（F7-32）：tests/suites-manifest.json（条目 {runner, path}，
# runner ∈ node|python3）。新增/删除套件只改 manifest；tests/suite-manifest.test.mjs
# 做 manifest ↔ tests/ 目录双向一致性断言，coverage-report.mjs 共用同一清单。
set -uo pipefail
cd "$(dirname "$0")/.."

mapfile -t SUITES < <(python3 -c "
import json
m = json.load(open('tests/suites-manifest.json', encoding='utf-8'))
for s in m['suites']:
    print(f\"{s['runner']}:{s['path']}\")
")
if [ "${#SUITES[@]}" -eq 0 ]; then
  echo "[test] 错误：tests/suites-manifest.json 未读出任何套件，拒绝以空集合假绿" >&2
  exit 1
fi

FAILED=()
for entry in "${SUITES[@]}"; do
  runner="${entry%%:*}"
  file="${entry#*:}"
  echo "===== [test] $runner $file ====="
  if "$runner" "$file"; then
    echo "[test] PASS $file"
  else
    echo "[test] FAIL $file" >&2
    FAILED+=("$file")
  fi
done

echo "===== [test] 汇总：$(( ${#SUITES[@]} - ${#FAILED[@]} ))/${#SUITES[@]} 套件通过 ====="
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '[test] 失败套件：%s\n' "${FAILED[*]}" >&2
  exit 1
fi
echo "[test] 全部套件通过"
