import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runFfmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "pipe"
  });
}

function readArrayBuffer(path) {
  const file = readFileSync(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

function assertGif(bytes, label) {
  assert.ok(bytes.byteLength > 0, `${label}: expected non-empty GIF output`);
  assert.equal(String.fromCharCode(...bytes.slice(0, 6)), "GIF89a", `${label}: expected GIF header`);
}

const dir = mkdtempSync(join(tmpdir(), "mp4-to-gif-package-"));
const baseline = join(dir, "baseline.mp4");
const oversize = join(dir, "oversize.mp4");
const tooLong = join(dir, "too-long.mp4");

runFfmpeg([
  "-f", "lavfi",
  "-i", "testsrc=size=320x180:rate=24",
  "-t", "1.5",
  "-an",
  "-c:v", "libx264",
  "-profile:v", "baseline",
  "-bf", "0",
  "-pix_fmt", "yuv420p",
  "-preset", "ultrafast",
  "-use_editlist", "0",
  "-movflags", "+faststart",
  baseline
]);

runFfmpeg([
  "-f", "lavfi",
  "-i", "testsrc=size=640x360:rate=24",
  "-t", "4.0",
  "-an",
  "-c:v", "libx264",
  "-profile:v", "baseline",
  "-bf", "0",
  "-pix_fmt", "yuv420p",
  "-preset", "ultrafast",
  "-use_editlist", "0",
  "-movflags", "+faststart",
  oversize
]);

runFfmpeg([
  "-f", "lavfi",
  "-i", "testsrc=size=320x180:rate=24",
  "-t", "6.2",
  "-an",
  "-c:v", "libx264",
  "-profile:v", "baseline",
  "-bf", "0",
  "-pix_fmt", "yuv420p",
  "-preset", "ultrafast",
  "-use_editlist", "0",
  "-movflags", "+faststart",
  tooLong
]);

const api = await import("../../dist/index.js");
const workerEntry = await import("../../dist/worker.js");

const baselineGif = await api.convertMp4ToGif(readArrayBuffer(baseline), {
  startMs: 0,
  durationMs: 1200,
  fps: 8,
  maxWidth: 160,
  colors: 64
});
assertGif(baselineGif, "baseline convertMp4ToGif");

const oversizeGif = await api.convertMp4ToGif(readArrayBuffer(oversize), {
  startMs: 0,
  durationMs: 1500,
  fps: 8,
  maxWidth: 240,
  colors: 96
});
assertGif(oversizeGif, "oversize source with clipped output");

const tooLongGif = await api.convertMp4ToGif(readArrayBuffer(tooLong), {
  startMs: 500,
  durationMs: 2000,
  fps: 8,
  maxWidth: 200,
  colors: 96
});
assertGif(tooLongGif, "long source with short output window");

const workerResponse = await workerEntry.default.fetch(new Request(
  "https://example.com/v1/mp4-to-gif?startMs=500&durationMs=1800&fps=8&maxWidth=200&colors=96",
  {
    method: "POST",
    headers: {
      "content-type": "video/mp4"
    },
    body: new Uint8Array(readFileSync(tooLong))
  }
));

assert.equal(workerResponse.status, 200, "worker fetch should succeed");
assert.equal(workerResponse.headers.get("content-type"), "image/gif");
assertGif(new Uint8Array(await workerResponse.arrayBuffer()), "worker fetch response");
