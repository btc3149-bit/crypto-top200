#!/usr/bin/env bash
# rollback.sh — crypto-top200 回滚助手（W4-12：回滚证明）
#
# 两条回滚路径：
#   1) deployment：把某个环境回滚到上一个（或指定的）部署，经 Cloudflare Pages
#      rollback API 立即生效，不需要重新部署。平台限制（2026-11-13 preview 演练
#      实测，错误码 8000040）：rollback API 只接受 production 部署，preview 调用
#      会被拒绝——preview 的等效恢复手段是把上一版内容重新部署一遍
#      （bash scripts/deploy.sh preview），演练计时见 ops/disaster-recovery/。
#   2) mode：把 Pages 环境变量 BOARD_READ_MODE 改为 legacy|dual|kv
#      （G3 坏数据时的模式回滚：kv -> legacy）。
#
# 凭据：本脚本禁止内嵌任何令牌值。所有 API 调用都经
#   ~/workspace/custom-connectors/custom.cloudflare/bin/cf_api.py
# 发出，凭证由该连接（custom.cloudflare）的机制在运行时注入
# （authd 代用值，出站时才换成真实令牌），脚本与日志里不出现令牌。
#
# 账号 ID 与项目名不是机密：账号 ID 见 custom.cloudflare 的 CONNECTOR.md，
# 项目名 crypto-top200 见 wrangler.toml；账号 ID 可用环境变量
# CLOUDFLARE_ACCOUNT_ID 覆盖，cf_api.py 路径可用 CF_API_PY 覆盖。
#
# 防误触：
#   - deployment 真正执行前必须 ROLLBACK_CONFIRM=1，否则只打印目标并退出（退出码 3）。
#   - mode 改 production 额外要求 ALLOW_PROD_MODE_ROLLBACK=1，缺省拒绝（退出码 3）。
#
# mode 路径的生效口径（重要，2026-11-13 preview 演练已实测修正）：
#   PATCH deployment_configs 能改项目配置且回读一致，但本项目是 Wrangler 直推
#   管线：实测新部署的 env_vars 快照仍为空、且把配置改成 kv 后新部署的
#   /api/board 仍按缺省 legacy 应答——即 API 改 env 对 Wrangler 直推的新部署
#   不生效，当前在线部署更不会热切换。本管线下真正的模式切换必须在部署时
#   注入变量（如 wrangler.toml [vars] 写 BOARD_READ_MODE 后跑 deploy.sh），
#   本子命令只完成 API 配置层变更，不得单独作为 G3 模式回滚的完成依据。
#   完整证据见 ops/disaster-recovery/rollback-drill-2026-11-13.md。
#   另经 preview 实测（2026-11-13）：PATCH deployment_configs 的 env_vars 是
#   「按 key 合并」语义——请求体只带 BOARD_READ_MODE 一个 key 即可，不会动同环境
#   的其它变量（含 secret_text，脚本更不会回传任何 secret 的值）；给 key 传 null
#   可删除该 key。production 侧未在演练中实测 PATCH（纪律禁动生产），脚本执行后
#   会回读逐项核对原有 key 名是否都还在，缺失即非零退出报警。
set -euo pipefail

PROJECT="crypto-top200"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-e6eae7d19e653edfedb12f4bb5e0227d}"
CF_API_PY="${CF_API_PY:-$HOME/workspace/custom-connectors/custom.cloudflare/bin/cf_api.py}"

TMPDIR_RB="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_RB"' EXIT

