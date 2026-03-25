import { describe, expect, it } from "vitest";
import * as api from "../../src/index";

describe("public API surface", () => {
  it("re-exports the public entrypoints", () => {
    expect(api.worker).toBeDefined();
    expect(api.H264Decoder).toBeDefined();
    expect(api.convertMp4ToGif).toBeTypeOf("function");
    expect(api.encodeGif).toBeTypeOf("function");
    expect(api.parseMp4Video).toBeTypeOf("function");
    expect(api.parseGifJobOptions).toBeTypeOf("function");
    expect(api.WorkerError).toBeDefined();
    expect(api.toErrorResponse).toBeTypeOf("function");
  });
});
