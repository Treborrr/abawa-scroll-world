#!/bin/bash
# Codifica los 13 clips para scrubbing: resolución nativa, crf 20, GOP 8, sin audio, faststart, unsharp suave.
set -u
SRC="$(cd "$(dirname "$0")/video" && pwd)"
OUT="$(cd "$(dirname "$0")/../site/assets/vid" && pwd)"
enc() {
  ffmpeg -loglevel error -y -i "$SRC/$1.mp4" -an \
    -vf "unsharp=5:5:0.8:5:5:0.0" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
    -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart \
    "$OUT/$1.mp4" && echo "$1 → $(du -h "$OUT/$1.mp4" | cut -f1)"
}
for i in 1 2 3 4 5 6 7; do enc "dive_$i"; done
for i in 1 2 3 4 5 6; do [ -f "$SRC/conn_$i.mp4" ] && enc "conn_$i" || echo "conn_$i pendiente"; done
