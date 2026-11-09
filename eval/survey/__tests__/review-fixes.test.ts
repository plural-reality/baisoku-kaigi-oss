import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { budgetDecision } from "../budget";
import { surveyCases } from "../dataset";
import {
  digest,
  type Manifest,
  prepareManifest,
  scoreManifest,
} from "../evaluate";
import {
  type JudgmentRecord,
  type PreferenceRecord,
  positionBias,
  preferenceAgreement,
} from "../judgments";
import { scoreRun, sourceDrift } from "../report";
import { startReviewServer } from "../review/app";

const generated = { revision: "rev-at-generation", hash: "hash-at-generation" };
// Round-tripped through JSON, exactly as run.ts stores manifest.json.
const stored: Manifest = JSON.parse(
  JSON.stringify(prepareManifest(surveyCases, generated)),
);
const models = [...new Set(stored.entries.map((e) => e.options.model))];
const statements = (tag: string) =>
  JSON.stringify({
    statements: Array.from({ length: 15 }, (_, i) => `${tag}の合成文${i + 1}`),
  });
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
  rawContent: statements(`${entry.caseId}-${index % 2}`),
}));
const judgment = (
  judgeId: string,
  index: number,
  verdict: (id: string) => "pass" | "fail",
): JudgmentRecord => {
  const entry = stored.entries[index];
  return {
    caseId: entry.caseId,
    model: entry.options.model,
    outputHash: digest(responses[index].rawContent),
    rubricHash: digest(entry.criteria),
    judgeId,
    criteria: entry.criteria.map((c) => ({
      id: c.id,
      verdict: verdict(c.id),
      evidence: "#1",
    })),
    note: "",
    updatedAt: "t",
  };
};

describe("score --run uses the run's own manifest (fix 1)", () => {
  const live = prepareManifest(surveyCases, {
    revision: "rev-after-merge",
    hash: "hash-after-merge",
  });
  it("keeps records valid after later commits and reports drift", () => {
    const result = scoreRun(stored, responses, [], [], live);
    expect(result.summary.byStatus.invalid_record).toBe(0);
    expect(result.summary.byStatus.unreviewed).toBe(40);
    expect(result.liveSourceDrift).toMatchObject({
      any: true,
      revisionChanged: true,
      sourceHashChanged: true,
      datasetHashChanged: false,
      stored: generated,
      entries: [],
    });
  });
  it("names the entries whose prompt or options changed", () => {
    const changedLive = prepareManifest(
      surveyCases.map((item, index) =>
        index === 0
          ? { ...item, input: { ...item.input, sessionGoal: "別の目的" } }
          : item,
      ),
      generated,
    );
    const drift = sourceDrift(stored, changedLive);
    expect(drift.revisionChanged).toBe(false);
    expect(drift.datasetHashChanged).toBe(true);
    expect(drift.entries).toEqual(
      models.map((model) => ({
        caseId: "library",
        model,
        changed: ["caseHash", "promptHash", "requestHash"],
      })),
    );
    expect(sourceDrift(stored, stored).any).toBe(false);
  });
  it("keeps the legacy live-manifest check for a bare responses file", () => {
    const legacy = scoreManifest(live, responses);
    expect(legacy.summary.byStatus.invalid_record).toBe(40);
  });
});

