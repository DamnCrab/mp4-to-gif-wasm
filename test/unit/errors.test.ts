import { describe, expect, it } from "vitest";
import { toErrorResponse, WorkerError } from "../../src/errors";

describe("errors", () => {
  it("uses 422 as the default WorkerError status", () => {
    const error = new WorkerError("unsupported_feature", "bad input");
    expect(error.status).toBe(422);
  });

  it("serializes WorkerError instances", async () => {
    const response = toErrorResponse(new WorkerError("input_too_large", "too big", 413));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      code: "input_too_large",
      message: "too big"
    });
  });

  it("maps unknown errors to decode_failed", async () => {
    const response = toErrorResponse(new Error("boom"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: "decode_failed",
      message: "boom"
    });
  });
});
