import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function importWorker() {
  return (await import("../../src/worker")).default;
}

describe("worker", () => {
  it("returns 404 for unknown routes", async () => {
    const worker = await importWorker();
    const response = await worker.fetch(new Request("https://example.com/nope", {
      method: "POST",
      headers: {
        "content-type": "video/mp4"
      },
      body: new Uint8Array([1])
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "unsupported_feature"
    });
  });

  it("returns 415 for non-mp4 requests", async () => {
    const worker = await importWorker();
    const response = await worker.fetch(new Request("https://example.com/v1/mp4-to-gif", {
      method: "POST",
      headers: {
        "content-type": "text/plain"
      },
      body: "hello"
    }));

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      code: "unsupported_container"
    });
  });

  it("rejects empty request body", async () => {
    const worker = await importWorker();
    const request = new Request("https://example.com/v1/mp4-to-gif", {
      method: "POST",
      headers: {
        "content-type": "video/mp4"
      },
      body: new Uint8Array()
    });

    const response = await worker.fetch(request);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "unsupported_container",
      message: expect.stringMatching(/Empty request body/)
    });
  });

  it("returns a GIF response for valid requests", async () => {
    const convertMp4ToGif = vi.fn().mockResolvedValue(new Uint8Array([71, 73, 70, 56, 57, 97]));
    vi.doMock("../../src/pipeline", () => ({ convertMp4ToGif }));

    const worker = await importWorker();
    const response = await worker.fetch(new Request("https://example.com/v1/mp4-to-gif?fps=8", {
      method: "POST",
      headers: {
        "content-type": "video/mp4"
      },
      body: new Uint8Array([1, 2, 3])
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(convertMp4ToGif).toHaveBeenCalledOnce();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([71, 73, 70, 56, 57, 97]));
  });

  it("maps unexpected pipeline failures to 500", async () => {
    vi.doMock("../../src/pipeline", () => ({
      convertMp4ToGif: vi.fn().mockRejectedValue(new Error("boom"))
    }));

    const worker = await importWorker();
    const response = await worker.fetch(new Request("https://example.com/v1/mp4-to-gif", {
      method: "POST",
      headers: {
        "content-type": "video/mp4"
      },
      body: new Uint8Array([1, 2, 3])
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: "decode_failed",
      message: "boom"
    });
  });
});
