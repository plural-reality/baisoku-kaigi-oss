import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthedRequest,
  createMockRequest,
} from "@/lib/__tests__/helpers/mock-request";
import {
  createMockSupabase,
  mockError,
  mockNotFound,
  mockSelectAllRange,
  mockSuccess,
} from "@/lib/__tests__/helpers/mock-supabase";

// --- Mocks ---

vi.mock("@/lib/supabase", () => ({
  supabase: createMockSupabase(),
  selectAllRange: mockSelectAllRange,
}));

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/server/session-access", () => ({
  safeCompare: (a: string, b: string) => a === b,
}));

// --- Imports ---

import { getUserIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { DELETE, GET, PATCH } from "../route";

const mockedGetUserId = getUserIdFromRequest as ReturnType<typeof vi.fn>;
const mockedFrom = supabase.from as ReturnType<typeof vi.fn>;

// --- Helpers ---

const USER_ID = "user-admin-1";
const SESSION_ID = "session-admin-1";
const ACCESS_TOKEN = "valid-token-abc";

function makeParams(sessionId = SESSION_ID, accessToken = ACCESS_TOKEN) {
  return { params: Promise.resolve({ sessionId, accessToken }) };
}

function mockSupabaseSequence(tables: Record<string, unknown[]>) {
  const counters: Record<string, number> = {};
  mockedFrom.mockImplementation((table: string) => {
    const seq = tables[table];
    if (!seq) return createMockSupabase().from(table);
    const idx = counters[table] ?? 0;
    counters[table] = idx + 1;
    const result = idx < seq.length ? seq[idx] : seq[seq.length - 1];
    return createMockSupabase({
      tables: {
        [table]: result as {
          data: unknown;
          error: { code?: string; message: string } | null;
        },
      },
    }).from(table);
  });
}

// --- Tests ---

describe("GET /api/sessions/[sessionId]/[accessToken]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest();

    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 403 when access token is invalid", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          title: "Test",
          context: "",
          goal: "Goal",
          is_public: false,
          created_at: "2026-01-01T00:00:00Z",
          host_user_id: USER_ID,
          admin_access_token: ACCESS_TOKEN,
        }),
      ],
    });

    const req = createAuthedRequest(USER_ID);
    // Pass wrong access token
    const res = await GET(req, makeParams(SESSION_ID, "wrong-token"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");
  });

  it("returns 404 when session does not exist", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      sessions: [mockNotFound()],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams("nonexistent"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Session not found");
  });

  it("returns admin data with stats on success", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const sessionData = {
      id: SESSION_ID,
      title: "Admin Session",
      context: "Some context",
      goal: "Find consensus",
      facilitator_context: "Private context",
      facilitator_goal: "Private goal",
      is_public: false,
      created_at: "2026-01-01T00:00:00Z",
      host_user_id: USER_ID,
      admin_access_token: ACCESS_TOKEN,
    };

    const statementsData = [
      { id: "st1", session_id: SESSION_ID, text: "Q1", order_index: 0 },
      { id: "st2", session_id: SESSION_ID, text: "Q2", order_index: 1 },
    ];

    const responsesData = [
      {
        statement_id: "st1",
        value: 2,
        participant_user_id: "p1",
        response_type: "scale",
        text_response: null,
      },
      {
        statement_id: "st1",
        value: -1,
        participant_user_id: "p2",
        response_type: "scale",
        text_response: null,
      },
    ];

    const participantsData = [
      { user_id: "p1", name: "Alice", updated_at: "2026-01-01T00:00:00Z" },
      { user_id: "p2", name: "Bob", updated_at: "2026-01-01T00:00:00Z" },
    ];

    mockSupabaseSequence({
      sessions: [mockSuccess(sessionData)],
      statements: [mockSuccess(statementsData)],
      responses: [mockSuccess(responsesData)],
      participants: [mockSuccess(participantsData)],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(SESSION_ID);
    expect(body.data.title).toBe("Admin Session");
    expect(body.data.facilitatorContext).toBe("Private context");
    expect(body.data.facilitatorGoal).toBe("Private goal");
    expect(body.data.totalStatements).toBe(2);
    expect(body.data.totalParticipants).toBe(2);
    expect(body.data.canEdit).toBe(true);

    // Check statement stats
    expect(body.data.statements).toHaveLength(2);
    expect(body.data.statements[0].responses.totalCount).toBe(2);

    // Check participant progress
    expect(body.data.participants).toHaveLength(2);
    expect(body.data.participants[0].name).toBe("Alice");
    expect(body.data.participants[0].answeredCount).toBe(1);

    // Audit H2: participant UUIDs are replaced by per-session aliases, and the
    // same alias is used wherever that participant appears in the response.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('"p1"');
    expect(serialized).not.toContain('"p2"');
    expect(serialized).not.toContain(USER_ID);
    expect(body.data.participants[0].userId).toMatch(/^u_/);
    expect(body.data.participants[1].userId).toMatch(/^u_/);
    expect(body.data.participants[0].userId).not.toBe(
      body.data.participants[1].userId,
    );
  });

  it("aliases free-text sample authors consistently with the participant list (audit H2)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockSupabaseSequence({
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          title: "Admin Session",
          context: "",
          goal: "Goal",
          facilitator_context: null,
          facilitator_goal: null,
          is_public: false,
          created_at: "2026-01-01T00:00:00Z",
          host_user_id: USER_ID,
          admin_access_token: ACCESS_TOKEN,
        }),
      ],
      statements: [
        mockSuccess([
          { id: "st1", session_id: SESSION_ID, text: "Q1", order_index: 0 },
        ]),
      ],
      responses: [
        mockSuccess([
          {
            statement_id: "st1",
            value: null,
            participant_user_id: "p1",
            response_type: "free_text",
            text_response: "自由記述",
          },
        ]),
      ],
      participants: [
        mockSuccess([
          { user_id: "p1", name: "Alice", updated_at: "2026-01-01T00:00:00Z" },
        ]),
      ],
    });

    const res = await GET(createAuthedRequest(USER_ID), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    const sample = body.data.statements[0].responses.freeTextSamples[0];
    expect(sample.participantUserId).toMatch(/^u_/);
    expect(sample.participantUserId).toBe(body.data.participants[0].userId);
  });

  it("normalizes legacy public-only fields into 本題 for admin display", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const sessionData = {
      id: SESSION_ID,
      title: "Admin Session",
      context: "Public context",
      goal: "Public goal",
      facilitator_context: null,
      facilitator_goal: null,
      is_public: false,
      created_at: "2026-01-01T00:00:00Z",
      host_user_id: USER_ID,
      admin_access_token: ACCESS_TOKEN,
    };

    mockSupabaseSequence({
      sessions: [mockSuccess(sessionData)],
      statements: [mockSuccess([])],
      responses: [mockSuccess([])],
      participants: [mockSuccess([])],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.goal).toBe("");
    expect(body.data.context).toBe("");
    expect(body.data.facilitatorGoal).toBe("Public goal");
    expect(body.data.facilitatorContext).toBe("Public context");
  });
});

