import { beforeAll, describe, expect, it } from "vitest";
import { parseMp4Video } from "../../src/mp4";
import { ensureRealVideoFixtures, realFixtures, readArrayBuffer } from "../helpers/real-video-fixtures";

beforeAll(() => {
  ensureRealVideoFixtures();
}, 120_000);

describe("real video boundary coverage", () => {
  const cases = [
    ["baseline", realFixtures.baseline, "accept"],
    ["bframes", realFixtures.bframes, "accept-bframes"],
    ["fragmented", realFixtures.fragmented, "reject:unsupported_container"],
    ["oversize", realFixtures.oversize, "accept-oversize"],
    ["tooLong", realFixtures.tooLong, "accept-too-long"],
    ["mpeg4", realFixtures.mpeg4, "reject:unsupported_codec"]
  ] as const;

  for (const [name, path, expected] of cases) {
    it(name, async () => {
      if (expected.startsWith("reject:")) {
        await expect(parseMp4Video(readArrayBuffer(path))).rejects.toMatchObject({
          code: expected.replace("reject:", "")
        });
        return;
      }

      const track = await parseMp4Video(readArrayBuffer(path));
      expect(track.codec.startsWith("avc1")).toBe(true);
      expect(track.samples.length).toBeGreaterThan(0);
      expect(track.durationMs).toBeGreaterThan(0);
      expect(track.timescale).toBe(1000);

      if (expected === "accept-bframes") {
        expect(track.samples.some((sample) => sample.pts !== sample.dts)).toBe(true);
      }
      if (expected === "accept-oversize") {
        expect(track.width).toBeGreaterThan(480);
      }
      if (expected === "accept-too-long") {
        expect(track.durationMs).toBeGreaterThan(5000);
      }
    }, 120_000);
  }
});
