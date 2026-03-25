import assert from "node:assert/strict";

const api = await import("../../dist/index.js");
const workerEntry = await import("../../dist/worker.js");

assert.equal(typeof api.convertMp4ToGif, "function");
assert.equal(typeof api.encodeGif, "function");
assert.equal(typeof api.parseMp4Video, "function");
assert.equal(typeof api.parseGifJobOptions, "function");
assert.equal(typeof workerEntry.default?.fetch, "function");
