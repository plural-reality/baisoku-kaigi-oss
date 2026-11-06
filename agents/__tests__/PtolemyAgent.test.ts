import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getThreadEventStatus } from "../../app/lib/thread-events";
import { __resetLLMLimiter } from "../llm-limiter";

vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  generatePlanMarkdown: vi.fn(),
  generateSurveyAnalysisMarkdown: vi.fn(),
}));

import { generatePlanMarkdown, generateSurveyAnalysisMarkdown } from "../llm";
import { PtolemyAgent } from "../PtolemyAgent";

type QueryResult = {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
};

type QueryChain = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function createQueryChain(result: QueryResult): QueryChain {
  const chain = {} as QueryChain;

  for (const method of [
    "select",
    "insert",
    "update",
    "eq",
    "in",
    "order",
    "limit",
  ] as const) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  chain.single = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  });

  // biome-ignore lint/suspicious/noThenProperty: Supabase client requires thenable chain in tests
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: QueryResult) => void) =>
      Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
        count: result.count ?? null,
      }).then(resolve),
    enumerable: false,
  });

  return chain;
}

function createSupabaseStub(sequenceMap: Record<string, QueryResult[]>) {
  const counters: Record<string, number> = {};
  const calls: Record<string, QueryChain[]> = {};

  const from = vi.fn((table: string) => {
    const sequence = sequenceMap[table] ?? [{ data: null, error: null }];
    const index = counters[table] ?? 0;
    counters[table] = index + 1;
    const result =
      index < sequence.length ? sequence[index] : sequence[sequence.length - 1];
    const chain = createQueryChain(result);
    calls[table] = [...(calls[table] ?? []), chain];
    return chain;
  });

  return { from, calls };
}

describe("PtolemyAgent", () => {
  it("stores payload.error when analysis generation fails", async () => {
    vi.mocked(generateSurveyAnalysisMarkdown).mockRejectedValueOnce(
      new Error("LLM unavailable"),
    );

    const supabase = createSupabaseStub({
      event_threads: [
        {
          data: {
            id: "thread-1",
            session_id: "session-1",
            should_proceed: true,
          },
          error: null,
        },
      ],
      sessions: [
        {
          data: {
            id: "session-1",
            title: "Budget Alignment",
            context: "Context",
            goal: "Goal",
          },
          error: null,
        },
      ],
      events: [
        {
          data: { id: "analysis-event-1" },
          error: null,
        },
        {
          data: [],
          error: null,
        },
        {
          data: null,
          error: null,
        },
      ],
      statements: [
        {
          data: [{ id: "st-1", text: "Question 1" }],
          error: null,
        },
      ],
      responses: [
        {
          data: [],
          error: null,
        },
      ],
      participants: [
        {
          data: null,
          error: null,
          count: 1,
        },
      ],
    });

    const agent = new PtolemyAgent(supabase as never);
    const result = await agent.run({
      id: "agent-1",
      thread_id: "thread-1",
      agent_type: "ptolemy",
      state: "CREATING_ANALYSIS",
      state_payload: { statementIds: ["st-1"] },
    });

    expect(result).toEqual({ status: "idle" });
    expect(generateSurveyAnalysisMarkdown).toHaveBeenCalledOnce();

    const failedUpdate = supabase.calls.events.at(-1);
    expect(failedUpdate).toBeDefined();
    if (!failedUpdate) {
      throw new Error("Failed to capture events update query");
    }
    expect(failedUpdate.update).toHaveBeenCalledWith({
      payload: {
        statementIds: ["st-1"],
        error: "LLM unavailable",
      },
      progress: 0,
      updated_at: expect.any(String),
    });
    expect(failedUpdate.eq).toHaveBeenCalledWith("id", "analysis-event-1");
  });
});

const surveyStub = () => ({
  ...createSupabaseStub({
    event_threads: [
      {
        data: { id: "thread-1", session_id: "session-1", should_proceed: true },
      },
    ],
    sessions: [
      {
        data: {
          id: "session-1",
          title: "合成の公園",
          context: "合成入力",
          goal: "認識差",
        },
      },
    ],
    events: [
      { data: { id: "new-survey" } },
      { count: 2 },
      { data: null },
      { data: null },
      { data: [] },
      { data: null },
    ],
    statements: [{ data: { order_index: 42 } }],
    participants: [{ count: 4 }],
    agent_instances: [{ data: null }],
  }),
  rpc: vi
    .fn()
    .mockResolvedValue({ data: [{ id: "new-statement" }], error: null }),
});
// States the agent moved the instance to (claim updates only touch the payload).
const stateTransitions = (supabase: {
  calls: Record<string, QueryChain[]>;
}): string[] =>
  (supabase.calls.agent_instances ?? [])
    .flatMap((chain) => chain.update.mock.calls)
    .map(([update]) => (update as { state?: string }).state)
    .filter((state): state is string => typeof state === "string");

