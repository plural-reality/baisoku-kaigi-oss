import {
  digest,
  type Manifest,
  type ManifestEntry,
  scoreManifest,
} from "./evaluate";
import {
  agreementByCriterion,
  attachJudgments,
  isJudgmentRecord,
  isPreferenceRecord,
  judgmentBound,
  positionBias,
  preferenceAgreement,
  preferenceBound,
  preferenceStats,
  type RatedItem,
} from "./judgments";
import { isConfirmedJudgment } from "./review/flow";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The raw answer of the single response record for an entry; undefined when the
// record is missing or duplicated (scoreManifest reports those separately).
export const entryContent = (
  responses: unknown,
  entry: Pick<ManifestEntry, "caseId" | "options">,
): string | undefined => {
  const matches = (Array.isArray(responses) ? responses : []).filter(
    (response) =>
      isRecord(response) &&
      response.caseId === entry.caseId &&
      response.model === entry.options.model,
  );
  return matches.length === 1 && typeof matches[0].rawContent === "string"
    ? matches[0].rawContent
    : undefined;
};

const ENTRY_HASHES = [
  "caseHash",
  "promptHash",
  "optionsHash",
  "requestHash",
] as const;

// What differs between the manifest a run was generated with and the one the
// live checkout would build. A warning only: the run's own manifest stays the
// provenance reference, so a later commit does not invalidate a reviewed run.
export const sourceDrift = (stored: Manifest, live: Manifest) => {
  const key = (e: Pick<ManifestEntry, "caseId" | "options">) =>
    `${e.caseId}\u0000${e.options.model}`;
  const liveByKey = new Map(live.entries.map((e) => [key(e), e]));
  const storedKeys = new Set(stored.entries.map(key));
  const entries = stored.entries.flatMap((entry) => {
    const current = liveByKey.get(key(entry));
    const changed = current
      ? [
          ...ENTRY_HASHES.filter((name) => entry[name] !== current[name]),
          ...(digest(entry.criteria) === digest(current.criteria)
            ? []
            : ["rubricHash"]),
        ]
      : ["missingInLive"];
    return changed.length === 0
      ? []
      : [{ caseId: entry.caseId, model: entry.options.model, changed }];
  });
  const drift = {
    revisionChanged: stored.source.revision !== live.source.revision,
    sourceHashChanged: stored.source.hash !== live.source.hash,
    datasetHashChanged: stored.datasetHash !== live.datasetHash,
    stored: stored.source,
    live: live.source,
    entries,
    newInLive: live.entries
      .filter((e) => !storedKeys.has(key(e)))
      .map((e) => ({ caseId: e.caseId, model: e.options.model })),
  };
  return {
    ...drift,
    any:
      drift.revisionChanged ||
      drift.sourceHashChanged ||
      drift.datasetHashChanged ||
      entries.length > 0 ||
      drift.newInLive.length > 0,
  };
};

// #379 score plus what the human review adds: inter-judge agreement per
// criterion and pairwise preference win rates. `manifest` is the run's own
// manifest.json (provenance reference); `live`, when given, only feeds the
// liveSourceDrift warning. Pure; cli.ts does the IO.
export const scoreRun = (
  manifest: Manifest,
  responses: unknown,
  judgeFiles: readonly unknown[],
  preferenceFiles: readonly unknown[],
  live?: Manifest,
) => {
  const score = scoreManifest(manifest, attachJudgments(responses, judgeFiles));
  const allJudgments = judgeFiles
    .flatMap((file) => (Array.isArray(file) ? file : []))
    .filter(isJudgmentRecord);
  // Agreement uses confirmed judgments only; unconfirmed reviews (optional
  // flags in かんたん mode) are counted per judge. semanticStatus already
  // treats them as unreviewed through their unrated criteria.
  const judgments = allJudgments.filter(isConfirmedJudgment);
  const items: RatedItem[] = manifest.entries.flatMap((entry) => {
    const raw = entryContent(responses, entry);
    const bound =
      raw === undefined
        ? []
        : judgments.filter(
            (judgment) =>
              judgment.caseId === entry.caseId &&
              judgment.model === entry.options.model &&
              judgmentBound(judgment, raw, entry.criteria),
          );
    return bound.length === 0
      ? []
      : entry.criteria.map((criterion) => ({
          caseId: entry.caseId,
          model: entry.options.model,
          criterionId: criterion.id,
          verdicts: Object.fromEntries(
            bound.map((judgment) => [
              judgment.judgeId,
              judgment.criteria.find((rating) => rating.id === criterion.id)
                ?.verdict ?? "unrated",
            ]),
          ),
        }));
  });
  const models = [...new Set(manifest.entries.map((e) => e.options.model))];
  const caseIds = [...new Set(manifest.entries.map((e) => e.caseId))];
  const preferences = preferenceFiles
    .flatMap((file) => (Array.isArray(file) ? file : []))
    .filter(isPreferenceRecord);
  const boundPreferences = caseIds.flatMap((caseId) => {
    const hashes = Object.fromEntries(
      manifest.entries
        .filter((entry) => entry.caseId === caseId)
        .flatMap((entry) => {
          const raw = entryContent(responses, entry);
          return raw === undefined ? [] : [[entry.options.model, digest(raw)]];
        }),
    );
    return preferences.filter(
      (preference) =>
        preference.caseId === caseId && preferenceBound(preference, hashes),
    );
  });
  const judges = [
    ...new Set([
      ...allJudgments.map((j) => j.judgeId),
      ...preferences.map((p) => p.judgeId),
    ]),
  ].sort();
  const common = items.filter((item) => !item.criterionId.startsWith("case:"));
  const caseSpecific = items
    .filter((item) => item.criterionId.startsWith("case:"))
    .map((item) => ({
      ...item,
      criterionId: `${item.caseId}:${item.criterionId}`,
    }));
  return {
    ...score,
    ...(live ? { liveSourceDrift: sourceDrift(manifest, live) } : {}),
    review: {
      judges: judges.map((judgeId) => ({
        judgeId,
        judgments: allJudgments.filter((j) => j.judgeId === judgeId).length,
        unconfirmedJudgments: allJudgments.filter(
          (j) => j.judgeId === judgeId && !isConfirmedJudgment(j),
        ).length,
        boundJudgments: new Set(
          items
            .filter((item) => judgeId in item.verdicts)
            .map((item) => `${item.caseId}\u0000${item.model}`),
        ).size,
        preferences: boundPreferences.filter((p) => p.judgeId === judgeId)
          .length,
      })),
      agreement: {
        note: "common: the 6 shared criteria pooled over all cases. caseSpecific: each case:* rule only within its own case (caseId:criterionId), because the same id names different rules in different cases; n is at most the number of models there, so its kappa is indicative only.",
        common: agreementByCriterion(common),
        caseSpecific: agreementByCriterion(caseSpecific),
      },
      preferences: {
        recorded: preferences.length,
        bound: boundPreferences.length,
        byModel: preferenceStats(models, boundPreferences),
        positionBias: positionBias(boundPreferences),
        interJudge: preferenceAgreement(boundPreferences),
      },
    },
  };
};
