import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; error?: { code?: string; message: string } };
type Chain = Record<string, ReturnType<typeof vi.fn>>;

// Every query on a table pops the next queued result; the chain is thenable so
// both `await query` and `.single()/.maybeSingle()` resolve to it.
const queued: Record<string, Result[]> = {};
const chains: Record<string, Chain[]> = {};

function chainFor(result: Result): Chain {
  const settled = { data: result.data ?? null, error: result.error ?? null };
  const chain: Chain = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "eq",
    "in",
    "lt",
    "gte",
    "order",
    "limit",
  ]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(settled);
  chain.maybeSingle = vi.fn().mockResolvedValue(settled);
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: unknown) => void) =>
      Promise.resolve(settled).then(resolve),
  });
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  selectAllRange: vi.fn(),
  supabase: {
    from: (table: string) => {
      const result = queued[table]?.shift() ?? {};
      const chain = chainFor(result);
      chains[table] = [...(chains[table] ?? []), chain];
      return chain;
    },
  },
}));

const mockCallLLM = vi.fn();
vi.mock("@/lib/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm")>()),
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
  callLLMWithMeta: (...args: unknown[]) => mockCallLLM(...args),
}));

import { LLMAbortedError } from "@/lib/llm";
import { encodeReportFailure } from "@/lib/report-failure";
import {
  ACTIVE_REPORT_STALE_MS,
  buildPayloadSummary,
  createSessionReportRecord,
  expireStaleSessionReports,
  INTERRUPTED_REPORT_MESSAGE,
  REPORT_GENERATION_BUDGET_MS,
} from "../session-reports";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "rpt-1",
  session_id: "s-1",
  version: 1,
  status: "pending",
  request_markdown: "",
  content_markdown: null,
  created_by: "u-1",
  model: "m",
  error_message: null,
  token_usage: null,
  prompt_snapshot: null,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
  completed_at: null,
  ...overrides,
});

beforeEach(() => {
  for (const key of Object.keys(queued)) delete queued[key];
  for (const key of Object.keys(chains)) delete chains[key];
  mockCallLLM.mockReset();
});

describe("report generation time bounds", () => {
  it("keeps a live generation from ever looking stale", () => {
    expect(ACTIVE_REPORT_STALE_MS).toBeGreaterThan(REPORT_GENERATION_BUDGET_MS);
  });
});

describe("expireStaleSessionReports", () => {
  it("fails only in-flight rows of the session older than the stale window", async () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    await expireStaleSessionReports("s-1", now);

    const [update] = chains.session_reports;
    expect(update.update).toHaveBeenCalledWith({
      status: "failed",
      error_message: INTERRUPTED_REPORT_MESSAGE,
      updated_at: new Date(now).toISOString(),
    });
    expect(update.eq).toHaveBeenCalledWith("session_id", "s-1");
    expect(update.in).toHaveBeenCalledWith("status", ["pending", "generating"]);
    expect(update.lt).toHaveBeenCalledWith(
      "updated_at",
      new Date(now - ACTIVE_REPORT_STALE_MS).toISOString(),
    );
  });
});

describe("createSessionReportRecord", () => {
  it("returns the concurrent winner when the one-in-flight index rejects the insert", async () => {
    queued.session_reports = [
      { data: { version: 2 } }, // next version lookup
      { error: { code: "23505", message: "duplicate key" } }, // insert
      { data: row({ id: "rpt-winner", version: 3, status: "generating" }) },
    ];

    const result = await createSessionReportRecord({
      sessionId: "s-1",
      userId: "u-1",
    });

    expect(result.created).toBe(false);
    expect(result.report.id).toBe("rpt-winner");
  });

  it("recomputes the version once when a completed report took it", async () => {
    queued.session_reports = [
      { data: { version: 2 } },
      { error: { code: "23505", message: "duplicate key" } },
      { data: null }, // no in-flight report
      { data: { version: 3 } },
      { data: row({ id: "rpt-new", version: 4 }) },
    ];

    const result = await createSessionReportRecord({
      sessionId: "s-1",
      userId: "u-1",
    });

    expect(result).toMatchObject({ created: true, report: { version: 4 } });
    const inserts = chains.session_reports.filter(
      (chain) => chain.insert.mock.calls.length > 0,
    );
    expect(
      inserts.map((chain) => chain.insert.mock.calls[0][0].version),
    ).toEqual([3, 4]);
  });

  it("surfaces non-conflict insert errors", async () => {
    queued.session_reports = [
      { data: null },
      { error: { code: "42501", message: "permission denied" } },
    ];

    await expect(
      createSessionReportRecord({ sessionId: "s-1", userId: "u-1" }),
    ).rejects.toThrow("permission denied");
  });
});

describe("generateSessionReport", () => {
  it("stores the resolved model, prompt version, generation id and usage", async () => {
    const { generateSessionReport } = await import("../session-reports");
    const supabaseModule = await import("@/lib/supabase");
    vi.mocked(supabaseModule.selectAllRange).mockResolvedValue({
      data: [],
      error: null,
    } as never);
    queued.session_reports = [
      { data: row({ status: "pending" }) }, // load
      {}, // mark generating
      {}, // mark completed
    ];
    queued.sessions = [
      { data: { id: "s-1", title: "t", context: "", goal: "" } },
    ];
    queued.statements = [{ data: [] }];
    queued.event_threads = [{ data: null }];
    const usage = { prompt_tokens: 120, completion_tokens: 30 };
    mockCallLLM.mockResolvedValue({
      content: "# report",
      model: "google/gemini-3.1-pro-preview-0101",
      generationId: "gen-report",
      usage,
    });

    await generateSessionReport("rpt-1");

    expect(chains.session_reports.at(-1)?.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        content_markdown: "# report",
        model: "google/gemini-3.1-pro-preview-0101",
        prompt_version: "2026-11-07.1",
        generation_id: "gen-report",
        token_usage: usage,
      }),
    );
  });

  it("bounds the LLM call and records an over-budget run as failed", async () => {
    const { generateSessionReport } = await import("../session-reports");
    const supabaseModule = await import("@/lib/supabase");
    vi.mocked(supabaseModule.selectAllRange).mockResolvedValue({
      data: [],
      error: null,
    } as never);
    queued.session_reports = [
      { data: row({ status: "pending" }) }, // load
      {}, // mark generating
      {}, // mark failed
    ];
    queued.sessions = [
      { data: { id: "s-1", title: "t", context: "", goal: "" } },
    ];
    queued.statements = [{ data: [] }];
    queued.event_threads = [{ data: null }];
    mockCallLLM.mockImplementation(
      (_messages: unknown, _model: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new LLMAbortedError()),
          );
        }),
    );

    await generateSessionReport("rpt-1", 20);

    const failed = chains.session_reports.at(-1);
    expect(failed?.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: encodeReportFailure("timeout"),
      }),
    );
  });
});

describe("buildPayloadSummary", () => {
  const llm = {
    model: "google/gemini-3.1-pro-preview",
    promptVersion: "2026-11-07.1",
    generationId: "gen-1",
  };

  it("keeps generation metadata out of the report prompt", () => {
    expect(buildPayloadSummary({ markdown: "plan", llm })).toBeNull();
    expect(buildPayloadSummary({ markdown: "plan", error: "x", llm })).toBe(
      buildPayloadSummary({ markdown: "plan", error: "x" }),
    );
  });
});
