// Per-session opaque alias for user UUIDs in admin-facing responses (security
// audit 2026-10-06, H2).
//
// Admin pages are reached by a shareable link (`/sessions/<id>/<accessToken>`).
// The admin API used to echo raw `host_user_id` / `events.user_id` /
// `participants.user_id`, and a raw UUID doubled as a bearer credential under
// the legacy auth path — so anyone holding an admin link could lift the host's
// UUID, present it as `Bearer <uuid>`, and call `GET /api/sessions` to list the
// host's other sessions with their admin tokens. The legacy path is now rejected
// by default (app/lib/participant-token.ts), and this module removes the
// disclosure itself: clients only ever see HMAC(secret, session ‖ user).
//
// The alias is deterministic per (secret, session, user), so the admin UI can
// still join participants ↔ responses ↔ events across endpoints, but it cannot
// be inverted or replayed as an identity, and the same user gets a different
// alias in every session (no cross-session tracking).

import { createHmac, randomBytes } from "node:crypto";

// Only mutation in the module: a per-process fallback key, generated once.
let processKey: string | undefined;

// Key preference: a dedicated secret, else the participant-token secret (already
// provisioned wherever signed tokens are), else a random per-process key. The
// last case keeps aliases stable within one process (enough for a single-node
// deployment) and still never reveals UUIDs; it only changes across restarts.
const fallbackProcessKey = (): string => {
  if (processKey === undefined) {
    processKey = randomBytes(32).toString("hex");
  }
  return processKey;
};

const aliasKey = (): string =>
  process.env.USER_ALIAS_SECRET ||
  process.env.PARTICIPANT_TOKEN_SECRET ||
  fallbackProcessKey();

const ALIAS_PREFIX = "u_";
const ALIAS_LENGTH = 22; // 132 bits of base64url — collision-free in practice.

export const aliasUserId = (sessionId: string, userId: string): string =>
  `${ALIAS_PREFIX}${createHmac("sha256", aliasKey())
    .update(`${sessionId}\n${userId}`)
    .digest("base64url")
    .slice(0, ALIAS_LENGTH)}`;

export const aliasNullableUserId = (
  sessionId: string,
  userId: string | null | undefined,
): string | null => (userId ? aliasUserId(sessionId, userId) : null);

// Event payloads are stored verbatim and some carry a participant id inside
// `metadata` (participant reflections: reflections/route.ts writes
// `metadata.participantUserId`). Alias it on the way out so the thread view
// never discloses a raw UUID either (found on staging, 2026-10-07).
const USER_ID_METADATA_KEYS = ["participantUserId", "userId"] as const;

export const aliasEventPayload = (
  sessionId: string,
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const metadata = payload.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return payload;
  }
  const record = metadata as Record<string, unknown>;
  const aliased = Object.fromEntries(
    USER_ID_METADATA_KEYS.filter((key) => typeof record[key] === "string").map(
      (key) => [key, aliasUserId(sessionId, record[key] as string)],
    ),
  );
  return Object.keys(aliased).length === 0
    ? payload
    : { ...payload, metadata: { ...record, ...aliased } };
};
