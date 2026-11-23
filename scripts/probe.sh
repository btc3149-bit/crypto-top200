#!/usr/bin/env bash
# probe.sh — P0-3 本地探针：与 smoke.sh 同一组断言 + 数据新鲜度断言
# 用法：bash scripts/probe.sh [基址]（默认 https://top200.oppcal.com）
# 每次运行把一行 JSON 结果（时间戳、各断言结果、总判定）追加写入项目 ops/probe-log.jsonl。
#
# 新鲜度判定：
# - updatedAt 在未来超过容差 300 秒 → FAIL（F7-27 双侧判定：时钟漂移/异常时间戳不得假绿；容差内未来按年龄 0 处理）
# - updatedAt 距今 ≤15 分钟 → PASS
# - mode=stale 且 staleAgeSec ≤3600 → WARN（降级警告，不算 FAIL；无 mode 字段时以 stale=true + 年龄 ≤3600 等价判定）
# - mode=snapshot → FAIL（接口未生效、只有快照）
# - 其余（年龄超限 / body 不可解析等）→ FAIL
# 总判定：任一 FAIL → fail；无 FAIL 但有 WARN → warn；全过 → pass。
# 退出码三档（F6-23 定版）：pass=0、fail=1、warn=4。编排（HC1）须按退出码分流：
# warn（退出 4）与 fail 一样 ping /fail（附降级注记），不得把 warn 报成 success。
#
# F8-24：探针日志（ops/probe-log.jsonl）写失败的处置（与现行消费方语义兼容）：
# 消费方核查——HC1 cron 按退出码 0/4/1 三分流（见 ops/probe-config.md HC1 行）；
# deploy.sh 部署后调用只看非零与否、未全过只告警不改判。故定版：日志写失败
# 不改变 verdict 本身，但 pass 时以 warn 级退出码 4 收尾（HC1 侧按降级 /fail
# 附注记上报、留痕丢失可见），并在 stderr 明示；fail/warn 时退出码不变
# （1/4，日志失败另行明示）。绝不把日志失败升级为 fail 级（1）——不得让
# 本地留痕故障把站点真 pass 误报为站点故障。日志路径可用环境变量
# PROBE_LOG_FILE 覆盖（测试用；默认 ops/probe-log.jsonl）。
#
# 告警邮箱预留：读环境变量 PROBE_ALERT_EMAIL。未设置时结果行标注 "alert": "skipped-no-email"；
# 设置了也暂不真发邮件，只标注 "alert": "would-email"。
#
# 注：本脚本刻意用 case 做条件判断，不用 test 中括号，避免历史写坏问题。
set -uo pipefail

BASE="${1:-https://top200.oppcal.com}"
BASE="${BASE%/}"
cd "$(dirname "$0")/.."
mkdir -p ops
LOG_FILE="${PROBE_LOG_FILE:-ops/probe-log.jsonl}"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

ALERT="skipped-no-email"
case "${PROBE_ALERT_EMAIL:-}" in
"");;
*) ALERT="would-email";;
esac

curl -sS -m 30 -D "$TMPD/board.headers" -o "$TMPD/board.json" -w "%{http_code}" "${BASE}/api/board" > "$TMPD/board.code" 2>/dev/null || echo "000" > "$TMPD/board.code"
curl -sS -m 30 -o "$TMPD/home.html" -w "%{http_code}" "${BASE}/" > "$TMPD/home.code" 2>/dev/null || echo "000" > "$TMPD/home.code"
curl -sS -m 30 -o "$TMPD/coins.json" -w "%{http_code}" "${BASE}/data/coins.json" > "$TMPD/coins.code" 2>/dev/null || echo "000" > "$TMPD/coins.code"
BOARD_CODE="$(cat "$TMPD/board.code")"
HOME_CODE="$(cat "$TMPD/home.code")"
DATA_CODE="$(cat "$TMPD/coins.code")"
BOARD_BODY="$TMPD/board.json"
HOME_BODY="$TMPD/home.html"
DATA_BODY="$TMPD/coins.json"

# 1) 状态码 + Content-Type
C_API="fail"
case "$BOARD_CODE" in
200)
if grep -i '^content-type:' "$TMPD/board.headers" | grep -qi 'application/json'; then
C_API="pass"
fi
;;
esac

# 2) JSON keys（coins / updatedAt / coverage）；解析失败由 shell 兜底为 fail
C_KEYS="$(python3 -c "import json,sys; b=json.load(open(sys.argv[1],encoding='utf-8')); print('pass' if all(k in b for k in ('coins','updatedAt','coverage')) else 'fail')" "$BOARD_BODY" 2>/dev/null || echo fail)"

# 3) 负向断言：不含 DOCTYPE html
C_NOHTML="pass"
if grep -qi '<!DOCTYPE html' "$BOARD_BODY"; then
C_NOHTML="fail"
fi

# 4) coverage.returned ≥ 期望数（/data/coins.json 的 coins 长度）的 94%
C_COV="$(python3 -c "import json,sys; d=json.load(open(sys.argv[2],encoding='utf-8')); e=len(d.get('coins') or d.get('rows') or []); r=json.load(open(sys.argv[1],encoding='utf-8'))['coverage']['returned']; print('pass' if r >= e * 0.94 else 'fail')" "$BOARD_BODY" "$DATA_BODY" 2>/dev/null || echo fail)"

