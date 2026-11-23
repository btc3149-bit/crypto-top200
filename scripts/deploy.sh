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

# (a0) F6-01/F6-26 绕过留痕：所有 DEPLOY_SKIP_*/DEPLOY_ALLOW_* 绕过必须带
# DEPLOY_SKIP_REASON 且自动追加 ops/deploy-log.jsonl，无理由一律拒绝。
# F7-20：除本地 deploy-log 外，同一事件再追加一份「可入版本控制的脱敏审计」
# ops/deploy-audit.jsonl（.gitignore 已为例外放行该文件；其余 ops/*.jsonl
# 仍被忽略）。审计记录只含时间/门禁名/环境/脱敏后原因：原因先做秘密形态
# 脱敏（长 hex、token/secret/password/key=值形态一律打码）并截断 200 字，
# 绝不记录任何秘密值。部署完成后脚本会提示把审计文件一并 commit。
deploy_log() { # $1=门禁名 $2=原因
  python3 - "$1" "$2" "$ENV_NAME" <<'PYEOF'
import json, re, sys
from datetime import datetime, timezone
gate, reason, env = sys.argv[1], sys.argv[2], sys.argv[3]
at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
rec = {"at": at, "gate": gate, "reason": reason, "env": env}
with open("ops/deploy-log.jsonl", "a", encoding="utf-8") as f:
    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
def sanitize(s):
    s = re.sub(r"\b[0-9a-fA-F]{32,}\b", "<redacted-hex>", s or "")
    s = re.sub(r"(?i)(token|secret|password|passwd|api[-_ ]?key|bearer)\s*[:=]\s*\S+", r"\1=<redacted>", s)
    s = re.sub(r"(?i)bearer\s+\S+", "Bearer <redacted>", s)
    return s[:200]
audit = {"at": at, "gate": gate, "env": env,
         "event": "gate_bypass" if gate.startswith("DEPLOY_") else "gate_event",
         "reason": sanitize(reason)}
try:
    with open("ops/deploy-audit.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(audit, ensure_ascii=False) + "\n")
except Exception as e:
    print(f"[deploy] 警告：审计文件 ops/deploy-audit.jsonl 写入失败：{e}", file=sys.stderr)
PYEOF
  echo "[deploy] 审计留痕：ops/deploy-audit.jsonl 已追加（脱敏、可入版本控制）——部署后请将该文件随本次部署一并 git add/commit，否则审计链仍只在本机。"
}
require_bypass_reason() { # $1=绕过变量名
  if [ -z "${DEPLOY_SKIP_REASON:-}" ]; then
    echo "[deploy] 错误：$1 已设置但 DEPLOY_SKIP_REASON 为空，拒绝无理由绕过门禁。" >&2
    exit 1
  fi
  deploy_log "$1" "$DEPLOY_SKIP_REASON"
  echo "[deploy] 警告：$1 绕过已留痕 ops/deploy-log.jsonl（原因：$DEPLOY_SKIP_REASON）"
}

# (a1) F6-01 测试门禁：数据门禁之前先跑全量测试，失败即中止。
if [ "${DEPLOY_SKIP_TESTS:-0}" = "1" ]; then
  require_bypass_reason "DEPLOY_SKIP_TESTS"
else
  echo "[deploy] 运行全量测试门禁（npm test）…"
  if ! npm test; then
    echo "[deploy] 错误：测试未全绿，中止部署（绕过须 DEPLOY_SKIP_TESTS=1 + DEPLOY_SKIP_REASON，且会落 deploy-log）。" >&2
    exit 1
  fi
  echo "[deploy] 测试门禁通过"
fi

# (a1b) F6-01 脏工作区门禁：默认中止；DEPLOY_ALLOW_DIRTY=1 + 理由 + 落 log 才放行。
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  if [ "${DEPLOY_ALLOW_DIRTY:-0}" = "1" ]; then
    require_bypass_reason "DEPLOY_ALLOW_DIRTY"
  else
    echo "[deploy] 错误：工作区有未提交改动，默认中止部署（放行须 DEPLOY_ALLOW_DIRTY=1 + DEPLOY_SKIP_REASON，且会落 deploy-log）。" >&2
    git status --porcelain >&2 || true
    exit 1
  fi
fi

# (a1c) F6-06 模式门禁：production 的 wrangler.toml [vars] BOARD_READ_MODE 必须为 kv。
BOARD_MODE="$(python3 - <<'PYEOF'
import re, sys
try:
    text = open("wrangler.toml", encoding="utf-8").read()
except Exception:
    print(""); sys.exit(0)
m = re.search(r"(?m)^\[vars\][ \t]*\n(.*?)(?=^\[|\Z)", text, re.S)
sec = m.group(1) if m else ""
mm = re.search(r'BOARD_READ_MODE\s*=\s*"([^"]*)"', sec)
print(mm.group(1) if mm else "")
PYEOF
)"
if [ "$ENV_NAME" = "production" ]; then
  if [ "$BOARD_MODE" != "kv" ]; then
    if [ "${DEPLOY_ALLOW_MODE_OVERRIDE:-0}" = "1" ]; then
      require_bypass_reason "DEPLOY_ALLOW_MODE_OVERRIDE"
    else
      echo "[deploy] 错误：模式门禁失败：production 期望 BOARD_READ_MODE=kv，wrangler.toml [vars] 实际='${BOARD_MODE:-<未设置>}'，中止部署（放行须 DEPLOY_ALLOW_MODE_OVERRIDE=1 + DEPLOY_SKIP_REASON，且会落 deploy-log）。" >&2
      exit 1
    fi
  fi
  echo "[deploy] 模式门禁通过（BOARD_READ_MODE=kv）"
