#!/bin/bash
# Amplía los 13 clips 720p de Kling a 1440p con Real-ESRGAN (realesr-animevideov3 x2, local)
# y los codifica para scrubbing: escritorio 2560×1440 y móvil 1920×1080, GOP 8, sin unsharp.
# OJO: las variantes móviles (*_m.mp4) que genera este script quedaron SUPERADAS por
# build/encode_mobile.sh (720p, GOP 4, desde los 720p nativos). Si se vuelve a correr
# este script, correr después encode_mobile.sh para no dejar los 1080p en el sitio.
# Binario: build/tools/realesrgan (release v0.2.5.0 macOS de xinntao/Real-ESRGAN).
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN="$ROOT/tools/realesrgan"
SRC="$ROOT/video"
OUT="$(cd "$ROOT/../site/assets/vid" && pwd)"
TMP="${TMPDIR:-/tmp}/abawa_upscale"
up() {
  rm -rf "$TMP" && mkdir -p "$TMP/in" "$TMP/out"
  ffmpeg -loglevel error -y -i "$SRC/$1.mp4" "$TMP/in/f%04d.png" || return 1
  "$BIN/realesrgan-ncnn-vulkan" -i "$TMP/in" -o "$TMP/out" -n realesr-animevideov3 -s 2 -f png -m "$BIN/models" >/dev/null 2>&1 || return 1
  ffmpeg -loglevel error -y -framerate 24 -i "$TMP/out/f%04d.png" -an \
    -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p \
    -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart "$OUT/$1.mp4" || return 1
  ffmpeg -loglevel error -y -framerate 24 -i "$TMP/out/f%04d.png" -an -vf "scale=1920:1080:flags=lanczos" \
    -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p \
    -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart "$OUT/$1_m.mp4" || return 1
  echo "$1 → $(du -h "$OUT/$1.mp4" | cut -f1) / móvil $(du -h "$OUT/$1_m.mp4" | cut -f1)"
}
for c in dive_1 dive_2 dive_3 dive_4 dive_5 dive_6 dive_7 conn_1 conn_2 conn_3 conn_4 conn_5 conn_6; do
  up "$c" || echo "$c FALLÓ"
done
rm -rf "$TMP"
