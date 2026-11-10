#!/usr/bin/env bash
# hc_ping.sh — W2-13 / HC2（部署后检查）的 healthchecks.io ping 客户端
# 用法：bash scripts/hc_ping.sh [success|fail]（默认 success）
#
# ping URL 等同密钥：只从环境变量 HEALTHCHECKS_DEPLOY_PING_URL 读取，
# 只存部署环境/保险箱，禁止写进仓库任何文件、禁止出现在日志里（本脚本不回显其值）。
# 未设置该变量时（例如 U3/账号尚未就绪的降级运行期）：打印 skipped-no-url 并以 0 退出，
# 不阻断部署管线。
#
# 接入方式（由协调者在 scripts/deploy.sh 尾部串联，本脚本不自改 deploy.sh）：
#   冒烟通过后调用 `bash scripts/hc_ping.sh success`，冒烟失败分支调用
#   `bash scripts/hc_ping.sh fail`；fail 时 ping 的是 "$HEALTHCHECKS_DEPLOY_PING_URL/fail"。
set -uo pipefail

RESULT="${1:-success}"
case "$RESULT" in
  success|fail) ;;
  *)
    echo "用法：bash scripts/hc_ping.sh [success|fail]" >&2
    exit 2
    ;;
esac

if [ -z "${HEALTHCHECKS_DEPLOY_PING_URL:-}" ]; then
  echo "hc_ping: skipped-no-url（HEALTHCHECKS_DEPLOY_PING_URL 未设置，降级运行，见 ops/probe-config.md）"
  exit 0
fi

PING_URL="$HEALTHCHECKS_DEPLOY_PING_URL"
case "$RESULT" in
  fail) PING_URL="${PING_URL}/fail" ;;
esac

if curl -fsS -m 10 --retry 3 -o /dev/null "$PING_URL"; then
  echo "hc_ping: $RESULT ping 已发出"
else
  echo "hc_ping: $RESULT ping 发送失败（不回显 URL，请检查部署环境变量与网络）" >&2
  exit 1
fi
