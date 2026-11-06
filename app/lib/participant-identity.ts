"use client";

// Client side of the signed participant token (audit H1/M2). On first use we
// exchange the legacy localStorage UUID (or nothing, for a brand-new visitor)
// for a server-signed token via /api/auth/participant-token, then send that
// token as the Bearer. Existing participants keep their userId (the server signs
// the UUID they already had), so no one is logged out during the staged rollout.
// If issuance is unavailable (secret unset / offline), we fall back to the legacy
// raw UUID — which the server still accepts until PARTICIPANT_TOKEN_ENFORCE.

const LEGACY_USER_ID_KEY = "cartographer_user_id";
const TOKEN_KEY = "cartographer_participant_token";

const generateUuid = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

export type ParticipantIdentity = Readonly<{
  userId: string;
  // The signed token to send as Bearer, or null when issuance is unavailable
  // (Stage 1 falls back to the raw userId).
  token: string | null;
}>;

export const ensureParticipantIdentity =
  async (): Promise<ParticipantIdentity> => {
    if (typeof window === "undefined") return { userId: "", token: null };

    const rawStoredToken = localStorage.getItem(TOKEN_KEY);
    const storedToken =
      rawStoredToken && rawStoredToken !== "null" ? rawStoredToken : null;
    const storedUser = localStorage.getItem(LEGACY_USER_ID_KEY);
    rawStoredToken === "null" ? localStorage.removeItem(TOKEN_KEY) : undefined;
    if (storedToken && storedUser) {
      return { userId: storedUser, token: storedToken };
    }

    try {
      const res = await fetch("/api/auth/participant-token", {
        method: "POST",
        headers: storedUser ? { Authorization: `Bearer ${storedUser}` } : {},
      });
      if (res.ok) {
        const { userId, token } = (await res.json()) as {
          userId: string;
          token: string | null;
        };
        localStorage.setItem(LEGACY_USER_ID_KEY, userId);
        token
          ? localStorage.setItem(TOKEN_KEY, token)
          : localStorage.removeItem(TOKEN_KEY);
        return { userId, token };
      }
    } catch {
      // fall through to legacy fallback
    }

    const fallbackId = storedUser ?? generateUuid();
    localStorage.setItem(LEGACY_USER_ID_KEY, fallbackId);
    return { userId: fallbackId, token: null };
  };

// The Bearer value to send: prefer the signed token, else the legacy UUID.
export const getParticipantBearer = (): string | null => {
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(LEGACY_USER_ID_KEY)
  );
};
