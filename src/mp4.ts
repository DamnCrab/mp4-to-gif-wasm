import { createFile, type ISOFile, type Movie, type Track } from "mp4box";
import { WorkerError } from "./errors";
import type { DecodedVideoSample, Mp4TrackInfo } from "./types";

type MP4File = ISOFile<unknown, unknown>;

interface AvcCBoxLike {
  configurationVersion: number;
  AVCProfileIndication: number;
  profile_compatibility: number;
  AVCLevelIndication: number;
  lengthSizeMinusOne: number;
  SPS: Array<{ length: number; nalu?: Uint8Array; data?: Uint8Array } | Uint8Array>;
  PPS: Array<{ length: number; nalu?: Uint8Array; data?: Uint8Array } | Uint8Array>;
}

function getNaluBytes(entry: { length: number; nalu?: Uint8Array; data?: Uint8Array } | Uint8Array): Uint8Array {
  if (entry instanceof Uint8Array) {
    return entry;
  }

  return entry.nalu ?? entry.data ?? new Uint8Array();
}

function serializeAvcc(avcC: AvcCBoxLike): Uint8Array {
  const totalLength = 6
    + avcC.SPS.reduce((sum, sps) => sum + 2 + sps.length, 0)
    + 1
    + avcC.PPS.reduce((sum, pps) => sum + 2 + pps.length, 0);
  const output = new Uint8Array(totalLength);

  let offset = 0;
  output[offset++] = avcC.configurationVersion;
  output[offset++] = avcC.AVCProfileIndication;
  output[offset++] = avcC.profile_compatibility;
  output[offset++] = avcC.AVCLevelIndication;
  output[offset++] = 0xfc | (avcC.lengthSizeMinusOne & 0x03);
  output[offset++] = 0xe0 | (avcC.SPS.length & 0x1f);

  for (const sps of avcC.SPS) {
    const bytes = getNaluBytes(sps);
    output[offset++] = (bytes.length >> 8) & 0xff;
    output[offset++] = bytes.length & 0xff;
    output.set(bytes, offset);
    offset += bytes.length;
  }

  output[offset++] = avcC.PPS.length & 0xff;
  for (const pps of avcC.PPS) {
    const bytes = getNaluBytes(pps);
    output[offset++] = (bytes.length >> 8) & 0xff;
    output[offset++] = bytes.length & 0xff;
    output.set(bytes, offset);
    offset += bytes.length;
  }

  return output;
}

function extractAvcc(file: MP4File, trackId: number): Uint8Array {
  const description = file.getTrackSample(trackId, 1)?.description;
  const avcC = description && "avcC" in description ? description.avcC : undefined;
  if (!avcC) {
    throw new WorkerError("unsupported_container", "Missing avcC box");
  }
  return serializeAvcc(avcC as AvcCBoxLike);
}

function getTrackDimensions(track: Track): { width: number; height: number } {
  const width = track.video?.width ?? track.track_width ?? 0;
  const height = track.video?.height ?? track.track_height ?? 0;
  return { width, height };
}

function isIdentityMatrix(matrix: Track["matrix"]): boolean {
  return matrix.length >= 9
    && matrix[0] === 65536
    && matrix[1] === 0
    && matrix[2] === 0
    && matrix[3] === 0
    && matrix[4] === 65536
    && matrix[5] === 0
    && matrix[6] === 0
    && matrix[7] === 0
    && matrix[8] === 1073741824;
}

function assertSupportedTrack(info: Movie, track: Track): void {
  if (info.isFragmented) {
    throw new WorkerError("unsupported_container", "fragmented MP4 is not supported");
  }
  if (info.videoTracks.length !== 1) {
    throw new WorkerError("unsupported_container", "expected exactly one video track");
  }
  if (!track.codec.startsWith("avc1")) {
    throw new WorkerError("unsupported_codec", `unsupported codec: ${track.codec}`);
  }
  if (track.edits && track.edits.length > 0) {
    throw new WorkerError("unsupported_feature", "edit list is not supported");
  }
  if (!isIdentityMatrix(track.matrix)) {
    throw new WorkerError("unsupported_feature", "rotation / transform matrix is not supported");
  }
}

export async function parseMp4Video(buffer: ArrayBuffer, maxDurationMs = 5000, maxWidth = 480): Promise<Mp4TrackInfo> {
  const file = createFile() as MP4File;

  return await new Promise<Mp4TrackInfo>((resolve, reject) => {
    const samples: DecodedVideoSample[] = [];

    file.onError = (_module, message) => reject(new WorkerError("unsupported_container", message));
    file.onSamples = (_trackId, _user, chunkSamples) => {
      for (const sample of chunkSamples) {
        if (!sample.data) {
          reject(new WorkerError("unsupported_container", "sample payload is missing"));
          return;
        }
        samples.push({
          data: sample.data instanceof Uint8Array ? sample.data : new Uint8Array(sample.data),
          dts: sample.dts,
          pts: sample.cts,
          isSync: sample.is_sync
        });
      }
    };
    file.onReady = (info) => {
      try {
        const track = info.videoTracks[0];
        assertSupportedTrack(info, track);

        const { width, height } = getTrackDimensions(track);
        const durationMs = Math.round((track.movie_duration / track.movie_timescale) * 1000);
        if (durationMs > maxDurationMs) {
          throw new WorkerError("input_too_large", `video duration exceeds ${maxDurationMs}ms`);
        }
        if (width > maxWidth) {
          throw new WorkerError("input_too_large", `video width exceeds ${maxWidth}px`);
        }
        if (width <= 0 || height <= 0) {
          throw new WorkerError("unsupported_container", "invalid track dimensions");
        }

        file.setExtractionOptions(track.id, undefined, {
          nbSamples: track.nb_samples
        });
        file.start();
        file.flush();

        resolve({
          codec: track.codec,
          width,
          height,
          durationMs,
          timescale: track.movie_timescale,
          avcc: extractAvcc(file, track.id),
          samples
        });
      } catch (error) {
        reject(error);
      }
    };

    const source = buffer as ArrayBuffer & { fileStart: number };
    source.fileStart = 0;
    file.appendBuffer(source, true);
    file.flush();
  });
}
