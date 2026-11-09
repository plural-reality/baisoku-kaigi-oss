import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { surveyCases } from "../dataset";
import { digest, type Manifest, prepareManifest } from "../evaluate";
import { startReviewServer } from "../review/app";
import { balancedOrder } from "../review/state";

// jsdom ships with vitest's dependencies but without type declarations here;
// type only what this test touches.
type DomWindow = Window &
  typeof globalThis & {
    close: () => void;
    KeyboardEvent: typeof KeyboardEvent;
    Event: typeof Event;
  };
const { JSDOM } = createRequire(__filename)("jsdom") as {
  JSDOM: new (
    html: string,
    options: {
      url: string;
      runScripts: "dangerously";
      pretendToBeVisual: boolean;
      beforeParse: (window: DomWindow) => void;
    },
  ) => { window: DomWindow };
};

// Runs the real page script (review/index.html) in jsdom against a real
// review server, to check what the page sends — not just what the server does.

const stored: Manifest = JSON.parse(
  JSON.stringify(prepareManifest(surveyCases, { revision: "r", hash: "h" })),
);
const models = [...new Set(stored.entries.map((e) => e.options.model))] as [
  string,
  string,
];
const responses = stored.entries.map((entry) => ({
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
    statements: Array.from(
      { length: 15 },
      (_, i) =>
        `${digest([entry.caseId, entry.options.model, i]).slice(0, 12)}を優先する`,
    ),
  }),
}));
const legacyCases = ["library", "park", "meeting"];
const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

// Files shaped exactly like those the per-criterion page wrote for the owner:
// six criteria 合格 with default evidence, diverse 保留 「判断保留」, preference 同等.
const writeLegacyRun = (dir: string) => {
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(stored));
  writeFileSync(join(dir, "responses.json"), JSON.stringify(responses));
  ["judgments", "preferences", "blinding"].forEach((d) => {
    mkdirSync(join(dir, d));
  });
  const entries = stored.entries.filter((e) => legacyCases.includes(e.caseId));
  writeFileSync(
    join(dir, "judgments", "legacy.json"),
    pretty(
      entries.map((entry, i) => ({
        caseId: entry.caseId,
        model: entry.options.model,
        outputHash: digest(
          responses.find(
            (r) => r.caseId === entry.caseId && r.model === entry.options.model,
          )?.rawContent,
        ),
        rubricHash: digest(entry.criteria),
        judgeId: "legacy",
        criteria: entry.criteria.map((c) =>
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
        ),
        note: "",
        updatedAt: `2026-11-08T11:56:22.9${40 + i}Z`,
      })),
    ),
  );
  const order = balancedOrder(
    "legacy-seed",
    surveyCases.map((c) => c.id),
    models,
  );
  writeFileSync(
    join(dir, "preferences", "legacy.json"),
    pretty(
      legacyCases.map((caseId, i) => ({
        caseId,
        judgeId: "legacy",
        winner: "tie",
        shownLeft: order[caseId][0],
        reason: "",
        outputHashes: Object.fromEntries(
          models.map((model) => [
            model,
            digest(
              responses.find((r) => r.caseId === caseId && r.model === model)
                ?.rawContent,
            ),
          ]),
        ),
        updatedAt: `2026-11-08T11:5${6 + i}:22.953Z`,
      })),
    ),
  );
  writeFileSync(
    join(dir, "blinding", "legacy.json"),
    pretty({
      judgeId: "legacy",
      seed: "legacy-seed",
      order,
      createdAt: "2026-11-08T06:37:49.319Z",
      unblindedAt: null,
    }),
  );
};

const files = (dir: string) =>
  ["judgments", "preferences", "blinding"].map((d) => {
    const path = join(dir, d, "legacy.json");
    return {
      path,
      bytes: readFileSync(path, "utf8"),
      mtime: statSync(path).mtimeMs,
    };
  });

const until = async (check: () => boolean, ms = 4000) => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("review page in jsdom against a real server", () => {
  const cleanup: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  it("opening and leaving legacy cases sends no PUT and leaves the files byte-identical", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-page-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    writeLegacyRun(dir);
    const before = files(dir);
    const server = await startReviewServer({
      runDir: dir,
      judgeId: "legacy",
      port: 0,
      host: "127.0.0.1",
    });
    cleanup.push(server.close);
    // Starting the server rewrote nothing.
    expect(files(dir)).toEqual(before);

    const requests: { method: string; path: string }[] = [];
    const html = readFileSync(
      join(__dirname, "..", "review", "index.html"),
      "utf8",
    ).replaceAll("__NONCE__", "test");
    const dom = new JSDOM(html, {
      url: `${server.url}/#library`,
      runScripts: "dangerously",
      pretendToBeVisual: true,
      beforeParse(window) {
        const w = window as unknown as Record<string, unknown>;
        w.fetch = (path: string, init?: RequestInit) => {
          requests.push({ method: init?.method ?? "GET", path });
          return fetch(new URL(path, server.url), init);
        };
        w.ResizeObserver = class {
          observe() {}
        };
        w.scrollTo = () => {};
        window.HTMLElement.prototype.scrollIntoView = () => {};
      },
    });
    cleanup.push(() => dom.window.close());
    const doc = dom.window.document;
    await until(() => doc.querySelector(".cell") !== null);
    expect(doc.querySelector("#progress")?.textContent).toBe("ケース 1 / 20");
    // The legacy hold is shown as 保留, not as the default 満たす.
    const holdButtons = [
      ...doc.querySelectorAll('.setq button.hold[aria-pressed="true"]'),
    ];
    expect(holdButtons.map((b) => b.textContent)).toEqual([
      "保留（判断保留）",
      "保留（判断保留）",
    ]);
    const press = (key: string) =>
      doc.body.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
      );
    for (const expected of [
      "ケース 2 / 20",
      "ケース 3 / 20",
      "ケース 4 / 20",
    ]) {
      press("ArrowRight");
      await until(
        () => doc.querySelector("#progress")?.textContent === expected,
      );
    }
    press("ArrowLeft");
    await until(
      () => doc.querySelector("#progress")?.textContent === "ケース 3 / 20",
    );
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    await new Promise((r) => setTimeout(r, 300));
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(files(dir)).toEqual(before);
  });
});
