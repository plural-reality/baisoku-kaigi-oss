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
}));

vi.mock("@/lib/server/session-access", async () => {
  const { SessionAccessError } = await vi.importActual<
    typeof import("@/lib/server/session-access")
  >("@/lib/server/session-access");
  return {
    requireSessionHost: vi.fn(),
    SessionAccessError,
  };
});

vi.mock("@/lib/server/event-threads", () => ({
  ensureEventThreadForSession: vi.fn(),
}));

vi.mock("../../agents/llm", () => ({
  generateSurveyStatements: vi.fn(),
}));

// --- Imports (after mocks) ---

import { getUserIdFromRequest } from "@/lib/auth";
import { ensureEventThreadForSession } from "@/lib/server/event-threads";
import {
  requireSessionHost,
  SessionAccessError,
} from "@/lib/server/session-access";
import { supabase } from "@/lib/supabase";
import { generateSurveyStatements } from "../../agents/llm";
import { POST } from "../../app/api/sessions/[sessionId]/statements/generate/route";

const mockedGetUserId = getUserIdFromRequest as ReturnType<typeof vi.fn>;
const mockedFrom = supabase.from as ReturnType<typeof vi.fn>;
const mockedRequireSessionHost = requireSessionHost as ReturnType<typeof vi.fn>;
const mockedEnsureThread = ensureEventThreadForSession as ReturnType<
  typeof vi.fn
>;
const mockedGenerateStatements = generateSurveyStatements as ReturnType<
  typeof vi.fn
>;

// --- Helpers ---

const USER_ID = "user-sg-1";
const SESSION_ID = "session-sg-1";
const THREAD_ID = "thread-sg-1";

const makeParams = (sessionId = SESSION_ID) => ({
  params: Promise.resolve({ sessionId }),
});

const mockSupabaseSequence = (tables: Record<string, unknown[]>) => {
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
};

const SESSION_HOST_ROW = {
  id: SESSION_ID,
  title: "Test Session",
  context: "Some context",
  goal: "Consensus",
  is_public: false,
  host_user_id: USER_ID,
};

const THREAD_ROW = {
  id: THREAD_ID,
  session_id: SESSION_ID,
  should_proceed: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// --- Tests ---

describe("POST /api/sessions/[sessionId]/statements/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest({ method: "POST" });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 404 when session is not found", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedRequireSessionHost.mockRejectedValue(
      new SessionAccessError("Session not found", 404),
    );

    const req = createAuthedRequest(USER_ID, { method: "POST" });
    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Session not found");
  });

  it("returns 403 when user is not the host", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedRequireSessionHost.mockRejectedValue(
      new SessionAccessError("Forbidden", 403),
    );

    const req = createAuthedRequest(USER_ID, { method: "POST" });
    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");
  });

  it("generates statements successfully", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedRequireSessionHost.mockResolvedValue(SESSION_HOST_ROW);
    mockedEnsureThread.mockResolvedValue(THREAD_ROW);
    mockedGenerateStatements.mockResolvedValue([
      "Statement A",
      "Statement B",
      "Statement C",
    ]);

    const eventsData = [
      {
        id: "e1",
        type: "user_message",
        agent_id: null,
        user_id: USER_ID,
        progress: 1,
        payload: {},
        order_index: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    const insertedStatements = [
      { id: "stmt-1", text: "Statement A", order_index: 1 },
      { id: "stmt-2", text: "Statement B", order_index: 2 },
      { id: "stmt-3", text: "Statement C", order_index: 3 },
    ];

    mockSupabaseSequence({
      // 1st events call: fetch events for context
      events: [mockSuccess(eventsData)],
      // 1st participants call: count (head: true)
      participants: [mockSuccess(null)],
      // 1st statements call: existing statements
      // 2nd statements call: get last order index (maybeSingle)
      // 3rd statements call: insert generated statements
      statements: [
        mockSuccess([]),
        mockSuccess(null),
        mockSuccess(insertedStatements),
      ],
    });

    const req = createAuthedRequest(USER_ID, { method: "POST" });
    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.statements).toHaveLength(3);
    expect(body.statements[0].id).toBe("stmt-1");
    expect(body.statements[0].text).toBe("Statement A");
    expect(body.statements[0].orderIndex).toBe(1);
    expect(mockedGenerateStatements).toHaveBeenCalledOnce();
    expect(mockedGenerateStatements).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionTitle: "Test Session",
        sessionGoal: "Consensus",
        initialContext: "Some context",
      }),
    );
  });

  it("returns 500 when events fetch fails", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedRequireSessionHost.mockResolvedValue(SESSION_HOST_ROW);
    mockedEnsureThread.mockResolvedValue(THREAD_ROW);

    mockSupabaseSequence({
      events: [mockError("events db error")],
    });

    const req = createAuthedRequest(USER_ID, { method: "POST" });
    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to load event thread");
  });

  it("returns 500 when LLM returns empty statements", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedRequireSessionHost.mockResolvedValue(SESSION_HOST_ROW);
    mockedEnsureThread.mockResolvedValue(THREAD_ROW);
    mockedGenerateStatements.mockResolvedValue([]);

    mockSupabaseSequence({
      events: [mockSuccess([])],
      participants: [mockSuccess(null)],
      statements: [mockSuccess([]), mockSuccess(null)],
    });

    const req = createAuthedRequest(USER_ID, { method: "POST" });
    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("No statements generated");
  });

  it("returns 500 when statement insert fails", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedRequireSessionHost.mockResolvedValue(SESSION_HOST_ROW);
    mockedEnsureThread.mockResolvedValue(THREAD_ROW);
    mockedGenerateStatements.mockResolvedValue(["New statement"]);

    mockSupabaseSequence({
      events: [mockSuccess([])],
      participants: [mockSuccess(null)],
      // 1st: existing statements, 2nd: last order index, 3rd: insert fails
      statements: [
        mockSuccess([]),
        mockSuccess(null),
        mockError("insert error"),
      ],
    });

    const req = createAuthedRequest(USER_ID, { method: "POST" });
    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to save generated statements");
  });

  it("appends statements after existing ones using correct base index", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedRequireSessionHost.mockResolvedValue(SESSION_HOST_ROW);
    mockedEnsureThread.mockResolvedValue(THREAD_ROW);
    mockedGenerateStatements.mockResolvedValue(["New Q"]);

    const insertedStatements = [
      { id: "stmt-new", text: "New Q", order_index: 6 },
    ];

    mockSupabaseSequence({
      events: [mockSuccess([])],
      participants: [mockSuccess(null)],
      // 1st: existing statements
      // 2nd: last statement with order_index=5
      // 3rd: insert
      statements: [
        mockSuccess([{ text: "Existing Q" }]),
        mockSuccess({ order_index: 5 }),
        mockSuccess(insertedStatements),
      ],
    });

    const req = createAuthedRequest(USER_ID, { method: "POST" });
    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.statements).toHaveLength(1);
    expect(body.statements[0].orderIndex).toBe(6);
  });
});
