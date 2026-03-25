import { describe, expect, it } from "vitest";
import { WorkerError } from "../../src/errors";
import { parseGifJobOptions } from "../../src/options";

function captureWorkerError(fn: () => void): WorkerError {
  try {
    fn();
  } catch (error) {
    return error as WorkerError;
  }

  throw new Error("Expected WorkerError");
}

describe("parseGifJobOptions", () => {
  it("uses defaults for missing params", () => {
    const url = new URL("https://example.com/v1/mp4-to-gif");

    expect(parseGifJobOptions(url)).toEqual({
      startMs: 0,
      durationMs: 5000,
      fps: 10,
      maxWidth: 320,
      colors: 128
    });
  });

  it("treats empty values as defaults", () => {
    const url = new URL("https://example.com/v1/mp4-to-gif?fps=&colors=");

    expect(parseGifJobOptions(url)).toMatchObject({
      fps: 10,
      colors: 128
    });
  });

  it("rejects invalid integers", () => {
    const url = new URL("https://example.com/v1/mp4-to-gif?fps=abc");
    const error = captureWorkerError(() => parseGifJobOptions(url));

    expect(error.code).toBe("unsupported_feature");
    expect(error.message).toMatch(/Invalid integer query param: fps/);
  });

  it("rejects out-of-range values", () => {
    const cases = [
      ["startMs", "startMs=-1", "unsupported_feature"],
      ["durationMs", "durationMs=6000", "input_too_large"],
      ["fps", "fps=99", "unsupported_feature"],
      ["maxWidth", "maxWidth=999", "input_too_large"],
      ["colors", "colors=1", "unsupported_feature"]
    ] as const;

    for (const [label, query, code] of cases) {
      const url = new URL(`https://example.com/v1/mp4-to-gif?${query}`);
      const error = captureWorkerError(() => parseGifJobOptions(url));
      expect(error.code, label).toBe(code);
    }
  });
});
