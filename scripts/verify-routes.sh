#!/usr/bin/env bash
# dsh-music S1 路由验证脚本（明镜/任何人可复跑）
# 用法: bash scripts/verify-routes.sh [BASE_URL]
# 默认 BASE_URL=http://127.0.0.1:53079（现有 GUI 同源，不启动替代服务器）
# 安全说明：穿越测试只检查拒绝状态码，响应体一律丢弃，绝不读取凭据内容。
set -u
B="${1:-http://127.0.0.1:53079}"
PASS=0; FAIL=0
check() { # check <描述> <期望> <实际>
  if [ "$2" = "$3" ]; then echo "PASS: $1 ($3)"; PASS=$((PASS+1));
  else echo "FAIL: $1 期望=$2 实际=$3"; FAIL=$((FAIL+1)); fi
}

LIB=$(curl -s "$B/dsh-music/api/library")
TOTAL=$(printf '%s' "$LIB" | python3 -c "import json,sys;print(len(json.load(sys.stdin)['tracks']))")
check "曲库总数 ≥55（实际 ${TOTAL}）" "ok" "$([ "$TOTAL" -ge 55 ] && echo ok)"
ID=$(printf '%s' "$LIB" | python3 -c "
import json,sys
ts=json.load(sys.stdin)['tracks']
g=[t for t in ts if t['artist']=='Beyond' and '光輝歲月' in t['title']]
print(g[0]['id'] if g else ts[0]['id'])")
echo "测试曲目 id: $ID"

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

check "完整 GET → 200" 200 "$(code "$B/dsh-music/audio/$ID")"
check "Range 0-1023 → 206" 206 "$(code -r 0-1023 "$B/dsh-music/audio/$ID")"
CR=$(curl -s -D - -o /dev/null -r 0-1023 "$B/dsh-music/audio/$ID" | tr -d '\r' | awk 'tolower($1)=="content-range:"{print $2, $3}')
case "$CR" in bytes\ 0-1023/*) check "Content-Range 格式" ok ok;; *) check "Content-Range 格式" "bytes 0-1023/<total>" "$CR";; esac
check "不可满足范围 → 416" 416 "$(code -r 999999999- "$B/dsh-music/audio/$ID")"
check "后缀 Range -512 → 206" 206 "$(code -r -512 "$B/dsh-music/audio/$ID")"
check "HEAD → 200" 200 "$(code -I "$B/dsh-music/audio/$ID")"
CT=$(curl -s -D - -o /dev/null "$B/dsh-music/audio/$ID" | tr -d '\r' | awk 'tolower($1)=="content-type:"{print $2}')
check "m4a MIME=audio/mp4" "audio/mp4" "$CT"
check "封面 → 200" 200 "$(code "$B/dsh-music/cover/$ID")"
NOCOVER=$(printf '%s' "$LIB" | python3 -c "
import json,sys
ts=json.load(sys.stdin)['tracks']
n=[t for t in ts if t['coverUrl'] is None]
print(n[0]['id'] if n else '')")
if [ -n "$NOCOVER" ]; then
  check "无封面曲目 → 404" 404 "$(code "$B/dsh-music/cover/$NOCOVER")"
else
  echo "INFO: 全部曲目都有封面，跳过无封面 404 用例"
fi
check "插件图标 → 200" 200 "$(code "$B/dsh-music/icon.png")"
check "插件图标 HEAD → 200" 200 "$(code -I "$B/dsh-music/icon.png")"
ICT=$(curl -s -D - -o /dev/null "$B/dsh-music/icon.png" | tr -d '\r' | awk 'tolower($1)=="content-type:"{print $2}')
check "插件图标 MIME=image/png" "image/png" "$ICT"
check "插件图标 POST → 405" 405 "$(code -X POST "$B/dsh-music/icon.png")"

# 路径穿越：期望全部 4xx 拒绝（--path-as-is 保留原始 ../）
for p in "../../.config/spotify-sync/refresh_token" "%2e%2e%2f%2e%2e%2f.config%2fspotify-sync%2frefresh_token" "..%252f..%252fetc%252fpasswd" "/etc/passwd" "$ID/../../x" "ffffffffffffffff"; do
  C=$(code --path-as-is "$B/dsh-music/audio/$p")
  case "$C" in 4*) check "穿越拒绝 $p" ok ok;; *) check "穿越拒绝 $p" 4xx "$C";; esac
done

check "rescan POST → 200" 200 "$(code -X POST "$B/dsh-music/api/rescan")"
check "library DELETE → 405" 405 "$(code -X DELETE "$B/dsh-music/api/library")"
check "playback GET → 200" 200 "$(code "$B/dsh-music/api/playback")"
check "playback 非法 volume → 400" 400 "$(code -X POST -d '{"volume":5}' "$B/dsh-music/api/playback")"

# 喜欢列表导入（只读）：状态 / 两个平台的二维码 / 未知二维码会话 / 未登录同步。响应体只看字段名，不落盘凭据。
check "liked-sync 状态 GET → 200" 200 "$(code "$B/dsh-music/api/liked-sync/status")"
LSS=$(curl -s "$B/dsh-music/api/liked-sync/status")
check "liked-sync 状态不含 cookie 字样" ok "$(printf '%s' "$LSS" | grep -qi cookie && echo leak || echo ok)"
check "网易云二维码 GET → 405（只接受 POST）" 405 "$(code "$B/dsh-music/api/liked-sync/netease/qr")"
check "网易云二维码 POST → 200" 200 "$(code -X POST "$B/dsh-music/api/liked-sync/netease/qr")"
NQ=$(curl -s -X POST "$B/dsh-music/api/liked-sync/netease/qr")
case "$NQ" in *'"key"'*'"url":"https://music.163.com/login?codekey='*) check "网易云二维码返回 key + 登录 URL" ok ok;; *) check "网易云二维码返回 key + 登录 URL" "key+url" "$(printf '%s' "$NQ" | head -c 80)";; esac
check "网易云未知二维码会话 → 404" 404 "$(code "$B/dsh-music/api/liked-sync/netease/qr/poll?key=nope")"
check "QQ 扫码二维码 GET → 405（只接受 POST）" 405 "$(code "$B/dsh-music/api/liked-sync/qq/qr")"
check "QQ 扫码二维码 POST → 200" 200 "$(code -X POST "$B/dsh-music/api/liked-sync/qq/qr")"
QQ=$(curl -s -X POST "$B/dsh-music/api/liked-sync/qq/qr")
case "$QQ" in *'"key"'*"data:image/png;base64,"*) check "QQ 扫码二维码返回 key + PNG（有矩阵则带 matrix）" ok ok;; *) check "QQ 扫码二维码返回 key + PNG" "key+png" "$(printf '%s' "$QQ" | head -c 80)";; esac
case "$QQ" in *'"matrix"'*) check "QQ 扫码二维码含模块矩阵（可直接画 SVG）" ok ok;; *) check "QQ 扫码二维码含模块矩阵" "matrix" "无（退回 PNG 也可用）";; esac
case "$QQ" in *qrsig*|*pt_login_sig*) check "QQ 扫码响应不带 ptlogin 会话 cookie" "脱敏" "leak";; *) check "QQ 扫码响应不带 ptlogin 会话 cookie" ok ok;; esac
check "QQ 未知二维码会话 → 404" 404 "$(code "$B/dsh-music/api/liked-sync/qq/qr/poll?key=nope")"
case "$(code -X POST "$B/dsh-music/api/liked-sync/qq/sync")" in 200|401) check "QQ 同步 POST → 200（已登录）或 401（未登录）" ok ok;; *) check "QQ 同步 POST → 200/401" "200|401" "$(code -X POST "$B/dsh-music/api/liked-sync/qq/sync")";; esac
case "$(code -X POST "$B/dsh-music/api/liked-sync/kugou/sync")" in 404|405) check "liked-sync 未知平台 → 404/405（无此路由）" ok ok;; *) check "liked-sync 未知平台 → 404/405" "404|405" "$(code -X POST "$B/dsh-music/api/liked-sync/kugou/sync")";; esac

echo "----"
echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]