import { readFileSync } from "node:fs";
import { WASI } from "node:wasi";
import { encodeGif } from "../src/gif.ts";
import { parseMp4Video } from "../src/mp4.ts";
import type { DecodeFrameMeta, DecodedFrame, Mp4TrackInfo } from "../src/types";
import { ensureRealVideoFixtures, fixtures, readArrayBuffer } from "./real-video-fixtures.mts";

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

class NativeDecoder {
  private readonly exports: DecoderExports;
  private readonly memory: WebAssembly.Memory;

  private constructor(exports: DecoderExports) {
    this.exports = exports;
    this.memory = exports.memory;
  }

  static async create(track: Mp4TrackInfo): Promise<NativeDecoder> {
    const bytes = readFileSync("/Users/crab/Documents/Playground/native/out/decoder.wasm");
    const module = await WebAssembly.compile(bytes);
    const wasi = new WASI({
      version: "preview1"
    });
    const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
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
      const metaPtr = this.exports.decoder_get_frame_meta();
      const meta = this.readFrameMeta(metaPtr);
      if (meta.pixFmt !== PIX_FMT_YUV420P) {
        throw new Error(`unexpected pixel format: ${meta.pixFmt}`);
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
      throw new Error("malloc failed");
    }
    new Uint8Array(this.memory.buffer, ptr, data.byteLength).set(data);
    return ptr;
  }
}

ensureRealVideoFixtures();

const cases = [
  ["real-baseline-ok.mp4", fixtures.baseline, false],
  ["real-bframes-ok.mp4", fixtures.bframes, true]
] as const;

for (const [name, path, expectBFrame] of cases) {
  const track = await parseMp4Video(readArrayBuffer(path));
  const decoder = await NativeDecoder.create(track);
  const frames = decoder.decode(track);
  const gif = await encodeGif(frames, {
    startMs: 0,
    durationMs: Math.min(track.durationMs, 2000),
    fps: 8,
    maxWidth: 160,
    colors: 64
  });

  const nonDecreasingPts = frames.every((frame, index) => index === 0 || frames[index - 1].pts <= frame.pts);
  const hasBFrameTiming = track.samples.some((sample) => sample.pts !== sample.dts);
  const gifHeader = String.fromCharCode(...gif.slice(0, 6));

  if (frames.length === 0) {
    throw new Error(`${name}: decoder returned no frames`);
  }
  if (!nonDecreasingPts) {
    throw new Error(`${name}: decoded frame pts are not nondecreasing`);
  }
  if (gif.byteLength === 0 || gifHeader !== "GIF89a") {
    throw new Error(`${name}: invalid gif output`);
  }
  if (expectBFrame && !hasBFrameTiming) {
    throw new Error(`${name}: expected B-frame timing but none found`);
  }

  console.log(JSON.stringify({
    name,
    codec: track.codec,
    samples: track.samples.length,
    frames: frames.length,
    hasBFrameTiming,
    nonDecreasingPts,
    gifBytes: gif.byteLength,
    gifHeader
  }));
}
