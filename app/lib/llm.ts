import { recordLLMUsage, withLLMLimit } from "@agents/llm-limiter";
import * as Sentry from "@sentry/nextjs";
import axios from "axios";
import { type ContentLanguage, withOutputLanguage } from "./content-language";
import { callViaCli, localCliBackend } from "./llm-cli";
import {
  UNTRUSTED_DATA_RULE,
  untrustedName,
  wrapUntrusted,
} from "./untrusted-text";

const OPENROUTER_API_URL =
  process.env.OPENROUTER_API_URL ??
  "https://openrouter.ai/api/v1/chat/completions";
export const FAST_MODEL = "google/gemini-3.5-flash";
export const ACCURATE_MODEL = "google/gemini-3.1-pro-preview";
const DEFAULT_MODEL = ACCURATE_MODEL;
const DEFAULT_STREAM_MODEL = FAST_MODEL;
const STREAM_TIMEOUT_MS = 300000;

const isDebug = process.env.NODE_ENV !== "production";

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function buildSessionBrief(
  goal?: string | null,
  context?: string | null,
): string {
  const sections: string[] = [];
  const trimmedGoal = goal?.trim();
  const trimmedContext = context?.trim();

  if (trimmedGoal) {
    sections.push(`## Goal\n${trimmedGoal}`);
  }

  if (trimmedContext) {
    sections.push(`## Background\n${trimmedContext}`);
  }

  if (sections.length === 0) {
    return "## Goal\n(未設定)";
  }

  return sections.join("\n\n");
}

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 2000;
const MAX_RETRY_AFTER_MS = 60000;

class RetryableLLMResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableLLMResponseError";
  }
}

// Thrown when an LLM call ultimately fails. Carries the upstream HTTP status so
// callers (e.g. the session-report UI) can show the real reason — a credit/rate
// limit vs a generic failure — instead of a blind "try again". The message is
// status-derived and intentionally stable so existing string assertions hold.
export class LLMUnavailableError extends Error {
  readonly status?: number;
  // Provider's own short reason (OpenRouter `error.message`), if any — lets
  // callers distinguish a key-limit 403 from a moderation/permission 403.
  readonly providerMessage?: string;
  constructor(status?: number, providerMessage?: string) {
    super(
      status === 429
        ? "Rate limit exceeded. Please try again in a moment."
        : "Failed to call LLM API",
    );
    this.name = "LLMUnavailableError";
    this.status = status;
    this.providerMessage = providerMessage;
  }
}

function parseChoiceErrorCode(error: {
  code?: number | string | null;
}): number | null {
  if (typeof error.code === "number") {
    return error.code;
  }
  if (typeof error.code === "string") {
    const numeric = Number(error.code);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
  }
  return null;
}

function isRetryableChoiceError(error: {
  code?: number | string | null;
  metadata?: {
    error_type?: string | null;
  } | null;
}): boolean {
  const code = parseChoiceErrorCode(error);
  if (code !== null && [429, 500, 502, 503, 504].includes(code)) {
    return true;
  }
  const errorType = error.metadata?.error_type;
  if (typeof errorType === "string") {
    return ["provider_unavailable", "rate_limited", "server_error"].includes(
      errorType,
    );
  }
  return false;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof RetryableLLMResponseError) {
    return true;
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 429 || status === 502 || status === 503) return true;
  }
  if (
    error instanceof Error &&
    ["ECONNABORTED", "ETIMEDOUT", "ECONNRESET"].includes(
      (error as Error & { code?: string }).code ?? "",
    )
  ) {
    return true;
  }
  return false;
}

function getBackoffDelay(attempt: number, error: unknown): number {
  if (axios.isAxiosError(error) && error.response?.status === 429) {
    const retryAfter = error.response.headers?.["retry-after"];
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (!Number.isNaN(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
      }
    }
  }
  return BASE_BACKOFF_MS * 2 ** attempt;
}

// Retry backoff that ends early (rejecting) when the caller gives up, so an
// aborted call never waits out a backoff only to discover it is no longer wanted.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LLMAbortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LLMAbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Thrown when the caller's AbortSignal fired (client disconnected, or a
// generation exceeded its time budget). Not an upstream failure: no retry and
// no Sentry event.
export class LLMAbortedError extends Error {
  constructor() {
    super("LLM call aborted");
    this.name = "LLMAbortedError";
  }
}

