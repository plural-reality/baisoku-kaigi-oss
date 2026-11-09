import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { basename, join } from "node:path";
import type { Manifest } from "../evaluate";
import {
  isJudgmentRecord,
  isPreferenceRecord,
  JUDGE_ID,
  type JudgmentRecord,
  MAX_NOTE,
  type PreferenceRecord,
  validateRatings,
} from "../judgments";
import { judgeFile, readJson, runPaths, writeJsonAtomic } from "../run-dir";
import { deriveRatings, type Mode, validateReview } from "./flow";
import {
  buildCaseStates,
  caseComplete,
  caseCompleteIn,
  completeOrder,
  judgeSummary,
  judgmentRecord,
  preferenceRecord,
  publicCase,
  REASON_TAGS,
  SLOTS,
  type Slot,
  upsert,
} from "./state";

// The review GUI's HTTP server for one run directory and one judge. Reads only
// <run>/{manifest,responses}.json and index.html; writes only
// <run>/{judgments,preferences,blinding}/<judgeId>.json. server.ts is the CLI.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type ReviewServerOptions = Readonly<{
  runDir: string;
  judgeId: string;
  port: number; // 0 picks a free port
  host: string;
  allowHosts?: readonly string[];
}>;

const fail = (message: string): never => {
  throw new Error(message);
};

