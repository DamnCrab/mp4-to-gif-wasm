import { parseMp4Video } from "../src/mp4.ts";
import { ensureRealVideoFixtures, fixtures, readArrayBuffer } from "./real-video-fixtures.mts";

ensureRealVideoFixtures();

const cases = [
  ["real-baseline-ok.mp4", fixtures.baseline, "accept"],
  ["real-bframes-ok.mp4", fixtures.bframes, "accept-bframes"],
  ["real-fragmented.mp4", fixtures.fragmented, "reject:unsupported_container"],
  ["real-oversize.mp4", fixtures.oversize, "reject:input_too_large"],
  ["real-too-long.mp4", fixtures.tooLong, "reject:input_too_large"],
  ["real-mpeg4.mp4", fixtures.mpeg4, "reject:unsupported_codec"]
] as const;

const results: Array<Record<string, string | number | boolean>> = [];

for (const [name, path, expected] of cases) {
  try {
    const track = await parseMp4Video(readArrayBuffer(path));
    results.push({
      name,
      expected,
      status: "accepted",
      codec: track.codec,
      width: track.width,
      height: track.height,
      durationMs: track.durationMs,
      samples: track.samples.length,
      hasBFrameTiming: track.samples.some((sample) => sample.pts !== sample.dts)
    });
  } catch (error) {
    const maybeError = error as { code?: string; message?: string };
    results.push({
      name,
      expected,
      status: "rejected",
      code: maybeError.code ?? "unknown",
      message: maybeError.message ?? String(error)
    });
  }
}

for (const result of results) {
  console.log(JSON.stringify(result));
}
