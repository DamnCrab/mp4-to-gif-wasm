import { H264Decoder } from "./decoder.js";
import { WorkerError } from "./errors.js";
import { encodeGif } from "./gif.js";
import { parseMp4Video } from "./mp4.js";
import type { GifJobOptions } from "./types";

export async function convertMp4ToGif(
  buffer: ArrayBuffer,
  options: GifJobOptions
): Promise<Uint8Array> {
  const track = await parseMp4Video(buffer, 5000, 480);
  const decoder = await H264Decoder.create(track);
  const frames = decoder.decode(track);

  if (frames.length === 0) {
    throw new WorkerError("decode_failed", "No frames were decoded", 500);
  }

  return await encodeGif(frames, options);
}
