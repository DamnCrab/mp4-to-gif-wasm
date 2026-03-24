import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const script = resolve(root, "native", "build-ffmpeg.sh");

if (!existsSync(script)) {
  console.error(`Missing build script: ${script}`);
  process.exit(1);
}

const ffmpegDir = resolve(root, "vendor", "ffmpeg");
if (!existsSync(ffmpegDir)) {
  console.error(`Missing FFmpeg checkout: ${ffmpegDir}`);
  console.error("Run `npm run prepare:ffmpeg` before `npm run build:native`.");
  process.exit(1);
}

const child = spawn("bash", [script], {
  cwd: root,
  stdio: "inherit",
  shell: false
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
