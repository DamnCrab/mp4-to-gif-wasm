import { WorkerError } from "./errors";
import type { GifJobOptions } from "./types";

const DEFAULTS: GifJobOptions = {
  startMs: 0,
  durationMs: 5000,
  fps: 10,
  maxWidth: 320,
  colors: 128
};

const LIMITS = {
  durationMs: 5000,
  fps: 12,
  maxWidth: 480,
  colors: 256
};

function parseIntParam(value: string | null, fallback: number, name: string): number {
  if (value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new WorkerError("unsupported_feature", `Invalid integer query param: ${name}`);
  }

  return parsed;
}

export function parseGifJobOptions(url: URL): GifJobOptions {
  const options: GifJobOptions = {
    startMs: parseIntParam(url.searchParams.get("startMs"), DEFAULTS.startMs, "startMs"),
    durationMs: parseIntParam(url.searchParams.get("durationMs"), DEFAULTS.durationMs, "durationMs"),
    fps: parseIntParam(url.searchParams.get("fps"), DEFAULTS.fps, "fps"),
    maxWidth: parseIntParam(url.searchParams.get("maxWidth"), DEFAULTS.maxWidth, "maxWidth"),
    colors: parseIntParam(url.searchParams.get("colors"), DEFAULTS.colors, "colors")
  };

  if (options.startMs < 0) {
    throw new WorkerError("unsupported_feature", "startMs must be >= 0");
  }
  if (options.durationMs <= 0 || options.durationMs > LIMITS.durationMs) {
    throw new WorkerError("input_too_large", `durationMs must be between 1 and ${LIMITS.durationMs}`);
  }
  if (options.fps <= 0 || options.fps > LIMITS.fps) {
    throw new WorkerError("unsupported_feature", `fps must be between 1 and ${LIMITS.fps}`);
  }
  if (options.maxWidth <= 0 || options.maxWidth > LIMITS.maxWidth) {
    throw new WorkerError("input_too_large", `maxWidth must be between 1 and ${LIMITS.maxWidth}`);
  }
  if (options.colors <= 1 || options.colors > LIMITS.colors) {
    throw new WorkerError("unsupported_feature", `colors must be between 2 and ${LIMITS.colors}`);
  }

  return options;
}
