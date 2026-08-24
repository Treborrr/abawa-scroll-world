#!/bin/bash
# Genera un clip Kling O3 Standard (image-to-video) vía fal.ai — 5 s, sin audio.
# Uso:
#   bash gen_video.sh dive N          → video/dive_N.mp4   (start = video/start_N.jpg, prompt = video/dive_N.txt)
#   bash gen_video.sh conn N          → video/conn_N.mp4   (start = video/conn_N_start.png, end = video/conn_N_end.png, prompt = video/conn_N.txt)
# Requiere FAL_KEY en el entorno. Peticiones SIEMPRE en serie (una a la vez).
set -u
DIR="$(cd "$(dirname "$0")/video" && pwd)"
MODEL="fal-ai/kling-video/o3/standard/image-to-video"
QUEUE="https://queue.fal.run/$MODEL"

if [ -z "${FAL_KEY:-}" ]; then echo "ERROR: FAL_KEY no está en el entorno" >&2; exit 1; fi
KIND="${1:?uso: gen_video.sh dive|conn N}"; N="${2:?falta el número}"

if [ "$KIND" = "dive" ]; then
  PROMPT_FILE="$DIR/dive_$N.txt"; START="$DIR/start_$N.jpg"; END_IMG=""; OUT="$DIR/dive_$N.mp4"
else
  PROMPT_FILE="$DIR/conn_$N.txt"; START="$DIR/conn_${N}_start.png"; END_IMG="$DIR/conn_${N}_end.png"; OUT="$DIR/conn_$N.mp4"
fi
for f in "$PROMPT_FILE" "$START"; do [ -f "$f" ] || { echo "falta $f" >&2; exit 1; }; done
[ -n "$END_IMG" ] && { [ -f "$END_IMG" ] || { echo "falta $END_IMG" >&2; exit 1; }; }

body=$(python3 - "$PROMPT_FILE" "$START" "${END_IMG:-}" <<'PY'
import base64, json, mimetypes, sys
prompt = open(sys.argv[1]).read().strip()
def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode()
body = {
    "prompt": prompt,
    "image_url": data_uri(sys.argv[2]),
    "duration": "5",
    "generate_audio": False,
    "negative_prompt": "blur, distort, low quality, text, captions, letters, logos",
    "cfg_scale": 0.5,
}
if len(sys.argv) > 3 and sys.argv[3]:
    body["end_image_url"] = data_uri(sys.argv[3])
print(json.dumps(body))
PY
)

echo "[$KIND $N] enviando a la cola…"
sub=$(printf '%s' "$body" | curl -sS -X POST "$QUEUE" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @-)
status_url=$(printf '%s' "$sub" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status_url',''))" 2>/dev/null)
response_url=$(printf '%s' "$sub" | python3 -c "import json,sys; print(json.load(sys.stdin).get('response_url',''))" 2>/dev/null)
if [ -z "$status_url" ]; then echo "[$KIND $N] fallo al encolar: $(printf '%s' "$sub" | head -c 400)" >&2; exit 1; fi

t=0; st=""
while [ $t -lt 900 ]; do
  st=$(curl -sS -H "Authorization: Key $FAL_KEY" "$status_url" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  [ "$st" = "COMPLETED" ] && break
  if [ "$st" = "FAILED" ] || [ "$st" = "ERROR" ]; then
    echo "[$KIND $N] generación falló (status=$st). Detalle:" >&2
    curl -sS -H "Authorization: Key $FAL_KEY" "$response_url" | head -c 600 >&2
    exit 1
  fi
  sleep 10; t=$((t+10))
done
[ "$st" = "COMPLETED" ] || { echo "[$KIND $N] timeout" >&2; exit 1; }

res=$(curl -sS -H "Authorization: Key $FAL_KEY" "$response_url")
vid_url=$(printf '%s' "$res" | python3 -c "import json,sys; print(json.load(sys.stdin)['video']['url'])" 2>/dev/null)
if [ -z "$vid_url" ]; then echo "[$KIND $N] respuesta sin video: $(printf '%s' "$res" | head -c 400)" >&2; exit 1; fi
curl -sS -o "$OUT" "$vid_url"
echo "[$KIND $N] OK → $OUT ($(du -h "$OUT" | cut -f1))"