export const startReviewServer = (
  options: ReviewServerOptions,
): Promise<{ url: string; port: number; close: () => Promise<void> }> => {
  const { judgeId, runDir } = options;
  if (!JUDGE_ID.test(judgeId)) fail("judge id must match [a-z0-9_-]+");
  const paths = runPaths(runDir);
  if (!existsSync(paths.responses)) fail(`${paths.responses} is missing`);
  const manifest = readJson(paths.manifest) as Manifest | undefined;
  if (!manifest || !Array.isArray(manifest.cases)) {
    fail(`${paths.manifest} is missing or has no cases (rerun run.ts)`);
  }
  const run = {
    cases: manifest?.cases ?? [],
    entries: manifest?.entries ?? [],
    responses: readJson(paths.responses, []),
  };
  const files = {
    judgments: judgeFile(paths.judgments, judgeId),
    preferences: judgeFile(paths.preferences, judgeId),
    blinding: judgeFile(paths.blinding, judgeId),
  };

  // Blinding state per judge: the seed and the per-case left/right order (stored
  // so the order never changes once a judge has seen it), plus unblindedAt once
  // the summary has shown model names. Never leaves the server.
  const models = [...new Set(run.entries.map((e) => e.options.model))];
  if (models.length !== 2) fail("the review compares exactly two models");
  const modelPair = [models[0], models[1]] as const;
  const blinding = (() => {
    const stored = readJson(files.blinding);
    const previous = isRecord(stored) ? stored : {};
    const seed =
      typeof previous.seed === "string"
        ? previous.seed
        : randomBytes(16).toString("hex");
    // Spread first so an existing file keeps its keys, order and any extra
    // fields: loading never rewrites a blinding file that is already complete.
    const next = {
      ...previous,
      judgeId,
      seed,
      order: completeOrder(
        previous.order,
        seed,
        run.cases.map((item) => item.id),
        modelPair,
      ),
      createdAt:
        typeof previous.createdAt === "string"
          ? previous.createdAt
          : new Date().toISOString(),
      unblindedAt:
        typeof previous.unblindedAt === "string" ? previous.unblindedAt : null,
    };
    if (JSON.stringify(next) !== JSON.stringify(stored)) {
      writeJsonAtomic(files.blinding, next);
    }
    return next;
  })();
  const lock = {
    unblindedAt: blinding.unblindedAt as string | null,
    mode: ((blinding as Record<string, unknown>).unblindMode === "quick"
      ? "quick"
      : "full") as Mode,
  };
  const LOCKED_MESSAGE =
    "集計でモデル名を表示したため、この判定者の判定はロックされています。盲検が解けた後の修正は受け付けません。";
  const CONFLICT_MESSAGE = "別のタブで更新されました。最新を読み込みました";

  const loadJudgments = (): JudgmentRecord[] =>
    (readJson(files.judgments, []) as unknown[]).filter(isJudgmentRecord);
  const loadPreferences = (): PreferenceRecord[] =>
    (readJson(files.preferences, []) as unknown[]).filter(isPreferenceRecord);
  const states = () =>
    buildCaseStates(
      run,
      blinding.order,
      judgeId,
      loadJudgments(),
      loadPreferences(),
    );

  // Strictly after the stored value, so a base taken from it never matches twice.
  const nextUpdatedAt = (current: string | null): string => {
    const now = Date.now();
    const floor = current === null ? 0 : Date.parse(current) + 1;
    return new Date(Math.max(now, floor)).toISOString();
  };
  const baseOf = (body: Record<string, unknown>) =>
    typeof body.baseUpdatedAt === "string" ? body.baseUpdatedAt : null;

  // Serialise writes so two quick autosaves cannot interleave read-modify-write.
  const queue = { tail: Promise.resolve() as Promise<unknown> };
  const serial = <T>(task: () => T): Promise<T> => {
    const next = queue.tail.then(task, task);
    queue.tail = next.catch(() => undefined);
    return next;
  };

  const html = readFileSync(join(__dirname, "index.html"), "utf8");
  const runKey = `${basename(runDir)}:${manifest?.source.hash.slice(0, 12)}`;

  // Host / Origin allowlist against DNS rebinding. Binding to 0.0.0.0 needs the
  // name clients will use: --allow-host <name> (repeatable).
  const bound = { port: options.port };
  const allowedHosts = {
    has: (value: string) =>
      [options.host, "127.0.0.1", "localhost", ...(options.allowHosts ?? [])]
        .map((name) => `${name}:${bound.port}`)
        .includes(value),
  };

  const send = (
    res: ServerResponse,
    status: number,
    body: string,
    type: string,
    extra: Record<string, string> = {},
  ) => {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      ...extra,
    });
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, value: unknown) =>
    send(res, status, JSON.stringify(value), "application/json; charset=utf-8");

  const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((done, reject) => {
      const chunks: Buffer[] = [];
      const size = { total: 0 };
      req.on("data", (chunk: Buffer) => {
        size.total += chunk.length;
        if (size.total > 256 * 1024) {
          reject(new Error("body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        try {
          done(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new Error("invalid json"));
        }
      });
      req.on("error", reject);
    });

  const saveJudgment = (body: unknown) =>
    serial(() => {
      if (!isRecord(body)) return { status: 400, value: { error: "bad body" } };
      if (lock.unblindedAt) return locked();
      const state = states().find((s) => s.item.id === body.caseId);
      const output = state?.outputs.find((o) => o.slot === body.slot);
      if (!state || !output) {
        return { status: 404, value: { error: "unknown case or slot" } };
      }
      if (!output.judgeable) {
        return { status: 409, value: { error: "output has no content" } };
      }
      // New page: a review (flags, set answers, confirmation) from which the
      // ratings are derived. Earlier page / API clients: the ratings directly.
      const count = output.checks.statements?.length ?? null;
      const review =
        body.review === undefined
          ? null
          : validateReview(state.criteria, count, body.review);
      const ratings =
        review === null
          ? validateRatings(state.criteria, body.criteria)
          : review.ok
            ? validateRatings(
                state.criteria,
                deriveRatings(state.criteria, review.value, count),
              )
            : review;
      const note = typeof body.note === "string" ? body.note : "";
      if (!ratings.ok || note.length > MAX_NOTE) {
        return {
          status: 422,
          value: { errors: ratings.ok ? ["note too long"] : ratings.errors },
        };
      }
      const current = output.judgment?.updatedAt ?? null;
      if (baseOf(body) !== current) return conflict(state.item.id);
      const record = judgmentRecord(
        state,
        output,
        judgeId,
        ratings.value,
        note,
        nextUpdatedAt(current),
        review?.ok ? review.value : undefined,
      );
      writeJsonAtomic(
        files.judgments,
        upsert(
          loadJudgments(),
          record,
          (a, b) => a.caseId === b.caseId && a.model === b.model,
        ),
      );
      return { status: 200, value: caseView(String(body.caseId)) };
    });

  const savePreference = (body: unknown) =>
    serial(() => {
      if (!isRecord(body)) return { status: 400, value: { error: "bad body" } };
      if (lock.unblindedAt) return locked();
      const state = states().find((s) => s.item.id === body.caseId);
      const winner = body.winner;
      const reason = typeof body.reason === "string" ? body.reason : "";
      const reasonTags = Array.isArray(body.reasonTags) ? body.reasonTags : [];
      if (!state) return { status: 404, value: { error: "unknown case" } };
      const errors = [
        ...(winner === "tie" || SLOTS.includes(winner as Slot)
          ? []
          : ["winner must be A, B or tie"]),
        ...(reason.length > MAX_NOTE ? ["reason too long"] : []),
        ...(reasonTags.every(
          (tag) => typeof tag === "string" && REASON_TAGS.includes(tag),
        )
          ? []
          : [`reasonTags must be from: ${REASON_TAGS.join(", ")}`]),
      ];
      if (errors.length > 0) return { status: 422, value: { errors } };
      if (!state.outputs.every((output) => output.judgeable)) {
        return { status: 409, value: { error: "both outputs are needed" } };
      }
      const current = state.preference?.updatedAt ?? null;
      if (baseOf(body) !== current) return conflict(state.item.id);
      const record = preferenceRecord(
        state,
        judgeId,
        winner as Slot | "tie",
        reason,
        nextUpdatedAt(current),
        [...new Set(reasonTags as string[])],
      );
      writeJsonAtomic(
        files.preferences,
        upsert(loadPreferences(), record, (a, b) => a.caseId === b.caseId),
      );
      return { status: 200, value: caseView(state.item.id) };
    });

  const unblind = (body: unknown) =>
    serial(() => {
      if (lock.unblindedAt !== null) {
        return { status: 200, value: { unblindedAt: lock.unblindedAt } };
      }
      const mode: Mode =
        isRecord(body) && body.mode === "quick" ? "quick" : "full";
      if (!isRecord(body) || body.confirm !== true) {
        return { status: 422, value: { errors: ["confirm must be true"] } };
      }
      const all = states();
      if (!all.every((state) => caseCompleteIn(mode, state))) {
        return {
          status: 403,
          value: { error: "summary unlocks after all cases" },
        };
      }
      lock.unblindedAt = new Date().toISOString();
      lock.mode = mode;
      writeJsonAtomic(files.blinding, {
        ...blinding,
        unblindedAt: lock.unblindedAt,
        unblindMode: mode,
      });
      return { status: 200, value: { unblindedAt: lock.unblindedAt, mode } };
    });

  const locked = () => ({
    status: 409,
    value: { error: "locked", message: LOCKED_MESSAGE },
  });
  const conflict = (caseId: string) => ({
    status: 409,
    value: {
      error: "conflict",
      message: CONFLICT_MESSAGE,
      case: caseView(caseId),
    },
  });

  const caseView = (caseId: string) => {
    const state = states().find((s) => s.item.id === caseId);
    return state ? publicCase(state) : null;
  };

  const route = async (req: IncomingMessage, res: ServerResponse) => {
    const rawUrl = req.url ?? "/";
    // Only fixed routes exist; anything path-like is refused outright.
    if (/\.\.|%2e|%2f|%5c|\\/i.test(rawUrl)) {
      return json(res, 400, { error: "bad path" });
    }
    if (!allowedHosts.has(req.headers.host ?? "")) {
      return json(res, 421, { error: "unexpected host" });
    }
    const { pathname } = new URL(rawUrl, "http://localhost");
    const method = req.method ?? "GET";
    if (method === "PUT" || method === "POST") {
      const origin = req.headers.origin;
      if (
        origin !== undefined &&
        !allowedHosts.has(origin.replace(/^http:\/\//, ""))
      ) {
        return json(res, 403, { error: "cross-origin write" });
      }
      if (!String(req.headers["content-type"]).startsWith("application/json")) {
        return json(res, 415, { error: "json only" });
      }
    }
    if (method === "GET" && pathname === "/") {
      const nonce = randomBytes(16).toString("base64");
      return send(
        res,
        200,
        html.replaceAll("__NONCE__", nonce),
        "text/html; charset=utf-8",
        {
          "Content-Security-Policy": [
            "default-src 'none'",
            `script-src 'nonce-${nonce}'`,
            `style-src 'nonce-${nonce}'`,
            "connect-src 'self'",
            "img-src 'self' data:",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'",
          ].join("; "),
        },
      );
    }
    if (method === "GET" && pathname === "/api/state") {
      const all = states();
      return json(res, 200, {
        judgeId,
        runKey,
        datasetVersion: manifest?.datasetVersion,
        locked: lock.unblindedAt !== null,
        unblindedAt: lock.unblindedAt,
        lockedMessage: LOCKED_MESSAGE,
        cases: all.map(publicCase),
      });
    }
    // Model names: readable only after an explicit POST /api/unblind.
    if (method === "GET" && pathname === "/api/summary") {
      if (lock.unblindedAt === null) {
        return json(res, 403, { error: "not unblinded" });
      }
      const all = states();
      return json(res, 200, {
        ...judgeSummary(all),
        mode: lock.mode,
        fullyJudged: all.filter(caseComplete).length,
        unblindedAt: lock.unblindedAt,
      });
    }
    // The only state change that shows model names. POST + JSON + Origin/Host
    // checks (above), so a cross-site page or a prefetch cannot trigger it.
    if (method === "POST" && pathname === "/api/unblind") {
      const result = await unblind(await readBody(req));
      return json(res, result.status, result.value);
    }
    if (method === "PUT" && pathname === "/api/judgment") {
      const result = await saveJudgment(await readBody(req));
      return json(res, result.status, result.value);
    }
    if (method === "PUT" && pathname === "/api/preference") {
      const result = await savePreference(await readBody(req));
      return json(res, result.status, result.value);
    }
    return json(res, 404, { error: "not found" });
  };

  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) =>
      json(res, 400, {
        error: error instanceof Error ? error.message : "bad request",
      }),
    );
  });
  return new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      bound.port =
        typeof address === "object" && address ? address.port : options.port;
      done({
        url: `http://${options.host}:${bound.port}`,
        port: bound.port,
        close: () =>
          new Promise<void>((closed) => {
            server.close(() => closed());
            server.closeAllConnections();
          }),
      });
    });
  });
};