fi

# (a2) W4-17 工具链预检：package-lock.json 必须存在且 wrangler 版本与 package.json 的 pin 一致
# （防「本地验过的版本 ≠ 部署用的版本」）；Node 主版本须在 engines 允许范围（22–24，见 .nvmrc）。
if ! python3 - <<'PYEOF'
import json, sys
try:
    pkg = json.load(open("package.json"))
    lock = json.load(open("package-lock.json"))
except Exception as e:
    print(f"[deploy] 工具链预检失败：无法读取 package.json/package-lock.json：{e}", file=sys.stderr)
    sys.exit(1)
pin = pkg.get("devDependencies", {}).get("wrangler")
locked = (lock.get("packages", {}).get("node_modules/wrangler", {}) or {}).get("version")
if not pin or locked != pin:
    print(f"[deploy] 工具链预检失败：wrangler pin={pin} 与 lockfile={locked} 不一致，请先 npm install 对齐后再部署。", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PYEOF
then
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
case "$NODE_MAJOR" in
  22|23|24) ;;
  *) echo "[deploy] 工具链预检失败：Node 主版本 $NODE_MAJOR 不在 engines 允许范围（22–24，见 .nvmrc）。" >&2; exit 1 ;;
esac
echo "[deploy] W4-17 工具链预检通过（node v$NODE_MAJOR，wrangler pin 与 lockfile 一致）"

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
  require_bypass_reason "DEPLOY_SKIP_META_CHECK"
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

# (b2b) F7-47 安全头一致性门禁（report-only 产物）：ops/headers/_headers.report-only.txt 必须与
# 当前全站 HTML 的现行生成结果一致（WA-ON+report-only，与线上变体同口径，仅 CSP 头名不同）。
# 不一致即中止部署——先运行 node ops/headers/gen-headers.mjs --report-only --variant=on 重新生成，禁止手改。
if ! node ops/headers/gen-headers.mjs --check --report-only --variant=on; then
  echo "[deploy] 错误：ops/headers/_headers.report-only.txt 与当前全站 HTML 不一致，请先运行 node ops/headers/gen-headers.mjs --report-only --variant=on 重新生成后再部署。" >&2
  exit 1
fi
echo "[deploy] F7-47 _headers.report-only.txt --check 通过"

# (b3) W2-01 fetcher 数据一致性门禁：workers/fetcher/coins.json 的 meta.dataHash 必须与 data/coins.json 一致
# （只比 dataHash 不比字节：meta.generatedAt 允许不同）。不一致即中止——同步动作：cp data/coins.json workers/fetcher/coins.json，
# 按 docs/fetcher-runbook.md 重生成 src/coins-list.js，并单独部署 fetcher（bash scripts/wrangler-pinned.sh deploy -c workers/fetcher/wrangler.toml，锁版入口 F7-45，不与 Pages 连推）。
if ! python3 -c "import json,sys; a=json.load(open('data/coins.json'))['meta']['dataHash']; b=json.load(open('workers/fetcher/coins.json'))['meta']['dataHash']; sys.exit(0 if a==b else 1)"; then
  echo "[deploy] 错误：workers/fetcher/coins.json 与 data/coins.json 的 dataHash 不一致，请先同步 fetcher 数据副本并重生成 coins-list.js（见 docs/fetcher-runbook.md）。" >&2
  exit 1
fi
echo "[deploy] W2-01 fetcher 数据门禁通过"

# (b4) W4-10 第四份副本一致性门禁：workers/fetcher/src/coins-list.js 的 id 集合必须与
# data/coins.json 完全一致。漏重生成即中止——防 fetcher 静默按旧名单抓取（≤12 币漂移无感）。
if ! python3 - <<'PYEOF'
import json, sys
doc = json.load(open("data/coins.json"))
if isinstance(doc.get("coins"), list):
    want = sorted(c["coingeckoId"] for c in doc["coins"])
