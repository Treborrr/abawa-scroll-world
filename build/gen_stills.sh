#!/bin/bash
# Genera las 7 imágenes de escena de Abawa con gpt-image-2 vía fal.ai — EN SERIE.
# Requiere: FAL_KEY en el entorno. Uso: bash gen_stills.sh [n]  (sin arg: todas; con n: solo esa escena)
set -u
DIR="$(cd "$(dirname "$0")/stills" && pwd)"
MODEL="openai/gpt-image-2"
QUEUE="https://queue.fal.run/$MODEL"

if [ -z "${FAL_KEY:-}" ]; then echo "ERROR: FAL_KEY no está en el entorno" >&2; exit 1; fi

gen_one() {
  i="$1"
  prompt_file="$DIR/still_$i.txt"
  out_png="$DIR/still_$i.png"
  [ -f "$prompt_file" ] || { echo "[$i] falta $prompt_file" >&2; return 1; }

  body=$(python3 - "$prompt_file" <<'PY'
import json, sys
prompt = open(sys.argv[1]).read().strip()
print(json.dumps({
    "prompt": prompt,
    "image_size": {"width": 2400, "height": 1600},
    "quality": "high",
    "output_format": "png",
    "num_images": 1,
}))
PY
)
  echo "[$i] enviando a la cola…"
  sub=$(curl -sS -X POST "$QUEUE" \
    -H "Authorization: Key $FAL_KEY" \
    -H "Content-Type: application/json" \
    -d "$body")
  status_url=$(printf '%s' "$sub" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status_url',''))" 2>/dev/null)
  response_url=$(printf '%s' "$sub" | python3 -c "import json,sys; print(json.load(sys.stdin).get('response_url',''))" 2>/dev/null)
  if [ -z "$status_url" ]; then echo "[$i] fallo al encolar: $sub" >&2; return 1; fi

  # poll hasta COMPLETED (timeout ~10 min)
  t=0
  while [ $t -lt 600 ]; do
    st=$(curl -sS -H "Authorization: Key $FAL_KEY" "$status_url" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
    [ "$st" = "COMPLETED" ] && break
    if [ "$st" = "FAILED" ] || [ "$st" = "ERROR" ]; then echo "[$i] generación falló (status=$st)" >&2; return 1; fi
    sleep 5; t=$((t+5))
  done
  [ "$st" = "COMPLETED" ] || { echo "[$i] timeout esperando resultado" >&2; return 1; }

  res=$(curl -sS -H "Authorization: Key $FAL_KEY" "$response_url")
  img_url=$(printf '%s' "$res" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['images'][0]['url'])" 2>/dev/null)
  if [ -z "$img_url" ]; then echo "[$i] respuesta sin imagen: $res" >&2; return 1; fi
  curl -sS -o "$out_png" "$img_url"
  echo "[$i] OK → $out_png ($(du -h "$out_png" | cut -f1))"
}

if [ $# -ge 1 ]; then
  gen_one "$1"
else
  for i in 1 2 3 4 5 6 7; do
    gen_one "$i" || echo "[$i] ERROR — re-rollear individualmente con: bash gen_stills.sh $i" >&2
  done
fi