const abortedError = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

type LLMCallOptions = {
  // Reports run synchronously behind the HTTP request, so the LLM call must
  // finish under the CDN/proxy timeout (~100s). These cap a reasoning model's
  // thinking budget and output length so latency stays bounded and predictable.
  readonly maxTokens?: number;
  readonly reasoningEffort?: "low" | "medium" | "high";
  // Cancels the in-flight request and any remaining retries. Without it a
  // caller that has given up (disconnected client, exceeded budget) keeps
  // holding a limiter slot and spending tokens for up to 5 x 300s.
  readonly signal?: AbortSignal;
};

const MAX_ERROR_BODY_CHARS = 2000;

// Fields in an OpenRouter error body that can echo participant input (e.g. a
// moderation block returns the flagged snippet). We redact them so meeting
// content never reaches Sentry — status + error.message is enough to triage.
const REDACTED_BODY_KEYS = new Set([
  "flagged_input",
  "input",
  "prompt",
  "messages",
]);

const isStreamLike = (value: object): boolean =>
  typeof (value as { pipe?: unknown }).pipe === "function" ||
  typeof (value as { on?: unknown }).on === "function";

// OpenRouter encodes WHY a call failed (e.g. "Key limit exceeded", a moderation
// flag, insufficient credits) in the response body — not the HTTP status. We
// surface both to Sentry so 402/403/429 outages are diagnosable from the
// dashboard instead of requiring SSH access to the production host. Exported for
// direct unit testing of the (status, body) extraction.
export function extractUpstreamError(error: unknown): {
  status?: number;
  body?: string;
  // OpenRouter's own `error.message` — provider-authored, short, and the actual
  // reason (e.g. "Key limit exceeded" vs a moderation flag). Safe to show: it is
  // not participant content (that lives in redacted metadata.flagged_input).
  providerMessage?: string;
} {
  if (!axios.isAxiosError(error)) {
    return {};
  }
  const status = error.response?.status;
  const data = error.response?.data;
  if (data === undefined || data === null) {
    return { status };
  }
  if (typeof data === "string") {
    return { status, body: data.slice(0, MAX_ERROR_BODY_CHARS) };
  }
  // Streaming requests set responseType:"stream", so error.response.data is an
  // unconsumed Readable here — JSON.stringify would emit its internal state
  // rather than the error JSON (and would NOT throw). Status alone still
  // separates 402/403/429 for the streaming path.
  if (isStreamLike(data)) {
    return { status };
  }
  const rawMessage = (data as { error?: { message?: unknown } }).error?.message;
  const providerMessage =
    typeof rawMessage === "string" ? rawMessage.slice(0, 300) : undefined;
  try {
    const body = JSON.stringify(data, (key, value) =>
      REDACTED_BODY_KEYS.has(key) ? "[redacted]" : value,
    );
    return {
      status,
      body: body.slice(0, MAX_ERROR_BODY_CHARS),
      providerMessage,
    };
  } catch {
    // Circular structure or other non-serializable body; status is enough.
    return { status, providerMessage };
  }
}

