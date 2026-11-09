import { describe, expect, it } from "vitest";
import { eventsWithoutLlmMeta, withoutLlmMeta } from "@/lib/llm-models";

const llm = {
  model: "google/gemini-3.5-flash",
  promptVersion: "2026-11-07.1",
  generationId: "gen-1",
};

describe("generation metadata never reaches a prompt", () => {
  it("withoutLlmMeta drops only the llm key", () => {
    expect(withoutLlmMeta({ markdown: "m", note: 1, llm })).toEqual({
      markdown: "m",
      note: 1,
    });
  });

  it("eventsWithoutLlmMeta strips payload.llm and keeps everything else", () => {
    const events = [
      { id: "e1", type: "plan", payload: { markdown: "plan", llm } },
      { id: "e2", type: "survey", payload: { statementIds: ["s1"] } },
      { id: "e3", type: "user_message", payload: null },
    ];
    expect(eventsWithoutLlmMeta(events)).toEqual([
      { id: "e1", type: "plan", payload: { markdown: "plan" } },
      { id: "e2", type: "survey", payload: { statementIds: ["s1"] } },
      { id: "e3", type: "user_message", payload: null },
    ]);
    expect(JSON.stringify(eventsWithoutLlmMeta(events))).not.toContain(
      "generationId",
    );
  });
});
