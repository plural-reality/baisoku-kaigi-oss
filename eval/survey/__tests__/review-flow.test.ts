import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { surveyCases } from "../dataset";
import {
  criteriaFor,
  digest,
  type Manifest,
  prepareManifest,
} from "../evaluate";
import type { CriterionRating, JudgmentRecord } from "../judgments";
import { validateRatings } from "../judgments";
import { scoreRun } from "../report";
import { startReviewServer } from "../review/app";
import {
  criteriaView,
  criterionLabel,
  criterionScope,
  deriveRatings,
  emptyReview,
  labelFromRule,
  nearDuplicate,
  polarity,
  type Review,
  reviewFromRatings,
  SHARED_THRESHOLD,
  sharedStatements,
  similarity,
  validateReview,
} from "../review/flow";
import {
  balancedOrder,
  buildCaseStates,
  caseCompleteIn,
  judgeSummary,
  preferenceRecord,
  publicCase,
} from "../review/state";

const library = surveyCases.find((c) => c.id === "library");
const negation = surveyCases.find((c) => c.id === "negation");
if (!library || !negation) throw new Error("dataset changed");
const libraryCriteria = criteriaFor(library);
const negationCriteria = criteriaFor(negation);
const review = (patch: Partial<Review>): Review => ({
  ...emptyReview,
  ...patch,
});
const byId = (ratings: readonly CriterionRating[], id: string) =>
  ratings.find((r) => r.id === id);

describe("criterion scope and chip labels", () => {
  it("maps statement-level criteria to plain-Japanese chips", () => {
    const view = criteriaView(negationCriteria);
    expect(
      view.filter((c) => c.scope === "statement").map((c) => [c.id, c.label]),
    ).toEqual([
      ["yes-no", "賛否で答えにくい"],
      ["standalone", "意味があいまい"],
      ["grounded", "入力にない事実を前提"],
      ["neutral", "誘導・決めつけ"],
      ["novelty", "重複"],
      ["case:unsupported", "事実・合意を確定扱い"],
    ]);
    // diverse and every case-specific required rule are whole-batch questions
    expect(view.filter((c) => c.scope === "set").map((c) => c.id)).toEqual([
      "diverse",
      "case:context",
    ]);
  });
  it("labels case-specific forbidden rules, falling back to the rule text", () => {
    const unknown = libraryCriteria.find((c) => c.id === "case:unknown");
    expect(unknown && criterionScope(unknown)).toBe("statement");
    expect(unknown && criterionLabel(unknown)).toBe("未調査を確定扱い");
    expect(labelFromRule("人格評価や常識への同調圧力を文に引き継がない")).toBe(
      "人格評価や常識への同調圧力…",
    );
    expect(labelFromRule("曖昧な発言を断定しない")).toBe("曖昧な発言");
    expect(
      criterionLabel({
        id: "case:new",
        kind: "forbidden",
        rule: "数字を出さない",
        evidence: "x",
      }),
    ).toBe("数字");
  });
});

