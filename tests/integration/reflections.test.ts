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

// --- Imports (after mocks) ---

import { getUserIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  GET,
  POST,
} from "../../app/api/sessions/[sessionId]/reflections/route";

const mockedGetUserId = getUserIdFromRequest as ReturnType<typeof vi.fn>;
const mockedFrom = supabase.from as ReturnType<typeof vi.fn>;

// --- Helpers ---

const USER_ID = "user-refl-1";
const SESSION_ID = "session-refl-1";

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

describe("GET /api/sessions/[sessionId]/reflections", () => {
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

    // participants.maybeSingle() returns null (not found)
    mockSupabaseSequence({
      participants: [mockSuccess(null)],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Participant not found");
  });

  it("returns reflections for a valid participant", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const reflectionsData = [
      {
        id: "refl-1",
        participant_user_id: USER_ID,
        session_id: SESSION_ID,
        text: "I learned a lot",
        created_at: "2026-01-01T00:00:00Z",
        submitted_at: "2026-01-01T00:01:00Z",
      },
      {
        id: "refl-2",
        participant_user_id: USER_ID,
        session_id: SESSION_ID,
        text: "Great discussion",
        created_at: "2026-01-01T00:02:00Z",
        submitted_at: "2026-01-01T00:03:00Z",
      },
    ];

    mockSupabaseSequence({
      participants: [mockSuccess({ user_id: USER_ID })],
      participant_reflections: [mockSuccess(reflectionsData)],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reflections).toHaveLength(2);
    expect(body.reflections[0].id).toBe("refl-1");
    expect(body.reflections[0].text).toBe("I learned a lot");
    expect(body.reflections[0].createdAt).toBe("2026-01-01T00:00:00Z");
    expect(body.reflections[0].submittedAt).toBe("2026-01-01T00:01:00Z");
  });

  it("returns empty reflections array when none exist", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockSuccess({ user_id: USER_ID })],
      participant_reflections: [mockSuccess([])],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reflections).toEqual([]);
  });

  it("returns 500 when participant verification fails", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockError("db error")],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to fetch reflections");
  });

  it("returns 500 when reflections query fails", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockSuccess({ user_id: USER_ID })],
      participant_reflections: [mockError("db error")],
    });

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to fetch reflections");
  });
});

// --- Tests: POST ---

describe("POST /api/sessions/[sessionId]/reflections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest({
      method: "POST",
      body: { text: "Some reflection" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 404 when user is not a participant", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockSuccess(null)],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { text: "Some reflection" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Participant not found");
  });

  it("returns 400 when text is missing", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockSuccess({ user_id: USER_ID })],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {},
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid value for text");
  });

  it("returns 400 when text is not a string", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockSuccess({ user_id: USER_ID })],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { text: 123 },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid value for text");
  });

  it("submits a reflection successfully", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const insertedReflection = {
      id: "refl-new",
      participant_user_id: USER_ID,
      session_id: SESSION_ID,
      text: "Great insights",
      created_at: "2026-01-01T00:00:00Z",
      submitted_at: "2026-01-01T00:00:01Z",
    };

    mockSupabaseSequence({
      participants: [mockSuccess({ user_id: USER_ID })],
      participant_reflections: [mockSuccess(insertedReflection)],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { text: "  Great insights  " },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reflection).toBeDefined();
    expect(body.reflection.id).toBe("refl-new");
    expect(body.reflection.text).toBe("Great insights");
    expect(body.reflection.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(body.reflection.submittedAt).toBe("2026-01-01T00:00:01Z");
  });

  it("returns 500 when insert fails", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockSuccess({ user_id: USER_ID })],
      participant_reflections: [mockError("insert failed")],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { text: "A reflection" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to submit reflection");
  });

  it("returns 500 when participant verification fails on POST", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      participants: [mockError("db error")],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { text: "A reflection" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to submit reflection");
  });
});
