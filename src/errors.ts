export type WorkerErrorCode =
  | "unsupported_codec"
  | "unsupported_container"
  | "unsupported_feature"
  | "input_too_large"
  | "decode_failed";

export class WorkerError extends Error {
  readonly code: WorkerErrorCode;
  readonly status: number;

  constructor(code: WorkerErrorCode, message: string, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof WorkerError) {
    return Response.json(
      {
        code: error.code,
        message: error.message
      },
      {
        status: error.status
      }
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json(
    {
      code: "decode_failed",
      message
    },
    {
      status: 500
    }
  );
}
