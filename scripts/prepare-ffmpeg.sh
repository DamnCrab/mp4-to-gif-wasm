#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor"
FFMPEG_DIR="$VENDOR_DIR/ffmpeg"
FFMPEG_PATH="vendor/ffmpeg"

mkdir -p "$VENDOR_DIR"

if [ ! -d "$ROOT_DIR/.git" ]; then
  echo "This script must run from a git checkout of the repository." >&2
  exit 1
fi

if [ ! -f "$ROOT_DIR/.gitmodules" ]; then
  echo "Missing .gitmodules; vendor/ffmpeg is expected to be a git submodule." >&2
  exit 1
fi

git -C "$ROOT_DIR" submodule sync -- "$FFMPEG_PATH"
git -C "$ROOT_DIR" submodule update --init --depth 1 -- "$FFMPEG_PATH"

if [ -d "$FFMPEG_DIR/.git" ] || [ -f "$FFMPEG_DIR/.git" ]; then
  exit 0
fi

echo "Unable to initialize FFmpeg submodule at $FFMPEG_DIR." >&2
exit 1
