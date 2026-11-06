import { describe, expect, it } from "vitest";
import { buildSessionBrief, parseIndividualReportResponse } from "../llm";

describe("buildSessionBrief", () => {
  it("returns '(未設定)' when both goal and context are empty", () => {
    const result = buildSessionBrief(null, null);
    expect(result).toBe("## Goal\n(未設定)");
  });

  it("returns '(未設定)' when both are undefined", () => {
    const result = buildSessionBrief(undefined, undefined);
    expect(result).toBe("## Goal\n(未設定)");
  });

  it("returns '(未設定)' when both are whitespace-only strings", () => {
    const result = buildSessionBrief("  ", "   ");
    expect(result).toBe("## Goal\n(未設定)");
  });

  it("returns only Goal section when context is empty", () => {
    const result = buildSessionBrief("My goal", null);
    expect(result).toBe("## Goal\nMy goal");
    expect(result).not.toContain("Background");
  });

  it("returns only Background section when goal is empty", () => {
    const result = buildSessionBrief(null, "Some context");
    expect(result).toBe("## Background\nSome context");
    expect(result).not.toContain("Goal");
  });

  it("returns both sections when goal and context are provided", () => {
    const result = buildSessionBrief("My goal", "Some context");
    expect(result).toContain("## Goal\nMy goal");
    expect(result).toContain("## Background\nSome context");
    expect(result.indexOf("Goal")).toBeLessThan(result.indexOf("Background"));
  });

  it("separates sections with double newline", () => {
    const result = buildSessionBrief("Goal", "Context");
    expect(result).toBe("## Goal\nGoal\n\n## Background\nContext");
  });
});

describe("parseIndividualReportResponse", () => {
  it("returns the whole text as report and no questions when the delimiter is absent", () => {
    const result = parseIndividualReportResponse("# Report\n\nbody text");
    expect(result.reportMarkdown).toBe("# Report\n\nbody text");
    expect(result.deepDiveQuestions).toEqual([]);
  });

  it("splits report from the deep-dive question JSON", () => {
    const raw =
      '# Report\n\nbody\n===DEEPDIVE===\n[{"question":"A?","topic":"t1"},{"question":"B?","topic":"t2"}]';
    const result = parseIndividualReportResponse(raw);
    expect(result.reportMarkdown).toBe("# Report\n\nbody");
    expect(result.deepDiveQuestions).toEqual([
      { question: "A?", topic: "t1" },
      { question: "B?", topic: "t2" },
    ]);
  });

  it("extracts the JSON array even when wrapped in prose or code fences", () => {
    const raw =
      '# R\n===DEEPDIVE===\nはい:\n```json\n[{"question":"Q?","topic":"t"}]\n```';
    const result = parseIndividualReportResponse(raw);
    expect(result.deepDiveQuestions).toEqual([{ question: "Q?", topic: "t" }]);
  });

  it("returns empty questions when the JSON is malformed", () => {
    const result = parseIndividualReportResponse(
      "# R\n===DEEPDIVE===\nnot json at all",
    );
    expect(result.reportMarkdown).toBe("# R");
    expect(result.deepDiveQuestions).toEqual([]);
  });

  it("caps at 3 questions, drops entries without a question, and defaults topic", () => {
    const raw =
      '# R\n===DEEPDIVE===\n[{"question":"1"},{"topic":"x"},{"question":"2"},{"question":"3"},{"question":"4"}]';
    const result = parseIndividualReportResponse(raw);
    expect(result.deepDiveQuestions.map((q) => q.question)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(result.deepDiveQuestions.every((q) => q.topic === "")).toBe(true);
  });
});
