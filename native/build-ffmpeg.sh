#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FFMPEG_DIR="$ROOT_DIR/vendor/ffmpeg"
OUT_DIR="$ROOT_DIR/native/out"
CACHE_DIR="$ROOT_DIR/.cache/emscripten"

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc is required" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
mkdir -p "$CACHE_DIR"
export EM_CACHE="$CACHE_DIR"

if [ ! -d "$FFMPEG_DIR" ]; then
  echo "Missing FFmpeg source tree at $FFMPEG_DIR" >&2
  echo "Clone a fixed FFmpeg release into vendor/ffmpeg before building." >&2
  exit 1
fi

pushd "$FFMPEG_DIR" >/dev/null

if [ -f Makefile ]; then
  make distclean >/dev/null 2>&1 || true
fi

JOBS="$(getconf NPROCESSORS_ONLN 2>/dev/null || echo 4)"

emconfigure ./configure \
  --cc=emcc \
  --ar=emar \
  --ranlib=emranlib \
  --target-os=none \
  --arch=wasm32 \
  --enable-cross-compile \
  --enable-small \
  --disable-x86asm \
  --disable-inline-asm \
  --disable-programs \
  --disable-doc \
  --disable-debug \
  --disable-network \
  --disable-pthreads \
  --disable-runtime-cpudetect \
  --disable-autodetect \
  --disable-everything \
  --disable-avdevice \
  --disable-avformat \
  --disable-swresample \
  --enable-decoder=h264 \
  --enable-parser=h264 \
  --enable-avcodec \
  --enable-avfilter \
  --enable-avutil \
  --enable-swscale \
  --enable-filter=fps \
  --enable-filter=palettegen \
  --enable-filter=paletteuse \
  --enable-filter=scale \
  --extra-cflags="-Oz -flto -fno-vectorize -fno-slp-vectorize" \
  --extra-ldflags="-Oz -flto"

emmake make -j"$JOBS"
popd >/dev/null

emcc \
  "$ROOT_DIR/native/decoder.c" \
  "$FFMPEG_DIR/libavcodec/aom_film_grain.c" \
  "$FFMPEG_DIR/libavcodec/libavcodec.a" \
  "$FFMPEG_DIR/libavfilter/libavfilter.a" \
  "$FFMPEG_DIR/libswscale/libswscale.a" \
  "$FFMPEG_DIR/libavutil/libavutil.a" \
  -I"$FFMPEG_DIR" \
  -Oz \
  -flto \
  -s STANDALONE_WASM=1 \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_decoder_open","_decoder_send_packet","_decoder_receive_frame","_decoder_get_frame_meta","_decoder_flush","_decoder_close","_gif_encoder_open","_gif_encoder_add_frame","_gif_encoder_finish","_gif_encoder_get_output_ptr","_gif_encoder_get_output_size","_gif_encoder_close"]' \
  -s EXPORTED_RUNTIME_METHODS='[]' \
  -Wl,--no-entry \
  -o "$OUT_DIR/decoder.wasm"

if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt \
    -Oz \
    --enable-bulk-memory \
    --enable-bulk-memory-opt \
    --enable-sign-ext \
    --enable-mutable-globals \
    --enable-nontrapping-float-to-int \
    "$OUT_DIR/decoder.wasm" \
    -o "$OUT_DIR/decoder.wasm"
fi

wc -c "$OUT_DIR/decoder.wasm"
