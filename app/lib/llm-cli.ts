import { spawn } from "node:child_process";

// --- Local CLI backend (dev only) -----------------------------------------
// When LLM_PROVIDER=claude-cli, route completions through the locally
// authenticated `claude -p` (or codex) CLI instead of OpenRouter. This lets
// local demos / full-local debugging use the developer's Claude/Codex
// subscription with no API credits. Never set LLM_PROVIDER in production — it
// falls through to OpenRouter.
//
// This is the single canonical CLI bridge, shared by BOTH the app-side LLM
// client (app/lib/llm.ts) and the agent runtime (agents/llm.ts) so that the
// whole AI flow — including the 進行ログ / 自動進行 / 質問生成 / 分析 driven by
// the agent — is debuggable locally with one env switch.

export interface CliLLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CliBackend {
  bin: string;
  args: string[];
}

// Default to sonnet — fast enough for local avatar/report calls while clearly
// better than haiku. Opus on a big prompt blows past the timeout; haiku is
// available via CLAUDE_CLI_MODEL=haiku if you want minimum latency.
const CLAUDE_CLI_MODEL = process.env.CLAUDE_CLI_MODEL ?? "sonnet";

// A big survey-analysis prompt via `sonnet -p` runs ~177s — the old 180s timeout
// sat right on that edge and SIGKILLed it whenever LLM latency drifted over, so
// "分析の生成に失敗" looked random but was a too-tight margin. Give real headroom
// (configurable) and retry transient non-timeout failures; the CLI path otherwise
// had zero retry (the app-side retry loop is OpenRouter-only).
const CLI_TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS) || 300000;
const CLI_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.CLAUDE_CLI_MAX_ATTEMPTS) || 2,
);

const CLI_BACKENDS: Record<string, CliBackend> = {
  "claude-cli": {
    // --strict-mcp-config + empty --setting-sources skip the dev's MCP servers,
    // hooks, skills and CLAUDE.md, cutting ~40s of per-call harness startup
    // (auth is kept). Huge speedup for suggestions/reports/cluster narratives.
    bin: process.env.CLAUDE_CLI_PATH ?? "claude",
    args: [
      "-p",
      "--model",
      CLAUDE_CLI_MODEL,
      "--strict-mcp-config",
      "--setting-sources",
      "",
    ],
  },
  "codex-cli": {
    bin: process.env.CODEX_CLI_PATH ?? "codex",
    args: ["exec", "-"],
  },
};

export function localCliBackend(): CliBackend | null {
  const provider = process.env.LLM_PROVIDER;
  return provider ? (CLI_BACKENDS[provider] ?? null) : null;
}

// Flatten the chat messages into a single prompt the CLI can read from stdin.
function messagesToPrompt(messages: CliLLMMessage[]): string {
  return messages.map((m) => m.content).join("\n\n");
}

// Timeout is non-retryable (a SIGKILLed slow call would just be slow again, and
// the caller is a synchronous request); everything else — empty output, non-zero
// exit, spawn error — is a transient worth one more shot.
class CliTimeoutError extends Error {}

function spawnCliOnce(backend: CliBackend, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(backend.bin, backend.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      reject(
        new CliTimeoutError(
          `Local CLI LLM timed out after ${CLI_TIMEOUT_MS}ms`,
        ),
      );
    }, CLI_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0 && out.trim().length > 0) {
        resolve(out.trim());
      } else {
        reject(
          new Error(
            `Local CLI LLM exited ${code}: ${err.slice(0, 300) || "no output"}`,
          ),
        );
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export async function callViaCli(
  backend: CliBackend,
  messages: CliLLMMessage[],
): Promise<string> {
  const prompt = messagesToPrompt(messages);
  let lastError: unknown;
  for (let attempt = 1; attempt <= CLI_MAX_ATTEMPTS; attempt++) {
    try {
      return await spawnCliOnce(backend, prompt);
    } catch (error) {
      lastError = error;
      if (error instanceof CliTimeoutError || attempt >= CLI_MAX_ATTEMPTS) {
        break;
      }
      console.warn(
        `[LLM-CLI] attempt ${attempt}/${CLI_MAX_ATTEMPTS} failed, retrying:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  throw lastError;
}
