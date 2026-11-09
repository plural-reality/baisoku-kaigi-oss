import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthedRequest,
  createMockRequest,
} from "@/lib/__tests__/helpers/mock-request";
import {
  createMockSupabase,
  mockError,
  mockSuccess,
} from "@/lib/__tests__/helpers/mock-supabase";

// --- Mocks (module-level) ---

vi.mock("@/lib/supabase", () => ({
  supabase: createMockSupabase(),
}));

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: vi.fn(),
  getHostUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  createSession: vi.fn(),
}));

vi.mock("@agents/llm", () => ({
  generateSurveyStatements: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span: unknown) => unknown) =>
    fn({
      setAttribute: vi.fn(),
    }),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  logger: { info: vi.fn() },
}));

// --- Imports (after mocks) ---

import { generateSurveyStatements } from "@agents/llm";
import { createSession } from "@/lib/api/client";
import { getHostUserIdFromRequest, getUserIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { GET, POST } from "../route";

const mockedGetUserId = getUserIdFromRequest as ReturnType<typeof vi.fn>;
const mockedGetHostUserId = getHostUserIdFromRequest as ReturnType<
  typeof vi.fn
>;
const mockedFrom = supabase.from as ReturnType<typeof vi.fn>;
const mockedCreateSession = createSession as ReturnType<typeof vi.fn>;
const mockedGenerateStatements = generateSurveyStatements as ReturnType<
  typeof vi.fn
>;

// --- Helpers ---

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

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

describe("GET /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest();

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns sessions with roles for authenticated user", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const participantsResult = mockSuccess([
      { session_id: "s1" },
      { session_id: "s2" },
    ]);
    const sessionsResult = mockSuccess([
      {
        id: "s1",
        title: "Session 1",
        context: "ctx",
        goal: "goal",
        is_public: false,
        host_user_id: USER_ID,
        admin_access_token: "tok-1",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        participants: [{ user_id: USER_ID }],
        statements: [{ id: "st1" }, { id: "st2" }],
      },
      {
        id: "s2",
        title: "Session 2",
        context: "",
        goal: "goal2",
        is_public: true,
        host_user_id: "other-user",
        admin_access_token: "tok-2",
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        participants: [{ user_id: USER_ID }],
        statements: [],
      },
    ]);

    mockSupabaseSequence({
      participants: [participantsResult],
      sessions: [sessionsResult],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessions).toHaveLength(2);

    // First session: user is host
    expect(body.sessions[0].isHost).toBe(true);
    expect(body.sessions[0].isParticipant).toBe(true);
    expect(body.sessions[0].adminAccessToken).toBe("tok-1");
    expect(body.sessions[0]._count.statements).toBe(2);
    // Host sees their own host_user_id...
    expect(body.sessions[0].hostUserId).toBe(USER_ID);

    // Second session: user is participant but not host
    expect(body.sessions[1].isHost).toBe(false);
    expect(body.sessions[1].isParticipant).toBe(true);
    expect(body.sessions[1].adminAccessToken).toBeUndefined();
    // ...but a non-host must NOT receive another user's host_user_id
    // (impersonation vector via the legacy Bearer-UUID identity path).
    expect(body.sessions[1].hostUserId).toBeUndefined();
  });

  it("returns participant-visible goal/context fallback on the session list", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockSuccess([])],
      sessions: [
        mockSuccess([
          {
            id: "s-canonical",
            title: "Canonical Session",
            context: "",
            goal: "",
            facilitator_context: "本題の背景",
            facilitator_goal: "本題の目的",
            is_public: false,
            host_user_id: USER_ID,
            admin_access_token: "tok-canonical",
            created_at: "2026-01-03T00:00:00Z",
            updated_at: "2026-01-03T00:00:00Z",
            participants: [],
            statements: [],
          },
        ]),
      ],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessions[0].goal).toBe("本題の目的");
    expect(body.sessions[0].context).toBe("本題の背景");
  });

  it("returns empty sessions list", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockSuccess([])],
      sessions: [mockSuccess([])],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessions).toEqual([]);
  });

  it("returns 500 when participants query fails", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockError("db down")],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to fetch sessions");
  });
});