describe("deriving per-criterion ratings from flags and confirmation", () => {
  it("turns chips into fails with #n evidence, appending several statements", () => {
    const ratings = deriveRatings(
      negationCriteria,
      review({
        flags: [
          { statement: 7, criteria: ["neutral"], comment: "常識に訴える" },
          {
            statement: 3,
            criteria: ["neutral", "case:unsupported"],
            comment: "",
          },
        ],
      }),
      15,
    );
    expect(byId(ratings, "neutral")).toEqual({
      id: "neutral",
      verdict: "fail",
      evidence: "#3、#7 常識に訴える",
    });
    expect(byId(ratings, "case:unsupported")?.evidence).toBe("#3");
    expect(byId(ratings, "yes-no")?.verdict).toBe("unrated");
  });
  it("confirm fills defaults without overwriting flags or 満たさない", () => {
    const ratings = deriveRatings(
      negationCriteria,
      review({
        flags: [{ statement: 2, criteria: ["grounded"], comment: "" }],
        set: { "case:context": { met: false, reason: "#4 と #9 で取り違え" } },
        confirmed: true,
      }),
      15,
    );
    expect(byId(ratings, "grounded")).toMatchObject({
      verdict: "fail",
      evidence: "#2",
    });
    expect(byId(ratings, "case:context")).toMatchObject({
      verdict: "fail",
      evidence: "#4 と #9 で取り違え",
    });
    expect(byId(ratings, "yes-no")).toEqual({
      id: "yes-no",
      verdict: "pass",
      evidence: "15文を確認し満たす",
    });
    expect(byId(ratings, "neutral")?.evidence).toBe("15文を確認し該当なし");
    expect(byId(ratings, "diverse")?.verdict).toBe("pass");
    expect(validateRatings(negationCriteria, ratings).ok).toBe(true);
  });
  it("a clean confirmed output passes everything with zero criterion clicks", () => {
    const ratings = deriveRatings(
      libraryCriteria,
      review({ confirmed: true }),
      15,
    );
    expect(ratings.every((r) => r.verdict === "pass")).toBe(true);
    expect(
      deriveRatings(libraryCriteria, emptyReview, 15).every(
        (r) => r.verdict === "unrated",
      ),
    ).toBe(true);
  });
  it("set-level 満たさない without a reason still records evidence", () => {
    const ratings = deriveRatings(
      negationCriteria,
      review({ set: { diverse: { met: false, reason: " " } } }),
      15,
    );
    expect(byId(ratings, "diverse")).toMatchObject({
      verdict: "fail",
      evidence: "15文全体として満たさない",
    });
  });
  it("flags outrank overrides; an explicit 保留 survives confirm", () => {
    const ratings = deriveRatings(
      negationCriteria,
      review({
        flags: [{ statement: 1, criteria: ["yes-no"], comment: "" }],
        overrides: {
          "yes-no": { verdict: "pass", evidence: "見た" },
          standalone: { verdict: "fail", evidence: "全体に曖昧" },
          neutral: { verdict: "unrated", evidence: "判断保留" },
        },
        confirmed: true,
      }),
      15,
    );
    expect(byId(ratings, "yes-no")?.verdict).toBe("fail");
    expect(byId(ratings, "standalone")).toMatchObject({
      verdict: "fail",
      evidence: "全体に曖昧",
    });
    expect(byId(ratings, "neutral")).toEqual({
      id: "neutral",
      verdict: "unrated",
      evidence: "判断保留",
    });
    expect(byId(ratings, "grounded")?.verdict).toBe("pass");
  });
  it("uses the actual statement count in default evidence", () => {
    const ratings = deriveRatings(
      negationCriteria,
      review({ set: { diverse: { met: false, reason: "" } }, confirmed: true }),
      14,
    );
    expect(byId(ratings, "diverse")?.evidence).toBe("14文全体として満たさない");
    expect(byId(ratings, "yes-no")?.evidence).toBe("14文を確認し満たす");
    expect(
      byId(
        deriveRatings(negationCriteria, review({ confirmed: true }), null),
        "neutral",
      )?.evidence,
    ).toBe("全文を確認し該当なし");
  });
});

describe("backward compatibility with per-criterion judgments", () => {
  // The shape the owner's first three cases were saved in: six criteria 合格
  // with the default evidence, one left 保留.
  const legacy: CriterionRating[] = libraryCriteria.map((c) =>
    c.id === "diverse"
      ? { id: c.id, verdict: "unrated", evidence: "判断保留" }
      : {
          id: c.id,
          verdict: "pass",
          evidence:
            c.kind === "forbidden"
              ? "15文を確認し該当なし"
              : "15文を確認し満たす",
        },
  );
  it("rebuilds a review that derives exactly the stored ratings", () => {
    const rebuilt = reviewFromRatings(legacy);
    expect(rebuilt.confirmed).toBe(false);
    expect(rebuilt.overrides.diverse).toEqual({
      verdict: "unrated",
      evidence: "判断保留",
    });
    expect(deriveRatings(libraryCriteria, rebuilt, 15)).toEqual(legacy);
  });
  it("keeps the 保留 when the judge confirms", () => {
    const confirmed = deriveRatings(
      libraryCriteria,
      { ...reviewFromRatings(legacy), confirmed: true },
      15,
    );
    expect(confirmed).toEqual(legacy);
  });
  it("leaves never-touched unrated criteria open (未確認) for confirm", () => {
    const untouched = legacy.map((r) =>
      r.id === "diverse" ? { ...r, evidence: "" } : r,
    );
    const rebuilt = reviewFromRatings(untouched);
    expect(rebuilt.overrides.diverse).toBeUndefined();
    expect(
      byId(
        deriveRatings(libraryCriteria, { ...rebuilt, confirmed: true }, 15),
        "diverse",
      )?.verdict,
    ).toBe("pass");
  });
});

