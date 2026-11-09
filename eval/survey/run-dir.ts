import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { JUDGE_ID } from "./judgments";

// File layout of one generation run:
//   <dir>/manifest.json, <dir>/responses.json        (run.ts)
//   <dir>/judgments/<judgeId>.json                    (review GUI)
//   <dir>/preferences/<judgeId>.json                  (review GUI)
//   <dir>/blinding/<judgeId>.json                     (review GUI, seed only)
export const runPaths = (dir: string) => ({
  manifest: join(dir, "manifest.json"),
  responses: join(dir, "responses.json"),
  judgments: join(dir, "judgments"),
  preferences: join(dir, "preferences"),
  blinding: join(dir, "blinding"),
});

export const readJson = (path: string, fallback: unknown = undefined) =>
  existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;

// tmp file in the same directory + rename, so a crash never leaves half a file.
export const writeJsonAtomic = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
};

export const judgeFile = (directory: string, judgeId: string): string => {
  if (!JUDGE_ID.test(judgeId)) {
    throw new Error("judge id must match [a-z0-9_-]+");
  }
  return join(directory, `${judgeId}.json`);
};

// Every <judgeId>.json in a judgments/ or preferences/ directory.
export const readJudgeFiles = (directory: string): readonly unknown[] =>
  existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => /^[a-z0-9_-]{1,64}\.json$/.test(name))
        .sort()
        .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")))
    : [];
