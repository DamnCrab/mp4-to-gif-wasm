import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "../native/out/decoder.wasm": fileURLToPath(new URL("./test/wasm-stub.ts", import.meta.url))
    }
  }
});
