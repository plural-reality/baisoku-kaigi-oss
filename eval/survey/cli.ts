import { readFileSync } from "node:fs";
import { surveyCases } from "./dataset";
import {
  type Manifest,
  prepareManifest,
  scoreManifest,
  validateDataset,
} from "./evaluate";
import { scoreRun } from "./report";
import { readJson, readJudgeFiles, runPaths } from "./run-dir";
import { sourceVersion } from "./source";

// stdout carries the JSON result only; drop the production parser's debug
// logs ("[LLM] ... lenient parse").
console.log = () => {};

const errors = validateDataset(surveyCases);
const [command = "validate", ...args] = process.argv.slice(2);
const manifest = prepareManifest(surveyCases, sourceVersion());
const runDir = args[0] === "--run" ? args[1] : undefined;

// A run is scored against its own manifest.json, so commits after generation
// do not turn its records into invalid_record; differences from the live
// checkout are reported as liveSourceDrift. The legacy form (a bare responses
// file) has no manifest of its own and keeps using the live one.
const score = () =>
  runDir !== undefined
    ? scoreRun(
        readJson(runPaths(runDir).manifest) as Manifest,
        readJson(runPaths(runDir).responses),
        readJudgeFiles(runPaths(runDir).judgments),
        readJudgeFiles(runPaths(runDir).preferences),
        manifest,
      )
    : scoreManifest(
        manifest,
        JSON.parse(
          readFileSync(!args[0] || args[0] === "-" ? 0 : args[0], "utf8"),
        ),
      );

const output =
  errors.length > 0
    ? { errors }
    : command === "validate"
      ? {
          valid: true,
          version: manifest.datasetVersion,
          cases: surveyCases.length,
        }
      : command === "prepare"
        ? manifest
        : command === "score" && !(args[0] === "--run" && !runDir)
          ? score()
          : {
              errors: [
                "Usage: tsx eval/survey/cli.ts validate|prepare|score [responses.json|-|--run <dir>]",
              ],
            };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exitCode = "errors" in output ? 1 : 0;
