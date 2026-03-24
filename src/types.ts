export interface GifJobOptions {
  startMs: number;
  durationMs: number;
  fps: number;
  maxWidth: number;
  colors: number;
}

export interface DecodedVideoSample {
  data: Uint8Array;
  dts: number;
  pts: number;
  isSync: boolean;
}

export interface Mp4TrackInfo {
  codec: string;
  width: number;
  height: number;
  durationMs: number;
  timescale: number;
  avcc: Uint8Array;
  samples: DecodedVideoSample[];
}

export interface DecodeFrameMeta {
  width: number;
  height: number;
  pixFmt: number;
  pts: number;
  strideY: number;
  strideU: number;
  strideV: number;
  offsetY: number;
  offsetU: number;
  offsetV: number;
}

export interface DecodedFrame extends DecodeFrameMeta {
  yPlane: Uint8Array;
  uPlane: Uint8Array;
  vPlane: Uint8Array;
}
