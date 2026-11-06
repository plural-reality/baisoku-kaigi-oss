// In-process throttle + daily cost circuit-breaker for every OpenRouter call
// (security audit H5: no rate limit / concurrency cap / cost ceiling on any LLM
// path). Production runs a single Node process, so module-level state is the
// canonical chokepoint — this is deliberately NOT distributed.
//
// Kept free of Next.js / Sentry imports so both app/lib/llm.ts and the separate
// agents/ runtime can funnel through the same limiter. All thresholds are env
// overridable; defaults are conservative safety rails, not accounting.

const positiveNum = (key: string, fallback: number): number => {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const maxConcurrency = (): number => positiveNum("LLM_MAX_CONCURRENCY", 6);
// Observed peak agent load during large workshops was ~20 req/min — exactly the
// old default, so peaks queued and could cascade into 45s HTTP timeouts. 60/min
// gives ~3x headroom; the daily-budget breaker (below) remains the real cost
// backstop, and concurrency (6) still caps burst throughput well under this.
const ratePerMinute = (): number => positiveNum("LLM_RATE_LIMIT_PER_MIN", 60);
const dailyBudgetUsd = (): number => positiveNum("LLM_DAILY_BUDGET_USD", 25);
// Coarse blended price used only to trip the breaker — never billed.
const usdPer1mTokens = (): number => positiveNum("LLM_USD_PER_1M_TOKENS", 5);

const RATE_WINDOW_MS = 60_000;

// --- mutable singleton state (encapsulated; the only mutation in the module) ---
let inFlight = 0;
let grantTimestamps: readonly number[] = [];
const waiters: Array<() => void> = [];
let costDayKey = "";
let costUsd = 0;

const utcDayKey = (): string => new Date().toISOString().slice(0, 10);

const rollDay = (): void => {
  const today = utcDayKey();
  if (costDayKey !== today) {
    costDayKey = today;
    costUsd = 0;
  }
};

export class LLMBudgetExceededError extends Error {
  constructor(spentUsd: number, budgetUsd: number) {
    super(
      `LLM daily budget exceeded: ~$${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)} (circuit open; set LLM_DAILY_BUDGET_USD to adjust)`,
    );
    this.name = "LLMBudgetExceededError";
  }
}

const assertBudget = (): void => {
  rollDay();
  if (costUsd >= dailyBudgetUsd()) {
    throw new LLMBudgetExceededError(costUsd, dailyBudgetUsd());
  }
};

const recentGrants = (now: number): readonly number[] =>
  grantTimestamps.filter((t) => now - t < RATE_WINDOW_MS);

// True when both the concurrency slot and the rate window admit one more call.
const canGrant = (now: number): boolean =>
  inFlight < maxConcurrency() && recentGrants(now).length < ratePerMinute();

const msUntilRateSlot = (now: number): number => {
  const recent = recentGrants(now);
  return recent.length < ratePerMinute()
    ? 0
    : Math.max(0, RATE_WINDOW_MS - (now - recent[0]));
};

// Wake queued callers while capacity allows; re-arm a timer when only the rate
// window (not concurrency) is the blocker.
const pump = (): void => {
  const now = Date.now();
  if (waiters.length === 0) {
    return;
  }
  if (canGrant(now)) {
    grantTimestamps = [...recentGrants(now), now];
    inFlight += 1;
    const next = waiters.shift();
    next?.();
    pump(); // a grant may leave room for another waiter
    return;
  }
  if (inFlight < maxConcurrency()) {
    // Blocked only by the rate window — retry when the oldest grant expires.
    setTimeout(pump, msUntilRateSlot(now) || RATE_WINDOW_MS);
  }
};

const acquire = (): Promise<void> =>
  new Promise<void>((resolve) => {
    waiters.push(resolve);
    pump();
  });

const release = (): void => {
  inFlight = Math.max(0, inFlight - 1);
  pump();
};

// Wrap a single OpenRouter request: trips fast if the daily budget is spent,
// then waits for a concurrency slot and rate-window credit before running.
export const withLLMLimit = async <T>(fn: () => Promise<T>): Promise<T> => {
  assertBudget(); // fail fast before queueing
  await acquire();
  try {
    // Re-check inside the slot: while this call waited, earlier calls may have
    // recorded enough usage to open the circuit, so a queued burst must not run.
    assertBudget();
    return await fn();
  } finally {
    release();
  }
};

const estimateTokensFromChars = (chars: number): number => Math.ceil(chars / 4);

// Record spend against the daily breaker. Pass real usage tokens when the
// provider returns them; otherwise estimate from the text length.
export const recordLLMUsage = (usage: {
  promptTokens?: number;
  completionTokens?: number;
  estimatedChars?: number;
}): void => {
  rollDay();
  const tokens =
    (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0) ||
    estimateTokensFromChars(usage.estimatedChars ?? 0);
  costUsd += (tokens / 1_000_000) * usdPer1mTokens();
};

export type LLMLimiterSnapshot = Readonly<{
  inFlight: number;
  recentRequests: number;
  maxConcurrency: number;
  ratePerMinute: number;
  costUsd: number;
  dailyBudgetUsd: number;
  circuitOpen: boolean;
}>;

export const getLLMLimiterSnapshot = (): LLMLimiterSnapshot => {
  rollDay();
  return {
    inFlight,
    recentRequests: recentGrants(Date.now()).length,
    maxConcurrency: maxConcurrency(),
    ratePerMinute: ratePerMinute(),
    costUsd,
    dailyBudgetUsd: dailyBudgetUsd(),
    circuitOpen: costUsd >= dailyBudgetUsd(),
  };
};

// Test-only: reset the singleton between cases.
export const __resetLLMLimiter = (): void => {
  inFlight = 0;
  grantTimestamps = [];
  waiters.length = 0;
  costDayKey = "";
  costUsd = 0;
};