export async function callLLM(
  messages: LLMMessage[],
  model: string = DEFAULT_MODEL,
  options: LLMCallOptions = {},
): Promise<string> {
  const cliBackend = localCliBackend();
  if (cliBackend) {
    return callViaCli(cliBackend, messages);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  if (isDebug) {
    console.log("=== LLM Input ===");
    console.log("Model:", model);
    messages.forEach((msg, index) => {
      console.log(`\n[Message ${index + 1}]`);
      console.log(`Role: ${msg.role}`);
      console.log(msg.content);
    });
    console.log("\n================\n");
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (abortedError(options.signal)) {
      throw new LLMAbortedError();
    }
    try {
      const response = await withLLMLimit(() =>
        axios.post(
          OPENROUTER_API_URL,
          {
            model,
            messages,
            // Bound a reasoning model's thinking budget + output length so the
            // call completes under the proxy/CDN timeout (opt-in per caller).
            ...(options.reasoningEffort
              ? { reasoning: { effort: options.reasoningEffort } }
              : {}),
            ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://cartographer.app",
              "X-Title": "Cartographer",
            },
            timeout: 300000, // 300 second timeout
            signal: options.signal,
          },
        ),
      );

      recordLLMUsage({
        promptTokens: response.data?.usage?.prompt_tokens,
        completionTokens: response.data?.usage?.completion_tokens,
      });

      const choices = Array.isArray(response.data?.choices)
        ? response.data.choices
        : null;
      if (!choices || choices.length === 0) {
        throw new Error(
          `LLM response was missing choices (response.data: ${JSON.stringify(response.data)})`,
        );
      }
      const firstChoice = choices[0] as {
        error?: {
          code?: number | string | null;
          message?: string | null;
          metadata?: {
            error_type?: string | null;
          } | null;
        } | null;
        message?: {
          content?: string | null;
        } | null;
      };
      const choiceError = firstChoice?.error;
      if (choiceError) {
        const code = parseChoiceErrorCode(choiceError);
        const message =
          typeof choiceError.message === "string"
            ? choiceError.message
            : "Unknown provider error";
        const errorMessage = `LLM response choice contained provider error (code: ${code ?? "unknown"}, message: ${message}, choice: ${JSON.stringify(firstChoice)})`;
        if (isRetryableChoiceError(choiceError)) {
          throw new RetryableLLMResponseError(errorMessage);
        }
        throw new Error(errorMessage);
      }

      const output = firstChoice?.message?.content;
      if (output === undefined || output === null) {
        throw new Error(
          `LLM response choice was missing message content (choice: ${JSON.stringify(firstChoice)})`,
        );
      }

      if (isDebug) {
        console.log("=== LLM Output ===");
        console.log(output);
        console.log("==================\n");
      }

      return output;
    } catch (error) {
      if (abortedError(options.signal)) {
        throw new LLMAbortedError();
      }
      if (axios.isAxiosError(error)) {
        console.error(
          `LLM API Error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
          {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
          },
        );
      } else {
        console.error(
          `LLM API Error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
          error,
        );
      }

      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        const upstream = extractUpstreamError(error);
        Sentry.captureException(error, {
          tags: {
            component: "llm",
            model,
            llm_status: upstream.status?.toString() ?? "none",
          },
          extra: {
            attempts: attempt + 1,
            responseStatus: upstream.status,
            responseBody: upstream.body,
          },
        });
        // Preserve the upstream status (402/403/429/…) + provider reason for
        // callers that surface it. Message stays status-derived (see class).
        throw new LLMUnavailableError(
          upstream.status,
          upstream.providerMessage,
        );
      }

      const delay = getBackoffDelay(attempt, error);
      console.log(
        `Retrying LLM call in ${delay}ms (attempt ${attempt + 2}/${MAX_RETRIES + 1})...`,
      );
      await sleep(delay, options.signal);
    }
  }

  throw new Error("Failed to call LLM API");
}

