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
import { POST } from "../participants/route";

const mockedGetUserId = getUserIdFromRequest as ReturnType<typeof vi.fn>;
const mockedFrom = supabase.from as ReturnType<typeof vi.fn>;

// --- Helpers ---

const USER_ID = "user-part-1";
const SESSION_ID = "session-part-1";

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

describe("POST /api/sessions/[sessionId]/participants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest({
      method: "POST",
      body: { name: "Alice" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 400 when name is missing", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {},
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("name");
  });

  it("returns 404 when session does not exist", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    // sessions.single() returns PGRST116
    mockSupabaseSequence({
      sessions: [mockNotFound()],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { name: "Alice" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Session not found");
  });

  // Joining is idempotent: a participant sent back to the name form (reload, a failed
  // follow-up request) must get in again instead of being stuck on 409.
  it("returns the existing participant when the user has already joined", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const existing = {
      user_id: USER_ID,
      session_id: SESSION_ID,
      name: "Alice",
      latest_individual_report_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    mockSupabaseSequence({
      sessions: [mockSuccess({ id: SESSION_ID })],
      participants: [mockSuccess(existing)],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { name: "Alice again" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.participant.userId).toBe(USER_ID);
    expect(body.participant.name).toBe("Alice");
  });

  it("returns the participant a concurrent join created (unique key violation)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const joined = {
      user_id: USER_ID,
      session_id: SESSION_ID,
      name: "Alice",
      latest_individual_report_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    mockSupabaseSequence({
      sessions: [mockSuccess({ id: SESSION_ID })],
      participants: [
        mockSuccess(null),
        mockError("duplicate key value violates unique constraint", "23505"),
        mockSuccess(joined),
      ],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { name: "Alice" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.participant.userId).toBe(USER_ID);
  });

  it("registers a participant successfully", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    const newParticipant = {
      user_id: USER_ID,
      session_id: SESSION_ID,
      name: "Alice",
      latest_individual_report_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    mockSupabaseSequence({
      sessions: [mockSuccess({ id: SESSION_ID })],
      // First participants call: check existing -> null (maybeSingle)
      // Second participants call: insert -> new participant (single)
      participants: [mockSuccess(null), mockSuccess(newParticipant)],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { name: "Alice" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.participant).toBeDefined();
    expect(body.participant.userId).toBe(USER_ID);
    expect(body.participant.sessionId).toBe(SESSION_ID);
    expect(body.participant.name).toBe("Alice");
  });

  it("returns 500 when checking existing participant fails", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      sessions: [mockSuccess({ id: SESSION_ID })],
      participants: [mockError("db error")],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { name: "Alice" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to join session");
  });

  it("returns 500 when insert participant fails", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);

    mockSupabaseSequence({
      sessions: [mockSuccess({ id: SESSION_ID })],
      // check existing: not found, then insert: error
      participants: [mockSuccess(null), mockError("insert failed")],
    });

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { name: "Bob" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to join session");
  });
});