describe("review validation", () => {
  const ok = (value: unknown) => validateReview(negationCriteria, 15, value).ok;
  it("accepts the page's review and rejects malformed ones", () => {
    expect(ok({ ...emptyReview })).toBe(true);
    expect(
      ok({
        ...emptyReview,
        flags: [{ statement: 3, criteria: ["neutral"], comment: "" }],
      }),
    ).toBe(true);
    expect(
      ok({
        ...emptyReview,
        flags: [{ statement: 16, criteria: ["neutral"], comment: "" }],
      }),
    ).toBe(false);
    expect(
      ok({
        ...emptyReview,
        flags: [{ statement: 3, criteria: ["diverse"], comment: "" }],
      }),
    ).toBe(false);
    expect(
      ok({
        ...emptyReview,
        flags: [{ statement: 3, criteria: [], comment: "" }],
      }),
    ).toBe(false);
    expect(
      ok({
        ...emptyReview,
        flags: [1, 1].map(() => ({
          statement: 3,
          criteria: ["neutral"],
          comment: "",
        })),
      }),
    ).toBe(false);
    expect(
      ok({ ...emptyReview, set: { neutral: { met: false, reason: "" } } }),
    ).toBe(false);
    expect(
      ok({
        ...emptyReview,
        overrides: { neutral: { verdict: "fail", evidence: " " } },
      }),
    ).toBe(false);
    expect(ok({ ...emptyReview, confirmed: "yes" })).toBe(false);
    expect(
      ok({
        ...emptyReview,
        flags: [{ statement: 3, criteria: [["neutral"]], comment: "" }],
      }),
    ).toBe(false);
    expect(
      validateReview(negationCriteria, null, {
        ...emptyReview,
        flags: [{ statement: 1, criteria: ["neutral"], comment: "" }],
      }).ok,
    ).toBe(false);
  });
});

describe("near-identical statements across outputs", () => {
  it("ignores width, spaces and punctuation", () => {
    expect(
      similarity(
        "平日の開館時間を延長すべきだ。",
        "平日の開館時間を延長すべきだ",
      ),
    ).toBe(1);
    expect(similarity("ＡＢＣを優先すべき。", "abc を優先すべき")).toBe(1);
    expect(
      similarity(
        "平日の開館時間を20時まで延長すべきである。",
        "平日の開館時間を21時まで延長すべきである。",
      ),
    ).toBeGreaterThanOrEqual(0.8);
    expect(
      similarity("平日の開館時間を延長すべきだ。", "利用料を値上げすべきだ。"),
    ).toBeLessThan(0.8);
  });
  it("tags statements that have a match in the other output", () => {
    expect(
      sharedStatements(
        ["閉館時間を延長すべきだ。", "利用料を上げるべきだ。"],
        ["予約を必須にすべきだ。", "閉館時間を延長すべきだ"],
      ),
    ).toEqual({ a: [true, false], b: [false, true] });
    expect(sharedStatements(null, ["x"])).toEqual({ a: [], b: [false] });
  });
});

const stored: Manifest = JSON.parse(
  JSON.stringify(prepareManifest(surveyCases, { revision: "r", hash: "h" })),
);
const models = [...new Set(stored.entries.map((e) => e.options.model))] as [
  string,
  string,
];
const responses = stored.entries.map((entry, index) => ({
  caseId: entry.caseId,
  model: entry.options.model,
  caseHash: entry.caseHash,
  promptHash: entry.promptHash,
  optionsHash: entry.optionsHash,
  sourceHash: stored.source.hash,
  sourceRevision: stored.source.revision,
  datasetHash: stored.datasetHash,
  httpStatus: 200,
  rawContent: JSON.stringify({
    statements: Array.from({ length: 15 }, (_, i) =>
      i < 3
        ? `共通の文${i + 1}を検討すべきだ。`
        : `${digest([index, i]).slice(0, 16)}を優先する`,
    ),
  }),
}));

