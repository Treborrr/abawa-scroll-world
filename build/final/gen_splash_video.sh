#!/bin/bash
# Genera el clip de video del splash final (Kling O3 image-to-video) vía fal.ai.
# Arranca en base.png (tableta real ya en su lugar, sin splash) y termina en
# el frame aprobado (por defecto final_v2.png) — frame-lock igual que los
# conectores del film. Requiere FAL_KEY en el entorno.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL="fal-ai/kling-video/o3/standard/image-to-video"
QUEUE="https://queue.fal.run/$MODEL"

if [ -z "${FAL_KEY:-}" ]; then echo "ERROR: FAL_KEY no está en el entorno" >&2; exit 1; fi

START="${3:-$DIR/base.png}"
END="${1:-$DIR/final_v2.png}"
PROMPT_FILE="$DIR/splash_prompt.txt"
OUT="${2:-$DIR/splash.mp4}"

for f in "$START" "$END" "$PROMPT_FILE"; do [ -f "$f" ] || { echo "falta $f" >&2; exit 1; }; done

body=$(python3 - "$PROMPT_FILE" "$START" "$END" <<'PY'
import base64, json, mimetypes, sys
prompt = open(sys.argv[1]).read().strip()
def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode()
body = {
    "prompt": prompt,
    "image_url": data_uri(sys.argv[2]),
    "end_image_url": data_uri(sys.argv[3]),
    "duration": "5",
    "generate_audio": False,
    "negative_prompt": "blur, distort, low quality, text, captions, letters, logos, warping product, morphing logo, melting text, distorted chocolate bar, camera movement, camera shake, zoom, red cacao pods, orange pods",
    "cfg_scale": 0.5,
}
print(json.dumps(body))
PY
)

echo "enviando a la cola…"
sub=$(printf '%s' "$body" | curl -sS -X POST "$QUEUE" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @-)
status_url=$(printf '%s' "$sub" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status_url',''))" 2>/dev/null)
response_url=$(printf '%s' "$sub" | python3 -c "import json,sys; print(json.load(sys.stdin).get('response_url',''))" 2>/dev/null)
if [ -z "$status_url" ]; then echo "fallo al encolar: $(printf '%s' "$sub" | head -c 800)" >&2; exit 1; fi

t=0; st=""
while [ $t -lt 900 ]; do
  st=$(curl -sS -H "Authorization: Key $FAL_KEY" "$status_url" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  [ "$st" = "COMPLETED" ] && break
  if [ "$st" = "FAILED" ] || [ "$st" = "ERROR" ]; then
    echo "generación falló (status=$st). Detalle:" >&2
    curl -sS -H "Authorization: Key $FAL_KEY" "$response_url" | head -c 800 >&2
    exit 1
  fi
  sleep 10; t=$((t+10))
done
[ "$st" = "COMPLETED" ] || { echo "timeout"; exit 1; }

res=$(curl -sS -H "Authorization: Key $FAL_KEY" "$response_url")
vid_url=$(printf '%s' "$res" | python3 -c "import json,sys; print(json.load(sys.stdin)['video']['url'])" 2>/dev/null)
if [ -z "$vid_url" ]; then echo "respuesta sin video: $(printf '%s' "$res" | head -c 800)" >&2; exit 1; fi
curl -sS -o "$OUT" "$vid_url"
echo "OK → $OUT ($(du -h "$OUT" | cut -f1))"