usage() {
  cat <<'EOF'
用法：
  bash scripts/rollback.sh deployment [--env preview|production] [--to <deployment_id>]
  bash scripts/rollback.sh mode <legacy|dual|kv> [--env preview|production]
  bash scripts/rollback.sh --help

deployment（部署回滚，立即生效、无需重新部署）：
  --env   目标环境，默认 production。注意：rollback API 只接受 production
          （preview 会被平台以 8000040 拒绝，preview 恢复请重部署上一版内容）。
  --to    指定回滚目标部署 id；不带时自动选「该环境当前部署的上一个」。
  执行前会打印目标部署 id 与创建时间；必须 ROLLBACK_CONFIRM=1 才真正执行，
  否则只打印将要执行的动作并以退出码 3 结束（dry-run）。

mode（模式回滚：改 BOARD_READ_MODE 环境变量）：
  取值 legacy|dual|kv；--env 默认 production。
  F6-74：默认拒绝执行（此操作不改变线上行为）；须显式 ROLLBACK_MODE_API_ONLY=1 才执行。
  经 API PATCH 项目 deployment_configs（preview/production 分开设置）。
  注意（实测）：本项目 Wrangler 直推管线下 API 改 env 不会被新部署携带，
  不能单独完成模式切换，须配合部署时注入变量，见脚本头注释与演练记录。
  production 额外要求 ALLOW_PROD_MODE_ROLLBACK=1，缺省拒绝。

环境变量：
  ROLLBACK_CONFIRM=1          deployment 子命令的执行确认（必填才执行）
  ROLLBACK_MODE_API_ONLY=1    mode 子命令的执行确认（F6-74，必填才执行；仅改 API 配置层、不改变线上行为）
  ALLOW_PROD_MODE_ROLLBACK=1  mode 子命令改 production 的额外放行（必填才执行）
  CLOUDFLARE_ACCOUNT_ID       覆盖账号 ID（默认取连接文档登记值，非机密）
  CF_API_PY                   覆盖 cf_api.py 路径

示例：
  ROLLBACK_CONFIRM=1 bash scripts/rollback.sh deployment --env preview
  bash scripts/rollback.sh mode legacy --env preview
  ALLOW_PROD_MODE_ROLLBACK=1 bash scripts/rollback.sh mode legacy --env production
EOF
}

die() { echo "[rollback] 错误：$*" >&2; exit 1; }

# cf_call <outfile> <method> <path> [data]：把 cf_api.py 的 JSON 响应写入 outfile。
# cf_api.py 在 HTTP 出错时以退出码 1 返回但仍打印 JSON，故吞掉其退出码，
# 统一由 json_success 按响应体 success 字段裁决。
cf_call() {
  local out="$1" method="$2" path="$3" data="${4:-}"
  if [ -n "$data" ]; then
    python3 "$CF_API_PY" "$method" "$path" "$data" > "$out" || true
  else
    python3 "$CF_API_PY" "$method" "$path" > "$out" || true
  fi
  [ -s "$out" ] || die "cf_api.py 无输出（method=$method path=$path），请先按连接文档核对通道"
}

json_success() { # $1=JSON 文件；success=true 返回 0
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get("success") else 1)' "$1"
}

json_errors() { # $1=JSON 文件；打印 errors 摘要
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps(d.get("errors"), ensure_ascii=False))' "$1"
}

[ -f "$CF_API_PY" ] || die "找不到 cf_api.py：$CF_API_PY（可用 CF_API_PY 覆盖）"

cmd_deployment() {
  local env_name="production" to_id=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --env) [ $# -ge 2 ] || die "--env 缺少取值"; env_name="$2"; shift 2 ;;
      --to)  [ $# -ge 2 ] || die "--to 缺少取值"; to_id="$2"; shift 2 ;;
      *) die "deployment 不认识的参数：$1（见 --help）" ;;
    esac
  done
  case "$env_name" in preview|production) ;; *) die "--env 只能是 preview 或 production，收到：$env_name" ;; esac

  echo "[rollback] 查询 $PROJECT 的 $env_name 部署列表…"
  local list_json="$TMPDIR_RB/deployments.json"
  cf_call "$list_json" GET "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/deployments?env=$env_name&per_page=25"
  json_success "$list_json" || die "部署列表查询失败：$(json_errors "$list_json")"

  # 在该环境内（列表按创建时间倒序）选 current=第一条、previous=第二条；
  # --to 时按 id 在列表内定位。输出 CURRENT_*/TARGET_* 或 ERROR 行供 bash 读取。
  # F6-75：自动选择时过滤 latest_stage.status=success（不回滚到失败部署），
  # 并输出 TARGET_STAGE 供确认输出打印。
  local sel
  sel="$(python3 - "$list_json" "$env_name" "$to_id" <<'PYEOF'
import json, sys
path, env, to_id = sys.argv[1], sys.argv[2], sys.argv[3]
items = [x for x in (json.load(open(path)).get("result") or []) if x.get("environment") == env]
if not items:
    print("ERROR 该环境没有任何部署"); sys.exit(0)
cur = items[0]
print(f"CURRENT_ID {cur.get('id')}")
print(f"CURRENT_CREATED {cur.get('created_on')}")
def stage(x):
    return (x.get("latest_stage") or {}).get("status")