describe("shared statements respect polarity (fix 7)", () => {
  it("never pairs a statement with its negation", () => {
    const yes = "地域の公共施設の夜間開放を継続すべきである。";
    const no = "地域の公共施設の夜間開放を継続すべきではない。";
    expect(similarity(yes, no)).toBeGreaterThan(0.8);
    expect(nearDuplicate(yes, no)).toBe(false);
    expect(polarity(no)).not.toBe(polarity(yes));
    expect(nearDuplicate("有料化に賛成する。", "有料化に反対する。")).toBe(
      false,
    );
    expect(
      nearDuplicate("閉館時間を延長すべきだ。", "閉館時間を延長すべきだ"),
    ).toBe(true);
  });
  it("uses the 0.9 threshold", () => {
    expect(SHARED_THRESHOLD).toBe(0.9);
    const a = "平日の開館時間を20時まで延長すべきである。";
    const b = "平日の開館時間を21時まで延長すべきである。";
    // As similar as the threshold, but the numbers differ: not the same claim.
    expect(similarity(a, b)).toBeCloseTo(0.9, 5);
    expect(nearDuplicate(a, b)).toBe(false);
    expect(
      nearDuplicate(
        "閉館を延長する案を検討する",
        "閉館を延長する案を再検討する",
      ),
    ).toBe(
      similarity(
        "閉館を延長する案を検討する",
        "閉館を延長する案を再検討する",
      ) >= 0.9,
    );
  });
});

describe("unconfirmed judgments stay out of pass rates and agreement (fix 5)", () => {
  const run = { cases: surveyCases, entries: stored.entries, responses };
  const order = balancedOrder(
    "seed",
    surveyCases.map((c) => c.id),
    models,
  );
  const flagged = (
    judgeId: string,
    index: number,
    confirmed: boolean,
  ): JudgmentRecord => {
    const entry = stored.entries[index];
    const flags = [{ statement: 2, criteria: ["neutral"], comment: "" }];
    const reviewValue = { flags, set: {}, confirmed, overrides: {} };
    return {
      caseId: entry.caseId,
      model: entry.options.model,
      outputHash: digest(responses[index].rawContent),
      rubricHash: digest(entry.criteria),
      judgeId,
      criteria: deriveRatings(entry.criteria, reviewValue, 15),
      note: "",
      updatedAt: "t",
      review: reviewValue,
    };
  };
  it("judgeSummary counts them separately", () => {
    const summary = judgeSummary(
      buildCaseStates(
        run,
        order,
        "j",
        [flagged("j", 0, false), flagged("j", 1, true)],
        [],
      ),
    );
    expect(summary.unconfirmedJudgments).toBe(1);
    const neutral = summary.criteria.find((c) => c.criterionId === "neutral");
    expect(neutral?.byModel.map((m) => m.decided)).toEqual(
      models.map((m) => (m === stored.entries[1].options.model ? 1 : 0)),
    );
  });
  it("agreement ignores them and the scorer keeps them unreviewed", () => {
    const files = [[flagged("a", 0, false)], [flagged("b", 0, false)]];
    const score = scoreRun(stored, responses, files, []);
    expect(score.review.agreement.common).toEqual([]);
    expect(score.review.judges.map((j) => j.unconfirmedJudgments)).toEqual([
      1, 1,
    ]);
    expect(score.results[0].status).toBe("unreviewed");
  });
});

