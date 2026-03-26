import { encodeGif } from "mp4-to-gif-wasm";
import worker from "mp4-to-gif-wasm/worker";

function makePlane(length, value) {
  return new Uint8Array(length).fill(value);
}

function makeFrame(pts) {
  return {
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
  };
}

async function main() {
  const gif = await encodeGif([makeFrame(0), makeFrame(120)], {
    startMs: 0,
    durationMs: 200,
    fps: 10,
    maxWidth: 2,
    colors: 16
  });

  document.body.dataset.status = "ok";
  document.body.dataset.header = String.fromCharCode(...gif.slice(0, 6));
  document.body.dataset.worker = typeof worker.fetch;
}

main().catch((error) => {
  document.body.dataset.status = "error";
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
});
