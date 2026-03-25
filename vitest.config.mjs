import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/unit/**/*.test.ts",
      "test/integration/**/*.test.ts"
    ],
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/global.d.ts", "src/types.ts"]
    }
  },
  resolve: {
    alias: {
      "../native/out/decoder.wasm?url": fileURLToPath(new URL("./test/helpers/wasm-url-stub.ts", import.meta.url)),
      "../native/out/decoder.wasm": fileURLToPath(new URL("./test/helpers/wasm-stub.ts", import.meta.url))
    }
  }
});
