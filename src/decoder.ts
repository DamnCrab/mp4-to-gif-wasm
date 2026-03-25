import { WorkerError } from "./errors.js";
import type { DecodeFrameMeta, DecodedFrame, Mp4TrackInfo } from "./types";

interface DecoderExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  malloc(size: number): number;
  free(ptr: number): void;
  decoder_open(extradataPtr: number, extradataLen: number): number;
  decoder_send_packet(packetPtr: number, packetLen: number, dts: number, pts: number, isKey: number): number;
  decoder_receive_frame(): number;
  decoder_get_frame_meta(): number;
  decoder_flush(): number;
  decoder_close(): void;
}

const META_FIELDS = 10;
const PIX_FMT_YUV420P = 0;

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

let decoderModulePromise: Promise<WebAssembly.Module> | undefined;

async function loadDecoderModule(): Promise<WebAssembly.Module> {
  if (!decoderModulePromise) {
    decoderModulePromise = (async () => {
      if (isNodeRuntime()) {
        const wasmUrl = new URL("../native/out/decoder.wasm", import.meta.url);
        const { readFile } = getNodeBuiltin<typeof import("node:fs/promises")>("node:fs/promises");
        return await WebAssembly.compile(await readFile(wasmUrl));
      }

      try {
        const imported = await import("../native/out/decoder.wasm");
        return imported.default as WebAssembly.Module;
      } catch {
        const wasmUrl = new URL("../native/out/decoder.wasm", import.meta.url);
        const response = await fetch(wasmUrl);
        if (!response.ok) {
          throw new Error(`Failed to load decoder wasm: ${response.status} ${response.statusText}`);
        }
        return await WebAssembly.compile(await response.arrayBuffer());
      }
    })();
  }

  return await decoderModulePromise;
}

export class H264Decoder {
  private readonly exports: DecoderExports;
  private readonly memory: WebAssembly.Memory;

  private constructor(exports: DecoderExports) {
    this.exports = exports;
    this.memory = exports.memory;
  }

  static async create(track: Mp4TrackInfo): Promise<H264Decoder> {
    const module = await loadDecoderModule();
    let instance: WebAssembly.Instance | undefined;
    const imports = createBrowserWasiImports(() => (instance?.exports as unknown as DecoderExports | undefined)?.memory);
    instance = await WebAssembly.instantiate(module, imports);
    const exports = instance.exports as unknown as DecoderExports;
    exports._initialize?.();
    const decoder = new H264Decoder(exports);

    const extradataPtr = decoder.copyToHeap(track.avcc);
    try {
      const rc = exports.decoder_open(extradataPtr, track.avcc.byteLength);
      if (rc !== 0) {
        throw new WorkerError("decode_failed", `decoder_open failed: ${rc}`, 500);
      }
    } finally {
      exports.free(extradataPtr);
    }

    return decoder;
  }

  close(): void {
    this.exports.decoder_close();
  }

  decode(track: Mp4TrackInfo): DecodedFrame[] {
    const frames: DecodedFrame[] = [];
    try {
      for (const sample of track.samples) {
        this.sendPacket(sample.data, sample.dts, sample.pts, sample.isSync);
        this.drainFrames(frames);
      }
      const flushRc = this.exports.decoder_flush();
      if (flushRc < 0) {
        throw new WorkerError("decode_failed", `decoder_flush failed: ${flushRc}`, 500);
      }
      this.drainFrames(frames);
      return frames;
    } finally {
      this.close();
    }
  }

  private sendPacket(data: Uint8Array, dts: number, pts: number, isSync: boolean): void {
    const ptr = this.copyToHeap(data);
    try {
      const rc = this.exports.decoder_send_packet(ptr, data.byteLength, dts, pts, isSync ? 1 : 0);
      if (rc < 0) {
        throw new WorkerError("decode_failed", `decoder_send_packet failed: ${rc}`, 500);
      }
    } finally {
      this.exports.free(ptr);
    }
  }

  private drainFrames(frames: DecodedFrame[]): void {
    for (;;) {
      const rc = this.exports.decoder_receive_frame();
      if (rc === 1) {
        break;
      }
      if (rc < 0) {
        throw new WorkerError("decode_failed", `decoder_receive_frame failed: ${rc}`, 500);
      }

      const metaPtr = this.exports.decoder_get_frame_meta();
      if (metaPtr === 0) {
        throw new WorkerError("decode_failed", "decoder_get_frame_meta returned null", 500);
      }
      const meta = this.readFrameMeta(metaPtr);
      if (meta.pixFmt !== PIX_FMT_YUV420P) {
        throw new WorkerError("unsupported_feature", "only yuv420p is supported");
      }
      frames.push(this.readFrame(meta));
    }
  }

  private readFrameMeta(ptr: number): DecodeFrameMeta {
    const view = new Int32Array(this.memory.buffer, ptr, META_FIELDS);
    return {
      width: view[0],
      height: view[1],
      pixFmt: view[2],
      pts: view[3],
      strideY: view[4],
      strideU: view[5],
      strideV: view[6],
      offsetY: view[7],
      offsetU: view[8],
      offsetV: view[9]
    };
  }

  private readFrame(meta: DecodeFrameMeta): DecodedFrame {
    const lumaLength = meta.strideY * meta.height;
    const chromaHeight = Math.ceil(meta.height / 2);
    const chromaLengthU = meta.strideU * chromaHeight;
    const chromaLengthV = meta.strideV * chromaHeight;
    const memoryBytes = new Uint8Array(this.memory.buffer);

    return {
      ...meta,
      yPlane: memoryBytes.slice(meta.offsetY, meta.offsetY + lumaLength),
      uPlane: memoryBytes.slice(meta.offsetU, meta.offsetU + chromaLengthU),
      vPlane: memoryBytes.slice(meta.offsetV, meta.offsetV + chromaLengthV)
    };
  }

  private copyToHeap(data: Uint8Array): number {
    const ptr = this.exports.malloc(data.byteLength);
    if (ptr === 0) {
      throw new WorkerError("decode_failed", "malloc failed", 500);
    }
    new Uint8Array(this.memory.buffer, ptr, data.byteLength).set(data);
    return ptr;
  }
}
