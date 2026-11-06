import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractJsonArray,
  generatePlanMarkdown,
  generateSingleSurveyStatement,
  generateSurveyStatements,
} from "../llm";
import { __resetLLMLimiter } from "../llm-limiter";
import { validateSurveyStatements } from "../survey-validation";
import inputs from "./fixtures/survey-statements.json";

const requestAt = (index: number) =>
  vi.mocked(axios.post).mock.calls[index][1] as {
    model: string;
    messages: { content: string }[];
    reasoning?: { effort?: string; max_tokens?: number };
  };

const statements = Array.from(
  { length: 15 },
  (_, i) => `合成の賛否文${i + 1}。`,
);
const reply = (content: string) => ({
  status: 200,
  data: { choices: [{ message: { content } }] },
});
const structureAccepts = (parsed: string[] | null) =>
  parsed !== null &&
  parsed.length === 15 &&
  parsed.every((text) => text.trim().length > 0) &&
  new Set(parsed.map((text) => text.trim())).size === 15;

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-test-key");
  vi.stubEnv("LLM_PROVIDER", "");
  vi.stubEnv("SURVEY_STATEMENTS_MODEL", "");
  vi.stubEnv("LLM_DAILY_BUDGET_USD", "1000");
  vi.stubEnv("LLM_RATE_LIMIT_PER_MIN", "1000");
  __resetLLMLimiter();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(axios, "post").mockResolvedValue(reply(JSON.stringify(statements)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  __resetLLMLimiter();
});

describe("batch model routing through the actual agent LLM entry point", () => {
  it.each([
    "",
    "google/gemini-3.5-flash",
    "typo",
  ])("keeps the baseline for %j", async (setting) => {
    vi.stubEnv("SURVEY_STATEMENTS_MODEL", setting);
    await expect(generateSurveyStatements(inputs[0])).resolves.toEqual(
      statements,
    );
    expect(axios.post).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        model: "google/gemini-3.5-flash",
        temperature: 0.7,
        reasoning: { max_tokens: 1 },
      }),
      expect.objectContaining({ timeout: 45000 }),
    );
  });

  it.each(
    inputs,
  )("opts in with OpenRouter effort: $sessionTitle", async (input) => {
    vi.stubEnv("SURVEY_STATEMENTS_MODEL", "google/gemini-3.8-flash");
    await expect(generateSurveyStatements(input)).resolves.toEqual(statements);
    const body = requestAt(0);
    expect(body).toMatchObject({
      model: "google/gemini-3.8-flash",
      temperature: 0.7,
      reasoning: { effort: "low" },
    });
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body).not.toHaveProperty("thinkingConfig");
    // messages[0] is the fixed untrusted-data system guard (audit H1); the
    // prompt itself is the user message.
    expect(body.messages[0].content).toContain("untrusted_data");
    expect(body.messages[1].content).toContain(input.sessionTitle);
    expect(body.messages[1].content).toContain("15個");
  });

  it("restores the same request when the candidate setting is removed", () =>
    generateSurveyStatements(inputs[0])
      .then(() => {
        vi.stubEnv("SURVEY_STATEMENTS_MODEL", "google/gemini-3.8-flash");
        return generateSurveyStatements(inputs[0]);
      })
      .then(() => {
        vi.stubEnv("SURVEY_STATEMENTS_MODEL", undefined);
        return generateSurveyStatements(inputs[0]);
      })
      .then(() => {
        const calls = vi.mocked(axios.post).mock.calls;
        expect(calls[2]).toEqual(calls[0]);
        expect(requestAt(1).messages).toEqual(requestAt(0).messages);
      }));

  it("does not change single-statement or plan models", () => {
    vi.stubEnv("SURVEY_STATEMENTS_MODEL", "google/gemini-3.8-flash");
    return generateSingleSurveyStatement(inputs[0])
      .then(() => generatePlanMarkdown(inputs[0]))
      .then(() => {
        const calls = vi.mocked(axios.post).mock.calls;
        expect(calls[0][1]).toMatchObject({
          model: "google/gemini-3.5-flash",
          reasoning: { max_tokens: 1 },
        });
        expect(requestAt(1).model).toBe("google/gemini-3.1-pro-preview");
        expect(calls[1][1]).not.toHaveProperty("reasoning");
      });
  });
});

describe.each([
  "",
  "google/gemini-3.8-flash",
])("HTTP, parser and independent structural acceptance (%j, mocked responses)", (setting) => {
  it.each([
    ["JSON", JSON.stringify(statements), true, true],
    [
      "fenced JSON",
      `\`\`\`json\n${JSON.stringify(statements)}\n\`\`\``,
      true,
      true,
    ],
    ["bullets", statements.map((s) => `- ${s}`).join("\n"), true, true],
    ["empty array", "[]", true, false],
    [
      "empty element",
      JSON.stringify(["", ...statements.slice(1)]),
      true,
      false,
    ],
    ["duplicates", JSON.stringify(Array(15).fill("同じ文。")), true, false],
    ["14 items", JSON.stringify(statements.slice(1)), true, false],
    ["number", '[1, "文"]', false, false],
    ["empty content", "", false, false],
  ])("%s", async (_name, content, parserAccepted, structurallyAccepted) => {
    vi.stubEnv("SURVEY_STATEMENTS_MODEL", setting);
    vi.mocked(axios.post).mockResolvedValue(reply(content as string));
    const parsed = extractJsonArray(content as string);
    expect(parsed !== null).toBe(parserAccepted);
    expect(structureAccepts(parsed)).toBe(structurallyAccepted);
    const result = generateSurveyStatements(inputs[0]);
    await (validateSurveyStatements(parsed).ok
      ? expect(result).resolves.toEqual(parsed)
      : expect(result).rejects.toThrow("Survey statement generation failed"));
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("propagates a transport failure without silently switching models", async () => {
    vi.stubEnv("SURVEY_STATEMENTS_MODEL", setting);
    vi.mocked(axios.post).mockRejectedValue(new Error("synthetic failure"));
    await expect(generateSurveyStatements(inputs[0])).rejects.toThrow(
      "Survey statement generation failed",
    );
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
