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

function isNodeRuntime(): boolean {
  const maybeWindow = globalThis as typeof globalThis & {
    window?: unknown;
  };

  return typeof process !== "undefined"
    && !!process.versions?.node
    && typeof maybeWindow.window === "undefined";
}

function getNodeBuiltin<T>(specifier: string): T {
  const nodeProcess = process as NodeJS.Process & {
    getBuiltinModule?: (id: string) => T;
  };
  const builtin = nodeProcess.getBuiltinModule?.(specifier);
  if (!builtin) {
    throw new Error(`Missing Node builtin: ${specifier}`);
  }
  return builtin as unknown as T;
}

async function loadGifModule(): Promise<WebAssembly.Module> {
  if (!gifModulePromise) {
    gifModulePromise = (async () => {
      const wasmUrl = new URL("../native/out/decoder.wasm", import.meta.url);

      if (isNodeRuntime()) {
        const { readFile } = getNodeBuiltin<typeof import("node:fs/promises")>("node:fs/promises");
        return await WebAssembly.compile(await readFile(wasmUrl));
      }

      const response = await fetch(wasmUrl);
      return await WebAssembly.compile(await response.arrayBuffer());
    })();
  }

  return await gifModulePromise;
}

async function instantiateGifModule(): Promise<WebAssembly.Instance> {
  const module = await loadGifModule();

  if (isNodeRuntime()) {
    const { WASI } = getNodeBuiltin<typeof import("node:wasi")>("node:wasi");
    const wasi = new WASI({ version: "preview1" });
    const instance = await WebAssembly.instantiate(module, wasi.getImportObject() as WebAssembly.Imports);
    wasi.initialize(instance);
    return instance;
  }

  const instance = await WebAssembly.instantiate(module, {} as WebAssembly.Imports);
  const exports = instance.exports as unknown as GifExports;
  exports._initialize?.();
  return instance;
}

export async function encodeGif(frames: DecodedFrame[], options: GifJobOptions): Promise<Uint8Array> {
  const selectedFrames = selectFrames(frames, options);
  if (selectedFrames.length === 0) {
    return new Uint8Array();
  }

  const width = Math.min(options.maxWidth, selectedFrames[0].width);
  const height = Math.max(1, Math.round(selectedFrames[0].height * (width / selectedFrames[0].width)));
  const delay = Math.max(1, Math.round((1000 / options.fps) / 10));
  const encoder = await WasmGifEncoder.create(width, height, delay, options.colors);

  try {
    for (const frame of selectedFrames) {
      encoder.addFrame(frame);
    }
    return encoder.finish();
  } finally {
    encoder.close();
  }
}
