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

# (b) 数据一致性门禁：data/coins.json 与 public/data/coins.json 必须一致；
#     不一致时以 data/ 为准同步一份，再比一次；仍不一致则退出报错，禁止部署。
if ! cmp -s data/coins.json public/data/coins.json; then
  echo "[deploy] 两份 coins.json 不一致，以 data/coins.json 为准同步到 public/data/coins.json"
  cp data/coins.json public/data/coins.json
fi
if ! cmp -s data/coins.json public/data/coins.json; then
  echo "[deploy] 错误：同步后两份 coins.json 仍不一致，已中止部署。" >&2
  exit 1
fi
echo "[deploy] 数据一致性门禁通过（data/coins.json == public/data/coins.json）"

# (c) 用 package.json 锁定的 wrangler 版本部署（防 CLI 大版本漂移）
WRANGLER_VERSION="$(python3 -c "import json; print(json.load(open('package.json'))['devDependencies']['wrangler'])")"
echo "[deploy] 使用 wrangler@${WRANGLER_VERSION} 部署到项目 crypto-top200（branch=$BRANCH）"
npx "wrangler@${WRANGLER_VERSION}" pages deploy public --project-name crypto-top200 --branch "$BRANCH" --commit-dirty=true

# (d) 部署后冒烟：失败则非零退出，部署虽已上线但必须人工处理/回滚
echo "[deploy] 部署完成，开始冒烟：$BASE_URL"
if ! bash scripts/smoke.sh "$BASE_URL"; then
  echo "部署已上线但冒烟失败，需人工处理/回滚" >&2
  exit 1
fi
echo "[deploy] 冒烟通过，$ENV_NAME 部署完成：$BASE_URL"
