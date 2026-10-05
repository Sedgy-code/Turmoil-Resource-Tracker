import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      {
        status: error.status,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: error.issues[0]?.message ?? "Invalid request.",
        code: "VALIDATION_ERROR",
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: "The request body must contain valid JSON.",
        code: "INVALID_JSON",
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  // Never include database errors or OAuth response payloads in responses or logs.
  console.error(
    "Tracker request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return NextResponse.json(
    {
      error: "Something went wrong. Please try again.",
      code: "INTERNAL_ERROR",
    },
    { status: 500, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function privateResponse<T>(data: T): NextResponse {
  const response = NextResponse.json(data);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
