import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAuthedRequest,
  createMockRequest,
} from "@/lib/__tests__/helpers/mock-request";
import {
  createMockSupabase,
  mockSuccess,
} from "@/lib/__tests__/helpers/mock-supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: createMockSupabase(),
}));

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/server/session-access", () => ({
  safeCompare: (a: string, b: string) => a === b,
}));

vi.mock("@/lib/server/event-threads", () => ({
  ensureEventThreadForSession: vi.fn(),
}));

import { getUserIdFromRequest } from "@/lib/auth";
import { ensureEventThreadForSession } from "@/lib/server/event-threads";
import { supabase } from "@/lib/supabase";
import { GET } from "../event-thread/route";

const mockedGetUserId = getUserIdFromRequest as ReturnType<typeof vi.fn>;
const mockedEnsureEventThreadForSession =
  ensureEventThreadForSession as ReturnType<typeof vi.fn>;
const mockedFrom = supabase.from as ReturnType<typeof vi.fn>;

const USER_ID = "user-thread-1";
const SESSION_ID = "session-thread-1";
const ACCESS_TOKEN = "valid-thread-token";

function makeParams(sessionId = SESSION_ID, accessToken = ACCESS_TOKEN) {
  return { params: Promise.resolve({ sessionId, accessToken }) };
}

function mockSupabaseSequence(tables: Record<string, unknown[]>) {
  const counters: Record<string, number> = {};
  mockedFrom.mockImplementation((table: string) => {
    const sequence = tables[table];
    if (!sequence) return createMockSupabase().from(table);
    const index = counters[table] ?? 0;
    counters[table] = index + 1;
    const result =
      index < sequence.length ? sequence[index] : sequence[sequence.length - 1];
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

describe("GET /api/sessions/[sessionId]/[accessToken]/event-thread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth is present", async () => {
    mockedGetUserId.mockResolvedValue(null);

    const response = await GET(createMockRequest(), makeParams());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns derived event status and error message", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedEnsureEventThreadForSession.mockResolvedValue({
      id: "thread-1",
      session_id: SESSION_ID,
      should_proceed: false,
      created_at: "2026-03-10T00:00:00Z",
      updated_at: "2026-03-10T00:01:00Z",
    });

    mockSupabaseSequence({
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          title: "Thread Session",
          context: "Context",
          goal: "Goal",
          is_public: false,
          host_user_id: USER_ID,
          admin_access_token: ACCESS_TOKEN,
        }),
      ],
      events: [
        mockSuccess([
          {
            // Bootstrap user_message carries host_user_id (event-threads.ts).
            id: "evt-bootstrap",
            type: "user_message",
            agent_id: null,
            user_id: USER_ID,
            progress: 1,
            payload: { markdown: "goal" },
            order_index: 0,
            created_at: "2026-03-10T00:00:00Z",
            updated_at: "2026-03-10T00:00:00Z",
          },
          {
            id: "evt-plan-failed",
            type: "plan",
            agent_id: "agent-1",
            user_id: null,
            progress: 0,
            payload: { markdown: "", error: "Failed to call LLM API" },
            order_index: 1,
            created_at: "2026-03-10T00:00:00Z",
            updated_at: "2026-03-10T00:01:00Z",
          },
          {
            id: "evt-survey",
            type: "survey",
            agent_id: "agent-1",
            user_id: null,
            progress: 1,
            payload: { statementIds: ["st-1"] },
            order_index: 2,
            created_at: "2026-03-10T00:02:00Z",
            updated_at: "2026-03-10T00:03:00Z",
          },
        ]),
      ],
      statements: [
        mockSuccess([
          {
            id: "st-1",
            text: "Question 1",
            order_index: 0,
          },
        ]),
      ],
      agent_instances: [
        mockSuccess([
          {
            id: "agent-1",
            agent_type: "ptolemy",
            state: "WAITING_ANALYSIS",
            state_payload: {},
            created_at: "2026-03-10T00:00:00Z",
            updated_at: "2026-03-10T00:03:00Z",
          },
        ]),
      ],
    });

    const response = await GET(createAuthedRequest(USER_ID), makeParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(3);
    expect(body.events[1]).toMatchObject({
      id: "evt-plan-failed",
      status: "failed",
      errorMessage: "Failed to call LLM API",
    });
    expect(body.events[2]).toMatchObject({
      id: "evt-survey",
      status: "completed",
      errorMessage: null,
    });
    expect(body.agents[0].state).toBe("WAITING_ANALYSIS");
  });

  it("never discloses host_user_id — events carry a per-session alias (audit H2)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockedEnsureEventThreadForSession.mockResolvedValue({
      id: "thread-1",
      session_id: SESSION_ID,
      should_proceed: false,
      created_at: "2026-03-10T00:00:00Z",
      updated_at: "2026-03-10T00:01:00Z",
    });
    mockSupabaseSequence({
      sessions: [
        mockSuccess({
          id: SESSION_ID,
          title: "Thread Session",
          context: "Context",
          goal: "Goal",
          is_public: false,
          host_user_id: USER_ID,
          admin_access_token: ACCESS_TOKEN,
        }),
      ],
      events: [
        mockSuccess([
          {
            id: "evt-bootstrap",
            type: "user_message",
            agent_id: null,
            user_id: USER_ID,
            progress: 1,
            payload: { markdown: "goal" },
            order_index: 0,
            created_at: "2026-03-10T00:00:00Z",
            updated_at: "2026-03-10T00:00:00Z",
          },
          {
            id: "evt-agent",
            type: "plan",
            agent_id: "agent-1",
            user_id: null,
            progress: 1,
            payload: { markdown: "plan" },
            order_index: 1,
            created_at: "2026-03-10T00:01:00Z",
            updated_at: "2026-03-10T00:01:00Z",
          },
          {
            // Participant reflection mirrored into the thread
            // (reflections/route.ts) carries the participant id in metadata.
            id: "evt-reflection",
            type: "user_message",
            agent_id: null,
            user_id: "participant-raw-uuid",
            progress: 1,
            payload: {
              markdown: "reflection",
              metadata: {
                kind: "participant_reflection",
                source: "participant",
                participantUserId: "participant-raw-uuid",
              },
            },
            order_index: 2,
            created_at: "2026-03-10T00:02:00Z",
            updated_at: "2026-03-10T00:02:00Z",
          },
        ]),
      ],
      agent_instances: [mockSuccess([])],
    });

    const response = await GET(createAuthedRequest(USER_ID), makeParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(USER_ID);
    expect(serialized).not.toContain("participant-raw-uuid");
    expect(body.events[0].userId).toMatch(/^u_/);
    expect(body.events[1].userId).toBeNull();
    // Payload metadata is aliased with the same alias as the event's userId.
    expect(body.events[2].payload.metadata.participantUserId).toBe(
      body.events[2].userId,
    );
    expect(body.events[2].payload.metadata.kind).toBe("participant_reflection");
  });
});
