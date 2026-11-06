import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { SessionAccessError } from "./session-access";

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof SessionAccessError) {
    if (error.status >= 500) {
      Sentry.captureException(error);
    }
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  Sentry.captureException(error);
  console.error("Unhandled API error:", error);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}
