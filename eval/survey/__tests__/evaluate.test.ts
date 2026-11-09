import { describe, expect, it } from "vitest";
import { buildSurveyStatementsPrompt } from "../../../agents/llm";
import { surveyCases } from "../dataset";
import {
  criteriaFor,
  digest,
  prepareManifest,
  scoreManifest,
  semanticStatus,
  validateDataset,
} from "../evaluate";
import type { Judgment } from "../types";

const source = { revision: "test-revision", hash: "test-source-hash" };
const manifest = prepareManifest(surveyCases, source);
const entry = manifest.entries[0];
const judgments = (verdict: "pass" | "fail" | "unrated" = "pass"): Judgment[] =>
  ["reviewer-a", "reviewer-b"].map((judgeId) => ({
    judgeId,
    criteria: entry.criteria.map((criterion) => ({
      id: criterion.id,
      verdict,
      evidence: "判定処理の合成例。実モデル品質の評価ではない。",
    })),
  }));
const response = {
  caseId: entry.caseId,
  model: entry.options.model,
  caseHash: entry.caseHash,
  promptHash: entry.promptHash,
  sourceHash: source.hash,
  sourceRevision: source.revision,
  datasetHash: manifest.datasetHash,
  optionsHash: digest(entry.options),
  httpStatus: 200,
  rawContent: JSON.stringify(
    Array.from({ length: 15 }, (_, i) => `合成文${i}`),
  ),
  judgments: judgments().map((judge) => ({
    ...judge,
    outputHash: digest(
      JSON.stringify(Array.from({ length: 15 }, (_, i) => `合成文${i}`)),
    ),
    rubricHash: digest(entry.criteria),
  })),
};
const status = (value: unknown) =>
  scoreManifest(manifest, value).results[0].status;

describe("versioned Japanese dataset and production prompt reuse", () => {
  it("validates 20 cases and prepares both profiles without API calls", () => {
    expect(validateDataset(surveyCases)).toEqual([]);
    expect(manifest.entries).toHaveLength(40);
    expect(entry.prompt).toBe(
      buildSurveyStatementsPrompt(surveyCases[0].input),
    );
    expect(manifest.entries[1].promptHash).toBe(entry.promptHash);
    expect(manifest.entries[1].options.model).toBe("google/gemini-3.8-flash");
    expect(
      surveyCases.every((item) =>
        item.failureExample.violates.every((id) =>
          item.criteria.some((criterion) => criterion.id === id),
        ),
      ),
    ).toBe(true);
  });
  it.each([
    null,
    [],
    [...surveyCases.slice(1), surveyCases[1]],
    surveyCases.map((item, index) =>
      index === 0 ? { ...item, criteria: [] } : item,
    ),
  ])("rejects invalid dataset %j", (value) => {
    expect(validateDataset(value).length).toBeGreaterThan(0);
  });
  it("tracks changed case and prompt versions", () => {
    const changed = prepareManifest(
      [
        {
          ...surveyCases[0],
          input: { ...surveyCases[0].input, sessionGoal: "別の合成目的" },
        },
      ],
      source,
    );
    expect(changed.entries[0].caseHash).not.toBe(entry.caseHash);
    expect(changed.entries[0].promptHash).not.toBe(entry.promptHash);
    expect(changed.datasetHash).not.toBe(manifest.datasetHash);
  });
});

describe("mechanical versus semantic decisions (synthetic judgments only)", () => {
  it("passes only the supplied fully reviewed record, retaining all missing cases", () => {
    const result = scoreManifest(manifest, [response]);
    expect(result.summary).toEqual({
      byStatus: {
        pass: 1,
        fail: 0,
        disagreement: 0,
        unreviewed: 0,
        invalid_record: 0,
        unmeasured: 39,
      },
      total: 40,
      passed: 1,
      unmeasured: 39,
    });
  });
  it.each([
    [],
    undefined,
    [judgments()[0]],
    judgments("unrated"),
    [judgments()[0], judgments()[0]],
    judgments().map((j) => ({ ...j, criteria: j.criteria.slice(1) })),
  ])("does not turn incomplete judgments into pass", (value) => {
    expect(semanticStatus(value, entry.criteria)).toBe("unreviewed");
  });
  it("requires evidence and treats disagreement separately", () => {
    expect(
      semanticStatus([judgments()[0], judgments("fail")[1]], entry.criteria),
    ).toBe("disagreement");
    expect(semanticStatus(judgments("fail"), entry.criteria)).toBe("fail");
    expect(
      semanticStatus(
        judgments().map((j) => ({
          ...j,
          criteria: j.criteria.map((c) => ({ ...c, evidence: "" })),
        })),
        entry.criteria,
      ),
    ).toBe("unreviewed");
  });
  it.each([
    [],
    [""],
    ["x", " x "],
    [1],
    Array(15).fill("重複"),
    ["正常1件"],
  ])("fails structural response %j even with pass judgments", (content) => {
    expect(status([{ ...response, rawContent: JSON.stringify(content) }])).toBe(
      "fail",
    );
  });
  it.each([
    "sourceHash",
    "sourceRevision",
    "caseHash",
    "promptHash",
    "datasetHash",
    "optionsHash",
  ])("rejects mismatched %s", (key) => {
    expect(status([{ ...response, [key]: "different" }])).toBe(
      "invalid_record",
    );
  });
  it("does not reuse judgments for changed output or rubric", () => {
    expect(
      status([
        {
          ...response,
          rawContent: JSON.stringify(
            Array.from({ length: 15 }, (_, i) => `変更文${i}`),
          ),
        },
      ]),
    ).toBe("unreviewed");
    expect(
      status([
        {
          ...response,
          judgments: response.judgments.map((judge) => ({
            ...judge,
            rubricHash: "old-rubric",
          })),
        },
      ]),
    ).toBe("unreviewed");
  });
  it("rejects duplicate records and failed transport", () => {
    expect(status([response, response])).toBe("invalid_record");
    expect(status([{ ...response, httpStatus: 500 }])).toBe("fail");
    expect(
      scoreManifest(manifest, [{ caseId: "unknown" }]).unknownRecords,
    ).toBe(1);
    expect(scoreManifest(manifest, {}).inputValid).toBe(false);
  });
  it.each(
    surveyCases,
  )("gives failure example an explicit rubric failure: $id", (item) => {
    const criteria = criteriaFor(item);
    const negative: Judgment[] = ["a", "b"].map((judgeId) => ({
      judgeId,
      criteria: criteria.map((criterion) => ({
        id: criterion.id,
        verdict: item.failureExample.violates.some(
          (id) => criterion.id === `case:${id}`,
        )
          ? "fail"
          : "pass",
        evidence: item.failureExample.statement,
      })),
    }));
    expect(semanticStatus(negative, criteria)).toBe("fail");
  });
});
