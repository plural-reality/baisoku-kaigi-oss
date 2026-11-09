import { describe, expect, it } from "vitest";
import {
  openRouterRequestBody,
  surveyStatementsCallOptions,
  surveyStatementsMessages,
} from "../../../agents/llm";
import { surveyCases } from "../dataset";
import { digest, prepareManifest, scoreManifest } from "../evaluate";
import {
  agreementByCriterion,
  attachJudgments,
  cohenKappa,
  type JudgmentRecord,
  preferenceBound,
  preferenceStats,
  validateRatings,
} from "../judgments";
import { scoreRun } from "../report";
import {
  balancedOrder,
  buildCaseStates,
  caseComplete,
  completeOrder,
  judgeSummary,
  judgmentRecord,
  preferenceRecord,
  publicCase,
  slotOf,
} from "../review/state";

const source = { revision: "test-revision", hash: "test-source-hash" };
const manifest = prepareManifest(surveyCases, source);
const models = [...new Set(manifest.entries.map((e) => e.options.model))] as [
  string,
  string,
];
const statements = (prefix: string) =>
  Array.from({ length: 15 }, (_, i) => `${prefix}の合成文${i + 1}`);
const responseFor = (
  entry: (typeof manifest.entries)[number],
  rawContent: string,
) => ({
  caseId: entry.caseId,
  model: entry.options.model,
  caseHash: entry.caseHash,
  promptHash: entry.promptHash,
  optionsHash: entry.optionsHash,
  sourceHash: source.hash,
  sourceRevision: source.revision,
  datasetHash: manifest.datasetHash,
  httpStatus: 200,
  rawContent,
});
// Statement text must not carry the model id: the blinding test searches the
// page payload for it.
const caseIds = surveyCases.map((c) => c.id);
const ORDER = balancedOrder("seed", caseIds, models);
const responses = manifest.entries.map((entry, index) =>
  responseFor(
    entry,
    JSON.stringify({ statements: statements(`${entry.caseId}-${index % 2}`) }),
  ),
);
const judgmentOf = (
  judgeId: string,
  entry: (typeof manifest.entries)[number],
  verdict: (criterionId: string) => "pass" | "fail" | "unrated",
): JudgmentRecord => {
  const raw = responses.find(
    (r) => r.caseId === entry.caseId && r.model === entry.options.model,
  )?.rawContent as string;
  return {
    caseId: entry.caseId,
    model: entry.options.model,
    outputHash: digest(raw),
    rubricHash: digest(entry.criteria),
    judgeId,
    criteria: entry.criteria.map((c) => ({
      id: c.id,
      verdict: verdict(c.id),
      evidence: verdict(c.id) === "unrated" ? "" : "#1 を確認",
    })),
    note: "",
    updatedAt: "2026-11-08T00:00:00.000Z",
  };
};

describe("production request and parser reuse", () => {
  it("prepares the exact structured-output request the agent sends", () => {
    const entry = manifest.entries[1];
    expect(entry.request).toEqual(
      openRouterRequestBody(
        surveyStatementsMessages(surveyCases[0].input),
        surveyStatementsCallOptions("google/gemini-3.8-flash"),
      ),
    );
    expect(entry.request.response_format?.json_schema.name).toBe(
      "survey_statements",
    );
    expect(entry.options.responseFormat).toBeDefined();
    expect(entry.requestHash).toBe(digest(entry.request));
  });
  it.each([
    [
      "structured {statements}",
      JSON.stringify({ statements: statements("s") }),
    ],
    ["legacy bare array", JSON.stringify(statements("a"))],
    ["fenced array", `\`\`\`json\n${JSON.stringify(statements("f"))}\n\`\`\``],
  ])("scores %s as structurally valid", (_label, rawContent) => {
    const result = scoreManifest(manifest, [
      responseFor(manifest.entries[0], rawContent),
    ]).results[0];
    expect(result.structure).toBe(true);
    expect(result.status).toBe("unreviewed");
  });
  it("reports whether the structured format was honoured", () => {
    const score = (raw: string) =>
      scoreManifest(manifest, [responseFor(manifest.entries[0], raw)])
        .results[0];
    expect(
      score(JSON.stringify({ statements: statements("s") })).structuredAccepted,
    ).toBe(true);
    expect(score(`- a\n- b`).structuredAccepted).toBe(false);
    expect(score(JSON.stringify({ statements: ["x"] })).structure).toBe(false);
  });
});

