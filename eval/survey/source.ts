import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { digest } from "./evaluate";

export const repoRoot = resolve(__dirname, "../..");

// Files whose content decides what is sent to the model and how the answer is
// scored. Their hash is recorded with every response, so a record produced by
// a different checkout is reported as invalid_record instead of being mixed in.
export const SOURCES = [
  "agents/llm.ts",
  "agents/llm-retry.ts",
  "agents/survey-validation.ts",
  "app/lib/llm-structured-output.ts",
  "app/lib/llm-models.ts",
  "app/lib/untrusted-text.ts",
  "app/lib/content-language.ts",
  "eval/survey/types.ts",
  "eval/survey/dataset.ts",
  "eval/survey/evaluate.ts",
  "eval/survey/source.ts",
  "eval/survey/cli.ts",
  "eval/survey/run.ts",
  "eval/survey/budget.ts",
  "agents/__tests__/fixtures/survey-statements.json",
] as const;

const git = (args: readonly string[], root: string): string =>
  execFileSync("git", [...args], { cwd: root, encoding: "utf8" }).trim();

export const sourceVersion = (root: string = repoRoot) => ({
  revision: git(["rev-parse", "HEAD"], root),
  hash: digest(
    SOURCES.map((path) => ({
      path,
      content: readFileSync(resolve(root, path), "utf8"),
    })),
  ),
});

// Tracked changes only: an untracked file cannot be one of SOURCES.
export const dirtyFiles = (root: string = repoRoot): readonly string[] =>
  execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line.trim().length > 0);
