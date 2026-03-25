import { describe, expect, it } from "vitest";
import { encodeGif } from "../../src/gif";
import type { DecodedFrame } from "../../src/types";

function makePlane(length: number, value: number): Uint8Array {
  return new Uint8Array(length).fill(value);
}

function makeFrame(pts: number): DecodedFrame {
  return {
    width: 2,
    height: 2,
    pixFmt: 0,
    pts,
    strideY: 2,
    strideU: 1,
    strideV: 1,
    offsetY: 0,
    offsetU: 0,
    offsetV: 0,
    yPlane: makePlane(4, 180),
    uPlane: makePlane(1, 128),
    vPlane: makePlane(1, 128)
  };
}

describe("encodeGif", () => {
  it("returns an empty payload when no frames are selected", async () => {
    const gif = await encodeGif([], {
      startMs: 0,
      durationMs: 200,
      fps: 10,
      maxWidth: 2,
      colors: 16
    });

    expect(gif).toEqual(new Uint8Array());
  });

  it("encodes at least one GIF frame", async () => {
    const gif = await encodeGif([makeFrame(0), makeFrame(120)], {
      startMs: 0,
      durationMs: 200,
      fps: 10,
      maxWidth: 2,
      colors: 16
    });

    expect(gif.byteLength).toBeGreaterThan(0);
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe("GIF89a");
  });
});
