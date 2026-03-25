# Known Issues And Troubleshooting

## Fixed Regressions Covered By Tests

The current test suite covers these previously reported regressions:

- Node ESM imports use explicit `.js` extensions
- browser and Worker runtimes do not rely on `process`
- browser and Worker Wasm instantiation provides the required WASI imports
- built `dist/*` assets can be imported directly in Node ESM
- MP4 sample timestamps are normalized to milliseconds
- large source assets are accepted; output clipping limits are enforced separately

## Current Functional Limits

- input container must be MP4
- video codec must be H.264 / `avc1`
- fragmented MP4 is rejected
- rotated / transformed video tracks are rejected
- output clip parameters must stay within:
  - `durationMs <= 5000`
  - `fps <= 12`
  - `maxWidth <= 480`
  - `colors <= 256`

## Common Errors

### `unsupported_codec`

Cause:

- the source video track is not `avc1`

Typical fix:

- transcode the source to H.264 in MP4 first

### `unsupported_container`

Cause:

- fragmented MP4
- malformed MP4
- missing `avcC`
- wrong request content type in Worker mode

Typical fix:

- remux to a standard progressive MP4
- send `content-type: video/mp4` to the Worker entrypoint

### `input_too_large`

Cause:

- requested GIF output is outside the supported clip limits

Typical fix:

- reduce `durationMs`
- reduce `maxWidth`

This error is about the requested output, not the original source dimensions or duration.

### `decode_failed`

Cause:

- FFmpeg decode failure
- GIF encoder memory pressure
- unexpected runtime failure

Typical fix:

- lower `maxWidth`
- lower `fps`
- lower `colors`
- shorten `durationMs`

The encoder already retries once memory-related GIF failures occur, but very large outputs can still fail.

## Cloudflare Worker Notes

- use the published package build, not `src/*` directly
- export the provided `worker` handler
- ensure your bundler/runtime supports Wasm asset imports from npm packages

## License And Source Availability

This package ships a Wasm binary linked against FFmpeg. See:

- `FFMPEG_COMPLIANCE.md`
- `THIRD_PARTY.md`
