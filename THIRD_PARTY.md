# Third-Party Dependencies

This repository depends on upstream projects that are not maintained here.

## Runtime and Build Dependencies

### FFmpeg

- Upstream: [https://github.com/FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg)
- Local checkout path: `vendor/ffmpeg`
- Current pinned ref used by helper script: `n7.1.1`
- License: LGPL-2.1-or-later for the linked configuration used by this repository

FFmpeg provides:

- H.264 decoding via `libavcodec`
- GIF palette generation and palette application via `libavfilter`
- scaling via `libswscale`

### MP4Box.js

- Upstream: [https://github.com/gpac/mp4box.js](https://github.com/gpac/mp4box.js)
- npm package: `mp4box`
- License: BSD-3-Clause

MP4Box.js provides:

- MP4 parsing
- sample extraction
- `avcC` extraction for H.264 decoder configuration

## Test Data and Tooling

### Sample Video Fixtures

- Source site: [https://samplelib.com](https://samplelib.com)
- Download URL family: [https://download.samplelib.com/mp4/](https://download.samplelib.com/mp4/)

These files are only used for local and CI fixture generation.

### Emscripten

- Upstream: [https://github.com/emscripten-core/emsdk](https://github.com/emscripten-core/emsdk)

Used to build the bundled WebAssembly module.

## Notes

- `vendor/ffmpeg` is not committed by default; CI and local builds fetch it from the upstream repository.
- The published npm package includes the generated `native/out/decoder.wasm`.
