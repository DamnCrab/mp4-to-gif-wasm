import { statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const wasmPath = resolve(process.cwd(), "native/out/decoder.wasm");

try {
  const raw = readFileSync(wasmPath);
  const stats = statSync(wasmPath);
  const gzip = gzipSync(raw);
  console.log(JSON.stringify({
    file: wasmPath,
    rawBytes: stats.size,
    gzipBytes: gzip.byteLength
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unable to read ${wasmPath}: ${message}`);
  process.exit(1);
}
