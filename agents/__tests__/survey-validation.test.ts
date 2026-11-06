import { describe, expect, it } from "vitest";
import { validateSurveyStatements } from "../survey-validation";

describe("survey validation before persistence", () => {
  it.each([
    1, 14, 15, 16,
  ])("accepts %i unique nonblank statements without imposing an exact count", (count) => {
    const statements = Array.from(
      { length: count },
      (_, index) => `文${index}`,
    );
    expect(validateSurveyStatements(statements)).toEqual({
      ok: true,
      statements,
    });
  });
  it.each([
    [[], "empty"],
    [[""], "blank"],
    [[" \n　"], "blank"],
    [["文", " 文　"], "duplicate"],
    [["文", 1], "not_string_array"],
    [undefined, "not_string_array"],
  ])("rejects %j as a whole", (value, reason) => {
    expect(validateSurveyStatements(value)).toEqual({ ok: false, reason });
  });
  it("trims accepted text without changing the source array", () => {
    const source = Object.freeze([" 文A ", "　文B"]);
    expect(validateSurveyStatements(source)).toEqual({
      ok: true,
      statements: ["文A", "文B"],
    });
    expect(source).toEqual([" 文A ", "　文B"]);
  });
});
