import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthedRequest,
  createMockRequest,
} from "@/lib/__tests__/helpers/mock-request";
import { __resetUserGuard } from "@/lib/llm-user-guard";
import { verifyParticipantToken } from "@/lib/participant-token";
import { POST } from "../route";

const UUID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "test-secret");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  __resetUserGuard();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  __resetUserGuard();
});

describe("POST /api/auth/participant-token", () => {
  it("mints a fresh signed token for a brand-new client", async () => {
    const res = await POST(createMockRequest({ method: "POST" }));
    const { userId, token } = await res.json();
    expect(token).toMatch(/^cpt1\./);
    expect(await verifyParticipantToken(token)).toBe(userId);
  });

  it("re-issues the same identity for a valid signed token", async () => {
    const first = await (
      await POST(createMockRequest({ method: "POST" }))
    ).json();
    const res = await POST(
      createMockRequest({
        method: "POST",
        headers: { authorization: `Bearer ${first.token}` },
      }),
    );
    const { userId } = await res.json();
    expect(userId).toBe(first.userId);
  });

  it("default (enforced): will not launder a raw leaked UUID — mints a fresh id (audit H2)", async () => {
    const res = await POST(createAuthedRequest(UUID, { method: "POST" }));
    const { userId } = await res.json();
    expect(userId).not.toBe(UUID);
  });

  it("dated opt-out (PARTICIPANT_TOKEN_ENFORCE=false): signs an existing legacy UUID", async () => {
    vi.stubEnv("PARTICIPANT_TOKEN_ENFORCE", "false");
    const res = await POST(createAuthedRequest(UUID, { method: "POST" }));
    const { userId } = await res.json();
    expect(userId).toBe(UUID);
  });

  it("returns a quiet legacy fallback when the signing secret is unset (non-production)", async () => {
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "");
    vi.stubEnv("NODE_ENV", "test");
    const res = await POST(createMockRequest({ method: "POST" }));
    const { userId, token } = await res.json();
    expect(res.status).toBe(200);
    expect(userId).toEqual(expect.any(String));
    expect(token).toBeNull();
  });

  it("production without a secret: still the quiet legacy fallback (Stage 1), never a 503 lockout", async () => {
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(createMockRequest({ method: "POST" }));
    const { token } = await res.json();
    expect(res.status).toBe(200);
    expect(token).toBeNull();
  });

  it("migration window: secret + opt-out signs the legacy UUID the client already holds", async () => {
    vi.stubEnv("PARTICIPANT_TOKEN_ENFORCE", "false");
    const res = await POST(createAuthedRequest(UUID, { method: "POST" }));
    const { userId, token } = await res.json();
    expect(userId).toBe(UUID);
    expect(await verifyParticipantToken(token)).toBe(UUID);
  });

  describe("per-IP rate limit (audit H2)", () => {
    const fromIp = (ip: string) =>
      createMockRequest({
        method: "POST",
        headers: { "x-forwarded-for": ip },
      });

    it("returns 429 with Retry-After once an IP exceeds the window", async () => {
      vi.stubEnv("PARTICIPANT_TOKEN_RATE_LIMIT_PER_MIN", "2");
      expect((await POST(fromIp("203.0.113.9"))).status).toBe(200);
      expect((await POST(fromIp("203.0.113.9"))).status).toBe(200);
      const limited = await POST(fromIp("203.0.113.9"));
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
      // Another IP is unaffected.
      expect((await POST(fromIp("203.0.113.10"))).status).toBe(200);
    });

    it("requests without any IP header share one bucket (no bypass)", async () => {
      vi.stubEnv("PARTICIPANT_TOKEN_RATE_LIMIT_PER_MIN", "1");
      expect((await POST(createMockRequest({ method: "POST" }))).status).toBe(
        200,
      );
      expect((await POST(createMockRequest({ method: "POST" }))).status).toBe(
        429,
      );
    });
  });
});