if to_id:
    hit = next((x for x in items if x.get("id") == to_id), None)
    if hit is None:
        print("ERROR_LIST_NOT_FOUND"); sys.exit(0)
    tgt = hit
else:
    ok_items = [x for x in items[1:] if stage(x) == "success"]
    if not ok_items:
        print("ERROR 该环境没有 latest_stage=success 的上一个部署可回滚"); sys.exit(0)
    tgt = ok_items[0]
print(f"TARGET_ID {tgt.get('id')}")
print(f"TARGET_CREATED {tgt.get('created_on')}")
print(f"TARGET_URL {tgt.get('url')}")
print(f"TARGET_STAGE {stage(tgt)}")
PYEOF
)" || die "解析部署列表失败"

  if echo "$sel" | grep -q '^ERROR_LIST_NOT_FOUND'; then
    # 目标不在最近 25 条内：单查该部署并校验环境后再继续
    local one_json="$TMPDIR_RB/one.json" one_env one_created current_part
    cf_call "$one_json" GET "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/deployments/$to_id"
    json_success "$one_json" || die "--to 部署 $to_id 查询失败：$(json_errors "$one_json")"
    one_env="$(python3 -c 'import json,sys; print((json.load(open(sys.argv[1])).get("result") or {}).get("environment",""))' "$one_json")"
    one_created="$(python3 -c 'import json,sys; print((json.load(open(sys.argv[1])).get("result") or {}).get("created_on",""))' "$one_json")"
    [ "$one_env" = "$env_name" ] || die "--to 部署 $to_id 属于 $one_env 环境，与 --env $env_name 不符，拒绝执行"
    one_stage="$(python3 -c 'import json,sys; print(((json.load(open(sys.argv[1])).get("result") or {}).get("latest_stage") or {}).get("status",""))' "$one_json")"
    current_part="$(echo "$sel" | grep '^CURRENT_' || true)"
    sel="$(printf '%s\nTARGET_ID %s\nTARGET_CREATED %s\nTARGET_URL \nTARGET_STAGE %s\n' "$current_part" "$to_id" "$one_created" "$one_stage")"
  elif echo "$sel" | grep -q '^ERROR'; then
    die "$(echo "$sel" | grep '^ERROR' | head -1 | cut -d' ' -f2-)"
  fi

  local current_id target_id target_created target_url target_stage
  current_id="$(echo "$sel" | awk '$1=="CURRENT_ID"{print $2}')"
  target_id="$(echo "$sel" | awk '$1=="TARGET_ID"{print $2}')"
  target_created="$(echo "$sel" | awk '$1=="TARGET_CREATED"{print $2}')"
  target_url="$(echo "$sel" | awk '$1=="TARGET_URL"{print $2}')"
  target_stage="$(echo "$sel" | awk '$1=="TARGET_STAGE"{print $2}')"
  [ -n "$target_id" ] || die "未能确定回滚目标"
  [ "$target_id" != "$current_id" ] || die "目标与当前部署相同（$target_id），无回滚可言"
  if [ -z "$to_id" ]; then :; elif [ "$target_stage" != "success" ]; then
    echo "[rollback] 警告：--to 指定部署的 latest_stage=$target_stage（非 success），请确认这确实是你要回滚到的部署。" >&2
  fi

  echo "[rollback] 环境=$env_name 当前部署=$current_id"
  echo "[rollback] 回滚目标部署 id=$target_id 创建时间=$target_created url=$target_url stage=${target_stage:-<未知>}"
  echo "[rollback] 将执行：POST /accounts/$ACCOUNT_ID/pages/projects/$PROJECT/deployments/$target_id/rollback"

  if [ "${ROLLBACK_CONFIRM:-}" != "1" ]; then
    echo "[rollback] 未执行（防误触）：确认目标无误后，带 ROLLBACK_CONFIRM=1 重跑本命令。" >&2
    exit 3
  fi

  local resp="$TMPDIR_RB/rollback-resp.json"
  cf_call "$resp" POST "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/deployments/$target_id/rollback"
  if ! json_success "$resp"; then
    if grep -q '8000040' "$resp"; then
      echo "[rollback] 平台限制：rollback API 只能回滚 production 部署，preview 被拒绝（8000040）。" >&2
      echo "[rollback] preview 的等效恢复：把上一版内容重新部署一遍（bash scripts/deploy.sh preview）。本次未对 $env_name 做任何变更。" >&2
    fi
    die "回滚 API 调用失败：$(json_errors "$resp")"
  fi
  echo "[rollback] 回滚 API 返回 success。响应摘要："
  python3 -c '
