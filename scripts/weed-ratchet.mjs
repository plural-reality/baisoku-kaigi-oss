#!/usr/bin/env node
// Weed ratchet: per-file counts of patterns that agents copy as if they were the
// house style. A file may not gain any; when a file loses some, lower the
// baseline with --update so the gain cannot come back.
//
//   node scripts/weed-ratchet.mjs           check against the baseline
//   node scripts/weed-ratchet.mjs --update  rewrite the baseline from the tree

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASELINE = "scripts/weed-ratchet.baseline.json";
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST = /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests|e2e)\/)/;
const SKIP =
  /(^|\/)(node_modules|\.next|dist|build|public)\/|\.d\.ts$|database\.types\.ts$/;

const WEEDS = [
  {
    kind: "useEffect",
    pattern: /\buse(Layout)?Effect\s*\(/g,
    tests: false,
    why: "An effect that syncs state, fetches or waits is a workaround the next change will copy. Derive the value during render, handle it in the event handler, or move it into a hook that owns the external system.",
  },
  {
    kind: "timer",
    pattern:
      /\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/g,
    tests: false,
    why: "A timer that waits for something to settle hides a missing event or a race. Wait on the event, promise or state that actually signals readiness.",
  },
  {
    kind: "suppression",
    pattern:
      /(biome-ignore|eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck)/g,
    tests: true,
    why: "A suppression turns a failing check into a comment. Fix what the rule reports.",
  },
  {
    kind: "doubleCast",
    pattern: /\bas\s+unknown\s+as\b/g,
    tests: false,
    why: "`as unknown as` tells the compiler to stop checking. Parse the value or fix the type at its source.",
  },
];

const listFiles = () =>
  execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    {
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter(
      (f) =>
        SOURCE.test(f) &&
        !SKIP.test(f) &&
        f !== "scripts/weed-ratchet.mjs" &&
        existsSync(f),
    );

const countFile = (file) => {
  const text = readFileSync(file, "utf8");
  const isTest = TEST.test(file);
  return Object.fromEntries(
    WEEDS.filter((w) => w.tests || !isTest)
      .map((w) => [w.kind, (text.match(w.pattern) ?? []).length])
      .filter(([, n]) => n > 0),
  );
};

const measure = () =>
  Object.fromEntries(
    listFiles()
      .sort()
      .map((f) => [f, countFile(f)])
      .filter(([, counts]) => Object.keys(counts).length > 0),
  );

const totals = (table) =>
  Object.values(table).reduce(
    (acc, counts) =>
      Object.fromEntries(
        WEEDS.map(({ kind }) => [kind, (acc[kind] ?? 0) + (counts[kind] ?? 0)]),
      ),
    {},
  );

const current = measure();

const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, "utf8"))
  : {};

if (process.argv.includes("--update")) {
  const before = totals(baseline);
  const after = totals(current);
  const grewTotal = WEEDS.filter(
    ({ kind }) => after[kind] > (before[kind] ?? 0),
  );
  if (existsSync(BASELINE) && grewTotal.length > 0) {
    console.error(
      `weed-ratchet: refusing to raise the baseline (${grewTotal
        .map(({ kind }) => `${kind} ${before[kind] ?? 0} -> ${after[kind]}`)
        .join(
          ", ",
        )}). Remove the new ones instead; moving one between files is fine.`,
    );
    process.exit(1);
  }
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`weed-ratchet: baseline written ${JSON.stringify(after)}`);
  process.exit(0);
}

const diffs = Object.entries(current).flatMap(([file, counts]) =>
  Object.entries(counts).map(([kind, n]) => ({
    file,
    kind,
    n,
    was: baseline[file]?.[kind] ?? 0,
  })),
);
const grown = diffs.filter((d) => d.n > d.was);
const shrunk = Object.entries(baseline).flatMap(([file, counts]) =>
  Object.entries(counts)
    .map(([kind, was]) => ({ file, kind, was, n: current[file]?.[kind] ?? 0 }))
    .filter((d) => d.n < d.was),
);

const report = grown
  .map(
    ({ file, kind, n, was }) =>
      `${file}: ${kind} ${was} -> ${n}. ${WEEDS.find((w) => w.kind === kind).why}`,
  )
  .join("\n");
if (report) console.error(report);
if (shrunk.length > 0) {
  console.log(
    `weed-ratchet: ${shrunk.length} count(s) went down. Run \`node scripts/weed-ratchet.mjs --update\` to lock it in.`,
  );
}
if (grown.length > 0) {
  console.error(
    `weed-ratchet: ${grown.length} file/kind count(s) grew past ${BASELINE}.`,
  );
  process.exit(1);
}
console.log(`weed-ratchet: OK ${JSON.stringify(totals(current))}`);