describe("PATCH /api/sessions/[sessionId]/[accessToken]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest({
      method: "PATCH",
      body: { title: "T", context: "", goal: "G" },
    });

    const res = await PATCH(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 403 when access token is invalid", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          admin_access_token: ACCESS_TOKEN,
        }),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "PATCH",
      body: { title: "T", context: "", goal: "G" },
    });

    const res = await PATCH(req, makeParams(SESSION_ID, "wrong-token"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");
  });

  it("returns 400 when title is invalid", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          admin_access_token: ACCESS_TOKEN,
        }),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "PATCH",
      body: { title: "", context: "", goal: "Goal" },
    });

    const res = await PATCH(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("title");
  });

  it("returns 400 when goal is not a string", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          admin_access_token: ACCESS_TOKEN,
        }),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "PATCH",
      body: { title: "Title", context: "", goal: 123 },
    });

    const res = await PATCH(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("goal");
  });

  it("allows empty public goal (optional — settable later)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const updatedSession = {
      id: SESSION_ID,
      title: "Title",
      context: "",
      goal: "",
      facilitator_context: "本題の背景",
      facilitator_goal: "本題の目的",
      is_public: false,
      created_at: "2026-01-01T00:00:00Z",
    };

    mockSupabaseSequence({
      sessions: [
        mockSuccess({ id: SESSION_ID, admin_access_token: ACCESS_TOKEN }),
        mockSuccess(updatedSession),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "PATCH",
      body: {
        title: "Title",
        context: "",
        goal: "",
        facilitatorGoal: "本題の目的",
        facilitatorContext: "本題の背景",
      },
    });

    const res = await PATCH(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    // public goal は空のまま保存できる（後から設定できる）
    expect(body.data.goal).toBe("");
    expect(body.data.facilitatorGoal).toBe("本題の目的");
  });

  it("preserves omitted fields (title-only PATCH does not touch goal/context/facilitator)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const updatedSession = {
      id: SESSION_ID,
      title: "新タイトル",
      context: "既存の公開背景",
      goal: "既存の公開目的",
      facilitator_context: "既存の本題背景",
      facilitator_goal: "既存の本題目的",
      is_public: false,
      created_at: "2026-01-01T00:00:00Z",
    };

    mockSupabaseSequence({
      sessions: [
        mockSuccess({ id: SESSION_ID, admin_access_token: ACCESS_TOKEN }),
        mockSuccess(updatedSession),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "PATCH",
      body: { title: "新タイトル" }, // goal/context/facilitator は未指定
    });

    const res = await PATCH(req, makeParams());
    const sessionQueries = mockedFrom.mock.results
      .map((result, index) => ({
        table: mockedFrom.mock.calls[index]?.[0],
        query: result.value as { update: ReturnType<typeof vi.fn> },
      }))
      .filter(({ table }) => table === "sessions");

    expect(res.status).toBe(200);
    // 未指定フィールドは update 対象に含まれない（既存値を温存）
    expect(sessionQueries[1]?.query.update).toHaveBeenCalledWith({
      title: "新タイトル",
      is_public: false,
    });
  });

  it("updates session successfully", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const updatedSession = {
      id: SESSION_ID,
      title: "Updated Title",
      context: "Updated context",
      goal: "Updated goal",
      facilitator_context: "Updated private context",
      facilitator_goal: "Updated private goal",
      is_public: false,
      created_at: "2026-01-01T00:00:00Z",
    };

    mockSupabaseSequence({
      // First: fetch for token check, second: update
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          admin_access_token: ACCESS_TOKEN,
        }),
        mockSuccess(updatedSession),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "PATCH",
      body: {
        title: "Updated Title",
        context: "Updated context",
        goal: "Updated goal",
        facilitatorContext: "Updated private context",
        facilitatorGoal: "Updated private goal",
      },
    });

    const res = await PATCH(req, makeParams());
    const body = await res.json();
    const sessionQueries = mockedFrom.mock.results
      .map((result, index) => ({
        table: mockedFrom.mock.calls[index]?.[0],
        query: result.value as { update: ReturnType<typeof vi.fn> },
      }))
      .filter(({ table }) => table === "sessions");

    expect(res.status).toBe(200);
    expect(body.data.title).toBe("Updated Title");
    expect(body.data.context).toBe("Updated context");
    expect(body.data.goal).toBe("Updated goal");
    expect(body.data.facilitatorContext).toBe("Updated private context");
    expect(body.data.facilitatorGoal).toBe("Updated private goal");
    expect(body.data.isPublic).toBe(false);
    expect(sessionQueries[1]?.query.update).toHaveBeenCalledWith({
      title: "Updated Title",
      context: "Updated context",
      goal: "Updated goal",
      facilitator_context: "Updated private context",
      facilitator_goal: "Updated private goal",
      is_public: false,
    });
  });

  it("stores empty facilitator fields as null and returns legacy shape as 本題", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const updatedSession = {
      id: SESSION_ID,
      title: "T",
      context: "Public ctx",
      goal: "Public goal",
      facilitator_context: null,
      facilitator_goal: null,
      is_public: false,
      created_at: "2026-01-01T00:00:00Z",
    };

    mockSupabaseSequence({
      sessions: [
        mockSuccess({ id: SESSION_ID, admin_access_token: ACCESS_TOKEN }),
        mockSuccess(updatedSession),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "PATCH",
      body: {
        title: "T",
        context: "Public ctx",
        goal: "Public goal",
        facilitatorContext: "",
        facilitatorGoal: "",
      },
    });

    const res = await PATCH(req, makeParams());
    const body = await res.json();
    const sessionQueries = mockedFrom.mock.results
      .map((result, index) => ({
        table: mockedFrom.mock.calls[index]?.[0],
        query: result.value as { update: ReturnType<typeof vi.fn> },
      }))
      .filter(({ table }) => table === "sessions");

    expect(res.status).toBe(200);
    // The write path stores exactly what was submitted; the read model prevents
    // legacy-shaped rows from showing the old 本題 under participant-only fields.
    expect(sessionQueries[1]?.query.update).toHaveBeenCalledWith({
      title: "T",
      context: "Public ctx",
      goal: "Public goal",
      facilitator_context: null,
      facilitator_goal: null,
      is_public: false,
    });
    expect(body.data.goal).toBe("");
    expect(body.data.context).toBe("");
    expect(body.data.facilitatorGoal).toBe("Public goal");
    expect(body.data.facilitatorContext).toBe("Public ctx");
  });
});

describe("DELETE /api/sessions/[sessionId]/[accessToken]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest({ method: "DELETE" });

    const res = await DELETE(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 403 when access token is invalid", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          admin_access_token: ACCESS_TOKEN,
        }),
      ],
    });

    const req = createAuthedRequest(USER_ID, { method: "DELETE" });
    const res = await DELETE(req, makeParams(SESSION_ID, "wrong-token"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");
  });

  it("returns 404 when session does not exist", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      sessions: [mockNotFound()],
    });

    const req = createAuthedRequest(USER_ID, { method: "DELETE" });
    const res = await DELETE(req, makeParams("nonexistent"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Session not found");
  });

  it("deletes session successfully", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      // First: fetch for token check, second: delete
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          admin_access_token: ACCESS_TOKEN,
        }),
        mockSuccess(null), // delete returns { error: null }
      ],
    });

    const req = createAuthedRequest(USER_ID, { method: "DELETE" });
    const res = await DELETE(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain("deleted");
  });

  it("returns 500 when delete operation fails", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          admin_access_token: ACCESS_TOKEN,
        }),
        mockError("FK constraint"),
      ],
    });

    const req = createAuthedRequest(USER_ID, { method: "DELETE" });
    const res = await DELETE(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to delete session");
  });
});
