# Usage Guide

## Output Limits

The package validates requested GIF output parameters through `parseGifJobOptions()` and `convertMp4ToGif()`:

- `startMs >= 0`
- `durationMs <= 5000`
- `fps <= 12`
- `maxWidth <= 480`
- `colors <= 256`

These limits apply to the output clip. The source MP4 itself can be larger or longer.

## Node.js ESM

Node must run in ESM mode. The package does not ship a CommonJS build.

```ts
import { readFile } from "node:fs/promises";
import { convertMp4ToGif } from "mp4-to-gif-wasm";

const mp4 = await readFile("./input.mp4");
const gif = await convertMp4ToGif(
  mp4.buffer.slice(mp4.byteOffset, mp4.byteOffset + mp4.byteLength),
  {
    startMs: 0,
    durationMs: 2000,
    fps: 8,
    maxWidth: 240,
    colors: 96
  }
);
```

## Browser

```ts
import { convertMp4ToGif } from "mp4-to-gif-wasm";

const file = input.files?.[0];
if (!file) {
  throw new Error("missing file");
}

const gif = await convertMp4ToGif(await file.arrayBuffer(), {
  startMs: 0,
  durationMs: 1500,
  fps: 8,
  maxWidth: 200,
  colors: 96
});
```

Notes:

- the package expects a bundler/runtime that understands Wasm asset imports
- the published package includes `dist/decoder.wasm`
- browser and Worker runtimes do not need `process`

## Cloudflare Worker

The package exports a Worker-style handler:

```ts
import { worker } from "mp4-to-gif-wasm";

export default worker;
```

Request shape:

- method: `POST`
- path: `/v1/mp4-to-gif`
- content type: `video/mp4`

Supported query parameters:

- `startMs`
- `durationMs`
- `fps`
- `maxWidth`
- `colors`

Example request:

```txt
POST /v1/mp4-to-gif?startMs=0&durationMs=2000&fps=8&maxWidth=200&colors=96
content-type: video/mp4
```

## Parsing And Decode Flow

Use the lower-level APIs when you need custom orchestration:

```ts
import { H264Decoder, encodeGif, parseMp4Video } from "mp4-to-gif-wasm";

const track = await parseMp4Video(mp4ArrayBuffer);
const decoder = await H264Decoder.create(track);
const frames = decoder.decode(track);

const gif = await encodeGif(frames, {
  startMs: 0,
  durationMs: 1200,
  fps: 8,
  maxWidth: 160,
  colors: 96
});
```

## Stability Notes

When the FFmpeg GIF stage hits memory pressure, the encoder now retries automatically with reduced output settings:

- smaller width
- lower fps
- fewer palette colors

If you still see failures on very large clips, lower `maxWidth`, `durationMs`, `fps`, or `colors` explicitly.
