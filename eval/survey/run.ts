import { existsSync } from "node:fs";
import { resolve } from "node:path";
import axios from "axios";
import { sendOpenRouterRequest } from "../../agents/llm";
import { budgetDecision } from "./budget";
import { surveyCases } from "./dataset";
import {
  httpSucceeded,
  type ManifestEntry,
  prepareManifest,
  structuralChecks,
  validateDataset,
} from "./evaluate";
import { runPaths, writeJsonAtomic } from "./run-dir";
import { dirtyFiles, repoRoot, sourceVersion } from "./source";

// Paid step: sends every manifest entry's production request to OpenRouter once
// and records the answer for cli.ts score and the review GUI.
//   npx tsx eval/survey/run.ts --out <dir> [--max-calls 40] [--max-usd 2]
//     [--concurrency 2] [--allow-dirty]
// --max-calls caps entries; each entry may cost up to 5 billed attempts
// (production withRetry), so --max-usd is the real spend cap. Credits are read
// before every entry.
// Always calls OpenRouter directly; LLM_PROVIDER (local CLI debug) is ignored.

console.log = (...args: unknown[]) => console.error(...args);

const MIN_REMAINING_USD = 1.0;
const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const GENERATION_URL = "https://openrouter.ai/api/v1/generation";

const flag = (name: string) => process.argv.includes(name);
const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const positiveNumber = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(value);
  return value === undefined
    ? fallback
    : Number.isFinite(parsed) && parsed > 0
      ? parsed
      : fail(`not a positive number: ${value}`);
};
const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value === undefined
    ? fallback
    : Number.isInteger(parsed) && parsed > 0
      ? parsed
      : fail(`not a positive integer: ${value}`);
};
const fail = (message: string): never => {
  process.stderr.write(`run.ts: ${message}\n`);
  process.exit(1);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const authHeaders = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
});

const remainingCredits = (apiKey: string): Promise<number> =>
  axios
    .get(CREDITS_URL, { headers: authHeaders(apiKey), timeout: 15000 })
    .then((response) => {
      const data = response.data?.data;
      const total = Number(data?.total_credits);
      const used = Number(data?.total_usage);
      return Number.isFinite(total) && Number.isFinite(used)
        ? total - used
        : Promise.reject(new Error("credits response without totals"));
    });

const assertBudget = (apiKey: string, label: string): Promise<number> =>
  remainingCredits(apiKey)
    .catch((error: unknown) =>
      fail(
        `cannot read OpenRouter credits (${label}): ${axios.isAxiosError(error) ? (error.response?.status ?? error.code) : String(error)}`,
      ),
    )
    .then((remaining) => {
      process.stderr.write(
        `credits ${label}: $${remaining.toFixed(4)} remaining\n`,
      );
      return remaining < MIN_REMAINING_USD
        ? fail(
            `remaining credits $${remaining.toFixed(4)} < $${MIN_REMAINING_USD}; aborting`,
          )
        : remaining;
    });

// OpenRouter's generation stats; the cost is usually there a few seconds after
// the call. Null when it is still unknown.
const generationCost = (
  apiKey: string,
  id: string,
  attempt = 0,
): Promise<number | null> =>
  axios
    .get(GENERATION_URL, {
      params: { id },
      headers: authHeaders(apiKey),
      timeout: 15000,
    })
    .then((response) => {
      const cost = Number(response.data?.data?.total_cost);
      return Number.isFinite(cost) ? cost : null;
    })
    .catch(() =>
      attempt < 3
        ? new Promise<number | null>((done) =>
            setTimeout(
              () => done(generationCost(apiKey, id, attempt + 1)),
              2000 * (attempt + 1),
            ),
          )
        : null,
    );

type Provenance = Readonly<{
  sourceHash: string;
  sourceRevision: string;
  datasetHash: string;
}>;

