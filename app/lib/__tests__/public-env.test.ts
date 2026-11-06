import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPublicEnv } from "../public-env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("collectPublicEnv", () => {
  it("normalizes copied shell-style public values before runtime injection", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", " https://data.supabase.co ");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key;");

    const env = collectPublicEnv();

    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://data.supabase.co");
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("public-anon-key");
  });
});
