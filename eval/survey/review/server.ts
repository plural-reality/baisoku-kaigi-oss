import { resolve } from "node:path";
import { startReviewServer } from "./app";

// Local single-user review GUI for one run directory.
//   npx tsx eval/survey/review/server.ts --run <dir> --judge <id> [--port 4310]
//     [--host 127.0.0.1] [--allow-host <name>]

console.log = () => {}; // production parser debug lines

const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const fail = (message: string): never => {
  process.stderr.write(`review server: ${message}\n`);
  process.exit(1);
};

const runDir = resolve(option("--run") ?? fail("--run <dir> is required"));
const judgeId = option("--judge") ?? fail("--judge <id> is required");
const port = Number(option("--port") ?? 4310);
if (!Number.isInteger(port) || port <= 0 || port > 65535) fail("bad --port");
const host = option("--host") ?? "127.0.0.1";
const allowHosts = process.argv.flatMap((arg, index) =>
  process.argv[index - 1] === "--allow-host" ? [arg] : [],
);

startReviewServer({ runDir, judgeId, port, host, allowHosts })
  .then(({ url }) =>
    process.stderr.write(
      `review server: ${url}/ judge=${judgeId} run=${runDir}\n`,
    ),
  )
  .catch((error: unknown) =>
    fail(error instanceof Error ? error.message : String(error)),
  );
