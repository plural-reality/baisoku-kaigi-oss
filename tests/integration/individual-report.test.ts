import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthedRequest,
  createMockRequest,
} from "@/lib/__tests__/helpers/mock-request";
import {
  createMockSupabase,
  mockError,
  mockNotFound,
  mockSuccess,
} from "@/lib/__tests__/helpers/mock-supabase";

// --- Mocks (module-level) ---

vi.mock("@/lib/supabase", () => ({
  supabase: createMockSupabase(),
}));

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  buildSessionBrief: vi.fn().mockReturnValue("session brief"),
  generateIndividualReport: vi.fn().mockResolvedValue({
    reportMarkdown: "# Report\nContent here",
    deepDiveQuestions: [],
    llm: {
      model: "test-model",
      promptVersion: "test.1",
      generationId: "gen-test",
    },
  }),
}));

// --- Imports (after mocks) ---

import { getUserIdFromRequest } from "@/lib/auth";
import { generateIndividualReport } from "@/lib/llm";
import { supabase } from "@/lib/supabase";
import {
  GET,
  POST,
} from "../../app/api/sessions/[sessionId]/individual-report/route";

const mockedGetUserId = getUserIdFromRequest as ReturnType<typeof vi.fn>;
const mockedFrom = supabase.from as ReturnType<typeof vi.fn>;
const mockedGenerateReport = generateIndividualReport as ReturnType<
  typeof vi.fn
>;

// --- Helpers ---

const USER_ID = "user-ir-1";
const SESSION_ID = "session-ir-1";

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

// --- Tests: GET ---

describe("GET /api/sessions/[sessionId]/individual-report", () => {
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

  it("returns 403 when user is not a participant (PGRST116)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockNotFound()],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("not a participant");
  });

  it("returns null report when participant has no latest_individual_report_id", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [
        mockSuccess({
          user_id: USER_ID,
          session_id: SESSION_ID,
          name: "Alice",
          latest_individual_report_id: null,
        }),
      ],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.report).toBeNull();
  });

  it("returns the report when it exists", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const reportData = {
      id: "report-1",
      participant_user_id: USER_ID,
      session_id: SESSION_ID,
      content_markdown: "# My Report\nSome content",
      created_at: "2026-01-01T00:00:00Z",
    };

    mockSupabaseSequence({
      participants: [
        mockSuccess({
          user_id: USER_ID,
          session_id: SESSION_ID,
          name: "Alice",
          latest_individual_report_id: "report-1",
        }),
      ],
      individual_reports: [mockSuccess(reportData)],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.report).toBeDefined();
    expect(body.report.id).toBe("report-1");
    expect(body.report.participantUserId).toBe(USER_ID);
    expect(body.report.sessionId).toBe(SESSION_ID);
    expect(body.report.contentMarkdown).toBe("# My Report\nSome content");
    expect(body.report.createdAt).toBe("2026-01-01T00:00:00Z");
  });

  it("returns null when individual_reports row not found (PGRST116)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [
        mockSuccess({
          user_id: USER_ID,
          session_id: SESSION_ID,
          name: "Alice",
          latest_individual_report_id: "report-missing",
        }),
      ],
      individual_reports: [mockNotFound()],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.report).toBeNull();
  });

  it("returns 500 when participant query fails (non-PGRST116)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockError("db connection error")],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to fetch individual report");
  });

  it("returns 500 when individual_reports query fails (non-PGRST116)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [
        mockSuccess({
          user_id: USER_ID,
          session_id: SESSION_ID,
          name: "Alice",
          latest_individual_report_id: "report-1",
        }),
      ],
      individual_reports: [mockError("db error")],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to fetch individual report");
  });
});

// --- Tests: POST ---

describe("POST /api/sessions/[sessionId]/individual-report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest({ method: "POST", body: {} });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 403 when user is not a participant (PGRST116)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockNotFound()],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {},
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("not a participant");
  });

  it("returns 400 when user has no responses", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [
        mockSuccess({
          user_id: USER_ID,
          session_id: SESSION_ID,
          name: "Alice",
        }),
      ],
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          title: "Test Session",
          context: "Test context",
          goal: "Test goal",
        }),
      ],
      responses: [mockSuccess([])],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {},
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("No responses found");
  });

  it("generates and saves individual report successfully", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedGenerateReport.mockResolvedValue({
      reportMarkdown: "# Generated Report\nContent",
      deepDiveQuestions: [],
      llm: {
        model: "google/gemini-3.1-pro-preview",
        promptVersion: "2026-11-07.1",
        generationId: "gen-ir",
      },
    });

    const insertedReport = {
      id: "report-new",
      participant_user_id: USER_ID,
      session_id: SESSION_ID,
      content_markdown: "# Generated Report\nContent",
      created_at: "2026-01-01T00:00:00Z",
    };

    mockSupabaseSequence({
      // 1st participants call: verify participant (single)
      // 2nd participants call: update latest_individual_report_id (update)
      participants: [
        mockSuccess({
          user_id: USER_ID,
          session_id: SESSION_ID,
          name: "Alice",
        }),
        mockSuccess(null),
      ],
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          title: "Test Session",
          context: "Test context",
          goal: "Test goal",
        }),
      ],
      responses: [
        mockSuccess([
          {
            statement_id: "st-1",
            value: 2,
            response_type: "scale",
            text_response: null,
          },
        ]),
      ],
      statements: [mockSuccess([{ id: "st-1", text: "Statement 1" }])],
      individual_reports: [mockSuccess(insertedReport)],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { taste: "formal" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.report).toBeDefined();
    expect(body.report.id).toBe("report-new");
    expect(body.report.contentMarkdown).toBe("# Generated Report\nContent");
    expect(mockedGenerateReport).toHaveBeenCalledOnce();
    // The row records which model / prompt version / generation produced it.
    const reportsIndex = mockedFrom.mock.calls.findIndex(
      ([table]) => table === "individual_reports",
    );
    const reportsBuilder = mockedFrom.mock.results[reportsIndex]?.value as {
      insert: ReturnType<typeof vi.fn>;
    };
    expect(reportsBuilder.insert.mock.calls[0][0]).toMatchObject({
      model: "google/gemini-3.1-pro-preview",
      prompt_version: "2026-11-07.1",
      generation_id: "gen-ir",
    });
  });

  it("returns 404 when session is not found (PGRST116)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [
        mockSuccess({
          user_id: USER_ID,
          session_id: SESSION_ID,
          name: "Alice",
        }),
      ],
      sessions: [mockNotFound()],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {},
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Session not found");
  });

  it("returns 500 when report insert fails", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedGenerateReport.mockResolvedValue({
      reportMarkdown: "# Report",
      deepDiveQuestions: [],
    });

    mockSupabaseSequence({
      participants: [
        mockSuccess({
          user_id: USER_ID,
          session_id: SESSION_ID,
          name: "Alice",
        }),
      ],
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          title: "Test",
          context: "",
          goal: "goal",
        }),
      ],
      responses: [
        mockSuccess([
          {
            statement_id: "st-1",
            value: 1,
            response_type: "scale",
            text_response: null,
          },
        ]),
      ],
      statements: [mockSuccess([{ id: "st-1", text: "Q1" }])],
      individual_reports: [mockError("insert failed")],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {},
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to generate individual report");
  });
});