export async function callLLMStreaming(
  messages: LLMMessage[],
  onChunk: (chunk: string) => void,
  model: string = DEFAULT_STREAM_MODEL,
  options: { readonly signal?: AbortSignal } = {},
): Promise<void> {
  const cliBackend = localCliBackend();
  if (cliBackend) {
    const text = await callViaCli(cliBackend, messages);
    onChunk(text);
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  if (isDebug) {
    console.log("=== LLM Streaming Input ===");
    console.log("Model:", model);
    messages.forEach((msg, index) => {
      console.log(`\n[Message ${index + 1}]`);
      console.log(`Role: ${msg.role}`);
      console.log(msg.content);
    });
    console.log("\n================\n");
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (abortedError(options.signal)) {
      throw new LLMAbortedError();
    }
    try {
      // The whole stream is consumed inside the limiter so the concurrency slot
      // is held until [DONE] — axios resolves at headers-received, so wrapping
      // only the POST would let unbounded streams run in parallel.
      await withLLMLimit(async () => {
        const response = await axios.post(
          OPENROUTER_API_URL,
          {
            model,
            messages,
            stream: true,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://cartographer.app",
              "X-Title": "Cartographer",
            },
            timeout: STREAM_TIMEOUT_MS,
            responseType: "stream",
            signal: options.signal,
          },
        );

        const stream = response.data as AsyncIterable<Uint8Array | string>;
        const decoder = new TextDecoder();
        let buffer = "";
        let outputChars = 0;

        const processLine = (line: string) => {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith("data:")) return;

          const data = trimmedLine.slice(5).trim();
          if (!data || data === "[DONE]") return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              outputChars += content.length;
              onChunk(content);
            }
          } catch (e) {
            // Skip invalid JSON
            console.warn("Failed to parse streaming chunk:", e);
          }
        };

        for await (const chunk of stream) {
          buffer +=
            typeof chunk === "string"
              ? chunk
              : decoder.decode(chunk, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            processLine(line);
          }
        }

        buffer += decoder.decode();
        if (buffer.trim().length > 0) {
          processLine(buffer);
        }

        recordLLMUsage({
          estimatedChars:
            messages.reduce((sum, msg) => sum + msg.content.length, 0) +
            outputChars,
        });
      });

      if (isDebug) {
        console.log("=== LLM Streaming Complete ===\n");
      }
      return;
    } catch (error) {
      if (abortedError(options.signal)) {
        throw new LLMAbortedError();
      }
      if (axios.isAxiosError(error)) {
        console.error(
          `LLM Streaming Error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
          {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            code: error.code,
          },
        );
      } else {
        console.error(
          `LLM Streaming Error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
          error,
        );
      }

      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        const upstream = extractUpstreamError(error);
        Sentry.captureException(error, {
          tags: {
            component: "llm-streaming",
            model,
            llm_status: upstream.status?.toString() ?? "none",
          },
          extra: {
            attempts: attempt + 1,
            responseStatus: upstream.status,
            responseBody: upstream.body,
          },
        });
        throw new Error("Failed to call LLM streaming API");
      }

      const delay = getBackoffDelay(attempt, error);
      console.log(
        `Retrying LLM streaming call in ${delay}ms (attempt ${attempt + 2}/${MAX_RETRIES + 1})...`,
      );
      await sleep(delay, options.signal);
    }
  }
}

type IndividualReportResponse = {
  statementText: string;
  responseType: "scale" | "free_text";
  value: number | null;
  textResponse?: string;
};

export type DeepDiveQuestion = { question: string; topic: string };

export type IndividualReportResult = {
  reportMarkdown: string;
  deepDiveQuestions: DeepDiveQuestion[];
};

const DEEPDIVE_DELIMITER = "===DEEPDIVE===";

// The report LLM call emits the markdown report, a delimiter line, then a JSON
// array of personalised follow-up questions. Splitting on the delimiter means
// the large markdown body never has to survive JSON-escaping.
const parseDeepDiveQuestions = (tail: string): DeepDiveQuestion[] => {
  const start = tail.indexOf("[");
  const end = tail.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(tail.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (q): q is { question: string; topic?: unknown } =>
          typeof (q as { question?: unknown })?.question === "string" &&
          (q as { question: string }).question.trim().length > 0,
      )
      .slice(0, 3)
      .map((q) => ({
        question: q.question.trim(),
        topic: typeof q.topic === "string" ? q.topic.trim() : "",
      }));
  } catch {
    return [];
  }
};

export const parseIndividualReportResponse = (
  raw: string,
): IndividualReportResult => {
  const trimmed = raw.trim();
  const idx = trimmed.indexOf(DEEPDIVE_DELIMITER);
  if (idx === -1) {
    return { reportMarkdown: trimmed, deepDiveQuestions: [] };
  }
  return {
    reportMarkdown: trimmed.slice(0, idx).trim(),
    deepDiveQuestions: parseDeepDiveQuestions(
      trimmed.slice(idx + DEEPDIVE_DELIMITER.length),
    ),
  };
};

