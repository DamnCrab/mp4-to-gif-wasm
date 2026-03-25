# `mp4-to-gif-wasm`

`mp4-to-gif-wasm` converts H.264 MP4 clips into GIFs with a bundled FFmpeg-based WebAssembly pipeline.

It is designed to work out of the box in:

- Node.js ESM
- modern browsers
- bundler-based Worker runtimes such as Cloudflare Workers

## What It Does

- parses MP4 in JavaScript
- decodes H.264 in Wasm
- encodes GIF in Wasm with FFmpeg palette filters
- exports both library APIs and a Worker-style `fetch()` handler

## Runtime Support

- container: MP4
- video codec: `avc1` / H.264
- audio: ignored
- B-frames: supported
- output: GIF
- Node: `>= 22`
- module format: ESM only

Important: size and duration limits apply to the requested GIF output parameters, not to the original source asset. A source video may be longer than 5 seconds or wider than 480 pixels as long as the requested output clip stays within the configured limits.

## Install

```sh
npm install mp4-to-gif-wasm
```

## Quick Start

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

## Exports

- `convertMp4ToGif(buffer, options)`
- `parseMp4Video(buffer)`
- `encodeGif(frames, options)`
- `H264Decoder`
- `worker`
- `parseGifJobOptions(url)`
- `WorkerError`
- `toErrorResponse(error)`

## Usage Guides

- [USAGE.md](./USAGE.md): Node, browser, and Cloudflare Worker examples
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md): limitations, failure modes, and mitigation notes

## Development

```sh
npm install
npm run prepare:ffmpeg
npm run check
npm test
npm run test:coverage
npm run test:dist
npm run build:native
npm run test:native
npm run test:browser
```

## Test Suites

- `test/unit`: option parsing, API surface, and error mapping
- `test/integration`: MP4 parsing, worker behavior, and Wasm-backed GIF flow under Node
- `test/native`: real FFmpeg/Wasm verification against generated and real fixtures
- `test/browser`: Chromium smoke coverage against built `dist/*` assets
- `test/package`: built-package import smoke for Node ESM consumers

CI runs:

- type checking
- coverage reporting
- built-package import smoke
- native rebuild plus end-to-end verification
- browser smoke coverage

## FFmpeg Source And License Compliance

This package distributes a WebAssembly binary that statically links selected FFmpeg libraries.

- FFmpeg upstream repository: [https://github.com/FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg)
- pinned source checkout: Git submodule at `vendor/ffmpeg`
- pinned upstream ref: `n7.1.1`
- build script: `native/build-ffmpeg.sh`
- bootstrap script: `scripts/prepare-ffmpeg.sh`

See `FFMPEG_COMPLIANCE.md` and `THIRD_PARTY.md` for source availability and redistribution notes.

## Native Build Prerequisites

- Node.js `>= 22`
- Emscripten
- Binaryen / `wasm-opt`
- FFmpeg source checkout in `vendor/ffmpeg`

Initialize the pinned FFmpeg checkout with:

```sh
npm run prepare:ffmpeg
```
