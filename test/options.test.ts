import { describe, expect, it } from "vitest";
import { parseGifJobOptions } from "../src/options";

describe("parseGifJobOptions", () => {
  it("uses defaults", () => {
    const url = new URL("https://example.com/v1/mp4-to-gif");
    expect(parseGifJobOptions(url)).toEqual({
      startMs: 0,
      durationMs: 5000,
      fps: 10,
      maxWidth: 320,
      colors: 128
    });
  });

  it("rejects duration above limit", () => {
    const url = new URL("https://example.com/v1/mp4-to-gif?durationMs=6000");
    expect(() => parseGifJobOptions(url)).toThrowError(/durationMs/);
  });
});