export async function generateIndividualReport(input: {
  sessionTitle: string;
  context: string;
  responses: IndividualReportResponse[];
  userName: string;
  taste?: string;
  reflections?: string[];
  language?: ContentLanguage;
}): Promise<IndividualReportResult> {
  const responsesText = input.responses
    .map((r) => {
      if (r.responseType === "free_text") {
        const text = (r.textResponse ?? "").trim();
        const content =
          text.length > 0
            ? wrapUntrusted(text, { kind: "free_text" })
            : "（自由記述：未入力）";
        return `- "${r.statementText}" → [自由記述] ${content}`;
      }

      const valueLabel =
        r.value === 2
          ? "強く同意"
          : r.value === 1
            ? "同意"
            : r.value === 0
              ? "わからない・自信がない"
              : r.value === -1
                ? "反対"
                : "強く反対";
      return `- "${r.statementText}" → ${valueLabel}`;
    })
    .join("\n");

  // Participant-authored → isolated as data (audit H1).
  const reflectionsText = (input.reflections ?? [])
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((r) => `- ${wrapUntrusted(r, { kind: "participant_reflection" })}`)
    .join("\n");
  const reflectionsSection = reflectionsText
    ? `\n\n**この参加者が自発的に挙げた論点・ご意見:**\n${reflectionsText}\n\nこれらは本人が特に関心を持っているテーマです。レポートで優先的に触れてください。`
    : "";

  // Define tone based on taste
  const toneInstructions: Record<string, string> = {
    neutral:
      "客観的で中立的なトーンで、バランスの取れた分析を提供してください。",
    encouraging:
      "励ましとポジティブなフィードバックを重視し、建設的で前向きな表現を使ってください。",
    analytical:
      "詳細で論理的な分析を提供し、深い洞察と具体的な観察を含めてください。",
    casual:
      "親しみやすくフレンドリーなトーンで、くだけた表現を使いながらも敬意を保ってください。",
  };

  const toneInstruction =
    toneInstructions[input.taste || "neutral"] || toneInstructions.neutral;

  const userName = untrustedName(input.userName);
  const prompt = `あなたは思慮深いコーチまたはカウンセラーです。

**セッションタイトル:**
${input.sessionTitle}

**セッションのコンテキスト:**
${input.context}

**参加者の名前:**
${userName}

**この参加者の回答履歴:**
${responsesText}${reflectionsSection}

この参加者の回答パターンから、${userName}さんがこのテーマに対してどのような認識を持っているかを分析し、本人向けのフィードバックレポートをMarkdown形式で作成してください。

**レポート作成の指示:**
1. 特徴的な回答や、他の人と意見が異なりそうな点を優しく指摘してください
2. 自己理解を深める手助けをしてください
3. ${toneInstruction}
4. Markdown形式で見やすく構造化してください
5. 概念や関係を図で示す場合は、ASCIIアート（コードブロックでの擬似作図）ではなく \`\`\`mermaid フェンス（graph 等・正しい構文のみ）を使ってください

まずレポート本文をMarkdownで出力してください。

そのあと、次の区切り行をそのまま1行だけ出力してください:
${DEEPDIVE_DELIMITER}

区切り行のあとに、この参加者が「まだ言語化していないが関心がありそうなトピック」を2〜3個推定し、それぞれを「〜についてどう思いますか?」のような一人称の問いにして、次のJSON配列だけで出力してください(前後に説明文やコードフェンスを付けない):
[{"question":"問いの文","topic":"関心トピックの短いラベル"}]`;

  const messages: LLMMessage[] = withOutputLanguage(
    [
      { role: "system", content: UNTRUSTED_DATA_RULE },
      { role: "user", content: prompt },
    ],
    input.language,
  );

  // Generated synchronously inside the individual-report route: cap reasoning +
  // output so the model finishes under the CDN timeout (was 504-ing at 32-50s+
  // with full reasoning). max_tokens also bounds the reasoning budget. Then parse
  // the report body + deep-dive questions out of the response.
  const response = await callLLM(messages, ACCURATE_MODEL, {
    reasoningEffort: "low",
    maxTokens: 8192,
  });
  return parseIndividualReportResponse(response);
}

export interface StatementStat {
  text: string;
  totalCount: number;
  distribution: {
    strongYes: number;
    yes: number;
    dontKnow: number;
    no: number;
    strongNo: number;
  };
  participantResponses: Array<{
    participantId: string;
    participantName: string;
    value: number;
  }>;
  freeTextResponses: Array<{
    participantId: string;
    participantName: string;
    text: string;
  }>;
}

