import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthedRequest,
  createMockRequest,
} from "@/lib/__tests__/helpers/mock-request";

// --- Mocks ---

const mockRequireSessionAdminToken = vi.fn();
const mockRequireSessionAdminAccess = vi.fn();

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/server/session-access", () => ({
  requireSessionAdminToken: (...args: unknown[]) =>
    mockRequireSessionAdminToken(...args),
  requireSessionAdminAccess: (...args: unknown[]) =>
    mockRequireSessionAdminAccess(...args),
  SessionAccessError: class SessionAccessError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

const mockListSessionReports = vi.fn();
const mockCreateSessionReportRecord = vi.fn();
const mockTriggerSessionReportGeneration = vi.fn();
const mockFindActiveSessionReport = vi.fn();
const mockExpireStaleSessionReports = vi.fn();

vi.mock("@/lib/server/session-reports", () => ({
  listSessionReports: (...args: unknown[]) => mockListSessionReports(...args),
  createSessionReportRecord: (...args: unknown[]) =>
    mockCreateSessionReportRecord(...args),
  findActiveSessionReport: (...args: unknown[]) =>
    mockFindActiveSessionReport(...args),
  expireStaleSessionReports: (...args: unknown[]) =>
    mockExpireStaleSessionReports(...args),
  triggerSessionReportGeneration: (...args: unknown[]) =>
    mockTriggerSessionReportGeneration(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span: unknown) => unknown) =>
    fn({
      setAttribute: vi.fn(),
    }),
  logger: { info: vi.fn() },
}));

// --- Imports ---

import { getUserIdFromRequest } from "@/lib/auth";
import { SessionAccessError } from "@/lib/server/session-access";
import { GET, POST } from "../reports/route";

const mockedGetUserId = getUserIdFromRequest as ReturnType<typeof vi.fn>;

// --- Helpers ---

const USER_ID = "user-rpt-1";
const SESSION_ID = "session-rpt-1";
const ACCESS_TOKEN = "valid-admin-token";

function makeParams(sessionId = SESSION_ID, accessToken = ACCESS_TOKEN) {
  return { params: Promise.resolve({ sessionId, accessToken }) };
}

// --- Tests ---

describe("GET /api/sessions/[sessionId]/[accessToken]/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest();

    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when access token is invalid", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockRequireSessionAdminToken.mockRejectedValue(
      new SessionAccessError("Forbidden", 403),
    );

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams(SESSION_ID, "bad-token"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
  });

  it("returns list of reports on success", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockRequireSessionAdminToken.mockResolvedValue({
      id: SESSION_ID,
      admin_access_token: ACCESS_TOKEN,
    });

    const reports = [
      {
        id: "rpt-1",
        sessionId: SESSION_ID,
        version: 1,
        status: "completed",
        contentMarkdown: "# Report",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    mockListSessionReports.mockResolvedValue(reports);

    const req = createAuthedRequest(USER_ID);
    const res = await GET(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(reports);
    expect(mockRequireSessionAdminToken).toHaveBeenCalledWith(
      SESSION_ID,
      ACCESS_TOKEN,
    );
    expect(mockListSessionReports).toHaveBeenCalledWith(SESSION_ID);
  });

  it("never discloses raw user UUIDs: createdBy and snapshot user ids are aliased (audit H2)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockRequireSessionAdminToken.mockResolvedValue({
      id: SESSION_ID,
      admin_access_token: ACCESS_TOKEN,
    });
    const HOST = "11111111-1111-4111-8111-111111111111";
    const PARTICIPANT = "22222222-2222-4222-8222-222222222222";
    mockListSessionReports.mockResolvedValue([
      {
        id: "rpt-2",
        sessionId: SESSION_ID,
        version: 2,
        status: "completed",
        contentMarkdown: "# Report",
        createdBy: HOST,
        promptSnapshot: {
          session: { id: SESSION_ID, title: "T" },
          participantSummaries: [{ userId: PARTICIPANT, name: "Alice" }],
          eventTimeline: [
            { id: "evt-1", userId: HOST, type: "user_message" },
            { id: "evt-2", userId: null, type: "plan" },
          ],
          statementStats: [{ statementNumber: 1, text: "Q1" }],
        },
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);

    const res = await GET(createAuthedRequest(USER_ID), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(HOST);
    expect(serialized).not.toContain(PARTICIPANT);
    const report = body.data[0];
    expect(report.createdBy).toMatch(/^u_/);
    expect(report.promptSnapshot.participantSummaries[0]).toMatchObject({
      name: "Alice",
      userId: expect.stringMatching(/^u_/),
    });
    // Same user → same alias across fields; null stays null; other data intact.
    expect(report.promptSnapshot.eventTimeline[0].userId).toBe(
      report.createdBy,
    );
    expect(report.promptSnapshot.eventTimeline[1].userId).toBeNull();
    expect(report.promptSnapshot.statementStats).toEqual([
      { statementNumber: 1, text: "Q1" },
    ]);
    expect(report.promptSnapshot.session.title).toBe("T");
  });
});

