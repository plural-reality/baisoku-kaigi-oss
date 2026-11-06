// Per-identity throttle + short-lived result cache for the expensive, low-auth
// preview / form-suggestion LLM endpoints.
//
// agents/llm-limiter caps TOTAL OpenRouter throughput (global ~60/min). That does
// NOT stop one client from consuming the whole budget: /sessions/new fires
// preview-questions + form-suggestions on every input change, so a fast typist —
// or AI voice dictation streaming interim transcripts, or an abuser holding a
// participant token — can pin the global limiter and drain the daily OpenRouter
// cap for everyone (incident 2026-06-02). This adds a PER-IDENTITY rate window
// plus a per-(identity,input) result cache so repeated / near-identical requests
// are served without a new LLM call.
//
// Single Node process, so module-level Maps are the canonical store (not
// distributed) — same deliberate choice as agents/llm-limiter.

const WINDOW_MS = 60_000;

// `participant-token`: per-IP cap on identity issuance (audit 2026-10-06 H2 —
// the unauthenticated minting endpoint was otherwise an unbounded source of
// fresh identities for spam / vote stuffing). Keyed by client IP, not identity,
// because the caller has none yet.
export type PreviewKind = "preview" | "suggestions" | "participant-token";

const positiveInt = (key: string, fallback: number): number => {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const maxPerWindow = (kind: PreviewKind): number =>
  kind === "preview"
    ? positiveInt("PREVIEW_RATE_LIMIT_PER_MIN", 6)
    : kind === "participant-token"
      ? positiveInt("PARTICIPANT_TOKEN_RATE_LIMIT_PER_MIN", 30)
      : positiveInt("SUGGESTIONS_RATE_LIMIT_PER_MIN", 6);

const cacheTtlMs = (): number => positiveInt("PREVIEW_CACHE_TTL_MS", 60_000);

// --- mutable singleton state (the only mutation in the module) ---
const grantsByKey = new Map<string, readonly number[]>();
const cacheByKey = new Map<
  string,
  Readonly<{ value: unknown; expiresAt: number }>
>();
let lastSweepAt = 0;

const recentGrants = (key: string, now: number): readonly number[] =>
  (grantsByKey.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

// Drop expired cache entries and rate windows that have fully aged out so the
// maps cannot grow without bound under a flood of distinct identities / inputs —
// cheap participant tokens make that an abuse vector, the very thing this guard
// exists to limit. Throttled to once per window: at most one O(n) scan per 60s,
// so steady-state size tracks only the last window's working set.
const sweep = (now: number): void => {
  Array.from(cacheByKey.entries()).forEach(([key, entry]) => {
    if (entry.expiresAt <= now) {
      cacheByKey.delete(key);
    }
  });
  Array.from(grantsByKey.entries()).forEach(([key, window]) => {
    if (window.every((t) => now - t >= WINDOW_MS)) {
      grantsByKey.delete(key);
    }
  });
};

const maybeSweep = (now: number): void => {
  if (now - lastSweepAt >= WINDOW_MS) {
    lastSweepAt = now;
    sweep(now);
  }
};

export type RateDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

// Consume one per-identity rate slot for `kind`. Records the grant only when
// allowed, so a denied call does not extend the window. Caller passes `now` in
// tests for determinism; production uses the default.
export const takeRateSlot = (
  kind: PreviewKind,
  identity: string,
  now: number = Date.now(),
): RateDecision => {
  maybeSweep(now);
  const key = `${kind}:${identity}`;
  const window = recentGrants(key, now);
  if (window.length >= maxPerWindow(kind)) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((WINDOW_MS - (now - window[0])) / 1000),
      ),
    };
  }
  grantsByKey.set(key, [...window, now]);
  return { allowed: true, retryAfterSeconds: 0 };
};

// djb2 over the joined parts — small, dependency-free, edge-safe. Only used to
// key a short-lived cache, so collision resistance is irrelevant.
export const hashInput = (parts: readonly string[]): string =>
  (
    Array.from(parts.join("")).reduce(
      (acc, ch) => (((acc << 5) + acc) ^ ch.charCodeAt(0)) >>> 0,
      5381,
    ) >>> 0
  ).toString(36);

export const cacheKeyFor = (
  kind: PreviewKind,
  identity: string,
  inputParts: readonly string[],
): string => `${kind}:${identity}:${hashInput(inputParts)}`;

export const readCache = <T>(
  cacheKey: string,
  now: number = Date.now(),
): T | undefined => {
  const entry = cacheByKey.get(cacheKey);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cacheByKey.delete(cacheKey);
    return undefined;
  }
  return entry.value as T;
};

export const writeCache = (
  cacheKey: string,
  value: unknown,
  now: number = Date.now(),
): void => {
  maybeSweep(now);
  cacheByKey.set(cacheKey, { value, expiresAt: now + cacheTtlMs() });
};

// Test-only: current map sizes, for asserting eviction.
export const __guardSizes = (): Readonly<{
  grants: number;
  cache: number;
}> => ({
  grants: grantsByKey.size,
  cache: cacheByKey.size,
});

// Test-only: reset the singleton between cases.
export const __resetUserGuard = (): void => {
  grantsByKey.clear();
  cacheByKey.clear();
  lastSweepAt = 0;
};
