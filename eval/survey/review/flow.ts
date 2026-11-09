import type { CriterionRating, ValidationResult, Verdict } from "../judgments";
import type { Criterion } from "../types";

// Exception-first review. The judge states only what is wrong (flags on
// statements, "not met" on set-level questions) and then confirms the output;
// deriveRatings turns that into the per-criterion pass/fail/unrated records
// the #379 scorer reads, so the on-disk judgment format does not change.

export type Scope = "statement" | "set";

// Shared criteria that are judged per statement, with plain-Japanese labels for
// the flag chips. Everything else common (diverse) is a set-level question.
const STATEMENT_LABELS: Readonly<Record<string, string>> = {
  "yes-no": "賛否で答えにくい",
  standalone: "意味があいまい",
  grounded: "入力にない事実を前提",
  neutral: "誘導・決めつけ",
  novelty: "重複",
};
// Short chip labels for the case-specific forbidden rules in ja-survey-v1.
// Unknown ids fall back to a label cut from the rule text.
const CASE_LABELS: Readonly<Record<string, string>> = {
  "case:unknown": "未調査を確定扱い",
  "case:novel": "既存質問の言い換え",
  "case:unsupported": "事実・合意を確定扱い",
};

export const criterionScope = (criterion: Criterion): Scope =>
  criterion.id in STATEMENT_LABELS ||
  (criterion.id.startsWith("case:") && criterion.kind === "forbidden")
    ? "statement"
    : "set";

export const labelFromRule = (rule: string): string => {
  const core = rule
    .replace(/(を)?(前提にし|出さ|使わ|含め|し|扱わ|結合し|断定し)ない$/u, "")
    .replace(/[。、]$/u, "");
  return core.length > 14 ? `${core.slice(0, 13)}…` : core;
};

export const criterionLabel = (criterion: Criterion): string =>
  STATEMENT_LABELS[criterion.id] ??
  CASE_LABELS[criterion.id] ??
  labelFromRule(criterion.rule);

export const criteriaView = (criteria: readonly Criterion[]) =>
  criteria.map((criterion) => ({
    ...criterion,
    scope: criterionScope(criterion),
    label: criterionLabel(criterion),
    caseSpecific: criterion.id.startsWith("case:"),
  }));

export type Flag = Readonly<{
  statement: number; // 1-based
  criteria: readonly string[];
  comment: string;
}>;
export type SetAnswer = Readonly<{ met: boolean; reason: string }>;
export type Override = Readonly<{ verdict: Verdict; evidence: string }>;
export type Review = Readonly<{
  flags: readonly Flag[];
  set: Readonly<Record<string, SetAnswer>>;
  confirmed: boolean;
  overrides: Readonly<Record<string, Override>>;
}>;

export const emptyReview: Review = {
  flags: [],
  set: {},
  confirmed: false,
  overrides: {},
};

export const defaultEvidence = (
  criterion: Criterion,
  statementCount: number | null,
): string => {
  const scope = statementCount === null ? "全文" : `${statementCount}文`;
  return criterion.kind === "forbidden"
    ? `${scope}を確認し該当なし`
    : `${scope}を確認し満たす`;
};
const notMet = (statementCount: number | null): string =>
  `${statementCount === null ? "全文" : `${statementCount}文`}全体として満たさない`;

