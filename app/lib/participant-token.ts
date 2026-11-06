// HMAC-signed participant identity token (security audit H1 / M2).
//
// The legacy flow accepted a raw `Bearer <uuid>` as identity, so any leaked UUID
// was a working impersonation credential (H1), and clients self-minted their own
// UUIDs (forgeable — M2). A signed token binds the userId with a server-only
// HMAC: a leaked UUID is useless without the signature, and new identities are
// minted server-side. Web Crypto so it runs in both the Node API routes and the
// edge middleware; verification uses crypto.subtle.verify (constant-time).
//
// Format: cpt1.<base64url(userId)>.<base64url(hmacSha256(userId))>

const PREFIX = "cpt1";
const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const secret = (): string | null =>
  process.env.PARTICIPANT_TOKEN_SECRET ?? null;

const importKey = (rawSecret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(rawSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

export const isParticipantToken = (token: string): boolean =>
  token.startsWith(`${PREFIX}.`);

// Mint a signed token for an already-decided userId. Throws when the secret is
// unset so callers can fall back to the legacy flow instead of issuing a token
// that can never be verified.
export const signParticipantToken = async (userId: string): Promise<string> => {
  const key = secret();
  if (!key) {
    throw new Error("PARTICIPANT_TOKEN_SECRET is not set");
  }
  const cryptoKey = await importKey(key);
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(userId) as BufferSource,
  );
  return `${PREFIX}.${toBase64Url(encoder.encode(userId))}.${toBase64Url(new Uint8Array(signature))}`;
};

// Returns the userId iff the token is well-formed and the signature verifies
// against the current secret; null otherwise (never throws).
export const verifyParticipantToken = async (
  token: string,
): Promise<string | null> => {
  const key = secret();
  if (!key || !isParticipantToken(token)) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const userIdBytes = fromBase64Url(parts[1]);
    const signature = fromBase64Url(parts[2]);
    const cryptoKey = await importKey(key);
    const valid = await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      signature as BufferSource,
      userIdBytes as BufferSource,
    );
    return valid ? new TextDecoder().decode(userIdBytes) : null;
  } catch {
    return null;
  }
};

// Stage 2 (enforce): getUserIdFromRequest stops honouring raw legacy UUID
// bearers and accepts only signed tokens / WorkOS sessions.
//
// ENFORCED BY DEFAULT since 2026-10-06 (security audit H2: a raw UUID was still
// a working impersonation credential, and admin responses disclosed host /
// participant UUIDs). The old `PARTICIPANT_TOKEN_ENFORCE=true` go-sign is gone;
// `PARTICIPANT_TOKEN_ENFORCE=false` is the only opt-out, kept for the dated
// migration window below.
//
// Lockout guard (deliberately NOT fail-closed): without a configured secret,
// clients cannot mint signed tokens (issuance 503), so enforcing would lock out
// every anonymous participant — and `main` auto-deploys to production, so a
// merge must be safe against the env production has *today*. A deployment
// without the secret therefore stays in Stage 1 (legacy UUIDs accepted) and
// says so loudly once per process; /api/health exposes the same state so the
// rollout can be read back after each deploy.
//
// Rollout contract: adding the secret WITHOUT the opt-out enforces at once and
// strands every identity that only exists as a legacy UUID (existing answers,
// hosts' session lists). Add the secret together with
// PARTICIPANT_TOKEN_ENFORCE=false first, let clients exchange their UUIDs for
// signed tokens, then drop the opt-out.
export const LEGACY_OPT_OUT_UNTIL = "2026-11-06";

// Only mutation in the module: each warning fires once per process, not per
// request.
const warned = new Set<string>();

const warnOnce = (key: string, message: string): void => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
};

export const isLegacyOptOut = (): boolean => {
  if (process.env.PARTICIPANT_TOKEN_ENFORCE !== "false") return false;
  const expired = new Date() > new Date(`${LEGACY_OPT_OUT_UNTIL}T00:00:00Z`);
  warnOnce(
    expired ? "opt-out-expired" : "opt-out",
    expired
      ? `[auth] PARTICIPANT_TOKEN_ENFORCE=false is past its migration window (${LEGACY_OPT_OUT_UNTIL}); remove it to enforce signed participant tokens`
      : `[auth] PARTICIPANT_TOKEN_ENFORCE=false: legacy UUID bearers accepted (migration window ends ${LEGACY_OPT_OUT_UNTIL})`,
  );
  return true;
};

export const isParticipantTokenEnforced = (): boolean => {
  if (isLegacyOptOut()) return false;
  if (secret()) return true;
  if (process.env.NODE_ENV === "production") {
    warnOnce(
      "no-secret",
      "[auth] PARTICIPANT_TOKEN_SECRET is not set: signed tokens cannot be issued, legacy UUID bearers are still accepted (audit H2 open). Set the secret together with PARTICIPANT_TOKEN_ENFORCE=false, then drop the opt-out.",
    );
  }
  return false;
};

// Rollout readback for /api/health (no secret material).
export type ParticipantTokenStatus = Readonly<{
  secretConfigured: boolean;
  enforced: boolean;
  legacyOptOut: boolean;
  legacyOptOutUntil: string;
}>;

export const participantTokenStatus = (): ParticipantTokenStatus => ({
  secretConfigured: Boolean(secret()),
  enforced: isParticipantTokenEnforced(),
  legacyOptOut: isLegacyOptOut(),
  legacyOptOutUntil: LEGACY_OPT_OUT_UNTIL,
});

// Test-only: reset the once-per-process warnings.
export const __resetParticipantTokenWarnings = (): void => {
  warned.clear();
};