describe("blinding", () => {
  const leftCount = (order: ReturnType<typeof balancedOrder>, model: string) =>
    Object.values(order).filter(([left]) => left === model).length;
  it("puts each model on the left exactly half the time", () => {
    ["seed-1", "seed-2", "seed-3", "x"].forEach((seed) => {
      const order = balancedOrder(seed, caseIds, models);
      expect(Object.keys(order).sort()).toEqual([...caseIds].sort());
      expect(leftCount(order, models[0])).toBe(10);
      expect(leftCount(order, models[1])).toBe(10);
    });
  });
  it("differs by at most one for an odd number of cases", () => {
    const counts = ["a", "b", "c", "d", "e", "f"].map((seed) => {
      const order = balancedOrder(seed, caseIds.slice(0, 19), models);
      return [leftCount(order, models[0]), leftCount(order, models[1])];
    });
    counts.forEach(([x, y]) => {
      expect(x + y).toBe(19);
      expect(Math.abs(x - y)).toBe(1);
    });
  });
  it("is stable per seed and independent across seeds", () => {
    expect(balancedOrder("seed-1", caseIds, models)).toEqual(
      balancedOrder("seed-1", caseIds, models),
    );
    expect(balancedOrder("seed-1", caseIds, models)).not.toEqual(
      balancedOrder("seed-2", caseIds, models),
    );
  });
  it("keeps a stored order and assigns only missing cases", () => {
    const stored = Object.fromEntries(
      caseIds.slice(0, 5).map((id) => [id, [models[0], models[1]]]),
    );
    const order = completeOrder(stored, "seed", caseIds, models);
    caseIds.slice(0, 5).forEach((id) => {
      expect(order[id]).toEqual([models[0], models[1]]);
    });
    expect(Object.keys(order)).toHaveLength(20);
    const rest = balancedOrder("seed", caseIds.slice(5), models);
    caseIds.slice(5).forEach((id) => {
      expect(order[id]).toEqual(rest[id]);
    });
    // Unknown cases and malformed pairs are dropped.
    const cleaned = completeOrder(
      { gone: [models[0], models[1]], library: ["x", "y"] },
      "seed",
      caseIds,
      models,
    );
    expect(cleaned.gone).toBeUndefined();
    expect([...(cleaned.library ?? [])].sort()).toEqual([...models].sort());
  });
  it("maps slots back to models", () => {
    const order = ORDER.library;
    expect(slotOf(order, order[0])).toBe("A");
    expect(slotOf(order, order[1])).toBe("B");
    expect(slotOf(order, "other")).toBeUndefined();
  });
  it("never sends model ids or the order key to the page", () => {
    const states = buildCaseStates(
      { cases: surveyCases, entries: manifest.entries, responses },
      ORDER,
      "judge-a",
      [],
      [],
    );
    const page = JSON.stringify(states.map(publicCase));
    models.forEach((model) => {
      expect(page).not.toContain(model);
    });
    expect(page).not.toContain("seed");
  });
  it("refuses to build a case without a blinding order", () => {
    expect(() =>
      buildCaseStates(
        { cases: surveyCases, entries: manifest.entries, responses },
        {},
        "judge-a",
        [],
        [],
      ),
    ).toThrow(/no blinding order/);
  });
});

