export type SurveyValidation =
  | { ok: true; statements: string[] }
  | { ok: false; reason: "not_string_array" | "empty" | "blank" | "duplicate" };

// Runtime accepts shorter useful batches; the caller retains its existing cap
// of 15. Validate the entire response before any trimming to that cap or writes.
export const validateSurveyStatements = (value: unknown): SurveyValidation => {
  const strings =
    Array.isArray(value) && value.every((item) => typeof item === "string")
      ? (value as string[]).map((item) => item.trim())
      : undefined;
  return strings === undefined
    ? { ok: false, reason: "not_string_array" }
    : strings.length === 0
      ? { ok: false, reason: "empty" }
      : strings.some((item) => item.length === 0)
        ? { ok: false, reason: "blank" }
        : new Set(strings).size !== strings.length
          ? { ok: false, reason: "duplicate" }
          : { ok: true, statements: strings };
};