else:
    _idx = doc["meta"]["fields"].index("coingeckoId")
    want = sorted(r[_idx] for r in doc["rows"])
src = open("workers/fetcher/src/coins-list.js", encoding="utf-8").read()
arr = src[src.index("["):src.rindex("]") + 1]
got = sorted(e["id"] for e in json.loads(arr))
if got != want:
    print(f"[deploy] coins-list.js 名单不一致：coins-list {len(got)} 个 / coins.json {len(want)} 个", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PYEOF
then
  echo "[deploy] 错误：workers/fetcher/src/coins-list.js 名单与 data/coins.json 不一致，请按 docs/fetcher-runbook.md 重新生成 coins-list.js 后再部署。" >&2
  exit 1
fi
echo "[deploy] W4-10 coins-list.js 名单门禁通过（200 个 id 与 data/coins.json 一致）"

# (c) 用 package.json 锁定的 wrangler 版本部署（防 CLI 大版本漂移）
# F7-45 起统一走锁版入口 scripts/wrangler-pinned.sh（内部从 package.json 读 pin 并校验 lockfile，
# 与此前本节内联的 npx wrangler@<pin> 等价，版本来源仍只有 package.json 一处）。
WRANGLER_VERSION="$(python3 -c "import json; print(json.load(open('package.json'))['devDependencies']['wrangler'])")"
echo "[deploy] 使用 wrangler@${WRANGLER_VERSION}（经 scripts/wrangler-pinned.sh）部署到项目 crypto-top200（branch=$BRANCH）"
bash scripts/wrangler-pinned.sh pages deploy public --project-name crypto-top200 --branch "$BRANCH"

# (d) 部署后冒烟：失败则非零退出，部署虽已上线但必须人工处理/回滚
# W2-13/HC2：冒烟结果同步 ping healthchecks（HEALTHCHECKS_DEPLOY_PING_URL 未设置时 hc_ping.sh 打印 skipped-no-url 并以 0 退出，不阻断部署）。
# F7-04：preview 只跑 smoke.sh 的静态/UI 子集（preview 模式），且 HC2 是生产部署
# 健康检查——preview 无论冒烟成败均不发 HC2 success/fail ping，避免误报污染告警。
echo "[deploy] 部署完成，开始冒烟：$BASE_URL（模式=$ENV_NAME）"
if [ "$ENV_NAME" = "preview" ]; then
  if ! bash scripts/smoke.sh "$BASE_URL" preview; then
    echo "[deploy] preview 静态/UI 冒烟失败（不发送 HC2 fail；preview 结论不可迁移到生产数据面）" >&2
    exit 1
  fi
  echo "[deploy] preview 冒烟通过（未发送 HC2 ping：HC2 仅记生产部署）"
else
  if ! bash scripts/smoke.sh "$BASE_URL" production; then
    bash scripts/hc_ping.sh fail || true
    echo "部署已上线但冒烟失败，需人工处理/回滚" >&2
    exit 1
  fi
  bash scripts/hc_ping.sh success || true
fi

# (d2) F6-27 部署后安全头冒烟（线上子集 S1/S2/S4/S6）：结果落 deploy-log；
# 非零时部署末尾以醒目信息 + 非零退出码收尾（部署已发生，不假装未部署）。
HEADERS_RC=0
if ! node ops/headers/smoke-headers.mjs "$BASE_URL" --variant=on --only=S1,S2,S4,S6; then
  HEADERS_RC=1
fi
deploy_log "smoke-headers" "rc=$HEADERS_RC" || true

# (e) W4-17 部署后自动核对（checklists ① 首项自动化）：生产部署后自动跑全量探针并留痕。
# 探针未全过只告警不改判：部署成败以冒烟为准，探针结果写入 ops/probe-log.jsonl 供人工复核。
if [ "$ENV_NAME" = "production" ]; then
  if ! bash scripts/probe.sh "$BASE_URL"; then
    echo "[deploy] 警告：部署后 probe.sh 未全过（详见上方输出与 ops/probe-log.jsonl），请人工复核后再签核本次部署。" >&2
  fi
fi
if [ "${HEADERS_RC:-0}" != "0" ]; then
  echo "============================================================" >&2
  echo "[deploy] *** 警告：部署已上线，但 smoke-headers 安全头冒烟未通过（见上方输出与 ops/deploy-log.jsonl），须人工处理！***" >&2
  echo "============================================================" >&2
  exit 1
fi
echo "[deploy] 冒烟通过，$ENV_NAME 部署完成：$BASE_URL"
echo "[deploy] 提醒（F7-20）：若本次部署产生过门禁绕过/异常留痕，ops/deploy-audit.jsonl 已更新（脱敏审计、可入版本控制），请随本次部署一并 git add/commit 该文件，使审计链进入版本控制。"