const callEntry = async (
  entry: ManifestEntry,
  provenance: Provenance,
  apiKey: string,
) => {
  const started = Date.now();
  const attempts = { count: 0 };
  const base = {
    caseId: entry.caseId,
    model: entry.options.model,
    caseHash: entry.caseHash,
    promptHash: entry.promptHash,
    optionsHash: entry.optionsHash,
    requestHash: entry.requestHash,
    ...provenance,
  };
  const outcome = await sendOpenRouterRequest(entry.request, apiKey, () => {
    attempts.count += 1;
  })
    .then((response) => {
      const data = isRecord(response.data) ? response.data : {};
      const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
      const content =
        isRecord(choice) && isRecord(choice.message)
          ? choice.message.content
          : undefined;
      const usage = isRecord(data.usage) ? data.usage : null;
      return {
        httpStatus: response.status,
        rawContent: typeof content === "string" ? content : "",
        ...(typeof content === "string"
          ? {}
          : { errorCode: "missing_content" }),
        generationId: typeof data.id === "string" ? data.id : null,
        servedModel: typeof data.model === "string" ? data.model : null,
        finishReason:
          isRecord(choice) && typeof choice.finish_reason === "string"
            ? choice.finish_reason
            : null,
        usage,
      };
    })
    // Never log the error object: its config carries the Authorization header.
    .catch((error: unknown) => {
      const response = axios.isAxiosError(error) ? error.response : undefined;
      const providerMessage = isRecord(response?.data)
        ? isRecord(response.data.error)
          ? response.data.error.message
          : undefined
        : undefined;
      return {
        httpStatus: response?.status ?? null,
        rawContent: "",
        errorCode: axios.isAxiosError(error)
          ? (error.code ?? "http_error")
          : error instanceof Error
            ? error.name
            : "error",
        errorMessage:
          typeof providerMessage === "string"
            ? providerMessage.slice(0, 500)
            : null,
        generationId: null,
        servedModel: null,
        finishReason: null,
        usage: null,
      };
    });
  return {
    ...base,
    ...outcome,
    attempts: attempts.count,
    latencyMs: Date.now() - started,
    createdAt: new Date().toISOString(),
  };
};
type ResponseRecord = Awaited<ReturnType<typeof callEntry>> & {
  costUsd?: number | null;
};

// Runs `fn` over `items` with at most `limit` in flight, keeping input order.
const pool = <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  const state = { next: 0 };
  const worker = (): Promise<void> => {
    const index = state.next;
    state.next += 1;
    return index >= items.length
      ? Promise.resolve()
      : fn(items[index]).then((result) => {
          results[index] = result;
          return worker();
        });
  };
  return Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  ).then(() => results);
};