// flags / set answers > explicit overrides > confirm (unrated → pass).
// Confirm never overwrites a fail and fills only criteria the judge has not
// decided: an explicit 保留 (override verdict unrated) stays unrated with its
// evidence, so confirming never turns a deliberate hold into 合格.
export const deriveRatings = (
  criteria: readonly Criterion[],
  review: Review,
  statementCount: number | null,
): CriterionRating[] =>
  criteria.map((criterion) => {
    const flagged = review.flags.filter((flag) =>
      flag.criteria.includes(criterion.id),
    );
    const answer = review.set[criterion.id];
    const override = review.overrides[criterion.id];
    const fromFlags: CriterionRating | null =
      criterionScope(criterion) === "statement" && flagged.length > 0
        ? {
            id: criterion.id,
            verdict: "fail",
            evidence: [...flagged]
              .sort((a, b) => a.statement - b.statement)
              .map((flag) =>
                flag.comment.trim()
                  ? `#${flag.statement} ${flag.comment.trim()}`
                  : `#${flag.statement}`,
              )
              .join("、"),
          }
        : null;
    const fromSet: CriterionRating | null =
      criterionScope(criterion) !== "set" || !answer
        ? null
        : answer.met
          ? {
              id: criterion.id,
              verdict: "pass",
              evidence:
                answer.reason.trim() ||
                defaultEvidence(criterion, statementCount),
            }
          : {
              id: criterion.id,
              verdict: "fail",
              evidence: answer.reason.trim() || notMet(statementCount),
            };
    const decided: CriterionRating =
      fromFlags ??
      fromSet ??
      (override
        ? {
            id: criterion.id,
            verdict: override.verdict,
            evidence: override.evidence,
          }
        : { id: criterion.id, verdict: "unrated", evidence: "" });
    return review.confirmed && decided.verdict === "unrated" && !override
      ? {
          id: criterion.id,
          verdict: "pass",
          evidence: defaultEvidence(criterion, statementCount),
        }
      : decided;
  });

// A judgment saved by the per-criterion UI (no review field). Every rating the
// judge set becomes an override with its evidence unchanged, so deriving gives
// the stored ratings back byte for byte. An unrated rating with evidence (a
// 保留 such as 「判断保留」) is a deliberate hold and is kept; an unrated one
// without evidence was never touched and stays open (未確認).
export const reviewFromRatings = (
  ratings: readonly CriterionRating[],
): Review => ({
  ...emptyReview,
  overrides: Object.fromEntries(
    ratings
      .filter(
        (rating) => rating.verdict !== "unrated" || rating.evidence !== "",
      )
      .map((rating) => [
        rating.id,
        { verdict: rating.verdict, evidence: rating.evidence },
      ]),
  ),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const VERDICTS: readonly string[] = ["pass", "fail", "unrated"];
const MAX_TEXT = 2000;

export const validateReview = (
  criteria: readonly Criterion[],
  statementCount: number | null,
  input: unknown,
): ValidationResult<Review> => {
  if (!isRecord(input))
    return { ok: false, errors: ["review must be an object"] };
  const ids = new Set(criteria.map((c) => c.id));
  const statementIds = new Set(
    criteria.filter((c) => criterionScope(c) === "statement").map((c) => c.id),
  );
  const setIds = new Set(
    criteria.filter((c) => criterionScope(c) === "set").map((c) => c.id),
  );
  const flags = Array.isArray(input.flags) ? input.flags : [];
  const set = isRecord(input.set) ? input.set : {};
  const overrides = isRecord(input.overrides) ? input.overrides : {};
  const text = (value: unknown) =>
    typeof value === "string" && value.length <= MAX_TEXT;
  const errors = [
    ...(Array.isArray(input.flags) ? [] : ["flags must be an array"]),
    ...(typeof input.confirmed === "boolean"
      ? []
      : ["confirmed must be boolean"]),
    ...flags.flatMap((flag, index): string[] =>
      !isRecord(flag) ||
      !Number.isInteger(flag.statement) ||
      (flag.statement as number) < 1 ||
      (statementCount !== null &&
        (flag.statement as number) > statementCount) ||
      statementCount === null
        ? [`flag ${index}: bad statement number`]
        : !Array.isArray(flag.criteria) ||
            flag.criteria.length === 0 ||
            !flag.criteria.every(
              (id) => typeof id === "string" && statementIds.has(id),
            )
          ? [`flag ${index}: criteria must be statement-level ids`]
          : !text(flag.comment)
            ? [`flag ${index}: bad comment`]
            : [],
    ),
    ...(new Set(flags.map((f) => (isRecord(f) ? f.statement : null))).size ===
    flags.length
      ? []
      : ["one flag per statement"]),
    ...Object.entries(set).flatMap(([id, answer]): string[] =>
      !setIds.has(id)
        ? [`set ${id}: not a set-level criterion`]
        : !isRecord(answer) ||
            typeof answer.met !== "boolean" ||
            !text(answer.reason)
          ? [`set ${id}: bad answer`]
          : [],
    ),
    ...Object.entries(overrides).flatMap(([id, override]): string[] =>
      !ids.has(id)
        ? [`override ${id}: unknown criterion`]
        : !isRecord(override) ||
            !VERDICTS.includes(String(override.verdict)) ||
            !text(override.evidence)
          ? [`override ${id}: bad override`]
          : override.verdict !== "unrated" &&
              String(override.evidence).trim() === ""
            ? [`${id}: evidence required for ${override.verdict}`]
            : [],
    ),
  ];
  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          flags: flags.map((flag) => ({
            statement: Number(flag.statement),
            criteria: [...new Set(flag.criteria as string[])],
            comment: String(flag.comment ?? ""),
          })),
          set: Object.fromEntries(
            Object.entries(set).map(([id, answer]) => [
              id,
              {
                met: Boolean((answer as Record<string, unknown>).met),
                reason: String((answer as Record<string, unknown>).reason),
              },
            ]),
          ),
          confirmed: input.confirmed as boolean,
          overrides: Object.fromEntries(
            Object.entries(overrides).map(([id, override]) => [
              id,
              {
                verdict: (override as Record<string, unknown>)
                  .verdict as Verdict,
                evidence: String(
                  (override as Record<string, unknown>).evidence,
                ),
              },
            ]),
          ),
        },
      };
};

