// Single source of truth for the OpenRouter model IDs used by the web app
// (app/) and the Ptolemy agent (agents/). Kept dependency-free on purpose:
// flake.nix copies this file into the deployed agent package next to
// content-language.ts, so it must not import anything from app/.

const fromEnv = (name: string, fallback: string): string => {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
};

// Env overrides let staging try another model without a code change; the
// defaults are what production runs. Resolved once at module load.
export const FAST_MODEL = fromEnv("LLM_FAST_MODEL", "google/gemini-3.5-flash");
export const ACCURATE_MODEL = fromEnv(
  "LLM_ACCURATE_MODEL",
  "google/gemini-3.1-pro-preview",
);

// One entry per prompt. Bump the entry whenever that prompt's wording changes,
// so stored outputs (individual_reports, session_reports, events.payload,
// llm_cache) can be told apart by the prompt that produced them.
// Format: <date>.<n>.
export const PROMPT_VERSIONS = {
  plan: "2026-11-07.1",
  surveyStatements: "2026-11-07.1",
  surveyAnalysis: "2026-11-07.1",
  individualReport: "2026-11-07.1",
  sessionReport: "2026-11-07.1",
  reportMapNarrative: "2026-11-07.1",
  stance: "2026-11-07.1",
  suggestions: "2026-11-07.1",
  formSuggestions: "2026-11-07.1",
  extractText: "2026-11-07.1",
} as const;

export type PromptName = keyof typeof PROMPT_VERSIONS;

// What one completed LLM call tells us about itself; stored next to its output.
// `model` is the slug OpenRouter resolved (not the one we asked for, which may
// be an env override or an alias); `generationId` is OpenRouter's response id
// and can be looked up in its dashboard. Both are null when a local CLI backend
// answered instead.
export type LLMGenerationMeta = {
  readonly model: string;
  readonly promptVersion: string;
  readonly generationId: string | null;
};

// The three columns every table that stores an LLM output carries. Nulls when
// the metadata is missing (older code paths, test doubles) rather than failing
// the write: the output itself is what the user is waiting for.
export const llmGenerationColumns = (
  meta: LLMGenerationMeta | null | undefined,
): {
  model: string | null;
  prompt_version: string | null;
  generation_id: string | null;
} => ({
  model: meta?.model ?? null,
  prompt_version: meta?.promptVersion ?? null,
  generation_id: meta?.generationId ?? null,
});

// Generation metadata stored under events.payload.llm is for audit only. It must
// never reach a prompt: strip it whenever event payloads are serialised into LLM
// input, so adding telemetry does not change what the model sees.
export const withoutLlmMeta = <T extends Record<string, unknown>>(
  payload: T,
): Omit<T, "llm"> => {
  const { llm: _llm, ...rest } = payload;
  return rest;
};

export const eventsWithoutLlmMeta = <E extends { payload?: unknown }>(
  events: readonly E[] | null | undefined,
): E[] =>
  (events ?? []).map((event) =>
    event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
      ? {
          ...event,
          payload: withoutLlmMeta(event.payload as Record<string, unknown>),
        }
      : event,
  );
