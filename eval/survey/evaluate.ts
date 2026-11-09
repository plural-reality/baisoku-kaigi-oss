import { createHash } from "node:crypto";
import {
  buildSurveyStatementsPrompt,
  openRouterRequestBody,
  parseStatementList,
  STATEMENTS_KEY,
  surveyStatementsCallOptions,
  surveyStatementsMessages,
} from "../../agents/llm";
import { validateSurveyStatements } from "../../agents/survey-validation";
import { structuredStringList } from "../../app/lib/llm-structured-output";
import { DATASET_VERSION } from "./dataset";
import type { Criterion, Judgment, SurveyCase } from "./types";

export const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const unique = (items: readonly string[]) =>
  new Set(items).size === items.length;

export const commonCriteria: readonly Criterion[] = [
  {
    id: "yes-no",
    kind: "required",
    rule: "各文はYES/NOで答えられる断定文で、1文に1つの判断を含む",
    evidence: "本番promptのtask",
  },
  {
    id: "standalone",
    kind: "required",
    rule: "各文は対象と範囲が明瞭で、単独でも理解できる",
    evidence: "本番promptのtask",
  },
  {
    id: "grounded",
    kind: "forbidden",
    rule: "入力にない事実・合意や、発言の誤った帰属を前提にしない",
    evidence: "ケースのinput",
  },
  {
    id: "neutral",
    kind: "forbidden",
    rule: "人格評価・同調圧力・賛否を誘導する修辞を使わない",
    evidence: "認識差を収集する評価目的",
  },
  {
    id: "diverse",
    kind: "required",
    rule: "複数の観点を扱い、少数意見や条件を全体合意に潰さない",
    evidence: "ケースのinputと調査目的",
  },
  {
    id: "novelty",
    kind: "forbidden",
    rule: "バッチ内と既存質問に、意味が同じ賛否文を重複させない",
    evidence: "本番promptのexisting_statements規定",
  },
];

export const criteriaFor = (item: SurveyCase): readonly Criterion[] => [
  ...commonCriteria,
  ...item.criteria.map((criterion) => ({
    ...criterion,
    id: `case:${criterion.id}`,
  })),
];

const criterionValid = (value: unknown) =>
  record(value) &&
  text(value.id) &&
  text(value.rule) &&
  text(value.evidence) &&
  (value.kind === "required" || value.kind === "forbidden");
const caseValid = (value: unknown) =>
  record(value) &&
  text(value.id) &&
  value.source === "synthetic" &&
  text(value.acceptableExample) &&
  Array.isArray(value.tags) &&
  value.tags.length > 0 &&
  value.tags.every(text) &&
  record(value.input) &&
  ["sessionTitle", "sessionGoal", "initialContext", "eventThreadContext"].every(
    (key) => text((value.input as Record<string, unknown>)[key]),
  ) &&
  Array.isArray(value.criteria) &&
  value.criteria.length > 0 &&
  value.criteria.every(criterionValid) &&
  unique(value.criteria.map((criterion) => criterion.id)) &&
  record(value.failureExample) &&
  text(value.failureExample.statement) &&
  Array.isArray(value.failureExample.violates) &&
  value.failureExample.violates.length > 0 &&
  value.failureExample.violates.every((id) =>
    (value.criteria as Criterion[]).some((criterion) => criterion.id === id),
  );

export const validateDataset = (value: unknown): readonly string[] =>
  !Array.isArray(value)
    ? ["dataset must be an array"]
    : [
        ...(value.length !== 20 ? ["dataset must contain 20 cases"] : []),
        ...value.flatMap((item, index) =>
          caseValid(item) ? [] : [`invalid case at ${index}`],
        ),
        ...(unique(
          value.map((item) => (record(item) && text(item.id) ? item.id : "")),
        )
          ? []
          : ["duplicate case ids"]),
      ];

export type SourceVersion = Readonly<{ revision: string; hash: string }>;

// The two SURVEY_STATEMENTS_MODEL settings compared: unset (FAST_MODEL) and the
// Gemini 3.8 candidate. Each goes through the production options function.
export const MODEL_SETTINGS = [undefined, "google/gemini-3.8-flash"] as const;

// Every entry carries the exact OpenRouter body the agent would send for that
// case and setting (messages, reasoning, response_format), built by the
// production functions; run.ts sends `request` unchanged.
export const prepareManifest = (
  cases: readonly SurveyCase[],
  source: SourceVersion,
) => ({
  schemaVersion: 1,
  datasetVersion: DATASET_VERSION,
  datasetHash: digest(cases),
  source,
  cases,
  entries: cases.flatMap((item) =>
    MODEL_SETTINGS.map((setting) => {
      const prompt = buildSurveyStatementsPrompt(item.input);
      const options = surveyStatementsCallOptions(setting);
      const request = openRouterRequestBody(
        surveyStatementsMessages(item.input),
        options,
      );
      return {
        caseId: item.id,
        caseHash: digest(item),
        promptHash: digest(prompt),
        options,
        optionsHash: digest(options),
        requestHash: digest(request),
        prompt,
        request,
        criteria: criteriaFor(item),
      };
    }),
  ),
});
export type Manifest = ReturnType<typeof prepareManifest>;
export type ManifestEntry = Manifest["entries"][number];