# 5) 首页 200 且含标题关键字
C_HOME="fail"
case "$HOME_CODE" in
200)
if grep -q "市值前 200 币种" "$HOME_BODY"; then
C_HOME="pass"
fi
;;
esac

# 6) /data/coins.json 200 且 JSON 可解析
C_DATA="fail"
case "$DATA_CODE" in
200)
if python3 -c "import json,sys; json.load(open(sys.argv[1],encoding='utf-8'))" "$DATA_BODY" 2>/dev/null; then
C_DATA="pass"
fi
;;
esac

# 7) 新鲜度：输出 "pass|warn|fail:说明"；body 不是 JSON 时先行判 fail
case "$C_KEYS/$C_NOHTML" in
fail/fail)
FRESH_OUT="fail:board body 不是 JSON（疑似 HTML 冒充接口）"
;;
*)
FRESH_OUT="$(python3 -c "import json,sys,time,datetime; b=json.load(open(sys.argv[1],encoding='utf-8')); mode=b.get('mode'); raw=b.get('updatedAt'); ts=(raw/1000.0 if raw > 1e12 else float(raw)) if isinstance(raw,(int,float)) else (datetime.datetime.fromisoformat(raw.replace('Z','+00:00')).timestamp() if isinstance(raw,str) else None); age=(time.time()-ts) if ts is not None else None; sa=b.get('staleAgeSec'); print('fail:mode=snapshot（接口未生效，只有快照数据）' if mode=='snapshot' else 'fail:updatedAt 缺失或不可解析' if age is None else 'fail:updatedAt 在未来 ' + str(int(-age)) + 's，超过未来容差 300s（时钟漂移/异常时间戳，F7-27）' if age < -300 else 'pass:updatedAt 距今 ' + str(int(max(age, 0))) + 's（≤15 分钟）' if age <= 900 else 'warn:mode=stale，staleAgeSec=' + str(sa) + '（≤3600，降级警告）' if (mode=='stale' and sa is not None and sa <= 3600) else 'warn:stale=true，数据年龄 ' + str(int(sa if sa is not None else age)) + 's（≤3600，降级警告）' if (b.get('stale') is True and (sa if sa is not None else age) <= 3600) else 'fail:updatedAt 距今 ' + str(int(age)) + 's，超过新鲜度上限')" "$BOARD_BODY" 2>/dev/null || echo "fail:新鲜度计算失败（updatedAt 不可解析）")"
;;
esac
C_FRESH="${FRESH_OUT%%:*}"
FRESH_NOTE="${FRESH_OUT#*:}"

# 逐项打印
echo "probe base=$BASE"
echo " api_status_content_type: $C_API"
echo " api_json_keys: $C_KEYS"
echo " api_no_html: $C_NOHTML"
echo " coverage: $C_COV"
echo " home: $C_HOME"
echo " data_json: $C_DATA"
echo " freshness: $C_FRESH ($FRESH_NOTE)"

# 总判定
VERDICT="pass"
for v in "$C_API" "$C_KEYS" "$C_NOHTML" "$C_COV" "$C_HOME" "$C_DATA" "$C_FRESH"; do
case "$v" in
warn) VERDICT="warn";;
esac
done
for v in "$C_API" "$C_KEYS" "$C_NOHTML" "$C_COV" "$C_HOME" "$C_DATA" "$C_FRESH"; do
case "$v" in
fail) VERDICT="fail";;
esac
done
echo " verdict: $VERDICT (alert: $ALERT)"

# 追加一行 JSON 结果到 ops/probe-log.jsonl，并把该行打印出来。
# F8-24：写失败必须被检出（旧实现无任何检查、留痕静默丢失）——处置见文件头：
# verdict 不变，stderr 明示；pass 时退出码升为 warn 级 4，绝不升 fail 级 1。
LOG_WRITE_OK=1
if ! python3 -c "import json,sys,datetime; line={'ts': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'base': sys.argv[2], 'checks': {'api_status_content_type': sys.argv[3], 'api_json_keys': sys.argv[4], 'api_no_html': sys.argv[5], 'coverage': sys.argv[6], 'home': sys.argv[7], 'data_json': sys.argv[8], 'freshness': sys.argv[9]}, 'freshnessNote': sys.argv[10], 'verdict': sys.argv[11], 'alert': sys.argv[12]}; open(sys.argv[1],'a',encoding='utf-8').write(json.dumps(line,ensure_ascii=False) + chr(10)); print(json.dumps(line,ensure_ascii=False))" "$LOG_FILE" "$BASE" "$C_API" "$C_KEYS" "$C_NOHTML" "$C_COV" "$C_HOME" "$C_DATA" "$C_FRESH" "$FRESH_NOTE" "$VERDICT" "$ALERT"; then
LOG_WRITE_OK=0
echo "probe: ERROR 探针日志写入失败：$LOG_FILE（verdict=$VERDICT 不变，留痕丢失；F8-24）" >&2
echo " log_write: fail ($LOG_FILE)"
fi

case "$VERDICT" in
fail) exit 1;;
warn) exit 4;;
*) case "$LOG_WRITE_OK" in
   0) exit 4;;  # F8-24：pass + 日志写失败 → warn 级 4（降级上报），不误报 fail
   *) exit 0;;
   esac;;
esac