describe("report additions (fixes 3, 7, 8)", () => {
  it("counts every status", () => {
    const mixed = [
      ...responses.slice(0, 2),
      { ...responses[2], httpStatus: 500 },
      { ...responses[3], sourceRevision: "other" },
    ];
    const files = ["a", "b"].map((judge) =>
      [0, 1].map((index) =>
        judgment(judge, index, (id) =>
          index === 1 && judge === "b" && id === "neutral" ? "fail" : "pass",
        ),
      ),
    );
    expect(scoreRun(stored, mixed, files, []).summary.byStatus).toEqual({
      pass: 1,
      fail: 1,
      disagreement: 1,
      unreviewed: 0,
      invalid_record: 1,
      unmeasured: 36,
    });
  });
  it("keeps case-specific criteria per case instead of pooling one id", () => {
    const files = ["a", "b"].map((judge) =>
      stored.entries.map((_, index) => judgment(judge, index, () => "pass")),
    );
    const { agreement } = scoreRun(stored, responses, files, []).review;
    expect(agreement.common.map((c) => c.criterionId)).toEqual([
      "yes-no",
      "standalone",
      "grounded",
      "neutral",
      "diverse",
      "novelty",
    ]);
    expect(agreement.caseSpecific.map((c) => c.criterionId)).toContain(
      "library:case:unknown",
    );
    expect(
      agreement.caseSpecific.every((c) => !c.criterionId.startsWith("case:")),
    ).toBe(true);
    expect(
      agreement.caseSpecific.find(
        (c) => c.criterionId === "negation:case:context",
      )?.pairs[0].n,
    ).toBe(2);
    expect(agreement.note).toMatch(/caseSpecific/);
  });
  const pref = (
    caseId: string,
    judgeId: string,
    winner: string,
    shownLeft: string,
  ): PreferenceRecord => ({
    caseId,
    judgeId,
    winner,
    shownLeft,
    reason: "",
    outputHashes: {},
    updatedAt: "t",
  });
  it("reports position bias of the left-shown output", () => {
    const [m0, m1] = models;
    expect(
      positionBias([
        pref("c1", "a", m0, m0),
        pref("c2", "a", m1, m1),
        pref("c3", "a", m0, m1),
        pref("c4", "a", "tie", m0),
      ]),
    ).toEqual({ n: 4, leftWins: 2, rightWins: 1, ties: 1, leftWinRate: 0.625 });
    expect(positionBias([]).leftWinRate).toBeNull();
  });
  it("reports per-case inter-judge preference agreement", () => {
    const [m0, m1] = models;
    expect(
      preferenceAgreement([
        pref("c1", "a", m0, m0),
        pref("c1", "b", m0, m1),
        pref("c2", "a", m0, m0),
        pref("c2", "b", "tie", m0),
        pref("c3", "a", m1, m0),
      ]),
    ).toEqual({ cases: 2, pairs: 2, agreements: 1, agreementRate: 0.5 });
  });
});

describe("run.ts spend guard (fix 6)", () => {
  const base = {
    creditsAtStart: 3,
    remaining: 3,
    reportedCostUsd: 0,
    maxUsd: 2,
    minRemainingUsd: 1,
  };
  it("stops on the larger of credit drop and reported cost", () => {
    expect(budgetDecision(base).stop).toBeNull();
    expect(budgetDecision({ ...base, remaining: 0.99 }).stop).toMatch(
      /remaining/,
    );
    expect(
      budgetDecision({ ...base, maxUsd: 0.5, remaining: 2.4 }).stop,
    ).toMatch(/max-usd/);
    // Credits lag behind: the reported cost still trips the cap.
    const lagging = budgetDecision({
      ...base,
      maxUsd: 0.5,
      reportedCostUsd: 0.6,
    });
    expect(lagging.spentUsd).toBe(0.6);
    expect(lagging.stop).toMatch(/max-usd/);
  });
});

