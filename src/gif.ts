import type { DecodedFrame, GifJobOptions } from "./types";

interface GifExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  malloc(size: number): number;
  free(ptr: number): void;
  gif_encoder_open(width: number, height: number, delayCs: number, maxColors: number): number;
  gif_encoder_add_frame(
    srcWidth: number,
    srcHeight: number,
    strideY: number,
    strideU: number,
    strideV: number,
    planeYPtr: number,
    planeUPtr: number,
    planeVPtr: number
  ): number;
  gif_encoder_finish(): number;
  gif_encoder_get_output_ptr(): number;
  gif_encoder_get_output_size(): number;
  gif_encoder_close(): void;
}

interface GifEncodeAttempt {
  maxWidth: number;
  fps: number;
  colors: number;
}

function selectFrames(frames: DecodedFrame[], options: GifJobOptions): DecodedFrame[] {
  const selected: DecodedFrame[] = [];
  const endMs = options.startMs + options.durationMs;
  const frameStep = 1000 / options.fps;

  let cursor = options.startMs;
  let lastMatch: DecodedFrame | undefined;

  while (cursor < endMs) {
    const candidate = frames.find((frame) => frame.pts >= cursor) ?? lastMatch ?? frames[frames.length - 1];
    if (candidate) {
      selected.push(candidate);
      lastMatch = candidate;
    }
    cursor += frameStep;
  }

  return selected;
}

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  const rounded = Math.max(1, Math.floor(value));
  return rounded % 2 === 0 ? rounded : rounded - 1 || 1;
}

function buildEncodeAttempts(options: GifJobOptions): GifEncodeAttempt[] {
  const candidates: GifEncodeAttempt[] = [
    {
      maxWidth: options.maxWidth,
      fps: options.fps,
      colors: options.colors
    },
    {
      maxWidth: clampWidth(options.maxWidth * 0.8),
      fps: Math.max(6, Math.floor(options.fps * 0.8)),
      colors: Math.max(96, Math.floor(options.colors * 0.75))
    },
    {
      maxWidth: clampWidth(options.maxWidth * 0.66),
      fps: Math.max(4, Math.floor(options.fps * 0.66)),
      colors: Math.max(64, Math.floor(options.colors * 0.5))
    }
  ];

  return candidates.filter((candidate, index) => {
    return candidates.findIndex((entry) => {
      return entry.maxWidth === candidate.maxWidth
        && entry.fps === candidate.fps
        && entry.colors === candidate.colors;
    }) === index;
  });
}

function isRetryableGifError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /malloc failed|gif_encoder_add_frame failed: -48|gif_encoder_finish failed: -48/i.test(error.message);
}

class WasmGifEncoder {
  private readonly exports: GifExports;
  private readonly memory: WebAssembly.Memory;

  private constructor(exports: GifExports) {
    this.exports = exports;
    this.memory = exports.memory;
  }

  static async create(width: number, height: number, delayCs: number, maxColors: number): Promise<WasmGifEncoder> {
    const instance = await instantiateGifModule();
    const exports = instance.exports as unknown as GifExports;
    const encoder = new WasmGifEncoder(exports);
    const rc = exports.gif_encoder_open(width, height, delayCs, maxColors);
    if (rc < 0) {
      throw new Error(`gif_encoder_open failed: ${rc}`);
    }
    return encoder;
  }

  addFrame(frame: DecodedFrame): void {
    const planeYPtr = this.copyToHeap(frame.yPlane);
    const planeUPtr = this.copyToHeap(frame.uPlane);
    const planeVPtr = this.copyToHeap(frame.vPlane);

    try {
      const rc = this.exports.gif_encoder_add_frame(
        frame.width,
        frame.height,
        frame.strideY,
        frame.strideU,
        frame.strideV,
        planeYPtr,
        planeUPtr,
        planeVPtr
      );
      if (rc < 0) {
        throw new Error(`gif_encoder_add_frame failed: ${rc}`);
      }
    } finally {
      this.exports.free(planeYPtr);
      this.exports.free(planeUPtr);
      this.exports.free(planeVPtr);
    }
  }

  finish(): Uint8Array {
    const rc = this.exports.gif_encoder_finish();
    if (rc < 0) {
      throw new Error(`gif_encoder_finish failed: ${rc}`);
    }

    const outputPtr = this.exports.gif_encoder_get_output_ptr();
    const outputSize = this.exports.gif_encoder_get_output_size();
    if (outputPtr === 0 || outputSize <= 0) {
      throw new Error("gif_encoder produced no output");
    }

    return new Uint8Array(this.memory.buffer.slice(outputPtr, outputPtr + outputSize));
  }

  close(): void {
    this.exports.gif_encoder_close();
  }

  private copyToHeap(data: Uint8Array): number {
    const ptr = this.exports.malloc(data.byteLength);
    if (ptr === 0) {
      throw new Error("malloc failed");
    }
    new Uint8Array(this.memory.buffer, ptr, data.byteLength).set(data);
    return ptr;
  }
}

let gifModulePromise: Promise<WebAssembly.Module> | undefined;

type NodeProcessWithBuiltins = NodeJS.Process & {
  getBuiltinModule?: <T>(id: string) => T | undefined;
};

