import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("encodeGif runtime detection", () => {
  it("prefers browser-style wasm loading when window is available", async () => {
    const getBuiltinModule = vi.fn();
    vi.stubGlobal("process", {
      versions: {
        node: "fake-browser-process"
      },
      release: {
        name: "node"
      },
      getBuiltinModule
    });
    vi.stubGlobal("window", {});

    const fetch = vi.fn().mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(8)
    });
    vi.stubGlobal("fetch", fetch);

    const memory = new WebAssembly.Memory({ initial: 1 });
    let nextPtr = 64;
    const exports = {
      memory,
      _initialize: vi.fn(),
      malloc: vi.fn((size: number) => {
        const ptr = nextPtr;
        nextPtr += Math.max(size, 1);
        return ptr;
      }),
      free: vi.fn(),
      gif_encoder_open: vi.fn().mockReturnValue(0),
      gif_encoder_add_frame: vi.fn().mockReturnValue(0),
      gif_encoder_finish: vi.fn().mockReturnValue(0),
      gif_encoder_get_output_ptr: vi.fn().mockReturnValue(256),
      gif_encoder_get_output_size: vi.fn().mockReturnValue(6),
      gif_encoder_close: vi.fn()
    };
    new Uint8Array(memory.buffer, 256, 6).set([71, 73, 70, 56, 57, 97]);

    const compile = vi.spyOn(WebAssembly, "compile").mockResolvedValue({} as WebAssembly.Module);
    const instantiate = vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
      exports
    } as unknown as WebAssembly.Instance);

    const { encodeGif } = await import("../../src/gif");
    const gif = await encodeGif([makeFrame(0)], {
      startMs: 0,
      durationMs: 100,
      fps: 10,
      maxWidth: 2,
      colors: 16
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(getBuiltinModule).not.toHaveBeenCalled();
    expect(compile).toHaveBeenCalledOnce();
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
    expect(gif).toEqual(new Uint8Array([71, 73, 70, 56, 57, 97]));
  });
});
