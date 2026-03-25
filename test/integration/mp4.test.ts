import { beforeAll, describe, expect, it } from "vitest";
import { parseMp4Video } from "../../src/mp4";
import { ensureGeneratedFixtures, readFixture } from "../helpers/generated-fixtures";

let fixtures = ensureGeneratedFixtures();

beforeAll(() => {
  fixtures = ensureGeneratedFixtures();
}, 30_000);

describe("parseMp4Video", () => {
  it("parses baseline avc1 mp4", async () => {
    const track = await parseMp4Video(readFixture(fixtures.baseline));

    expect(track.codec.startsWith("avc1")).toBe(true);
    expect(track.width).toBe(320);
    expect(track.height).toBe(180);
    expect(track.durationMs).toBeGreaterThan(1000);
    expect(track.avcc.byteLength).toBeGreaterThan(0);
    expect(track.samples.length).toBeGreaterThan(0);
    expect(track.samples.some((sample) => sample.isSync)).toBe(true);
  }, 30_000);

  it("preserves b-frame timing differences", async () => {
    const track = await parseMp4Video(readFixture(fixtures.bframes));

    expect(track.codec.startsWith("avc1")).toBe(true);
    expect(track.samples.length).toBeGreaterThan(0);
    expect(track.samples.some((sample) => sample.pts !== sample.dts)).toBe(true);
  }, 30_000);

  it("rejects unsupported input variants", async () => {
    await expect(parseMp4Video(readFixture(fixtures.mpeg4))).rejects.toMatchObject({
      code: "unsupported_codec"
    });
    await expect(parseMp4Video(readFixture(fixtures.fragmented))).rejects.toMatchObject({
      code: "unsupported_container"
    });
    await expect(parseMp4Video(readFixture(fixtures.oversize))).rejects.toMatchObject({
      code: "input_too_large"
    });
    await expect(parseMp4Video(readFixture(fixtures.tooLong))).rejects.toMatchObject({
      code: "input_too_large"
    });
  }, 30_000);
});