function getNodeProcess(): NodeProcessWithBuiltins | undefined {
  return (globalThis as typeof globalThis & {
    process?: NodeProcessWithBuiltins;
  }).process;
}

function isNodeRuntime(): boolean {
  if ((globalThis as typeof globalThis & { window?: unknown }).window !== undefined) {
    return false;
  }

  const nodeProcess = getNodeProcess();

  return !!nodeProcess?.versions?.node
    && nodeProcess.release?.name === "node"
    && typeof nodeProcess.getBuiltinModule === "function";
}

function getNodeBuiltin<T>(specifier: string): T {
  const nodeProcess = getNodeProcess();
  const builtin = nodeProcess?.getBuiltinModule?.(specifier);
  if (!builtin) {
    throw new Error(`Missing Node builtin: ${specifier}`);
  }
  return builtin as T;
}

function createBrowserWasiImports(getMemory: () => WebAssembly.Memory | undefined): WebAssembly.Imports {
  const WASI_ERRNO_SUCCESS = 0;
  const WASI_ERRNO_FAULT = 21;

  function getView(): DataView | undefined {
    const memory = getMemory();
    if (!memory) {
      return undefined;
    }
    return new DataView(memory.buffer);
  }

  return {
    wasi_snapshot_preview1: {
      fd_close(): number {
        return WASI_ERRNO_SUCCESS;
      },
      fd_read(_fd: number, _iovs: number, _iovsLen: number, nreadPtr: number): number {
        const view = getView();
        if (!view) {
          return WASI_ERRNO_FAULT;
        }
        view.setUint32(nreadPtr, 0, true);
        return WASI_ERRNO_SUCCESS;
      },
      fd_write(_fd: number, iovs: number, iovsLen: number, nwrittenPtr: number): number {
        const view = getView();
        if (!view) {
          return WASI_ERRNO_FAULT;
        }
        let written = 0;
        for (let index = 0; index < iovsLen; index += 1) {
          const entryPtr = iovs + (index * 8);
          written += view.getUint32(entryPtr + 4, true);
        }
        view.setUint32(nwrittenPtr, written, true);
        return WASI_ERRNO_SUCCESS;
      },
      clock_time_get(_clockId: number, _precision: bigint, timePtr: number): number {
        const view = getView();
        if (!view) {
          return WASI_ERRNO_FAULT;
        }
        view.setBigUint64(timePtr, BigInt(Date.now()) * 1_000_000n, true);
        return WASI_ERRNO_SUCCESS;
      },
      fd_fdstat_get(_fd: number, statPtr: number): number {
        const memory = getMemory();
        if (!memory) {
          return WASI_ERRNO_FAULT;
        }
        new Uint8Array(memory.buffer, statPtr, 24).fill(0);
        return WASI_ERRNO_SUCCESS;
      },
      fd_seek(_fd: number, _offset: bigint, _whence: number, newOffsetPtr: number): number {
        const view = getView();
        if (!view) {
          return WASI_ERRNO_FAULT;
        }
        view.setBigUint64(newOffsetPtr, 0n, true);
        return WASI_ERRNO_SUCCESS;
      }
    }
  };
}

async function loadGifModule(): Promise<WebAssembly.Module> {
  if (!gifModulePromise) {
    gifModulePromise = (async () => {
      if (isNodeRuntime()) {
        const wasmUrl = new URL("../native/out/decoder.wasm", import.meta.url);
        const { readFile } = getNodeBuiltin<typeof import("node:fs/promises")>("node:fs/promises");
        return await WebAssembly.compile(await readFile(wasmUrl));
      }

      const imported = await import("../native/out/decoder.wasm");
      return imported.default as WebAssembly.Module;
    })();
  }

  return await gifModulePromise;
}

async function instantiateGifModule(): Promise<WebAssembly.Instance> {
  const module = await loadGifModule();

  let instance: WebAssembly.Instance | undefined;
  const imports = createBrowserWasiImports(() => (instance?.exports as unknown as GifExports | undefined)?.memory);
  instance = await WebAssembly.instantiate(module, imports);
  const exports = instance.exports as unknown as GifExports;
  exports._initialize?.();
  return instance;
}

export async function encodeGif(frames: DecodedFrame[], options: GifJobOptions): Promise<Uint8Array> {
  const attempts = buildEncodeAttempts(options);
  let lastError: unknown;

  for (const attempt of attempts) {
    const selectedFrames = selectFrames(frames, {
      ...options,
      fps: attempt.fps
    });
    if (selectedFrames.length === 0) {
      return new Uint8Array();
    }

    const width = Math.min(attempt.maxWidth, selectedFrames[0].width);
    const height = Math.max(1, Math.round(selectedFrames[0].height * (width / selectedFrames[0].width)));
    const delay = Math.max(1, Math.round((1000 / attempt.fps) / 10));
    const encoder = await WasmGifEncoder.create(width, height, delay, attempt.colors);

    try {
      for (const frame of selectedFrames) {
        encoder.addFrame(frame);
      }
      return encoder.finish();
    } catch (error) {
      lastError = error;
      if (!isRetryableGifError(error) || attempt === attempts[attempts.length - 1]) {
        throw error;
      }
    } finally {
      encoder.close();
    }
  }

  throw lastError instanceof Error ? lastError : new Error("GIF encoding failed");
}
