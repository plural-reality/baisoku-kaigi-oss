import { createHash } from "node:crypto";
import { digest, type ManifestEntry, structuralChecks } from "../evaluate";
import {
  type CriterionRating,
  isJudgmentRecord,
  isPreferenceRecord,
  type JudgmentRecord,
  judgmentBound,
  type PreferenceRecord,
  preferenceBound,
  ratingsComplete,
} from "../judgments";
import type { Criterion, SurveyCase } from "../types";
import {
  criteriaView,
  isConfirmedJudgment,
  type Mode,
  type Review,
  reviewFromRatings,
  sharedStatements,
  validateReview,
} from "./flow";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Server-side model of the review screen. The page receives only publicCase():
// slots A/B, never model ids, latency, usage or generation ids.

export type Slot = "A" | "B";
export const SLOTS: readonly Slot[] = ["A", "B"];

export type BlindOrder = Readonly<Record<string, readonly [string, string]>>;

const rank = (seed: string, key: string): string =>
  createHash("sha256").update(`${seed}\u0000${key}`).digest("hex");

// Which model is shown on the left (A) per case. The cases are ranked by a
// seeded hash and the first half puts models[0] on the left, the rest
// models[1], so each model is on the left exactly half the time (±1 for an odd
// count; the seed decides which model gets the extra case). Deterministic in
// the seed: stable for one judge, independent across judges.
export const balancedOrder = (
  seed: string,
  caseIds: readonly string[],
  models: readonly [string, string],
): BlindOrder => {
  const ranked = [...caseIds].sort((a, b) =>
    rank(seed, a).localeCompare(rank(seed, b)),
  );
  const extraFirst = Number.parseInt(rank(seed, "\u0000odd")[0], 16) % 2 === 0;
  const firstCount =
    Math.floor(caseIds.length / 2) +
    (caseIds.length % 2 === 1 && extraFirst ? 1 : 0);
  return Object.fromEntries(
    ranked.map((caseId, index) => [
      caseId,
      index < firstCount
        ? ([models[0], models[1]] as const)
        : ([models[1], models[0]] as const),
    ]),
  );
};

// Keeps every stored per-case order (a judge never sees a case flip sides) and
// assigns only cases the stored order lacks, balanced among themselves.
export const completeOrder = (
  stored: unknown,
  seed: string,
  caseIds: readonly string[],
  models: readonly [string, string],
): BlindOrder => {
  const valid = (value: unknown): value is readonly [string, string] =>
    Array.isArray(value) &&
    value.length === 2 &&
    [...value].sort().join("\u0000") === [...models].sort().join("\u0000");
  const kept = Object.fromEntries(
    Object.entries(isRecord(stored) ? stored : {}).filter(
      ([caseId, order]) => caseIds.includes(caseId) && valid(order),
    ),
  ) as BlindOrder;
  const missing = caseIds.filter((caseId) => !(caseId in kept));
  return { ...kept, ...balancedOrder(seed, missing, models) };
};

export const slotOf = (
  order: readonly [string, string],
  model: string,
): Slot | undefined =>
  order[0] === model ? "A" : order[1] === model ? "B" : undefined;

export type RunInput = Readonly<{
  cases: readonly SurveyCase[];
  entries: readonly ManifestEntry[];
  responses: unknown;
}>;

const responseOf = (responses: unknown, entry: ManifestEntry) => {
  const matches = (Array.isArray(responses) ? responses : []).filter(
    (response) =>
      isRecord(response) &&
      response.caseId === entry.caseId &&
      response.model === entry.options.model,
  );
  return {
    issue:
      matches.length === 0
        ? ("missing" as const)
        : matches.length > 1
          ? ("duplicate" as const)
          : null,
    record: matches.length === 1 ? (matches[0] as Record<string, unknown>) : {},
  };
};

