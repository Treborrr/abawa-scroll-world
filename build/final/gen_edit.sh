#!/bin/bash
# Genera el frame final "splash" (tableta real + cacaos volando) editando
# build/final/base.png con máscara build/final/mask.png vía gpt-image-2/edit
# en fal.ai. Requiere FAL_KEY en el entorno.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL="openai/gpt-image-2/edit"
QUEUE="https://queue.fal.run/$MODEL"

if [ -z "${FAL_KEY:-}" ]; then echo "ERROR: FAL_KEY no está en el entorno" >&2; exit 1; fi

PROMPT_FILE="$DIR/edit_prompt.txt"
BASE_IMG="$DIR/base.png"
MASK_IMG="$DIR/mask.png"
OUT="$DIR/edit_result_$(date +%s 2>/dev/null || echo 0).png"
[ -n "${1:-}" ] && OUT="$DIR/$1"
[ -n "${2:-}" ] && PROMPT_FILE="$DIR/$2"

for f in "$PROMPT_FILE" "$BASE_IMG" "$MASK_IMG"; do [ -f "$f" ] || { echo "falta $f" >&2; exit 1; }; done

body=$(python3 - "$PROMPT_FILE" "$BASE_IMG" "$MASK_IMG" <<'PY'
import base64, json, sys
prompt = open(sys.argv[1]).read().strip()
def data_uri(path, mime):
    return f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode()
body = {
    "prompt": prompt,
    "image_urls": [data_uri(sys.argv[2], "image/png")],
    "mask_url": data_uri(sys.argv[3], "image/png"),
    "image_size": {"width": 1280, "height": 720},
    "quality": "high",
    "output_format": "png",
    "num_images": 1,
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
while [ $t -lt 300 ]; do
  st=$(curl -sS -H "Authorization: Key $FAL_KEY" "$status_url" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  [ "$st" = "COMPLETED" ] && break
  if [ "$st" = "FAILED" ] || [ "$st" = "ERROR" ]; then
    echo "generación falló (status=$st). Detalle:" >&2
    curl -sS -H "Authorization: Key $FAL_KEY" "$response_url" | head -c 800 >&2
    exit 1
  fi
  sleep 5; t=$((t+5))
done
[ "$st" = "COMPLETED" ] || { echo "timeout"; exit 1; }

res=$(curl -sS -H "Authorization: Key $FAL_KEY" "$response_url")
img_url=$(printf '%s' "$res" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['images'][0]['url'])" 2>/dev/null)
if [ -z "$img_url" ]; then echo "respuesta sin imagen: $(printf '%s' "$res" | head -c 800)" >&2; exit 1; fi
curl -sS -o "$OUT" "$img_url"
echo "OK → $OUT ($(du -h "$OUT" | cut -f1))"
