import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { basename, join } from "node:path";
import { ensureRealVideoFixtures, fixtures, derived } from "./real-video-fixtures.mts";

const outDir = join(derived, "ffmpeg-palette");

interface Variant {
  name: string;
  palettegen: string;
  paletteuse: string;
}

const variants: Variant[] = [
  {
    name: "bayer-diff",
    palettegen: "fps=8,scale=160:-1:flags=lanczos,palettegen=stats_mode=diff",
    paletteuse: "fps=8,scale=160:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle"
  },
  {
    name: "floyd-diff",
    palettegen: "fps=8,scale=160:-1:flags=lanczos,palettegen=stats_mode=diff",
    paletteuse: "fps=8,scale=160:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=floyd_steinberg:diff_mode=rectangle"
  },
  {
    name: "sierra-balanced",
    palettegen: "fps=8,scale=160:-1:flags=lanczos,palettegen=stats_mode=full",
    paletteuse: "fps=8,scale=160:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a"
  },
  {
    name: "bayer-diff-128",
    palettegen: "fps=8,scale=160:-1:flags=lanczos,palettegen=stats_mode=diff:max_colors=128",
    paletteuse: "fps=8,scale=160:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle"
  },
  {
    name: "bayer-diff-96",
    palettegen: "fps=8,scale=160:-1:flags=lanczos,palettegen=stats_mode=diff:max_colors=96",
    paletteuse: "fps=8,scale=160:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle"
  },
  {
    name: "bayer-diff-64",
    palettegen: "fps=8,scale=160:-1:flags=lanczos,palettegen=stats_mode=diff:max_colors=64",
    paletteuse: "fps=8,scale=160:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle"
  }
];

const inputs = [
  fixtures.baseline,
  fixtures.bframes
];

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: "pipe" });
}

function generateGif(input: string, variant: Variant): { gifPath: string; elapsedMs: number; bytes: number } {
  const stem = basename(input, ".mp4");
  const palettePath = join(outDir, `${stem}.${variant.name}.png`);
  const gifPath = join(outDir, `${stem}.${variant.name}.gif`);
  const start = performance.now();

  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-t",
    "2.0",
    "-i",
    input,
    "-vf",
    variant.palettegen,
    palettePath
  ]);

  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-t",
    "2.0",
    "-i",
    input,
    "-i",
    palettePath,
    "-lavfi",
    variant.paletteuse,
    gifPath
  ]);

  const elapsedMs = performance.now() - start;
  return {
    gifPath,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    bytes: statSync(gifPath).size
  };
}

ensureRealVideoFixtures();
mkdirSync(outDir, { recursive: true });

for (const input of inputs) {
  for (const variant of variants) {
    const result = generateGif(input, variant);
    console.log(JSON.stringify({
      input: basename(input),
      variant: variant.name,
      gifPath: result.gifPath,
      bytes: result.bytes,
      elapsedMs: result.elapsedMs
    }));
  }
}