describe("judgment validation", () => {
  const criteria = manifest.entries[0].criteria;
  const rows = (verdict: string, evidence: string) =>
    criteria.map((c) => ({ id: c.id, verdict, evidence }));
  it("requires evidence for fail and pass, not for unrated", () => {
    expect(validateRatings(criteria, rows("fail", " ")).ok).toBe(false);
    expect(validateRatings(criteria, rows("pass", "")).ok).toBe(false);
    expect(validateRatings(criteria, rows("unrated", "")).ok).toBe(true);
    expect(validateRatings(criteria, rows("fail", "#7 は誘導")).ok).toBe(true);
  });
  it("rejects missing, reordered or unknown criteria", () => {
    expect(validateRatings(criteria, rows("pass", "x").slice(1)).ok).toBe(
      false,
    );
    expect(validateRatings(criteria, rows("pass", "x").reverse()).ok).toBe(
      false,
    );
    expect(validateRatings(criteria, rows("maybe", "x")).ok).toBe(false);
    expect(validateRatings(criteria, null).ok).toBe(false);
  });
});

describe("review state", () => {
  const run = { cases: surveyCases, entries: manifest.entries, responses };
  const entries = manifest.entries.filter((e) => e.caseId === "library");
  it("completes a case only with all verdicts decided and a preference", () => {
    const passAll = entries.map((e) => judgmentOf("judge-a", e, () => "pass"));
    const state = (judgments: unknown, preferences: unknown) =>
      buildCaseStates(run, ORDER, "judge-a", judgments, preferences)[0];
    expect(caseComplete(state(passAll, []))).toBe(false);
    const pref = preferenceRecord(
      state(passAll, []),
      "judge-a",
      "A",
      "",
      "2026-11-08T00:00:00.000Z",
    );
    expect(caseComplete(state(passAll, [pref]))).toBe(true);
    const held = [
      passAll[0],
      judgmentOf("judge-a", entries[1], (id) =>
        id === "neutral" ? "unrated" : "pass",
      ),
    ];
    expect(caseComplete(state(held, [pref]))).toBe(false);
  });
  it("de-blinds the preference winner server-side", () => {
    const state = buildCaseStates(run, ORDER, "judge-a", [], [])[0];
    const pref = preferenceRecord(state, "judge-a", "B", "理由", "t");
    expect(pref.winner).toBe(state.outputs[1].model);
    expect(pref.shownLeft).toBe(state.outputs[0].model);
    expect(
      publicCase(buildCaseStates(run, ORDER, "judge-a", [], [pref])[0])
        .preference.winner,
    ).toBe("B");
  });
  it("drops judgments made on another output", () => {
    const state = buildCaseStates(run, ORDER, "judge-a", [], [])[0];
    const stale = {
      ...judgmentRecord(state, state.outputs[0], "judge-a", [], "", "t"),
      outputHash: "old",
    };
    const next = buildCaseStates(run, ORDER, "judge-a", [stale], [])[0];
    expect(next.outputs[0].judgment).toBeNull();
    expect(next.outputs[0].staleJudgment).toBe(true);
  });
  it("summarises this judge's pass rates per model", () => {
    const judgments = manifest.entries.map((e) =>
      judgmentOf("judge-a", e, (id) =>
        id === "neutral" && e.options.model === models[1] ? "fail" : "pass",
      ),
    );
    const summary = judgeSummary(
      buildCaseStates(run, ORDER, "judge-a", judgments, []),
    );
    const neutral = summary.criteria.find((c) => c.criterionId === "neutral");
    expect(neutral?.byModel.map((m) => m.passRate)).toEqual([1, 0]);
  });
});

