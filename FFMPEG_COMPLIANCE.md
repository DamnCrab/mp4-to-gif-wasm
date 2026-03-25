# FFmpeg Source And LGPL Compliance

This repository distributes a WebAssembly binary, `dist/decoder.wasm`, that is built by statically linking selected FFmpeg libraries together with project-specific glue code.

## Upstream Source

- FFmpeg upstream repository: [https://github.com/FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg)
- Source location in this repository: Git submodule at `vendor/ffmpeg`
- Pinned upstream ref used for builds: `n7.1.1`

The Git submodule records the exact FFmpeg revision used by this project for each tagged release.

To retrieve the exact source for a published release from GitHub:

```sh
git clone --recurse-submodules https://github.com/DamnCrab/mp4-to-gif-wasm.git
cd mp4-to-gif-wasm
git checkout <release-tag>
git submodule update --init --recursive
```

## Build Materials Included By This Repository

- Project glue code: `native/decoder.c`
- FFmpeg build script: `native/build-ffmpeg.sh`
- Submodule initialization helper: `scripts/prepare-ffmpeg.sh`
- Third-party attribution summary: `THIRD_PARTY.md`

## Rebuilding The Distributed Wasm

From a git checkout of this repository:

```sh
npm run prepare:ffmpeg
npm run build:native
npm run build
```

`npm run prepare:ffmpeg` initializes the pinned `vendor/ffmpeg` submodule revision recorded by this repository.

## Distribution Notes

- The npm package distributes the built artifact `dist/decoder.wasm`.
- FFmpeg is configured without `--enable-gpl` and without `--enable-nonfree` in `native/build-ffmpeg.sh`.
- If this repository ever carries local modifications to FFmpeg itself, a corresponding patch file should be added alongside this document for the affected release.
