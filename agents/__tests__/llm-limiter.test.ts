import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetLLMLimiter,
  getLLMLimiterSnapshot,
  LLMBudgetExceededError,
  recordLLMUsage,
  withLLMLimit,
} from "../llm-limiter";
import { isRetryableHttpError, withRetry } from "../llm-retry";

const deferred = () => {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const tick = () => Promise.resolve();

beforeEach(() => {
  __resetLLMLimiter();
  vi.stubEnv("LLM_MAX_CONCURRENCY", "10");
  vi.stubEnv("LLM_RATE_LIMIT_PER_MIN", "100");
  vi.stubEnv("LLM_DAILY_BUDGET_USD", "1000");
  vi.stubEnv("LLM_USD_PER_1M_TOKENS", "5");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  __resetLLMLimiter();
});

describe("withLLMLimit — cost circuit breaker (H5)", () => {
  it("runs the call when under budget", async () => {
    await expect(withLLMLimit(async () => "ok")).resolves.toBe("ok");
  });

  it("opens the circuit once the daily budget is spent", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "0.001");
    vi.stubEnv("LLM_USD_PER_1M_TOKENS", "1000");
    recordLLMUsage({ promptTokens: 5000, completionTokens: 5000 });
    expect(getLLMLimiterSnapshot().circuitOpen).toBe(true);
    await expect(withLLMLimit(async () => "x")).rejects.toBeInstanceOf(
      LLMBudgetExceededError,
    );
  });
});

describe("withLLMLimit — concurrency cap (H5)", () => {
  it("does not exceed LLM_MAX_CONCURRENCY", async () => {
    vi.stubEnv("LLM_MAX_CONCURRENCY", "1");
    const first = deferred();
    const p1 = withLLMLimit(() => first.promise);
    await tick();
    expect(getLLMLimiterSnapshot().inFlight).toBe(1);

    let secondStarted = false;
    const p2 = withLLMLimit(async () => {
      secondStarted = true;
    });
    await tick();
    expect(secondStarted).toBe(false); // blocked until the slot frees

    first.resolve(undefined);
    await p1;
    await p2;
    expect(secondStarted).toBe(true);
    expect(getLLMLimiterSnapshot().inFlight).toBe(0);
  });
});

describe("withLLMLimit — rate window (H5)", () => {
  it("defers calls beyond the per-minute rate until the window rolls", async () => {
    vi.useFakeTimers();
    vi.stubEnv("LLM_RATE_LIMIT_PER_MIN", "1");
    __resetLLMLimiter();

    await withLLMLimit(async () => "first");
    let secondDone = false;
    const p2 = withLLMLimit(async () => {
      secondDone = true;
    });
    await tick();
    expect(secondDone).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    await p2;
    expect(secondDone).toBe(true);
  });
});

describe("recordLLMUsage", () => {
  it("accumulates estimated spend from token counts", () => {
    recordLLMUsage({ promptTokens: 1_000_000, completionTokens: 0 });
    expect(getLLMLimiterSnapshot().costUsd).toBeCloseTo(5, 5);
  });

  it("falls back to a char-based estimate when tokens are absent", () => {
    recordLLMUsage({ estimatedChars: 4_000_000 }); // ~1M tokens
    expect(getLLMLimiterSnapshot().costUsd).toBeCloseTo(5, 5);
  });
});

describe("withRetry (M3)", () => {
  it("retries retryable failures then succeeds", async () => {
    vi.useFakeTimers();
    const err = Object.assign(new Error("boom"), { code: "ECONNRESET" });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce("done");
    const p = withRetry(fn, { isRetryable: () => true, baseDelayMs: 1 });
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toBe("done");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    await expect(withRetry(fn, { isRetryable: () => false })).rejects.toThrow(
      "nope",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error("always"));
    const p = withRetry(fn, {
      isRetryable: () => true,
      maxRetries: 2,
      baseDelayMs: 1,
    }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("classifies HTTP errors", () => {
    expect(isRetryableHttpError(new Error("plain"))).toBe(false);
  });
});
