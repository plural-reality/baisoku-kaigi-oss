import { digest } from "./evaluate";
import type { Criterion } from "./types";

// Human review records written by the review GUI (eval/survey/review/) and read
// by `cli.ts score --run <dir>`. Pure functions only; file IO is in run-dir.ts.

export type Verdict = "pass" | "fail" | "unrated";
export type CriterionRating = Readonly<{
  id: string;
  verdict: Verdict;
  evidence: string;
}>;

// One judge's per-criterion verdicts on one output (case × model). Bound to the
// exact output and rubric through outputHash / rubricHash, as #379 requires.
export type JudgmentRecord = Readonly<{
  caseId: string;
  model: string;
  outputHash: string;
  rubricHash: string;
  judgeId: string;
  criteria: readonly CriterionRating[];
  note: string;
  updatedAt: string;
  // What the exception-first page recorded (flags, set-level answers,
  // confirmation); criteria above are derived from it. Absent in judgments
  // saved by the per-criterion page. The scorer reads criteria only.
  review?: unknown;
}>;

// Pairwise preference between the two outputs of one case. `winner` and
// `shownLeft` are de-blinded model ids; the page only ever sees A / B.
export type PreferenceRecord = Readonly<{
  caseId: string;
  judgeId: string;
  winner: string; // model id or "tie"
  shownLeft: string;
  reason: string;
  outputHashes: Readonly<Record<string, string>>;
  updatedAt: string;
  reasonTags?: readonly string[];
}>;

export const JUDGE_ID = /^[a-z0-9_-]{1,64}$/;
export const MAX_EVIDENCE = 2000;
export const MAX_NOTE = 5000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const VERDICTS: readonly string[] = ["pass", "fail", "unrated"];

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: readonly string[] };

// Validates what the page submits for one output. Pass and fail both need
// evidence: the scorer rejects a judgment with an empty evidence field, and a
// fail must name the statement (#n) or say why. Unrated may stay empty.
export const validateRatings = (
  criteria: readonly Criterion[],
  input: unknown,
): ValidationResult<readonly CriterionRating[]> => {
  const rows = Array.isArray(input) ? input : [];
  const errors = [
    ...(Array.isArray(input) ? [] : ["criteria must be an array"]),
    ...(rows.length === criteria.length
      ? []
      : [`expected ${criteria.length} criteria, got ${rows.length}`]),
    ...rows.flatMap((row, index): string[] =>
      !isRecord(row)
        ? [`criterion ${index} is not an object`]
        : row.id !== criteria[index]?.id
          ? [`criterion ${index} must be ${criteria[index]?.id}`]
          : !VERDICTS.includes(String(row.verdict))
            ? [`${row.id}: unknown verdict`]
            : typeof row.evidence !== "string" ||
                row.evidence.length > MAX_EVIDENCE
              ? [`${row.id}: evidence must be a string`]
              : row.verdict !== "unrated" && row.evidence.trim() === ""
                ? [`${row.id}: evidence required for ${row.verdict}`]
                : [],
    ),
  ];
  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        value: rows.map((row) => ({
          id: String(row.id),
          verdict: row.verdict as Verdict,
          evidence: String(row.evidence).trim(),
        })),
      };
};

export const ratingsComplete = (ratings: readonly CriterionRating[]) =>
  ratings.length > 0 && ratings.every((rating) => rating.verdict !== "unrated");

// A stored judgment counts only for the output and rubric it was made on.
export const judgmentBound = (
  judgment: JudgmentRecord,
  rawContent: string,
  criteria: readonly Criterion[],
) =>
  judgment.outputHash === digest(rawContent) &&
  judgment.rubricHash === digest(criteria);

export const isJudgmentRecord = (value: unknown): value is JudgmentRecord =>
  isRecord(value) &&
  typeof value.caseId === "string" &&
  typeof value.model === "string" &&
  typeof value.judgeId === "string" &&
  typeof value.outputHash === "string" &&
  typeof value.rubricHash === "string" &&
  Array.isArray(value.criteria);

// Flattens judge files and attaches each judgment to its response record in the
// shape scoreManifest expects. Hash binding is left to scoreManifest, so a stale
// judgment makes the entry unreviewed instead of silently disappearing.
export const attachJudgments = (
  responses: unknown,
  judgeFiles: readonly unknown[],
): unknown =>
  Array.isArray(responses)
    ? responses.map((response) => {
        const judgments = judgeFiles
          .flatMap((file) => (Array.isArray(file) ? file : []))
          .filter(isJudgmentRecord)
          .filter(
            (judgment) =>
              isRecord(response) &&
              judgment.caseId === response.caseId &&
              judgment.model === response.model,
          )
          .map(({ judgeId, outputHash, rubricHash, criteria }) => ({
            judgeId,
            outputHash,
            rubricHash,
            criteria,
          }));
        return isRecord(response) ? { ...response, judgments } : response;
      })
    : responses;