describe("POST /api/sessions/[sessionId]/[accessToken]/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest({ method: "POST" });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when access is denied", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockRequireSessionAdminAccess.mockRejectedValue(
      new SessionAccessError("Forbidden", 403),
    );

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {},
    });
    const res = await POST(req, makeParams(SESSION_ID, "bad-token"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
  });

  it("creates a report record and triggers generation", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockRequireSessionAdminAccess.mockResolvedValue({
      id: SESSION_ID,
      admin_access_token: ACCESS_TOKEN,
    });

    const createdReport = {
      id: "rpt-new",
      sessionId: SESSION_ID,
      version: 1,
      status: "pending",
      requestMarkdown: "Custom request",
      createdAt: "2026-01-01T00:00:00Z",
    };
    mockCreateSessionReportRecord.mockResolvedValue({
      created: true,
      report: createdReport,
    });
    mockTriggerSessionReportGeneration.mockResolvedValue(undefined);
    mockFindActiveSessionReport.mockResolvedValue(null);

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { requestMarkdown: "Custom request" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toEqual(createdReport);
    expect(mockCreateSessionReportRecord).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      userId: USER_ID,
      requestMarkdown: "Custom request",
    });
    expect(mockTriggerSessionReportGeneration).toHaveBeenCalledWith("rpt-new");
  });

  it("creates report even with invalid JSON body (requestMarkdown defaults)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockRequireSessionAdminAccess.mockResolvedValue({
      id: SESSION_ID,
      admin_access_token: ACCESS_TOKEN,
    });

    const createdReport = {
      id: "rpt-default",
      sessionId: SESSION_ID,
      version: 1,
      status: "pending",
      requestMarkdown: "",
    };
    mockCreateSessionReportRecord.mockResolvedValue({
      created: true,
      report: createdReport,
    });
    mockTriggerSessionReportGeneration.mockResolvedValue(undefined);
    mockFindActiveSessionReport.mockResolvedValue(null);

    // createMockRequest with body={} will return {} when json() is called
    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: {},
    });

    const res = await POST(req, makeParams());
    await res.json();

    expect(res.status).toBe(201);
    expect(mockCreateSessionReportRecord).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      userId: USER_ID,
      requestMarkdown: undefined,
    });
  });

  it("returns the in-flight report without creating a new one (retry-storm guard)", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockRequireSessionAdminAccess.mockResolvedValue({
      id: SESSION_ID,
      admin_access_token: ACCESS_TOKEN,
    });

    const activeReport = {
      id: "rpt-active",
      sessionId: SESSION_ID,
      version: 2,
      status: "generating",
      requestMarkdown: "",
    };
    mockFindActiveSessionReport.mockResolvedValue(activeReport);

    const req = createAuthedRequest(USER_ID, {
      method: "POST",
      body: { requestMarkdown: "Another click" },
    });

    const res = await POST(req, makeParams());
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.data).toEqual(activeReport);
    // The whole point: no new record + no second generation.
    expect(mockCreateSessionReportRecord).not.toHaveBeenCalled();
    expect(mockTriggerSessionReportGeneration).not.toHaveBeenCalled();
  });

  it("expires reports orphaned by a restart before checking for an in-flight one", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockRequireSessionAdminAccess.mockResolvedValue({ id: SESSION_ID });
    mockFindActiveSessionReport.mockResolvedValue(null);
    mockCreateSessionReportRecord.mockResolvedValue({
      created: true,
      report: { id: "rpt-new", sessionId: SESSION_ID, status: "pending" },
    });

    const res = await POST(
      createAuthedRequest(USER_ID, { method: "POST", body: {} }),
      makeParams(),
    );

    expect(res.status).toBe(201);
    expect(mockExpireStaleSessionReports).toHaveBeenCalledWith(SESSION_ID);
    expect(
      mockExpireStaleSessionReports.mock.invocationCallOrder[0],
    ).toBeLessThan(mockFindActiveSessionReport.mock.invocationCallOrder[0]);
  });

  it("returns the report a concurrent POST created instead of generating twice", async () => {
    mockedGetUserId.mockResolvedValue(USER_ID);
    mockRequireSessionAdminAccess.mockResolvedValue({ id: SESSION_ID });
    mockFindActiveSessionReport.mockResolvedValue(null);
    const winner = {
      id: "rpt-winner",
      sessionId: SESSION_ID,
      version: 3,
      status: "pending",
      requestMarkdown: "",
    };
    mockCreateSessionReportRecord.mockResolvedValue({
      created: false,
      report: winner,
    });

    const res = await POST(
      createAuthedRequest(USER_ID, { method: "POST", body: {} }),
      makeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.data.id).toBe("rpt-winner");
    expect(mockTriggerSessionReportGeneration).not.toHaveBeenCalled();
  });
});
