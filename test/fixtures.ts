import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

interface FixtureSet {
  baseline: string;
  bframes: string;
  mpeg4: string;
  fragmented: string;
  oversize: string;
  tooLong: string;
}

let cachedFixtures: FixtureSet | undefined;

function runFfmpeg(args: string[]): void {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "pipe"
  });
}

function buildFixtures(): FixtureSet {
  const dir = mkdtempSync(join(tmpdir(), "mp4-to-gif-fixtures-"));

  const baseline = join(dir, "baseline.mp4");
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

  const bframes = join(dir, "bframes.mp4");
  runFfmpeg([
    "-f", "lavfi",
    "-i", "testsrc2=size=320x180:rate=24",
    "-t", "1.5",
    "-an",
    "-c:v", "libx264",
    "-profile:v", "high",
    "-bf", "2",
    "-g", "48",
    "-keyint_min", "48",
    "-sc_threshold", "0",
    "-pix_fmt", "yuv420p",
    "-preset", "ultrafast",
    "-use_editlist", "0",
    "-movflags", "+faststart",
    bframes
  ]);

  const mpeg4 = join(dir, "mpeg4.mp4");
  runFfmpeg([
    "-f", "lavfi",
    "-i", "testsrc=size=320x180:rate=24",
    "-t", "1.5",
    "-an",
    "-c:v", "mpeg4",
    "-q:v", "5",
    "-use_editlist", "0",
    "-movflags", "+faststart",
    mpeg4
  ]);

  const fragmented = join(dir, "fragmented.mp4");
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
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    fragmented
  ]);

  const oversize = join(dir, "oversize.mp4");
  runFfmpeg([
    "-f", "lavfi",
    "-i", "testsrc=size=640x360:rate=24",
    "-t", "1.5",
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

  const tooLong = join(dir, "too-long.mp4");
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

  return {
    baseline,
    bframes,
    mpeg4,
    fragmented,
    oversize,
    tooLong
  };
}

export function ensureFixtures(): FixtureSet {
  cachedFixtures ??= buildFixtures();
  return cachedFixtures;
}

export function readFixture(path: string): ArrayBuffer {
  const buffer = readFileSync(path);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
