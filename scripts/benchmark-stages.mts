import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WASI } from "node:wasi";
import { encodeGif } from "../src/gif.ts";
import { parseMp4Video } from "../src/mp4.ts";
import type { DecodeFrameMeta, DecodedFrame, Mp4TrackInfo } from "../src/types";

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
const wasmBytes = readFileSync(resolve(process.cwd(), "native/out/decoder.wasm"));
const wasmModule = await WebAssembly.compile(wasmBytes);

class NativeDecoder {
  private readonly exports: DecoderExports;
  private readonly memory: WebAssembly.Memory;

  private constructor(exports: DecoderExports) {
    this.exports = exports;
    this.memory = exports.memory;
  }

  static async create(track: Mp4TrackInfo): Promise<NativeDecoder> {
    const wasi = new WASI({ version: "preview1" });
    const instance = await WebAssembly.instantiate(wasmModule, wasi.getImportObject());
    const exports = instance.exports as unknown as DecoderExports;
    wasi.initialize(instance);
    const decoder = new NativeDecoder(exports);
    const extradataPtr = decoder.copyToHeap(track.avcc);
    try {
      const rc = exports.decoder_open(extradataPtr, track.avcc.byteLength);
      if (rc !== 0) {
        throw new Error(`decoder_open failed: ${rc}`);
      }
    } finally {
      exports.free(extradataPtr);
    }
    return decoder;
  }

  decode(track: Mp4TrackInfo): DecodedFrame[] {
    const frames: DecodedFrame[] = [];
    try {
      for (const sample of track.samples) {
        this.sendPacket(sample.data, sample.dts, sample.pts, sample.isSync);
        this.drain(frames);
      }
      const flushRc = this.exports.decoder_flush();
      if (flushRc < 0) {
        throw new Error(`decoder_flush failed: ${flushRc}`);
      }
      this.drain(frames);
      return frames;
    } finally {
      this.exports.decoder_close();
    }
  }

  private sendPacket(data: Uint8Array, dts: number, pts: number, isSync: boolean): void {
    const ptr = this.copyToHeap(data);
    try {
      const rc = this.exports.decoder_send_packet(ptr, data.byteLength, dts, pts, isSync ? 1 : 0);
      if (rc < 0) {
        throw new Error(`decoder_send_packet failed: ${rc}`);
      }
    } finally {
      this.exports.free(ptr);
    }
  }

  private drain(frames: DecodedFrame[]): void {
    for (;;) {
      const rc = this.exports.decoder_receive_frame();
      if (rc === 1) {
        return;
      }
      if (rc < 0) {
        throw new Error(`decoder_receive_frame failed: ${rc}`);
      }
      frames.push(this.readFrame(this.readFrameMeta(this.exports.decoder_get_frame_meta())));
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
      throw new Error("malloc failed");
    }
    new Uint8Array(this.memory.buffer, ptr, data.byteLength).set(data);
    return ptr;
  }
}

const cases = [
  ["baseline", "/tmp/cf-worker-video-samples/derived/real-baseline-ok.mp4"],
  ["bframes", "/tmp/cf-worker-video-samples/derived/real-bframes-ok.mp4"]
] as const;

for (const [name, path] of cases) {
  const bytes = readFileSync(path);
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  const parseStart = performance.now();
  const track = await parseMp4Video(input);
  const parseMs = performance.now() - parseStart;

  const decoder = await NativeDecoder.create(track);
  const decodeStart = performance.now();
  const frames = decoder.decode(track);
  const decodeMs = performance.now() - decodeStart;

  const encodeStart = performance.now();
  const gif = await encodeGif(frames, {
    startMs: 0,
    durationMs: Math.min(track.durationMs, 2000),
    fps: 8,
    maxWidth: 160,
    colors: 64
  });
  const encodeMs = performance.now() - encodeStart;

  console.log(JSON.stringify({
    name,
    samples: track.samples.length,
    frames: frames.length,
    parseMs: Number(parseMs.toFixed(2)),
    decodeMs: Number(decodeMs.toFixed(2)),
    encodeMs: Number(encodeMs.toFixed(2)),
    gifBytes: gif.byteLength
  }));
}
