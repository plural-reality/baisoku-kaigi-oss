export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { clientIpOf } from "@/lib/client-ip";
import { takeRateSlot } from "@/lib/llm-user-guard";
import {
  isParticipantToken,
  isParticipantTokenEnforced,
  signParticipantToken,
  verifyParticipantToken,
} from "@/lib/participant-token";
import { sanitizeErrorForLog } from "@/lib/sanitize-error";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Issue a signed participant token (audit H1/M2). New anonymous clients get a
// freshly minted, server-side userId; clients already holding a signed token
// keep their identity. When signing is unavailable and enforcement is off,
// return token:null so the client can quietly use the legacy UUID bearer that
// the server still accepts during the opt-out window.
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Unauthenticated endpoint → throttle per client IP (audit 2026-10-06 H2).
  // Requests without any IP header share one bucket rather than bypassing it.
  const rate = takeRateSlot(
    "participant-token",
    clientIpOf(request.headers) ?? "unknown",
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter: rate.retryAfterSeconds },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  // A raw legacy UUID is honoured as an existing identity ONLY under the dated
  // PARTICIPANT_TOKEN_ENFORCE=false opt-out. By default, accepting it here would
  // let any leaked / guessed UUID be laundered into a signed token — reopening
  // H2 — so only a valid signed token re-issues; otherwise a fresh UUID is minted.
  const existing = bearer
    ? isParticipantToken(bearer)
      ? await verifyParticipantToken(bearer)
      : !isParticipantTokenEnforced() && UUID_RE.test(bearer)
        ? bearer
        : null
    : null;

  const userId = existing ?? crypto.randomUUID();

  try {
    const token = await signParticipantToken(userId);
    return NextResponse.json({ userId, token });
  } catch (error) {
    // Never echo the exception to the client (it names the missing env var).
    console.error(
      "[participant-token] issuance failed:",
      sanitizeErrorForLog(error),
    );
    return isParticipantTokenEnforced()
      ? NextResponse.json(
          { error: "Token issuance unavailable" },
          { status: 503 },
        )
      : NextResponse.json({ userId, token: null });
  }
}
