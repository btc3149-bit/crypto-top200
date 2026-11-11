#!/usr/bin/env bash
# deploy.sh — crypto-top200 唯一部署入口（Wrangler 直推，禁止控制台拖放：拖放不编译 functions/）
# 用法：bash scripts/deploy.sh [preview|production]
#   preview    → wrangler pages deploy public --branch preview，部署后冒烟 https://preview.crypto-top200.pages.dev
#   production → wrangler pages deploy public --branch main，部署后冒烟 https://top200.oppcal.com
# 前置：已通过受限 API Token 配置 wrangler 凭证（CLOUDFLARE_API_TOKEN，Token 只授 Account → Cloudflare Pages → Edit）。
# 本脚本只允许触碰 crypto-top200 这一个项目。
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  preview)
    BRANCH="preview"
    BASE_URL="https://preview.crypto-top200.pages.dev"
    ;;
  production)
    BRANCH="main"
    BASE_URL="https://top200.oppcal.com"
    ;;
  *)
    echo "用法：bash scripts/deploy.sh [preview|production]" >&2
    exit 2
    ;;
esac

# (a) cd 项目根（脚本位于 scripts/ 下）
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"
echo "[deploy] 环境=$ENV_NAME 分支=$BRANCH 项目根=$PROJECT_ROOT"

# (b) 数据一致性门禁（v2）：只验不改。不一致即中止，同步是 build.py 的职责。
SRC_HASH="$(sha256sum data/coins.json | cut -d' ' -f1)"
OUT_HASH="$(sha256sum public/data/coins.json | cut -d' ' -f1)"
if [ "$SRC_HASH" != "$OUT_HASH" ]; then
  echo "[deploy] 错误：public/data/coins.json 与源 data/coins.json 哈希不一致。" >&2
  echo "[deploy] 请先运行 python3 scripts/build.py --emit（或完整构建）生成产物，禁止手改 public/ 副本。" >&2
  exit 1
fi
# 与 meta 内嵌 dataHash 对账（防「两份一起被手改成另一份错数据」）
if [ "${DEPLOY_SKIP_META_CHECK:-0}" = "1" ]; then
  echo "[deploy] 警告：DEPLOY_SKIP_META_CHECK=1 已设置，跳过 check_meta 对账（留痕通道：请在 CHANGELOG 该行注明绕过原因）"
else
  python3 scripts/check_meta.py data/coins.json || exit 1
fi
echo "[deploy] 数据门禁通过 sha256=$SRC_HASH"

# (b2) W2-18 安全头一致性门禁：public/_headers 必须与当前 index.html 的生成结果一致。
# 不一致即中止部署——先运行 node ops/headers/gen-headers.mjs 重新生成，禁止手改 public/_headers。
if ! node ops/headers/gen-headers.mjs --check --variant=on; then  # WA-ON：2026-11-11 U7 签收后启用统计，变体与开关状态同发版（W2-18 §18.4）
  echo "[deploy] 错误：public/_headers 与 index.html 不一致，请先运行 node ops/headers/gen-headers.mjs --variant=on 重新生成后再部署。" >&2
  exit 1
fi
echo "[deploy] W2-18 _headers --check 通过"

# (b3) W2-01 fetcher 数据一致性门禁：workers/fetcher/coins.json 的 meta.dataHash 必须与 data/coins.json 一致
# （只比 dataHash 不比字节：meta.generatedAt 允许不同）。不一致即中止——同步动作：cp data/coins.json workers/fetcher/coins.json，
# 按 docs/fetcher-runbook.md 重生成 src/coins-list.js，并单独部署 fetcher（npx wrangler deploy -c workers/fetcher/wrangler.toml，不与 Pages 连推）。
if ! python3 -c "import json,sys; a=json.load(open('data/coins.json'))['meta']['dataHash']; b=json.load(open('workers/fetcher/coins.json'))['meta']['dataHash']; sys.exit(0 if a==b else 1)"; then
  echo "[deploy] 错误：workers/fetcher/coins.json 与 data/coins.json 的 dataHash 不一致，请先同步 fetcher 数据副本并重生成 coins-list.js（见 docs/fetcher-runbook.md）。" >&2
  exit 1
fi
echo "[deploy] W2-01 fetcher 数据门禁通过"

# (c) 用 package.json 锁定的 wrangler 版本部署（防 CLI 大版本漂移）
WRANGLER_VERSION="$(python3 -c "import json; print(json.load(open('package.json'))['devDependencies']['wrangler'])")"
echo "[deploy] 使用 wrangler@${WRANGLER_VERSION} 部署到项目 crypto-top200（branch=$BRANCH）"
npx "wrangler@${WRANGLER_VERSION}" pages deploy public --project-name crypto-top200 --branch "$BRANCH" --commit-dirty=true

# (d) 部署后冒烟：失败则非零退出，部署虽已上线但必须人工处理/回滚
# W2-13/HC2：冒烟结果同步 ping healthchecks（HEALTHCHECKS_DEPLOY_PING_URL 未设置时 hc_ping.sh 打印 skipped-no-url 并以 0 退出，不阻断部署）。
echo "[deploy] 部署完成，开始冒烟：$BASE_URL"
if ! bash scripts/smoke.sh "$BASE_URL"; then
  bash scripts/hc_ping.sh fail || true
  echo "部署已上线但冒烟失败，需人工处理/回滚" >&2
  exit 1
fi
bash scripts/hc_ping.sh success || true
echo "[deploy] 冒烟通过，$ENV_NAME 部署完成：$BASE_URL"