const existingStatements = (context: string): string[] =>
  [
    ...context.matchAll(
      /<existing_statements>([\s\S]*?)<\/existing_statements>/g,
    ),
  ]
    .flatMap((match) => match[1].split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export type OutputState = Readonly<{
  slot: Slot;
  model: string;
  rawContent: string;
  outputHash: string;
  rubricHash: string;
  recordIssue: "missing" | "duplicate" | null;
  httpStatus: number | null;
  errorCode: string | null;
  judgeable: boolean;
  checks: ReturnType<typeof structuralChecks> & { httpSuccess: boolean };
  judgment: JudgmentRecord | null;
  staleJudgment: boolean;
}>;

export type CaseState = Readonly<{
  index: number;
  item: SurveyCase;
  criteria: readonly Criterion[];
  outputs: readonly OutputState[];
  preference: PreferenceRecord | null;
  stalePreference: boolean;
}>;

export const buildCaseStates = (
  run: RunInput,
  order: BlindOrder,
  judgeId: string,
  judgments: unknown,
  preferences: unknown,
): CaseState[] => {
  const mine = (Array.isArray(judgments) ? judgments : [])
    .filter(isJudgmentRecord)
    .filter((judgment) => judgment.judgeId === judgeId);
  const prefs = (Array.isArray(preferences) ? preferences : [])
    .filter(isPreferenceRecord)
    .filter((preference) => preference.judgeId === judgeId);
  return run.cases.map((item, index) => {
    const entries = run.entries.filter((entry) => entry.caseId === item.id);
    const models = entries.map((entry) => entry.options.model);
    const caseOrder = order[item.id];
    if (!caseOrder || !models.every((m) => caseOrder.includes(m))) {
      throw new Error(`no blinding order for ${item.id}`);
    }
    const outputs = caseOrder.map((model, position): OutputState => {
      const entry = entries.find((e) => e.options.model === model);
      if (!entry) throw new Error(`no manifest entry for ${item.id} ${model}`);
      const { issue, record } = responseOf(run.responses, entry);
      const rawContent =
        typeof record.rawContent === "string" ? record.rawContent : "";
      const httpStatus =
        typeof record.httpStatus === "number" ? record.httpStatus : null;
      const httpSuccess =
        httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
      const stored = mine.find(
        (judgment) => judgment.caseId === item.id && judgment.model === model,
      );
      const bound =
        stored !== undefined &&
        judgmentBound(stored, rawContent, entry.criteria);
      return {
        slot: SLOTS[position],
        model,
        rawContent,
        outputHash: digest(rawContent),
        rubricHash: digest(entry.criteria),
        recordIssue: issue,
        httpStatus,
        errorCode:
          typeof record.errorCode === "string" ? record.errorCode : null,
        judgeable: issue === null && rawContent.trim().length > 0,
        checks: { ...structuralChecks(rawContent), httpSuccess },
        judgment: bound ? stored : null,
        staleJudgment: stored !== undefined && !bound,
      };
    });
    const hashes = Object.fromEntries(
      outputs
        .filter((output) => output.judgeable)
        .map((output) => [output.model, output.outputHash]),
    );
    const storedPreference = prefs.find((p) => p.caseId === item.id);
    const preferenceValid =
      storedPreference !== undefined &&
      preferenceBound(storedPreference, hashes);
    return {
      index,
      item,
      criteria: entries[0].criteria,
      outputs,
      preference: preferenceValid ? storedPreference : null,
      stalePreference: storedPreference !== undefined && !preferenceValid,
    };
  });
};

export const needsPreference = (state: CaseState) =>
  state.outputs.every((output) => output.judgeable);

// Complete (しっかり / full) = every judgeable output has a pass/fail on every
// criterion, and a preference when both outputs can be compared. 保留
// (unrated) keeps it open. かんたん / quick = the preference alone.
export const caseComplete = (state: CaseState) =>
  state.outputs.every(
    (output) =>
      !output.judgeable ||
      (output.judgment !== null && ratingsComplete(output.judgment.criteria)),
  ) &&
  (!needsPreference(state) || state.preference !== null);

export const caseCompleteQuick = (state: CaseState) =>
  !needsPreference(state) || state.preference !== null;

export const caseCompleteIn = (mode: Mode, state: CaseState) =>
  mode === "quick" ? caseCompleteQuick(state) : caseComplete(state);

const statementCount = (output: OutputState): number | null =>
  output.checks.statements?.length ?? null;

// The review behind a stored judgment: the recorded one, or one rebuilt from
// the per-criterion ratings of the earlier page.
export const reviewOf = (
  state: CaseState,
  output: OutputState,
): Review | null => {
  if (output.judgment === null) return null;
  const stored = validateReview(
    state.criteria,
    statementCount(output),
    output.judgment.review,
  );
  return stored.ok ? stored.value : reviewFromRatings(output.judgment.criteria);
};

const winnerSlot = (state: CaseState): Slot | "tie" | null =>
  state.preference === null
    ? null
    : state.preference.winner === "tie"
      ? "tie"
      : (state.outputs.find((o) => o.model === state.preference?.winner)
          ?.slot ?? null);

export const publicCase = (state: CaseState) => ({
  caseId: state.item.id,
  index: state.index,
  tags: state.item.tags,
  input: {
    sessionTitle: state.item.input.sessionTitle,
    sessionGoal: state.item.input.sessionGoal,
    initialContext: state.item.input.initialContext,
    eventThreadContext: state.item.input.eventThreadContext,
    existingStatements: existingStatements(state.item.input.eventThreadContext),
    participantCount: state.item.input.participantCount ?? null,
  },
  acceptableExample: state.item.acceptableExample,
  failureExample: {
    statement: state.item.failureExample.statement,
    violates: state.item.failureExample.violates.map((id) => `case:${id}`),
  },
  criteria: state.criteria,
  criteriaView: criteriaView(state.criteria),
  outputs: state.outputs.map((output, position) => ({
    slot: output.slot,
    recordIssue: output.recordIssue,
    httpStatus: output.httpStatus,
    errorCode: output.errorCode,
    judgeable: output.judgeable,
    rawContent: output.rawContent,
    statements: output.checks.statements,
    checks: {
      httpSuccess: output.checks.httpSuccess,
      structuredAccepted: output.checks.structuredAccepted,
      parserAccepted: output.checks.parserAccepted,
      runtimeAccepted: output.checks.runtimeAccepted,
      exactCount: output.checks.exactCount,
      structure: output.checks.structure,
    },
    shared: sharedOf(state)[position === 0 ? "a" : "b"],
    judgment:
      output.judgment === null
        ? null
        : {
            criteria: output.judgment.criteria,
            note: output.judgment.note,
            updatedAt: output.judgment.updatedAt,
            review: reviewOf(state, output),
          },
    staleJudgment: output.staleJudgment,
  })),
  needsPreference: needsPreference(state),
  preference: {
    winner: winnerSlot(state),
    reason: state.preference?.reason ?? "",
    reasonTags: state.preference?.reasonTags ?? [],
    updatedAt: state.preference?.updatedAt ?? null,
    stale: state.stalePreference,
  },
  complete: caseComplete(state),
  completeQuick: caseCompleteQuick(state),
});

const sharedOf = (state: CaseState) =>
  sharedStatements(
    state.outputs[0]?.checks.statements ?? null,
    state.outputs[1]?.checks.statements ?? null,
  );

export const judgmentRecord = (
  state: CaseState,
  output: OutputState,
  judgeId: string,
  criteria: readonly CriterionRating[],
  note: string,
  now: string,
  review?: Review,
): JudgmentRecord => ({
  caseId: state.item.id,
  model: output.model,
  outputHash: output.outputHash,
  rubricHash: output.rubricHash,
  judgeId,
  criteria,
  note,
  updatedAt: now,
  ...(review ? { review } : {}),
});

export const preferenceRecord = (
  state: CaseState,
  judgeId: string,
  winner: Slot | "tie",
  reason: string,
  now: string,
  reasonTags: readonly string[] = [],
): PreferenceRecord => ({
  caseId: state.item.id,
  judgeId,
  winner:
    winner === "tie"
      ? "tie"
      : (state.outputs.find((o) => o.slot === winner)?.model ?? "tie"),
  shownLeft: state.outputs[0].model,
  reason,
  outputHashes: Object.fromEntries(
    state.outputs.map((output) => [output.model, output.outputHash]),
  ),
  updatedAt: now,
  ...(reasonTags.length > 0 ? { reasonTags } : {}),
});

// Quick reasons offered next to the preference buttons.
export const REASON_TAGS: readonly string[] = [
  "論点が広い",
  "表現が中立",
  "重複が少ない",
  "具体的",
];

// Replace this judge's record for the same key, keep everything else.
export const upsert = <T extends { caseId: string }>(
  records: readonly T[],
  next: T,
  sameKey: (a: T, b: T) => boolean,
): T[] => [...records.filter((record) => !sameKey(record, next)), next];

// This judge's own numbers, de-blinded. Served only once every case is
// complete so the totals cannot anchor the remaining judgments.
export const judgeSummary = (states: readonly CaseState[]) => {
  const models = [
    ...new Set(states.flatMap((s) => s.outputs.map((o) => o.model))),
  ].sort();
  const criterionIds = [
    ...new Set(states.flatMap((s) => s.criteria.map((c) => c.id))),
  ];
  // Only confirmed reviews (and judgments from the per-criterion page) count;
  // optional flags left in かんたん mode would read as fail-only records.
  const judged = (model: string) =>
    states.flatMap((s) =>
      s.outputs.filter(
        (o) =>
          o.model === model &&
          o.judgment !== null &&
          isConfirmedJudgment(o.judgment),
      ),
    );
  const quickFlags = states.flatMap((s) =>
    s.outputs.filter(
      (o) => o.judgment !== null && !isConfirmedJudgment(o.judgment),
    ),
  );
  return {
    models,
    unconfirmedJudgments: quickFlags.length,
    criteria: criterionIds.map((criterionId) => ({
      criterionId,
      byModel: models.map((model) => {
        const verdicts = judged(model).flatMap(
          (output) =>
            output.judgment?.criteria
              .filter((rating) => rating.id === criterionId)
              .map((rating) => rating.verdict) ?? [],
        );
        const decided = verdicts.filter((v) => v !== "unrated");
        return {
          model,
          pass: decided.filter((v) => v === "pass").length,
          decided: decided.length,
          passRate:
            decided.length === 0
              ? null
              : decided.filter((v) => v === "pass").length / decided.length,
        };
      }),
    })),
    outputsAllPass: models.map((model) => ({
      model,
      allPass: judged(model).filter((output) =>
        output.judgment?.criteria.every((rating) => rating.verdict === "pass"),
      ).length,
      judged: judged(model).length,
      notJudgeable: states.flatMap((s) =>
        s.outputs.filter((o) => o.model === model && !o.judgeable),
      ).length,
    })),
    preferences: {
      wins: models.map((model) => ({
        model,
        wins: states.filter((s) => s.preference?.winner === model).length,
      })),
      ties: states.filter((s) => s.preference?.winner === "tie").length,
    },
  };
};
