import { describe, expect, it } from "vitest";
import { statSync } from "node:fs";
import { resolve } from "node:path";

describe("native decoder size", () => {
  it("keeps decoder.wasm below 3MB", () => {
    const wasmPath = resolve(process.cwd(), "native/out/decoder.wasm");
    const size = statSync(wasmPath).size;
    expect(size).toBeLessThan(3 * 1024 * 1024);
  });
});
