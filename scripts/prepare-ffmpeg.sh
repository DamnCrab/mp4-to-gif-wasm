#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor"
FFMPEG_DIR="$VENDOR_DIR/ffmpeg"
FFMPEG_REPO="${FFMPEG_REPO:-https://github.com/FFmpeg/FFmpeg.git}"
FFMPEG_REF="${FFMPEG_REF:-n7.1.1}"

mkdir -p "$VENDOR_DIR"

if [ ! -d "$FFMPEG_DIR/.git" ]; then
  git clone --depth 1 --branch "$FFMPEG_REF" "$FFMPEG_REPO" "$FFMPEG_DIR"
  exit 0
fi

current_ref="$(git -C "$FFMPEG_DIR" describe --tags --always 2>/dev/null || true)"
if [ "$current_ref" = "$FFMPEG_REF" ]; then
  exit 0
fi

git -C "$FFMPEG_DIR" fetch --depth 1 origin "$FFMPEG_REF"
git -C "$FFMPEG_DIR" checkout --detach FETCH_HEAD