// Machine checks of one raw answer, parsed exactly as production does:
// structured { statements } (or a bare array) first, then the lenient parser.
export const structuralChecks = (rawContent: string) => {
  const parsed = parseStatementList(rawContent);
  const runtime = validateSurveyStatements(parsed);
  return {
    statements: parsed,
    structuredAccepted:
      structuredStringList(rawContent, STATEMENTS_KEY) !== null,
    parserAccepted: parsed !== null,
    runtimeAccepted: runtime.ok,
    exactCount: parsed?.length === 15,
    structure: runtime.ok && runtime.statements.length === 15,
  };
};

export const httpSucceeded = (status: unknown): boolean =>
  typeof status === "number" &&
  Number.isInteger(status) &&
  status >= 200 &&
  status < 300;

const judgmentsValid = (
  value: unknown,
  criteria: readonly Criterion[],
): value is Judgment[] =>
  Array.isArray(value) &&
  value.length >= 2 &&
  value.every(
    (judge) =>
      record(judge) &&
      text(judge.judgeId) &&
      Array.isArray(judge.criteria) &&
      judge.criteria.length === criteria.length &&
      judge.criteria.every(
        (rating) =>
          record(rating) &&
          text(rating.id) &&
          criteria.some((criterion) => criterion.id === rating.id) &&
          ["pass", "fail", "unrated"].includes(String(rating.verdict)) &&
          text(rating.evidence),
      ) &&
      unique(judge.criteria.map((rating) => rating.id)),
  ) &&
  unique(value.map((judge) => judge.judgeId.trim()));

export const semanticStatus = (
  judgments: unknown,
  criteria: readonly Criterion[],
): "pass" | "fail" | "unreviewed" | "disagreement" => {
  const valid = judgmentsValid(judgments, criteria);
  const verdicts = valid
    ? criteria.map((criterion) =>
        judgments.map(
          (judge) =>
            judge.criteria.find((rating) => rating.id === criterion.id)
              ?.verdict,
        ),
      )
    : [];
  return !valid || verdicts.some((ratings) => ratings.includes("unrated"))
    ? "unreviewed"
    : verdicts.some((ratings) => new Set(ratings).size > 1)
      ? "disagreement"
      : verdicts.some((ratings) => ratings.includes("fail"))
        ? "fail"
        : "pass";
};

export const STATUSES = [
  "pass",
  "fail",
  "disagreement",
  "unreviewed",
  "invalid_record",
  "unmeasured",
] as const;

// No network and no automatic semantic judge. Missing records remain visible.
export const scoreManifest = (manifest: Manifest, responses: unknown) => {
  const records = Array.isArray(responses) ? responses : [];
  const results = manifest.entries.map((entry) => {
    const matches = records.filter(
      (response) =>
        record(response) &&
        response.caseId === entry.caseId &&
        response.model === entry.options.model,
    );
    const response =
      matches.length === 1 && record(matches[0]) ? matches[0] : {};
    const provenanceMatches =
      response.caseHash === entry.caseHash &&
      response.promptHash === entry.promptHash &&
      response.sourceHash === manifest.source.hash &&
      response.datasetHash === manifest.datasetHash &&
      response.sourceRevision === manifest.source.revision &&
      response.optionsHash === digest(entry.options);
    const httpSuccess = httpSucceeded(response.httpStatus);
    const content =
      typeof response.rawContent === "string" ? response.rawContent : "";
    const checks = structuralChecks(content);
    const structure = checks.structure;
    const judgmentsBound =
      Array.isArray(response.judgments) &&
      response.judgments.every(
        (judge) =>
          record(judge) &&
          judge.outputHash === digest(content) &&
          judge.rubricHash === digest(entry.criteria),
      );
    const semantic = judgmentsBound
      ? semanticStatus(response.judgments, entry.criteria)
      : "unreviewed";
    const status =
      matches.length === 0
        ? "unmeasured"
        : matches.length !== 1 || !provenanceMatches
          ? "invalid_record"
          : !httpSuccess || !structure
            ? "fail"
            : semantic;
    return {
      caseId: entry.caseId,
      model: entry.options.model,
      status,
      httpSuccess,
      structuredAccepted: checks.structuredAccepted,
      parserAccepted: checks.parserAccepted,
      runtimeAccepted: checks.runtimeAccepted,
      exactCount: checks.exactCount,
      structure,
      semantic,
    };
  });
  return {
    schemaVersion: 1,
    datasetVersion: manifest.datasetVersion,
    source: manifest.source,
    unknownRecords: records.filter(
      (response) =>
        !record(response) ||
        !manifest.entries.some(
          (entry) =>
            entry.caseId === response.caseId &&
            entry.options.model === response.model,
        ),
    ).length,
    inputValid: Array.isArray(responses),
    results,
    summary: {
      byStatus: Object.fromEntries(
        STATUSES.map((status) => [
          status,
          results.filter((result) => result.status === status).length,
        ]),
      ),
      total: results.length,
      passed: results.filter((result) => result.status === "pass").length,
      unmeasured: results.filter((result) => result.status === "unmeasured")
        .length,
    },
  };
};
