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
    expect(track.timescale).toBe(1000);
    expect(track.avcc.byteLength).toBeGreaterThan(0);
    expect(track.samples.length).toBeGreaterThan(0);
    expect(track.samples.some((sample) => sample.isSync)).toBe(true);
    expect(track.samples.every((sample) => sample.dts >= 0 && sample.pts >= 0)).toBe(true);
    expect(track.samples[0].dts).toBe(0);
    expect(track.samples[track.samples.length - 1].dts).toBeGreaterThan(0);
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
  }, 30_000);

  it("accepts large source assets and leaves clipping to output options", async () => {
    const oversize = await parseMp4Video(readFixture(fixtures.oversize));
    const tooLong = await parseMp4Video(readFixture(fixtures.tooLong));

    expect(oversize.width).toBeGreaterThan(480);
    expect(oversize.samples.length).toBeGreaterThan(0);
    expect(tooLong.durationMs).toBeGreaterThan(5000);
    expect(tooLong.samples.length).toBeGreaterThan(0);
  }, 30_000);
});