const main = async () => {
  const out = option("--out") ?? fail("--out <dir> is required");
  const outDir = resolve(out);
  const maxCalls = positiveInt(option("--max-calls"), 40);
  const concurrency = positiveInt(option("--concurrency"), 2);
  const maxUsd = positiveNumber(option("--max-usd"), 2.0);
  const paths = runPaths(outDir);
  const dirty = dirtyFiles(repoRoot);
  if (dirty.length > 0 && !flag("--allow-dirty")) {
    fail(
      `working tree has uncommitted changes; commit first so source hashes match (or pass --allow-dirty):\n${dirty.join("\n")}`,
    );
  }
  if (existsSync(paths.responses)) {
    fail(`${paths.responses} already exists; use a new --out directory`);
  }
  const datasetErrors = validateDataset(surveyCases);
  if (datasetErrors.length > 0) fail(datasetErrors.join("\n"));
  const apiKey =
    process.env.OPENROUTER_API_KEY ?? fail("OPENROUTER_API_KEY is not set");

  const manifest = prepareManifest(surveyCases, sourceVersion());
  const provenance: Provenance = {
    sourceHash: manifest.source.hash,
    sourceRevision: manifest.source.revision,
    datasetHash: manifest.datasetHash,
  };
  const creditsBefore = await assertBudget(apiKey, "before start");
  writeJsonAtomic(paths.manifest, manifest);
  const entries = manifest.entries.slice(0, maxCalls);
  process.stderr.write(
    `calling ${entries.length} of ${manifest.entries.length} entries, concurrency ${concurrency}\n`,
  );

  const records: ResponseRecord[] = [];
  const save = () => writeJsonAtomic(paths.responses, records);
  const run = { stopped: null as string | null, skipped: 0 };
  const reportedCost = () =>
    records.reduce((sum, record) => {
      const cost = isRecord(record.usage) ? Number(record.usage.cost) : NaN;
      return sum + (Number.isFinite(cost) ? cost : 0);
    }, 0);
  // Checked before every entry: remaining credits and spend since the start.
  const gate = async (): Promise<string | null> => {
    if (run.stopped) return run.stopped;
    const remaining = await remainingCredits(apiKey).catch(() => null);
    const decision =
      remaining === null
        ? { spentUsd: NaN, stop: "cannot read OpenRouter credits" }
        : budgetDecision({
            creditsAtStart: creditsBefore,
            remaining,
            reportedCostUsd: reportedCost(),
            maxUsd,
            minRemainingUsd: MIN_REMAINING_USD,
          });
    run.stopped = run.stopped ?? decision.stop;
    return run.stopped;
  };
  await pool(entries, concurrency, async (entry) => {
    const stop = await gate();
    if (stop) {
      run.skipped += 1;
      process.stderr.write(
        `skip ${entry.caseId} ${entry.options.model}: ${stop}\n`,
      );
      return null;
    }
    const record = await callEntry(entry, provenance, apiKey);
    records.push(record);
    save();
    process.stderr.write(
      `${records.length}/${entries.length} ${record.caseId} ${record.model} -> ${record.httpStatus ?? record.errorCode} (${record.attempts} attempt(s), ${record.latencyMs}ms)\n`,
    );
    return record;
  });

  const costed: ResponseRecord[] = await Promise.all(
    records.map(async (record) => {
      const reported = isRecord(record.usage) ? Number(record.usage.cost) : NaN;
      return {
        ...record,
        costUsd: Number.isFinite(reported)
          ? reported
          : record.generationId
            ? await generationCost(apiKey, record.generationId)
            : null,
      };
    }),
  );
  const order = (record: ResponseRecord) =>
    manifest.entries.findIndex(
      (entry) =>
        entry.caseId === record.caseId && entry.options.model === record.model,
    );
  const sorted = [...costed].sort((a, b) => order(a) - order(b));
  writeJsonAtomic(paths.responses, sorted);

  const models = [...new Set(manifest.entries.map((e) => e.options.model))];
  const statusKeys = sorted.map((r) => String(r.httpStatus ?? r.errorCode));
  const statusCounts = Object.fromEntries(
    [...new Set(statusKeys)].map((key) => [
      key,
      statusKeys.filter((k) => k === key).length,
    ]),
  );
  const summary = {
    outDir,
    calls: sorted.length,
    httpStatus: statusCounts,
    byModel: models.map((model) => {
      const mine = sorted.filter((record) => record.model === model);
      const checks = mine.map((record) => ({
        http: httpSucceeded(record.httpStatus),
        ...structuralChecks(record.rawContent),
      }));
      return {
        model,
        calls: mine.length,
        httpOk: checks.filter((c) => c.http).length,
        structuredAccepted: checks.filter((c) => c.structuredAccepted).length,
        parserAccepted: checks.filter((c) => c.parserAccepted).length,
        runtimeAccepted: checks.filter((c) => c.runtimeAccepted).length,
        exact15: checks.filter((c) => c.exactCount).length,
        structurePass: checks.filter((c) => c.http && c.structure).length,
        costUsd: mine.reduce((sum, record) => sum + (record.costUsd ?? 0), 0),
        costUnknown: mine.filter((record) => record.costUsd == null).length,
        attempts: mine.reduce((sum, record) => sum + record.attempts, 0),
        medianLatencyMs: [...mine.map((r) => r.latencyMs)].sort(
          (a, b) => a - b,
        )[Math.floor(mine.length / 2)],
      };
    }),
    totalCostUsd: sorted.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
    totalAttempts: sorted.reduce((sum, r) => sum + r.attempts, 0),
    stopped: run.stopped,
    skipped: run.skipped,
    maxUsd,
    creditsBefore,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

main().catch((error: unknown) =>
  fail(error instanceof Error ? error.message : "unexpected failure"),
);