const surveyInstance = {
  id: "agent-1",
  thread_id: "thread-1",
  agent_type: "ptolemy",
  state: "CREATING_SURVEY",
  state_payload: { statementIds: ["previous-valid-statement"] },
};

describe("actual survey generation to atomic append and display status", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-test-key");
    vi.stubEnv("LLM_PROVIDER", "");
    vi.stubEnv("LLM_RATE_LIMIT_PER_MIN", "1000");
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "1000");
    __resetLLMLimiter();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(axios, "post");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __resetLLMLimiter();
  });

  it.each([
    "",
    "google/gemini-3.8-flash",
  ])("rejects invalid batches before any statement write (%j)", (model) => {
    vi.stubEnv("SURVEY_STATEMENTS_MODEL", model);
    return [[], [""], [" \n　"], ["正常", 1], ["重複", " 重複　"]].reduce(
      (previous, content) =>
        previous.then(() => {
          const supabase = surveyStub();
          vi.mocked(axios.post)
            .mockClear()
            .mockResolvedValue({
              data: {
                choices: [{ message: { content: JSON.stringify(content) } }],
              },
            });
          return new PtolemyAgent(supabase as never)
            .run(surveyInstance)
            .then((result) => {
              expect(result).toEqual({ status: "idle" }); // Manager requeues only "transitioned".
              expect(axios.post).toHaveBeenCalledTimes(1); // No retry on invalid content.
              expect(supabase.rpc).not.toHaveBeenCalled();
              expect(stateTransitions(supabase)).toEqual([]);
              expect(supabase.calls.statements).toHaveLength(1);
              expect(
                supabase.calls.statements[0].insert,
              ).not.toHaveBeenCalled();
              expect(
                supabase.calls.statements[0].update,
              ).not.toHaveBeenCalled();
              const failure = supabase.calls.events.at(-1);
              expect(failure?.eq).toHaveBeenCalledWith("id", "new-survey");
              const update = failure?.update.mock.calls[0][0];
              expect(update.payload.statementIds).toEqual([]);
              expect(
                getThreadEventStatus({
                  type: "survey",
                  payload: update.payload,
                }).status,
              ).toBe("failed");
              expect(surveyInstance.state_payload.statementIds).toEqual([
                "previous-valid-statement",
              ]);
            });
        }),
      Promise.resolve(),
    );
  });

  it.each([
    1, 14, 15, 16,
  ])("preserves valid %i-item behavior with one append capped at 15", (count) => {
    const texts = Array.from(
      { length: count },
      (_, index) => ` 賛否文${index} `,
    );
    vi.mocked(axios.post).mockResolvedValue({
      data: { choices: [{ message: { content: JSON.stringify(texts) } }] },
    });
    const supabase = surveyStub();
    return new PtolemyAgent(supabase as never)
      .run(surveyInstance)
      .then((result) => {
        expect(result).toEqual({ status: "transitioned" });
        expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith(
          "append_session_statements",
          {
            p_session_id: "session-1",
            p_texts: texts.slice(0, 15).map((text) => text.trim()),
          },
        );
        expect(stateTransitions(supabase)).toEqual(["COLLECTING_SURVEY"]);
        const update = supabase.calls.events.at(-1)?.update.mock.calls[0][0];
        expect(
          getThreadEventStatus({ type: "survey", payload: update.payload })
            .status,
        ).toBe("completed");
      });
  });

  it("keeps an append failure out of the completed display state", () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: { choices: [{ message: { content: '["正常文"]' } }] },
    });
    const supabase = surveyStub();
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: "synthetic database failure" },
    });
    return new PtolemyAgent(supabase as never)
      .run(surveyInstance)
      .then((result) => {
        expect(result).toEqual({ status: "idle" });
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(stateTransitions(supabase)).toEqual([]);
        const update = supabase.calls.events.at(-1)?.update.mock.calls[0][0];
        expect(
          getThreadEventStatus({ type: "survey", payload: update.payload })
            .status,
        ).toBe("failed");
      });
  });
});

