import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock("axios", async () => {
  const actual = await vi.importActual("axios");
  return {
    ...actual,
    default: {
      ...(actual as Record<string, unknown>).default,
      get: vi.fn(),
    },
  };
});

import axios from "axios";
import { supabase } from "@/lib/supabase";
import { GET } from "../route";

const mockedFrom = supabase.from as ReturnType<typeof vi.fn>;
const mockedGet = axios.get as ReturnType<typeof vi.fn>;

describe("GET /api/health", () => {
  const originalEnv = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OPENROUTER_API_KEY = originalEnv;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("returns ok when both services are healthy", async () => {
    mockedFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: [{ id: "1" }], error: null }),
      }),
    });
    mockedGet.mockResolvedValue({
      data: { data: { limit: null, limit_remaining: null } },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.supabase).toBe("ok");
    expect(body.checks.openrouter).toBe("ok");
  });

  it("returns degraded when supabase is down", async () => {
    mockedFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "connection error" },
        }),
      }),
    });
    mockedGet.mockResolvedValue({ data: {} });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.supabase).toBe("error");
    expect(body.checks.openrouter).toBe("ok");
  });

  it("returns degraded when openrouter is down", async () => {
    mockedFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: [{ id: "1" }], error: null }),
      }),
    });
    mockedGet.mockRejectedValue(new Error("timeout"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.supabase).toBe("ok");
    expect(body.checks.openrouter).toBe("error");
  });

  it("returns 503 when both services are down", async () => {
    mockedFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: "down" } }),
      }),
    });
    mockedGet.mockRejectedValue(new Error("timeout"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.checks.supabase).toBe("error");
    expect(body.checks.openrouter).toBe("error");
  });

  it("reports openrouter error when the key credit limit is exhausted", async () => {
    mockedFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: [{ id: "1" }], error: null }),
      }),
    });
    // Key reachable and valid, but its per-key credit limit is spent
    // (limit_remaining 0) — the state that makes real LLM calls 403.
    mockedGet.mockResolvedValue({
      data: { data: { limit: 500, limit_remaining: 0 } },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.openrouter).toBe("error");
  });

  it("reports openrouter error when the API key is not configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    mockedFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: [{ id: "1" }], error: null }),
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.openrouter).toBe("error");
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("handles supabase throwing an exception", async () => {
    mockedFrom.mockImplementation(() => {
      throw new Error("unexpected error");
    });
    mockedGet.mockResolvedValue({ data: {} });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.supabase).toBe("error");
    expect(body.checks.openrouter).toBe("ok");
  });
});

// Audit 2026-10-06: rollout readback — operators confirm the live auth / CSP
// posture from /api/health after each deploy.
describe("GET /api/health — security readback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const healthy = () => {
    mockedFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: [{ id: "1" }], error: null }),
      }),
    });
    mockedGet.mockResolvedValue({
      data: { data: { limit: null, limit_remaining: null } },
    });
  };

  it("reports Stage 1 (secret missing, not enforced) without leaking anything", async () => {
    healthy();
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "");
    const body = await (await GET()).json();
    expect(body.security.participantToken).toEqual({
      secretConfigured: false,
      enforced: false,
      legacyOptOut: false,
      legacyOptOutUntil: "2026-11-06",
    });
    expect(body.security.cspMode).toBe("enforce");
  });

  it("reports the migration window (secret + opt-out) and the enforced end state", async () => {
    healthy();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "s");
    vi.stubEnv("PARTICIPANT_TOKEN_ENFORCE", "false");
    vi.stubEnv("CSP_MODE", "report-only");
    let body = await (await GET()).json();
    expect(body.security.participantToken).toMatchObject({
      secretConfigured: true,
      enforced: false,
      legacyOptOut: true,
    });
    expect(body.security.cspMode).toBe("report-only");
    expect(JSON.stringify(body)).not.toContain('"s"');

    vi.stubEnv("PARTICIPANT_TOKEN_ENFORCE", "");
    body = await (await GET()).json();
    expect(body.security.participantToken).toMatchObject({
      secretConfigured: true,
      enforced: true,
      legacyOptOut: false,
    });
  });
});
