#!/bin/bash
# Variantes MÓVILES de los 13 clips (site/assets/vid/*_m.mp4), a partir de los
# 720p nativos de Kling en build/video (no del upscale 1440p).
#
# Por qué así (2026-11-06, el scroll se congelaba en el teléfono):
#   - 1280×720: la versión anterior era 1080p y los decodificadores hardware de
#     los móviles no dan para scrubbing a esa resolución con varios clips vivos.
#   - GOP 4 y sin B-frames (-bf 0 -refs 1): el coste de un seek en un teléfono es
#     "frames a decodificar desde el keyframe anterior"; así nunca pasa de 3.
#   - perfil Main 3.1: lo decodifica por hardware cualquier teléfono.
#   - crf 25 → ~2-3 MB por clip (~35 MB los 13), asumible en datos móviles.
set -u
SRC="$(cd "$(dirname "$0")/video" && pwd)"
OUT="$(cd "$(dirname "$0")/../site/assets/vid" && pwd)"
enc() {
  ffmpeg -loglevel error -y -i "$SRC/$1.mp4" -an \
    -vf "unsharp=5:5:0.5:5:5:0.0" \
    -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -profile:v main -level 3.1 \
    -g 4 -keyint_min 4 -sc_threshold 0 -bf 0 -refs 1 -movflags +faststart \
    "$OUT/$1_m.mp4" && echo "$1_m → $(du -h "$OUT/$1_m.mp4" | cut -f1)"
}
for i in 1 2 3 4 5 6 7; do enc "dive_$i"; done
for i in 1 2 3 4 5 6; do [ -f "$SRC/conn_$i.mp4" ] && enc "conn_$i" || echo "conn_$i pendiente"; done
