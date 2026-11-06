import { afterEach, describe, expect, it, vi } from "vitest";

const mockRun = vi.fn();

vi.mock("../PtolemyAgent", () => ({
  PtolemyAgent: class {
    run = mockRun;
    setSupabaseClient = vi.fn();
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({
          data: { id: "agent-1", agent_type: "ptolemy", state: "X" },
          error: null,
        }),
      };
      return chain;
    },
  }),
}));

import { AgentManager } from "../AgentManager";

type Internals = { handleInstance: (agentId: string) => Promise<void> };

afterEach(() => {
  mockRun.mockReset();
});

describe("AgentManager notifications during a run", () => {
  it("runs the instance again when notified while it was processing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const manager = new AgentManager("https://example.test", "key");
    const internals = manager as unknown as Internals;

    let release!: () => void;
    const firstRunGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondRunDone!: () => void;
    const secondRun = new Promise<void>((resolve) => {
      secondRunDone = resolve;
    });
    mockRun
      .mockImplementationOnce(async () => {
        await firstRunGate;
        return { status: "waiting" };
      })
      .mockImplementationOnce(async () => {
        secondRunDone();
        return { status: "waiting" };
      });

    const first = internals.handleInstance("agent-1");
    await vi.waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1));
    // e.g. the response that crosses the threshold arrives mid-run
    await internals.handleInstance("agent-1");
    expect(mockRun).toHaveBeenCalledTimes(1);

    release();
    await first;
    await secondRun;

    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it("does not re-run when nothing arrived during the run", async () => {
    const manager = new AgentManager("https://example.test", "key");
    mockRun.mockResolvedValue({ status: "waiting" });

    await (manager as unknown as Internals).handleInstance("agent-1");
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});