describe("review server: lock, concurrency and balanced order (fixes 2, 3, 4)", () => {
  const dirs: string[] = [];
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { recursive: true, force: true });
    });
  });
  const makeRun = () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-review-"));
    dirs.push(dir);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(stored));
    writeFileSync(join(dir, "responses.json"), JSON.stringify(responses));
    return dir;
  };
  const start = async (runDir: string, judgeId = "judge-a") => {
    const server = await startReviewServer({
      runDir,
      judgeId,
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
    return { ...server, call };
  };
  const blindingOf = (dir: string, judge = "judge-a") =>
    JSON.parse(readFileSync(join(dir, "blinding", `${judge}.json`), "utf8"));
  const passAll = (criteria: { id: string }[]) =>
    criteria.map((c) => ({ id: c.id, verdict: "pass", evidence: "#1" }));

  it("stores a balanced per-case order and keeps it across restarts", async () => {
    const dir = makeRun();
    await start(dir);
    const first = blindingOf(dir);
    const lefts = Object.values(first.order as Record<string, string[]>).map(
      ([left]) => left,
    );
    expect(lefts.filter((m) => m === models[0])).toHaveLength(10);
    expect(lefts.filter((m) => m === models[1])).toHaveLength(10);
    // An order already on disk (even an unbalanced legacy one) is kept as is.
    const legacy = Object.fromEntries(
      surveyCases.map((c) => [c.id, [models[0], models[1]]]),
    );
    writeFileSync(
      join(dir, "blinding", "judge-a.json"),
      JSON.stringify({ ...first, order: legacy }),
    );
    await closers.pop()?.();
    const again = await start(dir);
    expect(blindingOf(dir).order).toEqual(legacy);
    expect(blindingOf(dir).seed).toBe(first.seed);
    const state = await again.call("GET", "/api/state");
    expect(state.data.cases).toHaveLength(20);
    // Another judge gets an independent seed and order.
    await start(dir, "judge-b");
    expect(blindingOf(dir, "judge-b").seed).not.toBe(first.seed);
  });

  it("rejects a save based on an outdated version with 409 and the latest case", async () => {
    const server = await start(makeRun());
    const state = await server.call("GET", "/api/state");
    const item = state.data.cases[0];
    const body = {
      caseId: item.caseId,
      slot: "A",
      criteria: passAll(item.criteria),
      note: "",
    };
    const first = await server.call("PUT", "/api/judgment", {
      ...body,
      baseUpdatedAt: null,
    });
    expect(first.status).toBe(200);
    const savedAt = first.data.outputs[0].judgment.updatedAt;
    // A second tab still holding the old (null) base:
    const stale = await server.call("PUT", "/api/judgment", {
      ...body,
      note: "古いタブ",
      baseUpdatedAt: null,
    });
    expect(stale.status).toBe(409);
    expect(stale.data.message).toBe(
      "別のタブで更新されました。最新を読み込みました",
    );
    expect(stale.data.case.outputs[0].judgment.updatedAt).toBe(savedAt);
    const next = await server.call("PUT", "/api/judgment", {
      ...body,
      note: "新しい",
      baseUpdatedAt: savedAt,
    });
    expect(next.status).toBe(200);
    expect(next.data.outputs[0].judgment.updatedAt > savedAt).toBe(true);
    const prefOk = await server.call("PUT", "/api/preference", {
      caseId: item.caseId,
      winner: "A",
      reason: "",
      baseUpdatedAt: null,
    });
    expect(prefOk.status).toBe(200);
    const prefStale = await server.call("PUT", "/api/preference", {
      caseId: item.caseId,
      winner: "B",
      reason: "",
      baseUpdatedAt: null,
    });
    expect(prefStale.status).toBe(409);
  });

  it("locks the judge once the summary has shown model names", async () => {
    const dir = makeRun();
    const server = await start(dir);
    const state = await server.call("GET", "/api/state");
    expect((await server.call("GET", "/api/summary")).status).toBe(403);
    expect(blindingOf(dir).unblindedAt).toBeNull();
    for (const item of state.data.cases) {
      for (const slot of ["A", "B"]) {
        const saved = await server.call("PUT", "/api/judgment", {
          caseId: item.caseId,
          slot,
          criteria: passAll(item.criteria),
          note: "",
          baseUpdatedAt: null,
        });
        expect(saved.status).toBe(200);
      }
      await server.call("PUT", "/api/preference", {
        caseId: item.caseId,
        winner: "tie",
        reason: "",
        baseUpdatedAt: null,
      });
    }
    const summary = await server.call("POST", "/api/unblind", {
      mode: "full",
      confirm: true,
    });
    expect(summary.status).toBe(200);
    expect((await server.call("GET", "/api/summary")).status).toBe(200);
    const unblindedAt = blindingOf(dir).unblindedAt;
    expect(typeof unblindedAt).toBe("string");
    const after = (await server.call("GET", "/api/state")).data;
    expect(after.locked).toBe(true);
    const item = after.cases[0];
    const blocked = await server.call("PUT", "/api/judgment", {
      caseId: item.caseId,
      slot: "A",
      criteria: passAll(item.criteria),
      note: "",
      baseUpdatedAt: item.outputs[0].judgment.updatedAt,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.data.error).toBe("locked");
    expect(blocked.data.message).toMatch(/ロック/);
    const blockedPref = await server.call("PUT", "/api/preference", {
      caseId: item.caseId,
      winner: "A",
      reason: "",
      baseUpdatedAt: item.preference.updatedAt,
    });
    expect(blockedPref.status).toBe(409);
    // Reopening the summary keeps the first unblinding time; restarts stay locked.
    await server.call("POST", "/api/unblind", { mode: "full", confirm: true });
    expect(blindingOf(dir).unblindedAt).toBe(unblindedAt);
    await closers.pop()?.();
    const restarted = await start(dir);
    expect((await restarted.call("GET", "/api/state")).data.locked).toBe(true);
  });
});