import json, sys
r = json.load(open(sys.argv[1])).get("result") or {}
print("  id=%s env=%s created_on=%s url=%s stage=%s" % (r.get("id"), r.get("environment"), r.get("created_on"), r.get("url"), (r.get("latest_stage") or {}).get("status")))' "$resp"

  echo "[rollback] 回读部署列表确认 $env_name 最新状态："
  local after_json="$TMPDIR_RB/deployments-after.json"
  cf_call "$after_json" GET "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/deployments?env=$env_name&per_page=25"
  if json_success "$after_json"; then
    python3 - "$after_json" "$env_name" <<'PYEOF'
import json, sys
path, env = sys.argv[1], sys.argv[2]
items = [x for x in (json.load(open(path)).get("result") or []) if x.get("environment") == env]
for x in items[:3]:
    print(f"  {x.get('id')} created={x.get('created_on')} stage={(x.get('latest_stage') or {}).get('status')} url={x.get('url')}")
PYEOF
  else
    echo "[rollback] 警告：回读失败，请人工核对 deployments 列表" >&2
  fi
  echo "[rollback] deployment 回滚完成：$env_name -> $target_id"
}

cmd_mode() {
  # F6-74：mode 子命令默认拒绝执行——API 改 env 对 Wrangler 直推管线不生效，
  # 须显式 ROLLBACK_MODE_API_ONLY=1 才执行，且输出第一行先打印不生效声明。
  echo "此操作不改变线上行为：API 改 BOARD_READ_MODE 不会被 Wrangler 直推的新部署携带、当前在线部署也不会热切换；真正的模式切换须改 wrangler.toml [vars] 后跑 deploy.sh。"
  if [ "${ROLLBACK_MODE_API_ONLY:-}" != "1" ]; then
    echo "[rollback] 拒绝：mode 子命令默认不执行；确认只需改 API 配置层时，带 ROLLBACK_MODE_API_ONLY=1 重跑（production 另须 ALLOW_PROD_MODE_ROLLBACK=1）。" >&2
    exit 3
  fi
  local mode_val="${1:-}"
  case "$mode_val" in legacy|dual|kv) ;; *) die "mode 取值只能是 legacy|dual|kv，收到：${mode_val:-<空>}（见 --help）" ;; esac
  shift
  local env_name="production"
  while [ $# -gt 0 ]; do
    case "$1" in
      --env) [ $# -ge 2 ] || die "--env 缺少取值"; env_name="$2"; shift 2 ;;
      *) die "mode 不认识的参数：$1（见 --help）" ;;
    esac
  done
  case "$env_name" in preview|production) ;; *) die "--env 只能是 preview 或 production，收到：$env_name" ;; esac

  if [ "$env_name" = "production" ] && [ "${ALLOW_PROD_MODE_ROLLBACK:-}" != "1" ]; then
    echo "[rollback] 拒绝：mode 改 production 须额外带 ALLOW_PROD_MODE_ROLLBACK=1（防误触）。" >&2
    exit 3
  fi

  echo "[rollback] 读取项目 $PROJECT 当前 $env_name 配置…"
  local proj_json="$TMPDIR_RB/project.json" before
  cf_call "$proj_json" GET "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT"
  json_success "$proj_json" || die "项目查询失败：$(json_errors "$proj_json")"
  before="$(python3 - "$proj_json" "$env_name" <<'PYEOF'
