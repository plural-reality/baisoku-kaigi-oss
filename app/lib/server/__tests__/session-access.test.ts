import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import {
  requireSessionAdminToken,
  requireSessionHost,
  SessionAccessError,
} from "../session-access";

function chainResult(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SessionAccessError", () => {
  it("stores status code", () => {
    const err = new SessionAccessError("Not found", 404);
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not found");
    expect(err).toBeInstanceOf(Error);
  });

  it("is throwable and catchable", () => {
    expect(() => {
      throw new SessionAccessError("Forbidden", 403);
    }).toThrow(SessionAccessError);
  });
});

describe("requireSessionHost", () => {
  const sessionRow = {
    id: "sess-1",
    title: "Test Session",
    context: "ctx",
    goal: "goal",
    facilitator_context: "private ctx",
    facilitator_goal: "private goal",
    is_public: false,
    host_user_id: "host-user",
  };

  it("returns session when user is host", async () => {
    mockFrom.mockReturnValue(chainResult({ data: sessionRow, error: null }));

    const result = await requireSessionHost("sess-1", "host-user");
    expect(result).toEqual(sessionRow);
  });

  it("throws 404 when session not found (PGRST116)", async () => {
    mockFrom.mockReturnValue(
      chainResult({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      }),
    );

    await expect(
      requireSessionHost("missing-id", "user"),
    ).rejects.toMatchObject({
      message: "Session not found",
      status: 404,
    });
  });

  it("throws 500 on generic database error", async () => {
    mockFrom.mockReturnValue(
      chainResult({
        data: null,
        error: { message: "connection refused" },
      }),
    );

    await expect(requireSessionHost("sess-1", "user")).rejects.toMatchObject({
      status: 500,
    });
  });

  it("throws 404 when the session id is not a UUID (22P02)", async () => {
    mockFrom.mockReturnValue(
      chainResult({
        data: null,
        error: {
          code: "22P02",
          message: 'invalid input syntax for type uuid: "not-a-uuid"',
        },
      }),
    );

    await expect(
      requireSessionHost("not-a-uuid", "user"),
    ).rejects.toMatchObject({
      message: "Session not found",
      status: 404,
    });
  });

  it("throws 403 when user is not the host", async () => {
    mockFrom.mockReturnValue(chainResult({ data: sessionRow, error: null }));

    await expect(
      requireSessionHost("sess-1", "other-user"),
    ).rejects.toMatchObject({
      message: "Forbidden",
      status: 403,
    });
  });
});

describe("requireSessionAdminToken", () => {
  const adminRow = {
    id: "sess-1",
    title: "Test Session",
    context: "ctx",
    goal: "goal",
    facilitator_context: "private ctx",
    facilitator_goal: "private goal",
    is_public: false,
    host_user_id: "host-user",
    admin_access_token: "correct-token",
  };

  it("returns session when token matches", async () => {
    mockFrom.mockReturnValue(chainResult({ data: adminRow, error: null }));

    const result = await requireSessionAdminToken("sess-1", "correct-token");
    expect(result).toEqual(adminRow);
  });

  it("throws 403 when token does not match", async () => {
    mockFrom.mockReturnValue(chainResult({ data: adminRow, error: null }));

    await expect(
      requireSessionAdminToken("sess-1", "wrong-token"),
    ).rejects.toMatchObject({
      message: "Forbidden",
      status: 403,
    });
  });

  it("throws 404 when session does not exist", async () => {
    mockFrom.mockReturnValue(
      chainResult({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      }),
    );

    await expect(
      requireSessionAdminToken("missing", "token"),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});
