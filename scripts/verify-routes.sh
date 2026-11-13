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

# 路径穿越：期望全部 4xx 拒绝（--path-as-is 保留原始 ../）
for p in "../../.config/spotify-sync/refresh_token" "%2e%2e%2f%2e%2e%2f.config%2fspotify-sync%2frefresh_token" "..%252f..%252fetc%252fpasswd" "/etc/passwd" "$ID/../../x" "ffffffffffffffff"; do
  C=$(code --path-as-is "$B/dsh-music/audio/$p")
  case "$C" in 4*) check "穿越拒绝 $p" ok ok;; *) check "穿越拒绝 $p" 4xx "$C";; esac
done

check "rescan POST → 200" 200 "$(code -X POST "$B/dsh-music/api/rescan")"
check "library DELETE → 405" 405 "$(code -X DELETE "$B/dsh-music/api/library")"
check "playback GET → 200" 200 "$(code "$B/dsh-music/api/playback")"
check "playback 非法 volume → 400" 400 "$(code -X POST -d '{"volume":5}' "$B/dsh-music/api/playback")"

echo "----"
echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]