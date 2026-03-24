import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const root = "/tmp/cf-worker-video-samples";
export const downloads = root;
export const derived = join(root, "derived");

export const originals = {
  sample5: join(downloads, "sample-5s.mp4"),
  sample10: join(downloads, "sample-10s.mp4"),
  sample15: join(downloads, "sample-15s.mp4")
};

export const fixtures = {
  baseline: join(derived, "real-baseline-ok.mp4"),
  bframes: join(derived, "real-bframes-ok.mp4"),
  fragmented: join(derived, "real-fragmented.mp4"),
  oversize: join(derived, "real-oversize.mp4"),
  tooLong: join(derived, "real-too-long.mp4"),
  mpeg4: join(derived, "real-mpeg4.mp4")
};

function quiet(command: string, args: string[]): void {
  execFileSync(command, args, {
    stdio: "pipe"
  });
}

function download(url: string, output: string): void {
  if (existsSync(output)) {
    return;
  }
  quiet("curl", ["-L", url, "-o", output]);
}

function encode(input: string, output: string, args: string[]): void {
  quiet("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, ...args, output]);
}

export function readArrayBuffer(path: string): ArrayBuffer {
  const file = readFileSync(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

export function ensureRealVideoFixtures(): typeof fixtures {
  mkdirSync(downloads, { recursive: true });
  mkdirSync(derived, { recursive: true });

  download("https://download.samplelib.com/mp4/sample-5s.mp4", originals.sample5);
  download("https://download.samplelib.com/mp4/sample-10s.mp4", originals.sample10);
  download("https://download.samplelib.com/mp4/sample-15s.mp4", originals.sample15);

  encode(originals.sample5, fixtures.baseline, [
    "-t", "4.5",
    "-an",
    "-vf", "scale=480:-2",
    "-c:v", "libx264",
    "-profile:v", "baseline",
    "-bf", "0",
    "-pix_fmt", "yuv420p",
    "-preset", "veryfast",
    "-use_editlist", "0",
    "-movflags", "+faststart"
  ]);

  encode(originals.sample5, fixtures.bframes, [
    "-t", "4.5",
    "-an",
    "-vf", "scale=480:-2",
    "-c:v", "libx264",
    "-profile:v", "high",
    "-bf", "2",
    "-g", "48",
    "-keyint_min", "48",
    "-sc_threshold", "0",
    "-pix_fmt", "yuv420p",
    "-preset", "veryfast",
    "-use_editlist", "0",
    "-movflags", "+faststart"
  ]);

  encode(originals.sample5, fixtures.fragmented, [
    "-t", "4.5",
    "-an",
    "-vf", "scale=480:-2",
    "-c:v", "libx264",
    "-profile:v", "baseline",
    "-bf", "0",
    "-pix_fmt", "yuv420p",
    "-preset", "veryfast",
    "-use_editlist", "0",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof"
  ]);

  encode(originals.sample5, fixtures.oversize, [
    "-t", "4.5",
    "-an",
    "-vf", "scale=640:-2",
    "-c:v", "libx264",
    "-profile:v", "baseline",
    "-bf", "0",
    "-pix_fmt", "yuv420p",
    "-preset", "veryfast",
    "-use_editlist", "0",
    "-movflags", "+faststart"
  ]);

  encode(originals.sample10, fixtures.tooLong, [
    "-t", "6.0",
    "-an",
    "-vf", "scale=480:-2",
    "-c:v", "libx264",
    "-profile:v", "baseline",
    "-bf", "0",
    "-pix_fmt", "yuv420p",
    "-preset", "veryfast",
    "-use_editlist", "0",
    "-movflags", "+faststart"
  ]);

  encode(originals.sample5, fixtures.mpeg4, [
    "-t", "4.5",
    "-an",
    "-vf", "scale=480:-2",
    "-c:v", "mpeg4",
    "-q:v", "5",
    "-use_editlist", "0",
    "-movflags", "+faststart"
  ]);

  return fixtures;
}
