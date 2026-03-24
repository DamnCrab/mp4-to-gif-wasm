# `mp4-to-gif-wasm`

`mp4-to-gif-wasm` is a focused npm package for converting short H.264 MP4 clips into GIFs with a bundled FFmpeg-based WebAssembly pipeline.

It is usable as:

- a generic npm package
- a low-level Wasm-backed conversion library
- a Cloudflare Worker handler when you want an HTTP wrapper

## Scope

Current input and runtime constraints:

- input container: MP4
- supported video codec: `avc1` / H.264 only
- B-frames: supported
- audio: ignored
- input limits: `<= 5s`, `<= 480px` width
- output: GIF

The current architecture keeps MP4 demux in JavaScript and runs decode plus GIF generation in Wasm.

## Features

- H.264 decode in WebAssembly
- B-frame-safe MP4 sample handling
- FFmpeg-based GIF palette pipeline in Wasm
- TypeScript API surface
- Cloudflare Worker entrypoint included

## Install

```sh
npm install mp4-to-gif-wasm
```

## API Surface

The package exports:

- `convertMp4ToGif(buffer, options)`
- `parseMp4Video(buffer)`
- `encodeGif(frames, options)`
- `H264Decoder`
- `worker`

## Example

```ts
import { convertMp4ToGif } from "mp4-to-gif-wasm";

const gif = await convertMp4ToGif(mp4ArrayBuffer, {
  startMs: 0,
  durationMs: 2000,
  fps: 8,
  maxWidth: 160,
  colors: 96
});
```

## Worker Endpoint

The included Worker handler exposes:

`POST /v1/mp4-to-gif`

Query parameters:

- `startMs` default `0`
- `durationMs` default `5000`, max `5000`
- `fps` default `10`, max `12`
- `maxWidth` default `320`, max `480`
- `colors` default `128`, max `256`

Error codes:

- `unsupported_codec`
- `unsupported_container`
- `unsupported_feature`
- `input_too_large`
- `decode_failed`

## Development

```sh
npm install
npm run prepare:ffmpeg
npm run build:native
npm run build
npm run check
npm test
npm run test:real-videos
npm run test:e2e-native
npx wrangler deploy --dry-run
```

## Native Build Prerequisites

- Node.js `>= 22`
- Emscripten
- Binaryen / `wasm-opt`
- FFmpeg source checkout in `vendor/ffmpeg`

Fetch the pinned FFmpeg checkout with:

```sh
npm run prepare:ffmpeg
```

The helper script uses:

- FFmpeg upstream: [https://github.com/FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg)
- pinned ref: `n7.1.1`

## Repository Layout

- `src/`: package entrypoints, Worker wrapper, parser, decoder wrapper, types
- `native/`: FFmpeg build glue and C ABI layer
- `scripts/`: fixture generation, native build helpers, experiments, benchmarks
- `test/`: unit and integration tests

## Open Source Notes

This repository ships a bundled Wasm binary linked against FFmpeg libraries. The repository is therefore published under `LGPL-2.1-or-later`.

Third-party dependencies and upstream source links are tracked in `THIRD_PARTY.md`.

## CI

GitHub Actions cover:

- type checking
- unit tests
- native Wasm rebuild
- real-video boundary tests
- end-to-end Wasm decode/GIF tests
- Wrangler dry-run packaging
