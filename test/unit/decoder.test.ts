import { afterEach, describe, expect, it, vi } from "vitest";
import { H264Decoder } from "../../src/decoder";

import type { Mp4TrackInfo } from "../../src/types";

const wasmBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00
]);

const track: Mp4TrackInfo = {
  codec: "avc1.64001f",
  width: 320,
  height: 180,
  durationMs: 1000,
  timescale: 1000,
  avcc: new Uint8Array([1, 2, 3]),
  samples: [{
    data: new Uint8Array([9, 8, 7]),
    dts: 100,
    pts: 120,
    isSync: true
  }]
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function createDecoderExports(overrides: Partial<Record<string, unknown>> = {}) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let nextPtr = 64;

  return {
    memory,
    _initialize: vi.fn(),
    malloc: vi.fn((size: number) => {
      const ptr = nextPtr;
      nextPtr += Math.max(size, 1);
      return ptr;
    }),
    free: vi.fn(),
    decoder_open: vi.fn().mockReturnValue(0),
    decoder_send_packet: vi.fn().mockReturnValue(0),
    decoder_receive_frame: vi.fn(),
    decoder_get_frame_meta: vi.fn(),
    decoder_flush: vi.fn().mockReturnValue(0),
    decoder_close: vi.fn(),
    ...overrides
  };
}

describe("H264Decoder", () => {
  it("prefers browser-style wasm loading when window is available", async () => {
    const getBuiltinModule = vi.fn();
    vi.stubGlobal("process", {
      versions: {
        node: "22.0.0"
      },
      release: {
        name: "node"
      },
      getBuiltinModule
    });
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(wasmBytes, {
      status: 200,
      headers: {
        "content-type": "application/wasm"
      }
    })));

    const exports = createDecoderExports({
      decoder_receive_frame: vi.fn().mockReturnValue(1)
    });

    const instantiate = vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
      exports
    } as unknown as WebAssembly.Instance);

    const { H264Decoder: RuntimeAwareDecoder } = await import("../../src/decoder");
    const decoder = await RuntimeAwareDecoder.create(track);
    decoder.close();

    expect(getBuiltinModule).not.toHaveBeenCalled();
    expect(instantiate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        wasi_snapshot_preview1: expect.objectContaining({
          fd_close: expect.any(Function),
          fd_read: expect.any(Function),
          fd_write: expect.any(Function),
          clock_time_get: expect.any(Function),
          fd_fdstat_get: expect.any(Function),
          fd_seek: expect.any(Function)
        })
      })
    );
    expect(exports._initialize).toHaveBeenCalledOnce();
  });

  it("opens the decoder, decodes frames, and closes it", async () => {
    const exports = createDecoderExports();
    const metaPtr = 128;
    const meta = new Int32Array(exports.memory.buffer, metaPtr, 10);
    meta.set([2, 2, 0, 120, 2, 1, 1, 256, 260, 261]);
    new Uint8Array(exports.memory.buffer, 256, 6).set([16, 17, 18, 19, 128, 129]);

    exports.decoder_receive_frame = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(1);
    exports.decoder_get_frame_meta = vi.fn().mockReturnValue(metaPtr);

    vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
      exports
    } as unknown as WebAssembly.Instance);

    const decoder = await H264Decoder.create(track);
    expect(exports.decoder_open).toHaveBeenCalledOnce();
    const frames = decoder.decode(track);

    expect(exports._initialize).toHaveBeenCalledOnce();
    expect(exports.decoder_open).toHaveBeenCalledWith(expect.any(Number), track.avcc.byteLength);
    expect(exports.decoder_send_packet).toHaveBeenCalledWith(expect.any(Number), 3, 100, 120, 1);
    expect(exports.decoder_flush).toHaveBeenCalledOnce();
    expect(exports.decoder_close).toHaveBeenCalledOnce();
    expect(exports.free).toHaveBeenCalledTimes(2);
    expect(frames).toEqual([expect.objectContaining({
      width: 2,
      height: 2,
      pts: 120,
      yPlane: new Uint8Array([16, 17, 18, 19]),
      uPlane: new Uint8Array([128]),
      vPlane: new Uint8Array([129])
    })]);
  });

  it("frees extradata and surfaces decoder_open failures", async () => {
    const exports = createDecoderExports({
      decoder_open: vi.fn().mockReturnValue(-1)
    });

    vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
      exports
    } as unknown as WebAssembly.Instance);

    await expect(H264Decoder.create(track)).rejects.toMatchObject({
      code: "decode_failed",
      message: "decoder_open failed: -1"
    });

    expect(exports.free).toHaveBeenCalledTimes(1);
    expect(exports.decoder_close).not.toHaveBeenCalled();
  });

  it("rejects unsupported pixel formats and still closes the decoder", async () => {
    const exports = createDecoderExports();
    const metaPtr = 128;
    const meta = new Int32Array(exports.memory.buffer, metaPtr, 10);
    meta.set([2, 2, 1, 120, 2, 1, 1, 256, 260, 261]);

    exports.decoder_receive_frame = vi.fn()
      .mockReturnValueOnce(0);
    exports.decoder_get_frame_meta = vi.fn().mockReturnValue(metaPtr);

    vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
      exports
    } as unknown as WebAssembly.Instance);

    const decoder = await H264Decoder.create(track);

    expect(() => decoder.decode(track)).toThrowError("only yuv420p is supported");
    expect(exports.decoder_close).toHaveBeenCalledOnce();
  });
});