describe("scoring a reviewed run", () => {
  it("merges judge files into responses for the #379 scorer", () => {
    const files = ["judge-a", "judge-b"].map((judge) =>
      manifest.entries.map((e) => judgmentOf(judge, e, () => "pass")),
    );
    const merged = attachJudgments(responses, files) as {
      judgments: unknown[];
    }[];
    expect(merged[0].judgments).toHaveLength(2);
    const result = scoreRun(manifest, responses, files, []);
    expect(result.summary.passed).toBe(40);
    expect(result.review.judges.map((j) => j.boundJudgments)).toEqual([40, 40]);
  });
  it("reports disagreement and agreement statistics", () => {
    const a = manifest.entries.map((e) =>
      judgmentOf("judge-a", e, () => "pass"),
    );
    const b = manifest.entries.map((e, index) =>
      judgmentOf("judge-b", e, (id) =>
        id === "neutral" && index % 4 === 0 ? "fail" : "pass",
      ),
    );
    const result = scoreRun(manifest, responses, [a, b], []);
    expect(result.results[0].status).toBe("disagreement");
    const neutral = result.review.agreement.common.find(
      (c) => c.criterionId === "neutral",
    );
    expect(neutral?.pairs[0]).toMatchObject({
      judges: ["judge-a", "judge-b"],
      n: 40,
      percentAgreement: 0.75,
      kappa: 0,
    });
    const yesNo = result.review.agreement.common.find(
      (c) => c.criterionId === "yes-no",
    );
    expect(yesNo?.pairs[0].kappa).toBeNull(); // every rating identical
  });
  it("only counts judgments bound to the current output", () => {
    const files = ["judge-a", "judge-b"].map((judge) =>
      manifest.entries.map((e) => ({
        ...judgmentOf(judge, e, () => "pass"),
        outputHash: "stale",
      })),
    );
    const result = scoreRun(manifest, responses, files, []);
    expect(result.summary.passed).toBe(0);
    expect(result.review.agreement.common).toEqual([]);
    expect(result.review.agreement.caseSpecific).toEqual([]);
  });
  it("computes preference win rates with ties as halves", () => {
    const run = { cases: surveyCases, entries: manifest.entries, responses };
    const states = buildCaseStates(run, ORDER, "judge-a", [], []);
    const prefs = states.slice(0, 4).map((state, i) => {
      const winnerSlot =
        i === 3 ? "tie" : state.outputs[0].model === models[0] ? "A" : "B";
      return preferenceRecord(state, "judge-a", winnerSlot, "", "t");
    });
    const result = scoreRun(manifest, responses, [], [prefs]);
    expect(result.review.preferences.byModel).toEqual([
      { model: models[0], n: 4, wins: 3, losses: 0, ties: 1, winRate: 0.875 },
      { model: models[1], n: 4, wins: 0, losses: 3, ties: 1, winRate: 0.125 },
    ]);
    expect(
      preferenceBound(prefs[0], { [models[0]]: "x", [models[1]]: "y" }),
    ).toBe(false);
    expect(preferenceStats(models, [])[0].winRate).toBeNull();
  });
});

describe("Cohen's kappa", () => {
  const repeat = (pair: [string, string], n: number) =>
    Array.from({ length: n }, () => pair);
  it("matches a hand-computed example", () => {
    const pairs = [
      ...repeat(["pass", "pass"], 20),
      ...repeat(["pass", "fail"], 5),
      ...repeat(["fail", "pass"], 10),
      ...repeat(["fail", "fail"], 15),
    ];
    // po = 0.7, pe = 0.5*0.6 + 0.5*0.4 = 0.5 → kappa = 0.4
    expect(cohenKappa(pairs)).toBeCloseTo(0.4, 10);
  });
  it("is null with no items or no variation and 1 for perfect agreement", () => {
    expect(cohenKappa([])).toBeNull();
    expect(cohenKappa(repeat(["pass", "pass"], 3))).toBeNull();
    expect(
      cohenKappa([
        ...repeat(["pass", "pass"], 2),
        ...repeat(["fail", "fail"], 2),
      ]),
    ).toBe(1);
  });
  it("excludes unrated ratings from agreement", () => {
    const stats = agreementByCriterion([
      {
        caseId: "c",
        model: "m",
        criterionId: "x",
        verdicts: { a: "pass", b: "unrated" },
      },
      {
        caseId: "c",
        model: "n",
        criterionId: "x",
        verdicts: { a: "pass", b: "pass" },
      },
    ]);
    expect(stats[0].pairs[0].n).toBe(1);
  });
});