export async function generateSurveyAnalysisMarkdown(input: {
  sessionTitle: string;
  sessionGoal: string;
  initialContext: string;
  totalParticipants: number;
  statements: StatementStat[];
  eventThreadContext: string;
  language?: ContentLanguage;
}): Promise<string> {
  const formatValue = (value: number) => {
    switch (value) {
      case 2:
        return "強く同意";
      case 1:
        return "同意";
      case 0:
        return "わからない・自信がない";
      case -1:
        return "反対";
      case -2:
        return "強く反対";
      default:
        return `Unknown (${value})`;
    }
  };

  const statementsText = input.statements
    .map((statement, index) => {
      const dist = statement.distribution;
      const freeTextSnippet =
        statement.freeTextResponses.length > 0
          ? `- 自由記述(${statement.freeTextResponses.length}件):\n${statement.freeTextResponses
              .slice(0, 3)
              .map(
                (entry) =>
                  `  - ${untrustedName(entry.participantName)}: ${wrapUntrusted(entry.text, { kind: "free_text" })}`,
              )
              .join("\n")}`
          : "";
      const body = `${index + 1}. "${statement.text}" (回答人数: ${statement.totalCount}人)
- 強く同意: ${dist.strongYes}%
- 同意: ${dist.yes}%
- わからない・自信がない: ${dist.dontKnow}%
- 反対: ${dist.no}%
- 強く反対: ${dist.strongNo}%`;
      return freeTextSnippet ? `${body}\n${freeTextSnippet}` : body;
    })
    .join("\n\n");

  const participantMap = new Map<
    string,
    {
      name: string;
      responses: string[];
    }
  >();

  input.statements.forEach((statement, index) => {
    statement.participantResponses.forEach((response) => {
      const key =
        response.participantId && response.participantId !== "unknown"
          ? response.participantId
          : `unknown:${response.participantName}`;
      let entry = participantMap.get(key);
      if (!entry) {
        entry = { name: response.participantName, responses: [] };
        participantMap.set(key, entry);
      }
      entry.responses.push(
        `${index + 1}. "${statement.text}": ${formatValue(response.value)}`,
      );
    });
    statement.freeTextResponses.forEach((response) => {
      const key =
        response.participantId && response.participantId !== "unknown"
          ? response.participantId
          : `unknown:${response.participantName}`;
      let entry = participantMap.get(key);
      if (!entry) {
        entry = { name: response.participantName, responses: [] };
        participantMap.set(key, entry);
      }
      entry.responses.push(
        `${index + 1}. "${statement.text}": [自由記述] ${wrapUntrusted(response.text, { kind: "free_text" })}`,
      );
    });
  });

  const participantDetailsText =
    participantMap.size > 0
      ? Array.from(participantMap.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((entry) => {
            const lines = entry.responses.map((response) => `  ${response}`);
            return `${untrustedName(entry.name)}:\n${lines.join("\n")}`;
          })
          .join("\n\n")
      : "  (回答なし)";

  const surveyResultsText = `${statementsText}\n\n参加者別回答:\n${participantDetailsText}`;

  const prompt = `
<role>
あなたはシニアリサーチャー兼コンサルタント。参加者への問いかけと分析や考察を繰り返しながら、認識の合意点・相違点・不明点を洗い出しすことで目的を達成します。
</role>
<task>
Event Threadの履歴を踏まえつつ、提供された直近のSurvey結果から分かることを分析し、Markdownで以下を出力してください。
- 合意が存在する点。特に、具体的な合意点や意外な合意点。
- 意見が二極化・多極化している点。
- 多くがまだ判断できていない点、わからない点。
- 集団の傾向、クラスタなど（バイネームの分析）
また、それらからわかることを論理的に考察し、仮説を立てる。
</task>
<session>
  <title>${input.sessionTitle}</title>
  <goal>${input.sessionGoal}</goal>
  <participants>${input.totalParticipants}</participants>
</session>
<context>
  ${input.eventThreadContext}
  <initial_context>${input.initialContext}</initial_context>
</context>
<survey_results>
${surveyResultsText}
</survey_results>
<output>MarkdownのみでSurvey Analysisを返してください。前置きなく、本文のみを生成してください。</output>
`;

  // Also generated synchronously behind a route (event-thread/analyze): bound
  // latency the same way. Larger output budget since survey analysis is longer.
  const response = await callLLM(
    withOutputLanguage(
      [
        { role: "system", content: UNTRUSTED_DATA_RULE },
        { role: "user", content: prompt },
      ],
      input.language,
    ),
    ACCURATE_MODEL,
    { reasoningEffort: "low", maxTokens: 8192 },
  );
  return response.trim();
}
