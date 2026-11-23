#!/usr/bin/env bash
# wrangler-pinned.sh — F7-45 统一锁版入口：所有人工运维 wrangler 命令都经此脚本执行。
#
# 为什么不用裸 `npx wrangler`：裸命令在未 npm install 的临时环境会拉取当时最新版，
# 不受 package.json pin 与 package-lock.json 保护；密钥注入（secret put）与 fetcher
# 部署恰是最高权、最可能在临时环境执行的操作（PHASE7_REVIEW.md F7-45）。
#
# 行为：
#   1. 从 package.json 的 devDependencies.wrangler 读 pin（唯一版本来源，禁止在本脚本硬编码版本）；
#   2. 若 package-lock.json 存在，校验 lockfile 中 wrangler 版本与 pin 一致，不一致即中止
#      （与 scripts/deploy.sh 的 W4-17 工具链预检同口径）；
#   3. 本地 node_modules/.bin/wrangler 存在且 --version 与 pin 一致时直接用本地二进制（离线可用）；
#      否则回退 `npx --yes wrangler@<pin>`（仍锁版，只是需联网拉取该确切版本）；
#   4. 其余全部参数原样透传给 wrangler。
#
# 测试覆盖点（tests/wrangler-pinned.test.mjs）：可用环境变量 WRANGLER_PINNED_LOCAL_BIN
# 指定一个本地 wrangler 二进制路径代替 node_modules/.bin/wrangler（脚本仍会校验其
# --version 与 pin 一致，不一致即拒绝使用），便于在未 npm install 的 worktree 里用
# 桩二进制验证透传行为。生产运维不要设置此变量。
#
# 用法示例：
#   bash scripts/wrangler-pinned.sh --version
#   bash scripts/wrangler-pinned.sh pages dev public
#   bash scripts/wrangler-pinned.sh pages secret put COINGECKO_API_KEY --project-name crypto-top200
#   bash scripts/wrangler-pinned.sh deploy -c workers/fetcher/wrangler.toml
set -euo pipefail
cd "$(dirname "$0")/.."

# F8-28 部署旁路拦截（Pages 侧硬拦 / fetcher 侧警告）：
# - `pages deploy` 只能由 scripts/deploy.sh 调用（deploy.sh 会设置 DEPLOY_VIA_DEPLOY_SH=1），
#   直调即报错——Pages 部署必须先过 deploy.sh 的测试/数据/一致性全部门禁。
# - fetcher 部署（`deploy -c workers/fetcher/...`）是已知豁口：不经 deploy.sh 测试门禁，
#   此处只打印醒目警告、不硬拦（保持现行运维路径可用），操作纪律见 docs/fetcher-runbook.md。
if [ "${1:-}" = "pages" ] && [ "${2:-}" = "deploy" ] && [ "${DEPLOY_VIA_DEPLOY_SH:-0}" != "1" ]; then
  echo "[wrangler-pinned] 拒绝：pages deploy 不得直调本入口绕过门禁。请改走：bash scripts/deploy.sh [preview|production]（F8-28）" >&2
  exit 2
fi
if [ "${1:-}" = "deploy" ]; then
  echo "[wrangler-pinned] *** 警告（F8-28 已知豁口）：fetcher 经本入口单独部署，不经 deploy.sh 的测试门禁；部署前请自行确认已跑 ./scripts/run-tests.sh 全绿。***" >&2
fi

if [ "$#" -eq 0 ]; then
  echo "用法：bash scripts/wrangler-pinned.sh <wrangler 参数...>（版本由 package.json pin 决定，参数原样透传）" >&2
  exit 2
fi

PIN="$(python3 - <<'PY'
import json, re, sys
try:
    pin = json.load(open("package.json"))["devDependencies"]["wrangler"]
except Exception as e:
    print(f"[wrangler-pinned] 无法从 package.json 读取 wrangler pin：{e}", file=sys.stderr)
    sys.exit(1)
pin = str(pin).strip().lstrip("^~>=< ")
if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", pin):
    print(f"[wrangler-pinned] package.json 的 wrangler pin 不是确切版本：{pin!r}，拒绝执行（须为精确版本，如 4.159.0）", file=sys.stderr)
    sys.exit(1)
print(pin)
PY
)"

# lockfile 一致性门禁（与 deploy.sh W4-17 同口径；lockfile 缺失时只警告不放行裸版——仍走 npx@pin）
if [ -f package-lock.json ]; then
  LOCKED="$(python3 - <<'PY'
import json
try:
    lock = json.load(open("package-lock.json"))
    print((lock.get("packages", {}).get("node_modules/wrangler", {}) or {}).get("version", ""))
except Exception:
    print("")
PY
)"
  if [ "$LOCKED" != "$PIN" ]; then
    echo "[wrangler-pinned] 工具链预检失败：wrangler pin=$PIN 与 lockfile=$LOCKED 不一致，请先 npm install 对齐后再执行。" >&2
    exit 1
  fi
else
  echo "[wrangler-pinned] 警告：package-lock.json 不存在，跳过 lockfile 一致性校验（仍按 pin=$PIN 锁版执行）。" >&2
fi

LOCAL_BIN="${WRANGLER_PINNED_LOCAL_BIN:-node_modules/.bin/wrangler}"
if [ -x "$LOCAL_BIN" ]; then
  LOCAL_VERSION="$("$LOCAL_BIN" --version 2>/dev/null | tr -d '[:space:]' || true)"
  if [ "$LOCAL_VERSION" = "$PIN" ]; then
    exec "$LOCAL_BIN" "$@"
  fi
  echo "[wrangler-pinned] 本地 wrangler 版本（${LOCAL_VERSION:-未知}）与 pin=$PIN 不一致，改走 npx wrangler@$PIN。" >&2
fi

exec npx --yes "wrangler@${PIN}" "$@"
