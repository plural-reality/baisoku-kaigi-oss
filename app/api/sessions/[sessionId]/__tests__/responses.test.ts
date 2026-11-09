import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthedRequest,
  createMockRequest,
} from "@/lib/__tests__/helpers/mock-request";
import {
  createMockSupabase,
  mockNotFound,
  mockSuccess,
} from "@/lib/__tests__/helpers/mock-supabase";

// --- Mocks ---

vi.mock("@/lib/supabase", () => ({
  supabase: createMockSupabase(),
}));

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: vi.fn(),
}));

// --- Imports ---

import { getUserIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { GET, POST } from "../responses/route";

const mockedGetUserId = getUserIdFromRequest as ReturnType<typeof vi.fn>;
const mockedFrom = supabase.from as ReturnType<typeof vi.fn>;

// --- Helpers ---

const USER_ID = "user-resp-1";
const SESSION_ID = "session-resp-1";

function makeParams(sessionId = SESSION_ID) {
  return { params: Promise.resolve({ sessionId }) };
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

describe("GET /api/sessions/[sessionId]/responses", () => {
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

  it("returns 404 when user is not a participant", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    // participants query returns null (not found via maybeSingle)
    mockSupabaseSequence({
      participants: [mockSuccess(null)],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Participant not found");
  });

  it("returns responses for a valid participant", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const responsesData = [
      {
        id: "r1",
        participant_user_id: USER_ID,
        session_id: SESSION_ID,
        statement_id: "st1",
        response_type: "scale",
        value: 2,
        text_response: null,
        created_at: "2026-01-01T00:00:00Z",
        statement: { id: "st1", text: "Question 1", order_index: 0 },
      },
      {
        id: "r2",
        participant_user_id: USER_ID,
        session_id: SESSION_ID,
        statement_id: "st2",
        response_type: "free_text",
        value: null,
        text_response: "My thoughts",
        created_at: "2026-01-01T00:00:01Z",
        statement: { id: "st2", text: "Question 2", order_index: 1 },
      },
    ];

    mockSupabaseSequence({
      participants: [mockSuccess({ user_id: USER_ID })],
      responses: [mockSuccess(responsesData)],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.responses).toHaveLength(2);
    expect(body.responses[0].statementId).toBeDefined();
    expect(body.responses[0].statementText).toBe("Question 2"); // sorted by createdAt desc
  });
});

describe("POST /api/sessions/[sessionId]/responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest({
      method: "POST",
      body: { statementId: "st1", value: 1 },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 400 when statementId is missing", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { value: 1 },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("statementId");
  });

  it("returns 400 when scale value is invalid", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { statementId: "st1", value: 5 },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid value");
  });

  it("returns 400 when scale value is missing", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { statementId: "st1" }, // no value, no responseType
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("value");
  });

  it("returns 404 when statement not in session", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    // statements.single() returns not found
    mockSupabaseSequence({
      statements: [mockNotFound()],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { statementId: "st-nonexistent", value: 1 },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Statement not found");
  });

  it("returns 404 when user is not a participant (POST)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      statements: [mockSuccess({ id: "st1" })],
      participants: [mockSuccess(null)], // maybeSingle returns null
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { statementId: "st1", value: 1 },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Participant not found");
  });

  it("upserts a scale response successfully", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const upsertedResponse = {
      id: "resp-new",
      participant_user_id: USER_ID,
      session_id: SESSION_ID,
      statement_id: "st1",
      response_type: "scale",
      value: 2,
      text_response: null,
      created_at: "2026-01-01T00:00:00Z",
      statement: { id: "st1", text: "Test Q", order_index: 0 },
    };

    mockSupabaseSequence({
      statements: [mockSuccess({ id: "st1" })],
      participants: [mockSuccess({ user_id: USER_ID })],
      responses: [mockSuccess(upsertedResponse)],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { statementId: "st1", value: 2 },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.response.statementId).toBe("st1");
    expect(body.response.value).toBe(2);
  });

  // The upsert payload sent to the `responses` builder of this request.
  const responsesUpsertPayload = (): Record<string, unknown> => {
    const index = mockedFrom.mock.calls.findIndex(
      ([table]) => table === "responses",
    );
    const builder = mockedFrom.mock.results[index]?.value as {
      upsert: ReturnType<typeof vi.fn>;
    };
    return builder.upsert.mock.calls[0][0];
  };

  it.each([
    ["suggested", { answer_source: "suggested" }],
    ["typed", { answer_source: "typed" }],
  ])("stores answerSource %j on a free-text answer", async (answerSource, expected) => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockSupabaseSequence({
      statements: [mockSuccess({ id: "st1" })],
      participants: [mockSuccess({ user_id: USER_ID })],
      responses: [
        mockSuccess({
          id: "resp-ft",
          participant_user_id: USER_ID,
          session_id: SESSION_ID,
          statement_id: "st1",
          response_type: "free_text",
          value: null,
          text_response: "picked",
          created_at: "2026-01-01T00:00:00Z",
        }),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {
        statementId: "st1",
        responseType: "free_text",
        textResponse: "picked",
        answerSource,
      },
    });
    const res = await POST(req, makeParams());

    expect(res.status).toBe(200);
    expect(responsesUpsertPayload()).toMatchObject(expected);
  });

  it.each([
    undefined,
    "bogus",
    "suggested",
  ])("clears answer_source on a scale answer (answerSource %j)", async (answerSource) => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockSupabaseSequence({
      statements: [mockSuccess({ id: "st1" })],
      participants: [mockSuccess({ user_id: USER_ID })],
      responses: [
        mockSuccess({
          id: "resp-s",
          participant_user_id: USER_ID,
          session_id: SESSION_ID,
          statement_id: "st1",
          response_type: "scale",
          value: 1,
          text_response: null,
          created_at: "2026-01-01T00:00:00Z",
        }),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { statementId: "st1", value: 1, answerSource },
    });
    const res = await POST(req, makeParams());

    expect(res.status).toBe(200);
    expect(responsesUpsertPayload()).toMatchObject({ answer_source: null });
  });

  it("returns 400 when free_text response has empty textResponse", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {
        statementId: "st1",
        responseType: "free_text",
        textResponse: "",
      },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("textResponse is required");
  });
});
