import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __guardSizes,
  __resetUserGuard,
  cacheKeyFor,
  hashInput,
  readCache,
  takeRateSlot,
  writeCache,
} from "../llm-user-guard";

beforeEach(() => {
  __resetUserGuard();
  vi.stubEnv("PREVIEW_RATE_LIMIT_PER_MIN", "3");
  vi.stubEnv("SUGGESTIONS_RATE_LIMIT_PER_MIN", "3");
  vi.stubEnv("PREVIEW_CACHE_TTL_MS", "60000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("takeRateSlot", () => {
  it("allows up to the per-identity limit, then denies with a retryAfter", () => {
    const t0 = 1_000_000;
    expect(takeRateSlot("preview", "u1", t0).allowed).toBe(true);
    expect(takeRateSlot("preview", "u1", t0 + 1).allowed).toBe(true);
    expect(takeRateSlot("preview", "u1", t0 + 2).allowed).toBe(true);

    const denied = takeRateSlot("preview", "u1", t0 + 3);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("isolates identities and kinds", () => {
    const t0 = 2_000_000;
    expect(takeRateSlot("preview", "a", t0).allowed).toBe(true);
    expect(takeRateSlot("preview", "a", t0 + 1).allowed).toBe(true);
    expect(takeRateSlot("preview", "a", t0 + 2).allowed).toBe(true);
    // Different user: own fresh window.
    expect(takeRateSlot("preview", "b", t0 + 3).allowed).toBe(true);
    // Different kind for the same user: own fresh window.
    expect(takeRateSlot("suggestions", "a", t0 + 4).allowed).toBe(true);
  });

  it("frees slots once the window slides past them", () => {
    const t0 = 3_000_000;
    takeRateSlot("preview", "u", t0);
    takeRateSlot("preview", "u", t0 + 1);
    takeRateSlot("preview", "u", t0 + 2);
    expect(takeRateSlot("preview", "u", t0 + 3).allowed).toBe(false);
    // 61s later the first three grants have aged out of the 60s window.
    expect(takeRateSlot("preview", "u", t0 + 61_000).allowed).toBe(true);
  });
});

describe("cache", () => {
  it("returns a stored value within TTL and expires after it", () => {
    const t0 = 5_000_000;
    const key = cacheKeyFor("preview", "u", ["a", "b", "c"]);
    writeCache(key, ["q1", "q2"], t0);
    expect(readCache<string[]>(key, t0 + 59_000)).toEqual(["q1", "q2"]);
    expect(readCache<string[]>(key, t0 + 60_001)).toBeUndefined();
  });

  it("misses on a different input", () => {
    const t0 = 6_000_000;
    writeCache(cacheKeyFor("preview", "u", ["a"]), ["x"], t0);
    expect(readCache(cacheKeyFor("preview", "u", ["b"]), t0)).toBeUndefined();
  });
});

describe("eviction (no unbounded growth)", () => {
  it("sweeps expired cache entries and idle rate windows once per window", () => {
    const t0 = 7_000_000;
    takeRateSlot("preview", "idle-user", t0);
    writeCache(cacheKeyFor("preview", "idle-user", ["x"]), ["q"], t0);
    expect(__guardSizes().grants).toBe(1);
    expect(__guardSizes().cache).toBe(1);

    // Touching the guard with another identity > a window later triggers the
    // throttled sweep: the idle grant + the expired cache entry are evicted and
    // only the fresh grant remains (the maps do not grow without bound).
    takeRateSlot("preview", "other", t0 + 2 * 60_000);
    expect(__guardSizes()).toEqual({ grants: 1, cache: 0 });
  });
});

describe("hashInput / cacheKeyFor", () => {
  it("is stable and order-sensitive", () => {
    expect(hashInput(["a", "b"])).toBe(hashInput(["a", "b"]));
    expect(hashInput(["a", "b"])).not.toBe(hashInput(["b", "a"]));
  });

  it("scopes keys by kind and identity", () => {
    expect(cacheKeyFor("preview", "u", ["x"])).not.toBe(
      cacheKeyFor("suggestions", "u", ["x"]),
    );
    expect(cacheKeyFor("preview", "u1", ["x"])).not.toBe(
      cacheKeyFor("preview", "u2", ["x"]),
    );
  });
});