describe("POST /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetHostUserId.mockResolvedValue(null);
    const req = createMockRequest({
      method: "POST",
      body: { title: "t", goal: "g", context: "" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 400 when title is missing", async () => {
    mockedGetHostUserId.mockResolvedValue(USER_ID);
    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { goal: "some goal", context: "" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("title");
  });

  it("returns 400 when goal is missing", async () => {
    mockedGetHostUserId.mockResolvedValue(USER_ID);
    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { title: "Session Title", context: "" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("goal");
  });

  it("returns 400 when context is not a string", async () => {
    mockedGetHostUserId.mockResolvedValue(USER_ID);
    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { title: "Title", goal: "Goal", context: 123 },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("context");
  });

  it("creates session successfully with LLM-generated statements", async () => {
    mockedGetHostUserId.mockResolvedValue(USER_ID);
    mockedGenerateStatements.mockResolvedValue(["Statement 1", "Statement 2"]);
    mockedCreateSession.mockResolvedValue({
      sessionId: "new-session-id",
      adminAccessToken: "admin-tok",
    });
    // Mock Supabase poll for session projection verification
    mockSupabaseSequence({
      sessions: [mockSuccess({ id: "new-session-id" })],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { title: "New Session", goal: "Find consensus", context: "ctx" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session.id).toBe("new-session-id");
    expect(body.session.adminAccessToken).toBe("admin-tok");
    expect(mockedGenerateStatements).toHaveBeenCalledOnce();
    expect(mockedCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Session",
        purpose: "Find consensus",
        background: "ctx",
        hostUserId: USER_ID,
        initialQuestions: ["Statement 1", "Statement 2"],
      }),
    );
  });

  it("keeps a distinct public override when facilitator(本題) and public differ", async () => {
    mockedGetHostUserId.mockResolvedValue(USER_ID);
    mockedGenerateStatements.mockResolvedValue(["Private-informed question"]);
    mockedCreateSession.mockResolvedValue({
      sessionId: "split-context-session",
      adminAccessToken: "split-token",
    });
    mockSupabaseSequence({
      sessions: [
        mockSuccess({ id: "split-context-session" }),
        mockSuccess({ id: "split-context-session" }),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {
        title: "Eureka Concept",
        goal: "公開する目的",
        context: "公開する背景",
        facilitatorGoal: "内部の目的",
        facilitatorContext: "内部の背景",
      },
    });

    const res = await POST(req);
    const body = await res.json();

    const sessionQueries = mockedFrom.mock.results
      .map((result, index) => ({
        table: mockedFrom.mock.calls[index]?.[0],
        query: result.value as { update: ReturnType<typeof vi.fn> },
      }))
      .filter(({ table }) => table === "sessions");

    expect(res.status).toBe(200);
    expect(body.session.id).toBe("split-context-session");
    // AI は canonical(本題) を使う
    expect(mockedGenerateStatements).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionGoal: "内部の目的",
        initialContext: "内部の背景",
      }),
    );
    // backend には公開用 purpose を渡す
    expect(mockedCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "公開する目的",
        background: "公開する背景",
      }),
    );
    // 本題=facilitator、公開は本題と異なるので残る（上書き）
    expect(sessionQueries[1]?.query.update).toHaveBeenCalledWith({
      facilitator_goal: "内部の目的",
      facilitator_context: "内部の背景",
      goal: "公開する目的",
      context: "公開する背景",
      language: "ja",
    });
  });

  it("moves the purpose into 本題(facilitator) and clears public (inherit) when not separately set", async () => {
    mockedGetHostUserId.mockResolvedValue(USER_ID);
    mockedGenerateStatements.mockResolvedValue(["Q from canonical goal"]);
    mockedCreateSession.mockResolvedValue({
      sessionId: "no-facilitator-session",
      adminAccessToken: "tok-nf",
    });
    mockSupabaseSequence({
      sessions: [
        mockSuccess({ id: "no-facilitator-session" }),
        mockSuccess({ id: "no-facilitator-session" }),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {
        title: "No Facilitator",
        goal: "本題の目的",
        context: "本題の背景",
        // facilitatorGoal / facilitatorContext omitted
      },
    });

    const res = await POST(req);
    const body = await res.json();

    const sessionQueries = mockedFrom.mock.results
      .map((result, index) => ({
        table: mockedFrom.mock.calls[index]?.[0],
        query: result.value as { update: ReturnType<typeof vi.fn> },
      }))
      .filter(({ table }) => table === "sessions");

    expect(res.status).toBe(200);
    expect(body.session.id).toBe("no-facilitator-session");
    // AI は canonical(本題=入力 purpose) を使う
    expect(mockedGenerateStatements).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionGoal: "本題の目的",
        initialContext: "本題の背景",
      }),
    );
    // 入力は本題(facilitator)へ。公開(goal/context)は空＝参加者は本題を継承（重複保存しない）。
    expect(sessionQueries[1]?.query.update).toHaveBeenCalledWith({
      facilitator_goal: "本題の目的",
      facilitator_context: "本題の背景",
      goal: "",
      context: "",
      language: "ja",
    });
  });

  it("stores an English session language and generates statements in English", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedGenerateStatements.mockResolvedValue(["Q in English"]);
    mockedCreateSession.mockResolvedValue({
      sessionId: "english-session",
      adminAccessToken: "tok-en",
    });
    mockSupabaseSequence({
      sessions: [
        mockSuccess({ id: "english-session" }),
        mockSuccess({ id: "english-session" }),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {
        title: "Customer forum",
        goal: "Understand customer priorities",
        context: "",
        language: "en",
      },
    });

    const res = await POST(req);
    const sessionQueries = mockedFrom.mock.results
      .map((result, index) => ({
        table: mockedFrom.mock.calls[index]?.[0],
        query: result.value as { update: ReturnType<typeof vi.fn> },
      }))
      .filter(({ table }) => table === "sessions");

    expect(res.status).toBe(200);
    expect(mockedGenerateStatements).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en" }),
    );
    expect(sessionQueries[1]?.query.update).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en" }),
    );
  });

  it("rejects an unsupported session language", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { title: "T", goal: "G", context: "", language: "fr" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockedCreateSession).not.toHaveBeenCalled();
  });

  it("creates session with user-provided initialQuestions", async () => {
    mockedGetHostUserId.mockResolvedValue(USER_ID);
    mockedCreateSession.mockResolvedValue({
      sessionId: "s-custom",
      adminAccessToken: "tok-custom",
    });
    mockSupabaseSequence({
      sessions: [mockSuccess({ id: "s-custom" })],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {
        title: "Custom",
        goal: "Test",
        context: "",
        initialQuestions: ["Q1", "Q2"],
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session.id).toBe("s-custom");
    // Should NOT call generateSurveyStatements when initialQuestions are provided
    expect(mockedGenerateStatements).not.toHaveBeenCalled();
    expect(mockedCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        initialQuestions: ["Q1", "Q2"],
      }),
    );
  });

  it("continues session creation even when LLM generation fails", async () => {
    mockedGetHostUserId.mockResolvedValue(USER_ID);
    mockedGenerateStatements.mockRejectedValue(new Error("LLM down"));
    mockedCreateSession.mockResolvedValue({
      sessionId: "s-fallback",
      adminAccessToken: "tok-fallback",
    });
    mockSupabaseSequence({
      sessions: [mockSuccess({ id: "s-fallback" })],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { title: "Fallback", goal: "Test", context: "" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session.id).toBe("s-fallback");
    // Backend call should have undefined for initialQuestions since generation failed
    expect(mockedCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        initialQuestions: undefined,
      }),
    );
  });

  it("keeps a Decidim source URL in canonical form", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedGenerateStatements.mockResolvedValue(["Q"]);
    mockedCreateSession.mockResolvedValue({
      sessionId: "decidim-session",
      adminAccessToken: "decidim-token",
    });
    mockSupabaseSequence({
      sessions: [
        mockSuccess({ id: "decidim-session" }),
        mockSuccess({ id: "decidim-session" }),
      ],
    });

    const res = await POST(
      createAuthedRequest(USER_ID, {
        method: "POST",
        body: {
          title: "T",
          goal: "G",
          context: "C",
          sourceUrl: "https://x.example/processes/env/?a=1",
        },
      }),
    );

    expect(res.status).toBe(200);
    const updates = mockedFrom.mock.results.flatMap(
      (result) =>
        (result.value as { update: ReturnType<typeof vi.fn> }).update.mock
          .calls,
    );
    expect(updates[0][0]).toMatchObject({
      source_url: "https://x.example/processes/env",
    });
  });

  it.each([
    ["a non-https URL", "http://x.example/processes/env"],
    ["a script URL", "javascript:alert(1)"],
    ["a non-string", 1],
  ])("rejects %s as a source URL", async (_, sourceUrl) => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const res = await POST(
      createAuthedRequest(USER_ID, {
        method: "POST",
        body: { title: "T", goal: "G", context: "C", sourceUrl },
      }),
    );

    expect(res.status).toBe(400);
    expect(mockedCreateSession).not.toHaveBeenCalled();
  });
});