describe("completion per mode", () => {
  const run = { cases: surveyCases, entries: stored.entries, responses };
  const order = balancedOrder(
    "seed",
    surveyCases.map((c) => c.id),
    models,
  );
  it("かんたん needs only the preference; しっかり needs every criterion decided", () => {
    const state = buildCaseStates(run, order, "j", [], [])[0];
    expect(caseCompleteIn("quick", state)).toBe(false);
    const pref = preferenceRecord(state, "j", "tie", "", "t", ["表現が中立"]);
    const withPref = buildCaseStates(run, order, "j", [], [pref])[0];
    expect(caseCompleteIn("quick", withPref)).toBe(true);
    expect(caseCompleteIn("full", withPref)).toBe(false);
    const view = publicCase(withPref);
    expect(view.completeQuick).toBe(true);
    expect(view.complete).toBe(false);
    expect(view.preference.reasonTags).toEqual(["表現が中立"]);
    expect(view.outputs[0].shared.slice(0, 4)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe("review server: review intent stored with derived ratings", () => {
  const dirs: string[] = [];
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { recursive: true, force: true });
    });
  });
  const start = async (legacy: JudgmentRecord[] = []) => {
    const dir = mkdtempSync(join(tmpdir(), "eval-flow-"));
    dirs.push(dir);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(stored));
    writeFileSync(join(dir, "responses.json"), JSON.stringify(responses));
    if (legacy.length > 0) {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(dir, "judgments"));
      writeFileSync(
        join(dir, "judgments", "judge-a.json"),
        JSON.stringify(legacy),
      );
    }
    const server = await startReviewServer({
      runDir: dir,
      judgeId: "judge-a",
      port: 0,
      host: "127.0.0.1",
    });
    closers.push(server.close);
    const call = (method: string, path: string, body?: unknown) =>
      fetch(`${server.url}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      }).then(async (r) => ({ status: r.status, data: await r.json() }));
    return { dir, call, url: server.url };
  };
  const legacyFor = (index: number): JudgmentRecord => {
    const entry = stored.entries[index];
    return {
      caseId: entry.caseId,
      model: entry.options.model,
      outputHash: digest(responses[index].rawContent),
      rubricHash: digest(entry.criteria),
      judgeId: "judge-a",
      criteria: entry.criteria.map((c) =>
        c.id === "diverse"
          ? { id: c.id, verdict: "unrated", evidence: "判断保留" }
          : { id: c.id, verdict: "pass", evidence: "15文を確認し満たす" },
      ),
      note: "",
      updatedAt: "2026-11-08T11:56:22.943Z",
    };
  };

  it("shows a legacy 保留 as held; confirm keeps it until the judge resolves it", async () => {
    const { dir, call } = await start([legacyFor(0), legacyFor(1)]);
    const before = readFileSync(join(dir, "judgments", "judge-a.json"), "utf8");
    const item = (await call("GET", "/api/state")).data.cases[0];
    // Loading changes nothing on disk.
    expect(readFileSync(join(dir, "judgments", "judge-a.json"), "utf8")).toBe(
      before,
    );
    expect(item.caseId).toBe("library");
    const a = item.outputs[0];
    expect(a.judgment.review.confirmed).toBe(false);
    expect(a.judgment.review.overrides.diverse).toEqual({
      verdict: "unrated",
      evidence: "判断保留",
    });
    expect(item.complete).toBe(false);
    const confirmOnly = await call("PUT", "/api/judgment", {
      caseId: item.caseId,
      slot: "A",
      note: "",
      review: { ...a.judgment.review, confirmed: true },
      baseUpdatedAt: a.judgment.updatedAt,
    });
    const held = confirmOnly.data.outputs[0].judgment.criteria.find(
      (r: CriterionRating) => r.id === "diverse",
    );
    expect(held).toEqual({
      id: "diverse",
      verdict: "unrated",
      evidence: "判断保留",
    });
    // Resolving the hold (満たす: drop the override) and confirming completes it.
    const { diverse: _held, ...rest } = a.judgment.review.overrides;
    for (const output of confirmOnly.data.outputs) {
      const saved = await call("PUT", "/api/judgment", {
        caseId: item.caseId,
        slot: output.slot,
        note: "",
        review: { ...output.judgment.review, overrides: rest, confirmed: true },
        baseUpdatedAt: output.judgment.updatedAt,
      });
      expect(saved.status).toBe(200);
    }
    const done = await call("PUT", "/api/preference", {
      caseId: item.caseId,
      winner: "tie",
      reason: "",
      reasonTags: ["具体的"],
      baseUpdatedAt: null,
    });
    expect(done.data.complete).toBe(true);
    const file = JSON.parse(
      readFileSync(join(dir, "judgments", "judge-a.json"), "utf8"),
    );
    expect(
      file[0].criteria.every((r: CriterionRating) => r.verdict === "pass"),
    ).toBe(true);
    // Untouched legacy evidence is kept byte for byte.
    expect(
      file[0].criteria.find((r: CriterionRating) => r.id === "yes-no").evidence,
    ).toBe("15文を確認し満たす");
    const badTag = await call("PUT", "/api/preference", {
      caseId: item.caseId,
      winner: "A",
      reason: "",
      reasonTags: ["好き"],
      baseUpdatedAt: done.data.preference.updatedAt,
    });
    expect(badTag.status).toBe(422);
    expect(badTag.data.errors).toEqual([
      "reasonTags must be from: 論点が広い, 表現が中立, 重複が少ない, 具体的",
    ]);
  });

  it("stores flags as fails that score --run accepts", async () => {
    const { dir, call } = await start();
    const state = (await call("GET", "/api/state")).data;
    const item = state.cases[3]; // negation
    const output = item.outputs[0];
    const saved = await call("PUT", "/api/judgment", {
      caseId: item.caseId,
      slot: "A",
      note: "",
      review: {
        flags: [
          {
            statement: 5,
            criteria: ["neutral", "case:unsupported"],
            comment: "誘導",
          },
        ],
        set: {},
        confirmed: true,
        overrides: {},
      },
      baseUpdatedAt: null,
    });
    expect(saved.status).toBe(200);
    const ratings = saved.data.outputs[0].judgment
      .criteria as CriterionRating[];
    expect(ratings.find((r) => r.id === "neutral")).toMatchObject({
      verdict: "fail",
      evidence: "#5 誘導",
    });
    expect(ratings.filter((r) => r.verdict === "pass")).toHaveLength(
      ratings.length - 2,
    );
    expect(output.slot).toBe("A");
    const bad = await call("PUT", "/api/judgment", {
      caseId: item.caseId,
      slot: "B",
      note: "",
      review: {
        flags: [{ statement: 5, criteria: ["diverse"], comment: "" }],
        set: {},
        confirmed: false,
        overrides: {},
      },
      baseUpdatedAt: null,
    });
    expect(bad.status).toBe(422);
    const legacyBody = await call("PUT", "/api/judgment", {
      caseId: item.caseId,
      slot: "B",
      note: "",
      criteria: item.criteria.map((c: { id: string }) => ({
        id: c.id,
        verdict: "pass",
        evidence: "#1",
      })),
      baseUpdatedAt: null,
    });
    expect(legacyBody.status).toBe(200);
    const judgments = JSON.parse(
      readFileSync(join(dir, "judgments", "judge-a.json"), "utf8"),
    );
    const score = scoreRun(stored, responses, [judgments], []);
    expect(score.review.judges[0]).toMatchObject({
      judgeId: "judge-a",
      judgments: 2,
      boundJudgments: 2,
    });
    expect(score.summary.byStatus.invalid_record).toBe(0);
    const tag = await call("PUT", "/api/preference", {
      caseId: item.caseId,
      winner: "A",
      reason: "",
      reasonTags: ["好き"],
      baseUpdatedAt: null,
    });
    expect(tag.status).toBe(422);
  });

  it("unblinds only by POST, in かんたん mode with preferences only", async () => {
    const { dir, call } = await start();
    const state = (await call("GET", "/api/state")).data;
    for (const item of state.cases) {
      await call("PUT", "/api/preference", {
        caseId: item.caseId,
        winner: "A",
        reason: "",
        baseUpdatedAt: null,
      });
    }
    // Reading never unblinds or locks.
    expect((await call("GET", "/api/summary")).status).toBe(403);
    expect((await call("GET", "/api/summary?mode=quick")).status).toBe(403);
    const blinding = () =>
      JSON.parse(readFileSync(join(dir, "blinding", "judge-a.json"), "utf8"));
    expect(blinding().unblindedAt).toBeNull();
    expect((await call("GET", "/api/state")).data.locked).toBe(false);
    // Full mode is not complete; the explicit confirm flag is required.
    expect(
      (await call("POST", "/api/unblind", { mode: "full", confirm: true }))
        .status,
    ).toBe(403);
    expect((await call("POST", "/api/unblind", { mode: "quick" })).status).toBe(
      422,
    );
    const ok = await call("POST", "/api/unblind", {
      mode: "quick",
      confirm: true,
    });
    expect(ok.status).toBe(200);
    expect(blinding()).toMatchObject({ unblindMode: "quick" });
    const summary = await call("GET", "/api/summary");
    expect(summary.data).toMatchObject({ mode: "quick", fullyJudged: 0 });
    expect((await call("GET", "/api/state")).data.locked).toBe(true);
  });

  it("refuses a cross-origin or non-JSON unblind", async () => {
    const { call, url } = await start();
    const crossSite = await fetch(`${url}/api/unblind`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.example",
      },
      body: JSON.stringify({ mode: "quick", confirm: true }),
    });
    expect(crossSite.status).toBe(403);
    const form = await fetch(`${url}/api/unblind`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "mode=quick&confirm=true",
    });
    expect(form.status).toBe(415);
    expect((await call("GET", "/api/state")).data.locked).toBe(false);
  });
});