// Near-duplicate detection between the two outputs, so the judge can skip
// statements both models produced. Character-bigram Dice coefficient on text
// normalised for width, case, spaces and punctuation.
export const normalizeStatement = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");

const bigrams = (text: string): string[] =>
  text.length < 2
    ? [text]
    : Array.from({ length: text.length - 1 }, (_, i) => text.slice(i, i + 2));

export const similarity = (a: string, b: string): number => {
  const x = bigrams(normalizeStatement(a));
  const y = bigrams(normalizeStatement(b));
  const pool = new Map<string, number>();
  y.forEach((gram) => {
    pool.set(gram, (pool.get(gram) ?? 0) + 1);
  });
  const overlap = x.filter((gram) => {
    const left = pool.get(gram) ?? 0;
    if (left > 0) pool.set(gram, left - 1);
    return left > 0;
  }).length;
  return x.length + y.length === 0 ? 1 : (2 * overlap) / (x.length + y.length);
};

// 0.9 rather than 0.8: 「…すべきである」 and 「…すべきではない」 already reach
// 0.88. Statements whose polarity markers differ are never shared, however
// similar the rest of the text is.
export const SHARED_THRESHOLD = 0.9;

const POLARITY_MARKERS = [
  "ない",
  "ず",
  "反対",
  "不",
  "非",
  "無",
  "禁止",
  "廃止",
  "やめ",
  "賛成",
  "推進",
  "支持",
] as const;

export const polarity = (text: string): string =>
  POLARITY_MARKERS.filter((marker) =>
    normalizeStatement(text).includes(marker),
  ).join("|");

// 「20時まで」 and 「21時まで」 are different claims even when the rest matches.
const numbers = (text: string): string =>
  (text.normalize("NFKC").match(/\d+/g) ?? []).join(",");

export const nearDuplicate = (
  a: string,
  b: string,
  threshold: number = SHARED_THRESHOLD,
): boolean =>
  polarity(a) === polarity(b) &&
  numbers(a) === numbers(b) &&
  similarity(a, b) >= threshold;

export const sharedStatements = (
  a: readonly string[] | null,
  b: readonly string[] | null,
  threshold: number = SHARED_THRESHOLD,
) => {
  const mark = (xs: readonly string[] | null, ys: readonly string[] | null) =>
    (xs ?? []).map((x) =>
      (ys ?? []).some((y) => nearDuplicate(x, y, threshold)),
    );
  return { a: mark(a, b), b: mark(b, a) };
};

// Whether a judgment counts as a semantic judgment (per-criterion pass rates,
// inter-judge agreement): a review the judge confirmed, or a judgment from the
// earlier per-criterion page. Unconfirmed reviews (e.g. optional flags in
// かんたん mode) are counted separately.
export const isConfirmedJudgment = (judgment: { review?: unknown }): boolean =>
  judgment.review === undefined ||
  (typeof judgment.review === "object" &&
    judgment.review !== null &&
    (judgment.review as Record<string, unknown>).confirmed === true);

export type Mode = "quick" | "full";
export const MODES: readonly Mode[] = ["quick", "full"];