describe("resuming an interrupted CREATING_* run", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const threadAndSession = {
    event_threads: [
      {
        data: { id: "thread-1", session_id: "session-1", should_proceed: true },
      },
    ],
    sessions: [
      { data: { id: "session-1", title: "t", context: "c", goal: "g" } },
    ],
  };

  it("records the new output event before calling the LLM", async () => {
    vi.mocked(generateSurveyAnalysisMarkdown).mockRejectedValueOnce(
      new Error("LLM unavailable"),
    );
    const supabase = createSupabaseStub({
      ...threadAndSession,
      events: [{ data: { id: "analysis-new" } }, { data: [] }, { data: null }],
      statements: [{ data: [{ id: "st-1", text: "Q" }] }],
      responses: [{ data: [] }],
      participants: [{ count: 1 }],
    });

    await new PtolemyAgent(supabase as never).run({
      id: "agent-1",
      thread_id: "thread-1",
      agent_type: "ptolemy",
      state: "CREATING_ANALYSIS",
      state_payload: { statementIds: ["st-1"] },
    });

    const [claim] = supabase.calls.agent_instances;
    expect(claim.update).toHaveBeenCalledWith({
      state_payload: {
        statementIds: ["st-1"],
        pendingEvent: { state: "CREATING_ANALYSIS", id: "analysis-new" },
      },
      updated_at: expect.any(String),
    });
    expect(claim.eq).toHaveBeenCalledWith("state", "CREATING_ANALYSIS");
    expect(stateTransitions(supabase)).toEqual([]);
  });

  it("retries on the failed event instead of inserting another one", async () => {
    vi.mocked(generateSurveyAnalysisMarkdown).mockResolvedValueOnce("# done");
    const supabase = createSupabaseStub({
      ...threadAndSession,
      events: [
        {
          data: {
            id: "analysis-old",
            payload: { statementIds: ["st-1"], error: "LLM unavailable" },
          },
        },
        { data: null }, // reset to in-progress
        { data: [] }, // thread context
        { data: null }, // completion update
      ],
      statements: [{ data: [{ id: "st-1", text: "Q" }] }],
      responses: [{ data: [] }],
      participants: [{ count: 1 }],
    });

    const result = await new PtolemyAgent(supabase as never).run({
      id: "agent-1",
      thread_id: "thread-1",
      agent_type: "ptolemy",
      state: "CREATING_ANALYSIS",
      state_payload: {
        statementIds: ["st-1"],
        pendingEvent: { state: "CREATING_ANALYSIS", id: "analysis-old" },
      },
    });

    expect(result).toEqual({ status: "transitioned" });
    expect(
      supabase.calls.events.some((chain) => chain.insert.mock.calls.length),
    ).toBe(false);
    const completion = supabase.calls.events.at(-1);
    expect(completion?.eq).toHaveBeenCalledWith("id", "analysis-old");
    expect(stateTransitions(supabase)).toEqual(["WAITING_PLAN"]);
  });

  it("does not append statements again when the previous run already did", async () => {
    const rpc = vi.fn();
    const supabase = {
      ...createSupabaseStub({
        ...threadAndSession,
        events: [
          {
            data: {
              id: "survey-old",
              payload: { statementIds: ["st-a", "st-b"] },
            },
          },
        ],
      }),
      rpc,
    };

    const result = await new PtolemyAgent(supabase as never).run({
      id: "agent-1",
      thread_id: "thread-1",
      agent_type: "ptolemy",
      state: "CREATING_SURVEY",
      state_payload: {
        pendingEvent: { state: "CREATING_SURVEY", id: "survey-old" },
      },
    });

    expect(result).toEqual({ status: "transitioned" });
    expect(rpc).not.toHaveBeenCalled();
    const [transition] = supabase.calls.agent_instances;
    expect(transition.update).toHaveBeenCalledWith({
      state: "COLLECTING_SURVEY",
      state_payload: {
        surveyEventId: "survey-old",
        statementIds: ["st-a", "st-b"],
      },
      updated_at: expect.any(String),
    });
    // Compare-and-set: only moves the instance if it is still CREATING_SURVEY.
    expect(transition.eq).toHaveBeenCalledWith("state", "CREATING_SURVEY");
  });

  it("ignores a pending event recorded for a different state", async () => {
    vi.mocked(generatePlanMarkdown).mockRejectedValueOnce(new Error("down"));
    const supabase = createSupabaseStub({
      ...threadAndSession,
      events: [
        { data: { id: "plan-new" } },
        { data: null },
        { data: [] },
        { data: [] },
        { data: null },
      ],
      participants: [{ count: 0 }],
      participant_reflections: [{ data: [] }],
    });

    await new PtolemyAgent(supabase as never).run({
      id: "agent-1",
      thread_id: "thread-1",
      agent_type: "ptolemy",
      state: "CREATING_PLAN",
      state_payload: {
        pendingEvent: { state: "CREATING_ANALYSIS", id: "analysis-old" },
      },
    });

    expect(supabase.calls.events[0].insert).toHaveBeenCalled();
    expect(supabase.calls.agent_instances[0].update).toHaveBeenCalledWith(
      expect.objectContaining({
        state_payload: {
          pendingEvent: { state: "CREATING_PLAN", id: "plan-new" },
        },
      }),
    );
  });
});