import json, sys
path, env = sys.argv[1], sys.argv[2]
r = json.load(open(path)).get("result") or {}
ev = ((r.get("deployment_configs") or {}).get(env) or {}).get("env_vars") or {}
cur = (ev.get("BOARD_READ_MODE") or {}).get("value")
print("CUR " + (cur if cur is not None else "<未设置，缺省 legacy>"))
print("KEYS " + ",".join(sorted(ev.keys())))
secret_keys = sorted(k for k, v in ev.items() if isinstance(v, dict) and v.get("type") == "secret_text")
print("SECRET_KEYS " + ",".join(secret_keys))
PYEOF
)" || die "解析项目配置失败"
  local cur_val keys secret_keys
  cur_val="$(echo "$before" | sed -n 's/^CUR //p')"
  keys="$(echo "$before" | awk '$1=="KEYS"{print $2}')"
  secret_keys="$(echo "$before" | awk '$1=="SECRET_KEYS"{print $2}')"
  echo "[rollback] 环境=$env_name 当前 BOARD_READ_MODE=$cur_val；现有 env key：${keys:-<无>}"
  if [ -n "$secret_keys" ]; then
    echo "[rollback] 注意：该环境存在 secret_text 变量（只列名）：$secret_keys"
    echo "[rollback] 本脚本的 PATCH 只带 BOARD_READ_MODE 一个 key（按 key 合并语义，不回传 secret 值）；执行后将回读核对这些 key 是否仍在。"
  fi

  # 只 PATCH BOARD_READ_MODE 这一个 key（合并语义，见脚本头注释）。
  local body resp="$TMPDIR_RB/patch-resp.json"
  body="$(python3 -c '
import json, sys
env, val = sys.argv[1], sys.argv[2]
print(json.dumps({"deployment_configs": {env: {"env_vars": {"BOARD_READ_MODE": {"type": "plain_text", "value": val}}}}}))' "$env_name" "$mode_val")"
  echo "[rollback] 将执行：PATCH /accounts/$ACCOUNT_ID/pages/projects/$PROJECT （deployment_configs.$env_name.env_vars.BOARD_READ_MODE=$mode_val）"
  cf_call "$resp" PATCH "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT" "$body"
  json_success "$resp" || die "PATCH 失败：$(json_errors "$resp")"
  echo "[rollback] PATCH 返回 success，回读核对…"

  # 回读核对带重试：项目配置存在读后写传播延迟（2026-11-13 preview 演练实测：
  # PATCH 已成功但紧接着的 GET 仍读到旧值，约数十秒后才一致），故最多重试 6 次。
  local verify_json="$TMPDIR_RB/project-after.json" verify_out now_val="" missing="" attempt
  for attempt in 1 2 3 4 5 6; do
    cf_call "$verify_json" GET "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT"
    json_success "$verify_json" || die "PATCH 后回读失败：$(json_errors "$verify_json")"
    verify_out="$(python3 - "$verify_json" "$env_name" "$mode_val" "$keys" <<'PYEOF'
import json, sys
path, env, want, before_keys = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
r = json.load(open(path)).get("result") or {}
ev = ((r.get("deployment_configs") or {}).get(env) or {}).get("env_vars") or {}
now = (ev.get("BOARD_READ_MODE") or {}).get("value")
print("NOW " + str(now))
missing = [k for k in filter(None, before_keys.split(",")) if k not in ev]
print("MISSING " + ",".join(missing))
PYEOF
)" || die "解析回读结果失败"
    now_val="$(echo "$verify_out" | awk '$1=="NOW"{print $2}')"
    missing="$(echo "$verify_out" | awk '$1=="MISSING"{print $2}')"
    [ "$now_val" = "$mode_val" ] && break
    echo "[rollback] 回读暂未一致（第 $attempt 次，读到 $now_val），3 秒后重试…"
    sleep 3
  done
  [ "$now_val" = "$mode_val" ] || die "回读值 $now_val 与目标 $mode_val 不一致（已重试 6 次），mode 切换未确认生效"
  if [ -n "$missing" ]; then
    echo "[rollback] 严重警告：PATCH 后以下原有 key 消失：$missing —— 请立即人工处理！" >&2
    exit 1
  fi
  echo "[rollback] mode API 配置层已设置（不改变线上行为）：$env_name BOARD_READ_MODE=$mode_val（原有 key 全部保留）"
  echo "[rollback] 生效口径警告（2026-11-13 实测）：本项目为 Wrangler 直推管线，API 改 env 不会被新部署携带，Function 运行时读不到——不得单独作为模式切换的完成依据；真正的切换须在部署时注入变量（wrangler.toml [vars] + deploy.sh），详见脚本头注释与演练记录。"
}

main() {
  local sub="${1:-}"
  case "$sub" in
    deployment) shift; cmd_deployment "$@" ;;
    mode) shift; cmd_mode "$@" ;;
    --help|-h|help) usage ;;
    "") usage >&2; exit 2 ;;
    *) echo "[rollback] 不认识的子命令：$sub" >&2; usage >&2; exit 2 ;;
  esac
}

main "$@"