// Cohen's kappa for two raters over the same items. Null when there is nothing
// to compare or when chance agreement is already 1 (every rating identical).
export const cohenKappa = (
  pairs: readonly (readonly [string, string])[],
): number | null => {
  const n = pairs.length;
  const categories = [...new Set(pairs.flat())];
  const observed = pairs.filter(([a, b]) => a === b).length / n;
  const expected = categories.reduce(
    (sum, category) =>
      sum +
      (pairs.filter(([a]) => a === category).length / n) *
        (pairs.filter(([, b]) => b === category).length / n),
    0,
  );
  return n === 0 || expected === 1
    ? null
    : (observed - expected) / (1 - expected);
};

export type RatedItem = Readonly<{
  caseId: string;
  model: string;
  criterionId: string;
  verdicts: Readonly<Record<string, Verdict>>; // judgeId -> verdict
}>;

// Agreement per criterion id and per judge pair, over items both judges decided
// (unrated is excluded). Case-specific ids (case:*) pool across cases.
export const agreementByCriterion = (items: readonly RatedItem[]) => {
  const judges = [
    ...new Set(items.flatMap((item) => Object.keys(item.verdicts))),
  ].sort();
  const judgePairs = judges.flatMap((a, i) =>
    judges.slice(i + 1).map((b) => [a, b] as const),
  );
  const criterionIds = [...new Set(items.map((item) => item.criterionId))];
  return criterionIds.map((criterionId) => ({
    criterionId,
    pairs: judgePairs.map(([a, b]) => {
      const pairs = items
        .filter((item) => item.criterionId === criterionId)
        .map((item) => [item.verdicts[a], item.verdicts[b]] as const)
        .filter((pair): pair is readonly [Verdict, Verdict] =>
          pair.every((verdict) => verdict === "pass" || verdict === "fail"),
        );
      return {
        judges: [a, b],
        n: pairs.length,
        percentAgreement:
          pairs.length === 0
            ? null
            : pairs.filter(([x, y]) => x === y).length / pairs.length,
        kappa: cohenKappa(pairs),
      };
    }),
  }));
};

// Win / loss / tie per model across all bound preferences. winRate counts a tie
// as half a win.
export const preferenceStats = (
  models: readonly string[],
  preferences: readonly PreferenceRecord[],
) =>
  models.map((model) => {
    const relevant = preferences.filter(
      (preference) => model in preference.outputHashes,
    );
    const wins = relevant.filter((p) => p.winner === model).length;
    const ties = relevant.filter((p) => p.winner === "tie").length;
    const losses = relevant.length - wins - ties;
    return {
      model,
      n: relevant.length,
      wins,
      losses,
      ties,
      winRate:
        relevant.length === 0 ? null : (wins + ties / 2) / relevant.length,
    };
  });

// How often the output shown on the left (A) won. Far from 0.5 over many cases
// suggests a position bias rather than a quality difference.
export const positionBias = (preferences: readonly PreferenceRecord[]) => {
  const leftWins = preferences.filter((p) => p.winner === p.shownLeft).length;
  const ties = preferences.filter((p) => p.winner === "tie").length;
  const n = preferences.length;
  return {
    n,
    leftWins,
    rightWins: n - leftWins - ties,
    ties,
    leftWinRate: n === 0 ? null : (leftWins + ties / 2) / n,
  };
};

// Per case, do judges pick the same winner? Counted over every judge pair of
// every case that has preferences from two or more judges.
export const preferenceAgreement = (
  preferences: readonly PreferenceRecord[],
) => {
  const caseIds = [...new Set(preferences.map((p) => p.caseId))];
  const pairs = caseIds.flatMap((caseId) => {
    const mine = preferences.filter((p) => p.caseId === caseId);
    return mine.flatMap((a, i) =>
      mine.slice(i + 1).map((b) => ({ caseId, agree: a.winner === b.winner })),
    );
  });
  return {
    cases: new Set(pairs.map((pair) => pair.caseId)).size,
    pairs: pairs.length,
    agreements: pairs.filter((pair) => pair.agree).length,
    agreementRate:
      pairs.length === 0
        ? null
        : pairs.filter((pair) => pair.agree).length / pairs.length,
  };
};

export const isPreferenceRecord = (value: unknown): value is PreferenceRecord =>
  isRecord(value) &&
  typeof value.caseId === "string" &&
  typeof value.judgeId === "string" &&
  typeof value.winner === "string" &&
  isRecord(value.outputHashes);

// A preference counts only if both outputs it compared are unchanged.
export const preferenceBound = (
  preference: PreferenceRecord,
  currentHashes: Readonly<Record<string, string>>,
) =>
  Object.keys(currentHashes).length === 2 &&
  Object.keys(preference.outputHashes).length === 2 &&
  Object.entries(currentHashes).every(
    ([model, hash]) => preference.outputHashes[model] === hash,
  ) &&
  (preference.winner === "tie" || preference.winner in currentHashes);
