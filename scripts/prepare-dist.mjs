import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = resolve(root, "dist");
const sourceWasmPath = resolve(root, "native", "out", "decoder.wasm");
const distWasmPath = resolve(distDir, "decoder.wasm");

mkdirSync(distDir, { recursive: true });
copyFileSync(sourceWasmPath, distWasmPath);

const distFilesToRewrite = [
  resolve(distDir, "decoder.js"),
  resolve(distDir, "gif.js")
];

for (const filePath of distFilesToRewrite) {
  const source = readFileSync(filePath, "utf8");
  const rewritten = source
    .replaceAll("../native/out/decoder.wasm?url", "./decoder.wasm?url")
    .replaceAll("../native/out/decoder.wasm", "./decoder.wasm");
  if (source !== rewritten) {
    writeFileSync(filePath, rewritten);
  }
}
