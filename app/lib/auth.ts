import { withAuth } from "@workos-inc/authkit-nextjs";
import type { NextRequest } from "next/server";
import {
  isParticipantToken,
  isParticipantTokenEnforced,
  verifyParticipantToken,
} from "./participant-token";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extract user ID from request. Priority chain:
 * 1. WorkOS session cookie (primary — managed by authkitMiddleware)
 * 2. Bearer token: signed participant token (cpt1.…)
 * 3. Bearer token: plain UUID — REJECTED by default since 2026-10-06 (audit H2);
 *    honoured only under PARTICIPANT_TOKEN_ENFORCE=false until 2026-11-06
 * 4. Bearer token: Supabase JWT (legacy, migration period)
 *
 * TODO: Remove legacy fallbacks (3, 4) after 2026-11-06.
 */
export const getUserIdFromRequest = async (
  _request: NextRequest,
): Promise<string | null> => {
  // 1. Try WorkOS session (cookie-based, managed by middleware)
  const workosUserId = await getWorkOSUserId();
  if (workosUserId) return workosUserId;

  // 2. Otherwise resolve the Authorization Bearer credential
  return resolveBearerIdentity(_request);
};

const isWorkOSConfigured = () => Boolean(process.env.WORKOS_CLIENT_ID);

/**
 * Identity of a session host (creating sessions and the creation helpers).
 * Hosts must sign in with WorkOS, like 倍速アンケート creators; participants keep
 * using getUserIdFromRequest (anonymous signed tokens). Without WorkOS configured
 * (local dev) the participant identity is accepted so the app stays usable.
 */
export const getHostUserIdFromRequest = async (
  request: NextRequest,
): Promise<string | null> =>
  isWorkOSConfigured() ? getWorkOSUserId() : getUserIdFromRequest(request);

/**
 * Resolve ONLY the `Authorization: Bearer` credential to an identity, ignoring
 * any WorkOS session. This is proof of possession of that specific credential —
 * used by getUserIdFromRequest and by /api/auth/migrate to prove ownership of the
 * *old* anonymous identity before merging it into a WorkOS account (audit M1).
 */
export const resolveBearerIdentity = async (
  request: NextRequest,
): Promise<string | null> => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.substring(7);
  if (!token) return null;

  // a. Signed participant token (audit H1/M2) — the unforgeable bearer identity.
  if (isParticipantToken(token)) {
    return verifyParticipantToken(token);
  }

  // b. Legacy: plain UUID. A raw UUID is a forgeable bearer credential (audit
  // H2), so it is rejected unless the dated PARTICIPANT_TOKEN_ENFORCE=false
  // opt-out is set; clients must present signed tokens.
  if (UUID_RE.test(token)) {
    if (isParticipantTokenEnforced()) {
      console.warn("[auth] Rejected legacy plain UUID (enforcement on)");
      return null;
    }
    console.warn(`[auth] Legacy UUID fallback used: ${token.slice(0, 8)}...`);
    return token;
  }

  // c. Legacy: Supabase JWT — lazy-load to avoid import when not needed
  return verifySupabaseJWT(token);
};

/**
 * Get WorkOS user ID from session cookie via withAuth().
 * Returns null if no WorkOS session exists (e.g. anonymous participant).
 */
const getWorkOSUserId = async (): Promise<string | null> => {
  try {
    const { user } = await withAuth();
    if (!user?.id) return null;
    // WorkOS IDs (e.g. "user_01...") are not UUID format.
    // Convert to deterministic UUID so Postgres UUID columns work.
    if (UUID_RE.test(user.id)) return user.id;
    const { toStableUUID } = await import("./workos-uuid");
    return toStableUUID(user.id);
  } catch (err) {
    console.warn("[auth] withAuth() failed in API route:", err);
    return null;
  }
};

/**
 * Legacy: Verify Supabase JWT against Sonar Supabase.
 * TODO: Remove after WorkOS migration complete.
 */
const verifySupabaseJWT = async (token: string): Promise<string | null> => {
  try {
    const { getAuthSupabase } = await import("@/lib/supabase-auth-server");
    const {
      data: { user },
      error,
    } = await getAuthSupabase().auth.getUser(token);
    return error || !user ? null : user.id;
  } catch {
    return null;
  }
};

// Re-export for backward compatibility (server-side consumers)
export { createAuthorizationHeader } from "./auth-header";
