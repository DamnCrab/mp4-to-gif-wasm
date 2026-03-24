import { parseGifJobOptions } from "./options";
import { convertMp4ToGif } from "./pipeline";
import { toErrorResponse, WorkerError } from "./errors";

function assertRoute(request: Request, url: URL): void {
  if (request.method !== "POST" || url.pathname !== "/v1/mp4-to-gif") {
    throw new WorkerError("unsupported_feature", "Not found", 404);
  }
}

function assertContentType(request: Request): void {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("video/mp4")) {
    throw new WorkerError("unsupported_container", "Expected content-type video/mp4", 415);
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      assertRoute(request, url);
      assertContentType(request);

      const options = parseGifJobOptions(url);
      const requestBody = await request.arrayBuffer();
      if (requestBody.byteLength === 0) {
        throw new WorkerError("unsupported_container", "Empty request body", 422);
      }

      const gif = await convertMp4ToGif(requestBody, options);
      const responseBody = Uint8Array.from(gif).buffer;
      return new Response(responseBody, {
        status: 200,
        headers: {
          "content-type": "image/gif",
          "cache-control": "no-store"
        }
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  }
};
