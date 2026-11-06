export const dynamic = "force-dynamic";

import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

export async function GET() {
  // Anyone can call this route, so production would collect an event per visit (scanners
  // included). Staging keeps it for checking the Sentry wiring.
  // biome-ignore lint/complexity/useLiteralKeys: bracket notation prevents Next.js build-time inlining (Nix placeholder issue)
  if (process.env["NEXT_PUBLIC_SENTRY_ENVIRONMENT"] === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // i18n-allow: test error, never shown (404 in production)
  const error = new Error("Sentry test error — このエラーはテスト用です");
  Sentry.captureException(error);
  await Sentry.flush(2000);
  return NextResponse.json({
    ok: true,
    message: "Test error sent to Sentry",
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ? "configured" : "missing",
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "not set",
  });
}
