#!/usr/bin/env bash
# run-tests.sh — W4-04 全量测试入口：一条命令跑全部测试套件（node 与 python 混合）。
# 用法：bash scripts/run-tests.sh（或 npm test）。可在任意 cwd 调用，脚本自定位项目根。
# 语义：6 套全部执行（不因先失败而跳过后续套件，便于一次看全失败面）；
#       任一失败 → 汇总点名失败套件并以非零退出（fail-closed，供 deploy.sh 测试门禁调用）。
# 套件清单（与 tests/ 现状一一对应，新增套件时在此登记一行）：
#   board            node    tests/board.test.mjs
#   board-v2         node    tests/board-v2.test.mjs
#   board-fetcher    node    tests/board-fetcher.test.mjs
#   fetcher-branches node    tests/fetcher-branches.test.mjs
#   snapshot-verify  node    tests/snapshot-verify.mjs
#   render-snapshot  python3 tests/test_render_snapshot.py
set -uo pipefail

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

TMPDIR_RUN="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_RUN"' EXIT

SUITE_NAMES=()
SUITE_CMDS=()
SUITE_NAMES+=("board");            SUITE_CMDS+=("node tests/board.test.mjs")
SUITE_NAMES+=("board-v2");         SUITE_CMDS+=("node tests/board-v2.test.mjs")
SUITE_NAMES+=("board-fetcher");    SUITE_CMDS+=("node tests/board-fetcher.test.mjs")
SUITE_NAMES+=("fetcher-branches"); SUITE_CMDS+=("node tests/fetcher-branches.test.mjs")
SUITE_NAMES+=("snapshot-verify");  SUITE_CMDS+=("node tests/snapshot-verify.mjs")
SUITE_NAMES+=("render-snapshot");  SUITE_CMDS+=("python3 tests/test_render_snapshot.py")

echo "[test] 项目根=$PROJECT_ROOT 套件数=${#SUITE_NAMES[@]}"
OVERALL_START=$SECONDS
FAILED_SUITES=()
TOTAL_PASSED=0
TOTAL_TESTS=0
TOTAL_KNOWN=0

for i in "${!SUITE_NAMES[@]}"; do
  name="${SUITE_NAMES[$i]}"
  cmd="${SUITE_CMDS[$i]}"
  log="$TMPDIR_RUN/$name.log"
  start=$SECONDS
  echo "[test] --- 运行套件 $name：$cmd"
  # shellcheck disable=SC2086 # cmd 为脚本内写死的套件命令，故意按词拆分执行
  if $cmd >"$log" 2>&1; then
    status="PASS"
  else
    status="FAIL"
    FAILED_SUITES+=("$name")
  fi
  cat "$log"
  # 汇总各套件自报的「通过/总数」：node 套件打印 "=== X/Y passed ===" 或 "name: X/Y PASS"，
  # python 套件打印 "name: X/Y PASS"；取日志中最后一个匹配。
  counts="$(grep -oE '[0-9]+/[0-9]+ (passed|PASS)' "$log" | tail -n 1 | grep -oE '[0-9]+/[0-9]+' || true)"
  if [ -n "$counts" ]; then
    p="${counts%/*}"; t="${counts#*/}"
    TOTAL_PASSED=$((TOTAL_PASSED + p)); TOTAL_TESTS=$((TOTAL_TESTS + t)); TOTAL_KNOWN=$((TOTAL_KNOWN + 1))
    echo "[test] --- 套件 $name：$status（自报 $p/$t，耗时 $((SECONDS - start))s）"
  else
    echo "[test] --- 套件 $name：$status（未解析到自报计数，耗时 $((SECONDS - start))s）"
  fi
done

echo "[test] ===== 汇总 ====="
if [ "$TOTAL_KNOWN" -eq "${#SUITE_NAMES[@]}" ]; then
  echo "[test] 用例总数：$TOTAL_PASSED/$TOTAL_TESTS 通过（${#SUITE_NAMES[@]} 套）"
else
  echo "[test] 用例总数：已解析 $TOTAL_KNOWN/${#SUITE_NAMES[@]} 套自报计数，合计 $TOTAL_PASSED/$TOTAL_TESTS（计数不全，以套件退出码为准）"
fi
echo "[test] 总耗时：$((SECONDS - OVERALL_START))s"
if [ "${#FAILED_SUITES[@]}" -gt 0 ]; then
  echo "[test] 失败套件：${FAILED_SUITES[*]}" >&2
  echo "[test] 结论：FAIL（fail-closed）" >&2
  exit 1
fi
echo "[test] 结论：PASS（全部 ${#SUITE_NAMES[@]} 套通过）"
exit 0
