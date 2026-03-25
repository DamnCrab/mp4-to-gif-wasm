import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecodedFrame, Mp4TrackInfo } from "../../src/types";

const track: Mp4TrackInfo = {
  codec: "avc1.64001f",
  width: 320,
  height: 180,
  durationMs: 1000,
  timescale: 1000,
  avcc: new Uint8Array([1, 2, 3]),
  samples: []
};

const frame: DecodedFrame = {
  width: 2,
  height: 2,
  pixFmt: 0,
  pts: 0,
  strideY: 2,
  strideU: 1,
  strideV: 1,
  offsetY: 0,
  offsetU: 0,
  offsetV: 0,
  yPlane: new Uint8Array([16, 16, 16, 16]),
  uPlane: new Uint8Array([128]),
  vPlane: new Uint8Array([128])
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("convertMp4ToGif", () => {
  it("pipes parse, decode, and encode together", async () => {
    const parseMp4Video = vi.fn().mockResolvedValue(track);
    const decode = vi.fn().mockReturnValue([frame]);
    const create = vi.fn().mockResolvedValue({ decode });
    const encodeGif = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

    vi.doMock("../../src/mp4", () => ({ parseMp4Video }));
    vi.doMock("../../src/decoder", () => ({ H264Decoder: { create } }));
    vi.doMock("../../src/gif", () => ({ encodeGif }));

    const { convertMp4ToGif } = await import("../../src/pipeline");
    const output = await convertMp4ToGif(new ArrayBuffer(4), {
      startMs: 0,
      durationMs: 250,
      fps: 8,
      maxWidth: 160,
      colors: 64
    });

    expect(parseMp4Video).toHaveBeenCalledWith(expect.any(ArrayBuffer), 5000, 480);
    expect(create).toHaveBeenCalledWith(track);
    expect(decode).toHaveBeenCalledWith(track);
    expect(encodeGif).toHaveBeenCalledWith([frame], expect.objectContaining({ fps: 8 }));
    expect(output).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("fails when decoding returns no frames", async () => {
    const parseMp4Video = vi.fn().mockResolvedValue(track);
    const decode = vi.fn().mockReturnValue([]);
    const create = vi.fn().mockResolvedValue({ decode });
    const encodeGif = vi.fn();

    vi.doMock("../../src/mp4", () => ({ parseMp4Video }));
    vi.doMock("../../src/decoder", () => ({ H264Decoder: { create } }));
    vi.doMock("../../src/gif", () => ({ encodeGif }));

    const { convertMp4ToGif } = await import("../../src/pipeline");

    await expect(convertMp4ToGif(new ArrayBuffer(4), {
      startMs: 0,
      durationMs: 250,
      fps: 8,
      maxWidth: 160,
      colors: 64
    })).rejects.toMatchObject({
      code: "decode_failed"
    });

    expect(encodeGif).not.toHaveBeenCalled();
  });
});
