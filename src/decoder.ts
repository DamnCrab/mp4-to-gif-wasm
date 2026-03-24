import { WorkerError } from "./errors";
import type { DecodeFrameMeta, DecodedFrame, Mp4TrackInfo } from "./types";
import decoderModule from "../native/out/decoder.wasm";

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

export class H264Decoder {
  private readonly exports: DecoderExports;
  private readonly memory: WebAssembly.Memory;

  private constructor(exports: DecoderExports) {
    this.exports = exports;
    this.memory = exports.memory;
  }

  static async create(track: Mp4TrackInfo): Promise<H264Decoder> {
    const instance = await WebAssembly.instantiate(decoderModule, {});
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
