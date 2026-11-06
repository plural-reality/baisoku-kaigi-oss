import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthorizationHeader,
  getHostUserIdFromRequest,
  getUserIdFromRequest,
} from "../auth";

// Mock WorkOS authkit to avoid next/cache import in vitest
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: vi.fn().mockResolvedValue({ user: null }),
}));

// Mock auth supabase to avoid actual auth calls in tests
vi.mock("@/lib/supabase-auth-server", () => ({
  getAuthSupabase: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: "invalid token" },
      }),
    },
  })),
}));

const fakeRequest = (headers: Record<string, string> = {}) =>
  ({
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  }) as unknown as import("next/server").NextRequest;

describe("getUserIdFromRequest", () => {
  it("returns null when Authorization header is missing", async () => {
    expect(await getUserIdFromRequest(fakeRequest())).toBeNull();
  });

  it("returns null when Authorization header has no Bearer prefix", async () => {
    expect(
      await getUserIdFromRequest(fakeRequest({ authorization: "Basic abc" })),
    ).toBeNull();
  });

  // Audit 2026-10-06 H2: a raw UUID bearer is a forgeable credential. It is
  // rejected by default; only the dated PARTICIPANT_TOKEN_ENFORCE=false opt-out
  // (or the non-production no-secret lockout guard) still honours it.
  describe("legacy UUID bearer", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const request = () => fakeRequest({ authorization: `Bearer ${uuid}` });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it("is rejected by default once a secret is configured", async () => {
      vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "test-secret");
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(await getUserIdFromRequest(request())).toBeNull();
    });

    it("is still honoured in production while no secret is configured (Stage 1, warns — never a lockout on auto-deploy)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(await getUserIdFromRequest(request())).toBe(uuid);
    });

    it("is still honoured under the dated opt-out", async () => {
      vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "test-secret");
      vi.stubEnv("PARTICIPANT_TOKEN_ENFORCE", "false");
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(await getUserIdFromRequest(request())).toBe(uuid);
    });

    it("is honoured outside production when no secret exists (lockout guard, dev/test only)", async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(await getUserIdFromRequest(request())).toBe(uuid);
    });
  });

  it("returns null for non-UUID, non-JWT tokens", async () => {
    // non-UUID string triggers JWT verification, which is mocked to fail
    expect(
      await getUserIdFromRequest(
        fakeRequest({ authorization: "Bearer not-a-uuid-or-jwt" }),
      ),
    ).toBeNull();
  });

  it("converts WorkOS user ID to deterministic UUID", async () => {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    vi.mocked(withAuth).mockResolvedValueOnce({
      user: { id: "workos-user-123" },
    } as Awaited<ReturnType<typeof withAuth>>);

    const result = await getUserIdFromRequest(fakeRequest());
    // Should be a valid UUID (converted from non-UUID WorkOS ID)
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result).not.toBe("workos-user-123");
  });

  it("returns WorkOS user ID as-is when already UUID", async () => {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    vi.mocked(withAuth).mockResolvedValueOnce({
      user: { id: uuid },
    } as Awaited<ReturnType<typeof withAuth>>);

    expect(await getUserIdFromRequest(fakeRequest())).toBe(uuid);
  });
});

describe("getHostUserIdFromRequest", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const bearer = () => fakeRequest({ authorization: `Bearer ${uuid}` });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("ignores participant bearers when WorkOS is configured", async () => {
    vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
    vi.stubEnv("NODE_ENV", "test");
    expect(await getHostUserIdFromRequest(bearer())).toBeNull();
  });

  it("returns the WorkOS identity when signed in", async () => {
    vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    vi.mocked(withAuth).mockResolvedValueOnce({
      user: { id: uuid },
    } as Awaited<ReturnType<typeof withAuth>>);
    expect(await getHostUserIdFromRequest(bearer())).toBe(uuid);
  });

  it("falls back to the participant identity without WorkOS (local dev)", async () => {
    vi.stubEnv("WORKOS_CLIENT_ID", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await getHostUserIdFromRequest(bearer())).toBe(uuid);
  });
});

describe("createAuthorizationHeader", () => {
  it("returns an object with Authorization header", () => {
    const header = createAuthorizationHeader("user-123");
    expect(header).toEqual({ Authorization: "Bearer user-123" });
  });

  it("wraps any string as Bearer token", () => {
    const header = createAuthorizationHeader("some-uuid");
    expect(header.Authorization).toBe("Bearer some-uuid");
  });

  it("returns empty headers when token is null", () => {
    const header = createAuthorizationHeader(null);
    expect(header).toEqual({});
  });
});
