import { expect, test } from "@playwright/test";

test("encodes a GIF in a real browser using dist assets", async ({ page }) => {
  await page.goto("/test/browser/fixture.html");
  await page.addInitScript(() => {
    window.process = {
      versions: {
        node: "fake-browser-process"
      }
    };
  });

  const result = await page.evaluate(async () => {
    const { encodeGif } = await import("/dist/gif.js");
    const makePlane = (length, value) => new Uint8Array(length).fill(value);
    const makeFrame = (pts) => ({
      width: 2,
      height: 2,
      pixFmt: 0,
      pts,
      strideY: 2,
      strideU: 1,
      strideV: 1,
      offsetY: 0,
      offsetU: 0,
      offsetV: 0,
      yPlane: makePlane(4, 180),
      uPlane: makePlane(1, 128),
      vPlane: makePlane(1, 128)
    });

    const gif = await encodeGif([makeFrame(0), makeFrame(120)], {
      startMs: 0,
      durationMs: 200,
      fps: 10,
      maxWidth: 2,
      colors: 16
    });

    return {
      byteLength: gif.byteLength,
      header: String.fromCharCode(...gif.slice(0, 6))
    };
  });

  expect(result.byteLength).toBeGreaterThan(0);
  expect(result.header).toBe("GIF89a");
});
