#!/usr/bin/env bash
# run-tests.sh — 统一测试入口（F6-01/F6-80）：串联全部测试套件，任一非零即整体失败。
# 用法：bash scripts/run-tests.sh（或 npm test）
#
# 套件清单集中定义于下方 SUITES 数组（唯一台账）：
#   条目格式 "<runner>:<相对路径>"，runner ∈ node|python3。
#   新增套件时只改这一处（第六期其他施工员新增的 health/quota/compare/coins-list
#   等套件由协调人在集成时补入本清单，见 P6_NOTES.md）。
set -uo pipefail
cd "$(dirname "$0")/.."

SUITES=(
  "node:tests/board.test.mjs"
  "node:tests/board-v2.test.mjs"
  "node:tests/board-fetcher.test.mjs"
  "node:tests/fetcher-branches.test.mjs"
  "node:tests/frontend-dom.test.mjs"
  "node:tests/contract-real-data.test.mjs"
  "node:tests/snapshot-verify.mjs"
  "node:tests/health.test.mjs"
  "node:tests/kv-write-guard.test.mjs"
  "node:tests/legacy-credits.test.mjs"
  "node:tests/coins-list-contract.test.mjs"
  "node:tests/compare-shadow.test.mjs"
  "node:tests/wrangler-pinned.test.mjs"
  "node:tests/audit-deps.test.mjs"
  "python3:tests/test_render_snapshot.py"
  "python3:tests/weekly_check_test.py"
  "python3:tests/quota_check_test.py"
)

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
