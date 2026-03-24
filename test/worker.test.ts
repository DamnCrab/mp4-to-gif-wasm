import { describe, expect, it } from "vitest";
import worker from "../src/worker";

describe("worker", () => {
  it("returns 404 for unknown routes", async () => {
    const response = await worker.fetch(new Request("https://example.com/nope", {
      method: "POST",
      headers: {
        "content-type": "video/mp4"
      },
      body: new Uint8Array([1])
    }));

    expect(response.status).toBe(404);
    const payload = await response.json() as { code: string; message: string };
    expect(payload.code).toBe("unsupported_feature");
  });

  it("returns 415 for non-mp4 requests", async () => {
    const response = await worker.fetch(new Request("https://example.com/v1/mp4-to-gif", {
      method: "POST",
      headers: {
        "content-type": "text/plain"
      },
      body: "hello"
    }));

    expect(response.status).toBe(415);
    const payload = await response.json() as { code: string; message: string };
    expect(payload.code).toBe("unsupported_container");
  });

  it("rejects empty request body", async () => {
    const request = new Request("https://example.com/v1/mp4-to-gif", {
      method: "POST",
      headers: {
        "content-type": "video/mp4"
      },
      body: new Uint8Array()
    });

    const response = await worker.fetch(request);
    expect(response.status).toBe(422);

    const payload = await response.json() as { code: string; message: string };
    expect(payload.code).toBe("unsupported_container");
    expect(payload.message).toMatch(/Empty request body/);
  });
});
