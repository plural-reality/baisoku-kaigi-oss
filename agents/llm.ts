import axios from "axios";
// Both app/lib files are dependency-light and copied into the deployed agent
// package by flake.nix (next to session-context.ts) — keep that list in sync.
import {
  type ContentLanguage,
  withOutputLanguage,
} from "../app/lib/content-language";
import { sanitizeErrorForLog } from "../app/lib/sanitize-error";
import {
  UNTRUSTED_DATA_RULE,
  untrustedName,
  wrapUntrusted,
} from "../app/lib/untrusted-text";
import { recordLLMUsage, withLLMLimit } from "./llm-limiter";
import { withRetry } from "./llm-retry";
import { validateSurveyStatements } from "./survey-validation";

type Role = "system" | "user" | "assistant";

interface LLMMessage {
  role: Role;
  content: string;
}

export type ParticipantReflectionInput = {
  text: string;
  name?: string;
  submittedAt?: string;
};

const OPENROUTER_API_URL =
  process.env.OPENROUTER_API_URL ??
  "https://openrouter.ai/api/v1/chat/completions";
const FAST_MODEL = "google/gemini-3.5-flash";
const ACCURATE_MODEL = "google/gemini-3.1-pro-preview";
const DEFAULT_MODEL = FAST_MODEL;

// Full prompt bodies contain participant answers and names; never write them to
// production logs (audit 2026-10-06 M3). Same gate as app/lib/llm.ts.
const isPromptDebug = (): boolean => process.env.NODE_ENV !== "production";

// Every prompt that embeds participant text is prefixed with the fixed rule that
// <untrusted_data> blocks are data, not instructions (audit H1).
const SYSTEM_GUARD: LLMMessage = {
  role: "system",
  content: UNTRUSTED_DATA_RULE,
};

async function callLLM(
  messages: LLMMessage[],
  options?: {
    temperature?: number;
    reasoning_max_tokens?: number;
    reasoning_effort?: "low";
    model?: string;
  },
): Promise<string> {
  const model = options?.model ?? DEFAULT_MODEL;

  // Local full-debug path: when LLM_PROVIDER=claude-cli (or codex-cli), route the
  // whole agent flow (進行ログ / 自動進行 / 質問生成 / 分析) through the local CLI —
  // no OpenRouter key needed. Shares the canonical bridge with app/lib/llm.ts.
  // Dynamic import gated on the env var: the deployed cartographer-agent package
  // does NOT bundle app/lib, so a static import would crash the agent at load in
  // production. In prod LLM_PROVIDER is unset, so this block never resolves it.
  if (process.env.LLM_PROVIDER) {
    const { callViaCli, localCliBackend } = await import("../app/lib/llm-cli");
    const cliBackend = localCliBackend();
    if (cliBackend) {
      console.log("[LLM] via local CLI", {
        provider: process.env.LLM_PROVIDER,
      });
      return callViaCli(cliBackend, messages);
    }
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  console.log("[LLM] request", {
    model,
    messageCount: messages.length,
  });
  if (isPromptDebug()) {
    messages.forEach((message, index) => {
      console.log(`[LLM] message #${index + 1} (${message.role})`);
      console.log(message.content);
    });
  }

  const requestBody: {
    model: string;
    messages: LLMMessage[];
    temperature: number;
    reasoning?: { max_tokens: number } | { effort: "low" };
  } = {
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    ...(options?.reasoning_effort !== undefined
      ? { reasoning: { effort: options.reasoning_effort } }
      : options?.reasoning_max_tokens !== undefined
        ? { reasoning: { max_tokens: options.reasoning_max_tokens } }
        : {}),
  };

  // Each attempt acquires a fresh limiter slot (released during backoff) and is
  // counted against the rate window / daily budget; a tripped breaker throws and
  // is non-retryable, so it fails fast (audit H5 + M3).
  const response = await withRetry(() =>
    withLLMLimit(() =>
      axios.post(OPENROUTER_API_URL, requestBody, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://cartographer.app",
          "X-Title": "Cartographer-Agent",
        },
        timeout: 45000,
      }),
    ),
  );

  const data = response.data;
  const choices = Array.isArray(data?.choices) ? data.choices : null;
  if (!choices || choices.length === 0) {
    console.error("[LLM] Unexpected response payload", data);
    throw new Error("LLM response was missing choices");
  }

  const choice = choices[0];
  const content = choice?.message?.content;
  if (typeof content !== "string") {
    console.error("[LLM] Unexpected choice message", choice);
    throw new Error("LLM response was missing message content");
  }

  recordLLMUsage({
    promptTokens: data?.usage?.prompt_tokens,
    completionTokens: data?.usage?.completion_tokens,
  });
  console.log("[LLM] response length", content.length);
  return content;
}

export function extractJsonArray(text: string): string[] | null {
  // 優先: コードフェンス内のJSONを抽出
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

  // フェンス内がなければ、本文全体から最初の配列リテラルを拾う
  const fallbackMatches = text.match(/\[[\s\S]*\]/g);
  const candidates: string[] = [];

  if (fencedMatch?.[1]) {
    candidates.push(fencedMatch[1]);
  }
  if (fallbackMatches) {
    candidates.push(...fallbackMatches);
  }

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    // 末尾の余計なカンマを削る軽いサニタイズ
    const sanitized = trimmed.replace(/,\s*]/g, "]");
    try {
      const parsed = JSON.parse(sanitized);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === "string")
      ) {
        return parsed;
      }
    } catch {
      // 次の候補を試す
    }
  }

  // JSON配列が取れなかった場合のフォールバック:
  // 行頭の箇条書き（- , *, ・, 1. など）を拾い、文として扱う
  const bulletStatements = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(-|\*|・|\d+[).\s]|[0-9]+\s)/.test(line))
    .map((line) =>
      line
        .replace(/^(-|\*|・|\d+[).\s]|[0-9]+\s)/, "")
        .replace(/^\s*["“”]/, "")
        .replace(/["“”]\s*$/, "")
        .replace(/[;,]\s*$/, "")
        .trim(),
    )
    .filter((line) => line.length > 0);

  if (bulletStatements.length > 0) {
    return bulletStatements;
  }

  return null;
}

export async function generatePlanMarkdown(input: {
  sessionTitle: string;
  sessionGoal: string;
  initialContext: string;
  eventThreadContext: string;
  latestAnalysisMarkdown?: string;
  recentUserMessages?: string[];
  participantCount?: number;
  participantReflections?: ParticipantReflectionInput[];
  language?: ContentLanguage;
}): Promise<string> {
  const participantsLabel =
    typeof input.participantCount === "number"
      ? String(input.participantCount)
      : "unknown";
  // Reflections are participant-authored: each one (text AND name) is isolated
  // in an <untrusted_data> block with closing tags stripped (audit H1).
  const reflectionsSection =
    input.participantReflections && input.participantReflections.length > 0
      ? `<participant_reflections>
${input.participantReflections
  .map((reflection) =>
    wrapUntrusted(reflection.text, {
      kind: "participant_reflection",
      name: reflection.name,
      submitted_at: reflection.submittedAt,
    }),
  )
  .join("\n")}
</participant_reflections>`
      : "";

  const prompt = `
<role>
あなたはシニアリサーチャー兼コンサルタント。参加者への問いかけと分析や考察を繰り返しながら、認識の合意点・相違点・不明点を洗い出すことで、調査目的を達成します。
</role>
<task>
今までのEventThreadの内容を踏まえて、改めて、調査目的を満たすための道筋を大まかに描いた上で、まず今どんな認識を参加者全員から収集したいか具体的に記述してください。
- 参加者に対してこの後yes/noで答えられる質問を投げかけるので、それらの質問を通じてどんな情報を集めるべきか考察して方針を立ててください。（具体的な質問は作らなくてよいです）
- もし調査を進める上でそもそも前提情報が足りない場合は深掘りを急がずに、欠落している背景や前提の情報を探索的に収集することから始めてください。
- 最大40%ほど、議論の前提を確認するような質問や、各論点の重要さや関心の高さを問うようなメタな質問もすることで、探索や深掘りの指針となる情報を集めてください。
- 個人の利害と、共同体としてのべき論を混同しないように注意してください。
- 具体レベルと、抽象レベルの両方の認識を必要に応じて収集してください。
- 表層の主張だけではなく、その背後の価値観・利害・時間軸・認知などを収集するとよいです。
</task>
<session>
  <title>${input.sessionTitle}</title>
  <goal>${input.sessionGoal}</goal>
  <participants>${participantsLabel}</participants>
</session>
<context>
  ${input.eventThreadContext}
  <initial_context>${input.initialContext}</initial_context>
  ${reflectionsSection}
</context>
<output>MarkdownのみでPLANセクションの中身を返してください。前置きなく、本文のみを生成してください。</output>
`;

  try {
    const response = await callLLM(
      withOutputLanguage(
        [SYSTEM_GUARD, { role: "user", content: prompt }],
        input.language,
      ),
      {
        model: ACCURATE_MODEL,
      },
    );
    return response.trim();
  } catch (error) {
    console.error("[LLM] Plan generation failed:", sanitizeErrorForLog(error));
    throw new Error("Plan generation failed");
  }
}

export type SurveyStatementsInput = {
  sessionTitle: string;
  sessionGoal: string;
  initialContext: string;
  eventThreadContext: string;
  planMarkdown?: string;
  latestAnalysisMarkdown?: string;
  participantCount?: number;
  language?: ContentLanguage;
};

export const surveyStatementsOptions = (setting: string | undefined) =>
  setting === "google/gemini-3.8-flash"
    ? { model: "google/gemini-3.8-flash", reasoning_effort: "low" as const }
    : { model: FAST_MODEL, reasoning_max_tokens: 1 };

export const buildSurveyStatementsPrompt = (
  input: SurveyStatementsInput,
): string => {
  const participantsLabel =
    typeof input.participantCount === "number"
      ? String(input.participantCount)
      : "unknown";

  const prompt = `
<role>
あなたはシニアリサーチャー兼コンサルタント。参加者への問いかけと分析や考察を繰り返しながら、認識の合意点・相違点・不明点を洗い出します。
</role>
<task>
ステートメントに対する全参加者のYES/NO回答を通じて、認識・解釈・価値観・利害・優先順位などを浮き彫りにし、収集したい認識の情報を収集します。
今までのEventThreadの内容を踏まえて、新たに15個のステートメントを生成してください。それらに対して参加者全員がYES/NOで回答します。
各ステートメントは以下を満たすこと。
- YES/NOの二択で答えられる断定文であること。
- 1文のみ、単体で意味が通じること。
- 解釈のブレが生じないよう、必要であれば5W1Hや具体例を明示してシャープに表現すること。
- 参加者の立ち位置がYES/NOで鮮明に分かれ、背後の動機が推測できるようにする。
- 今後も質問を繰り返すので、今回だけで調査目的を達成する必要はない。深掘りを急がずに、まず今集めるべき情報を集めてほしい。
- contextに含まれるexisting_statementsは過去に生成済みの質問である。これらと同じ内容・同じ趣旨の質問を生成してはならない。異なる切り口や新たな観点からステートメントを作成すること。
</task>
<session>
  <title>${input.sessionTitle}</title>
  <goal>${input.sessionGoal}</goal>
  <participants>${participantsLabel}</participants>
</session>
<context>
  ${input.eventThreadContext}
  <initial_context>${input.initialContext}</initial_context>
</context>
<output>JSON配列（例: ["文1", "文2", ...]）のみを返してください。</output>
`;

  return prompt;
};

export const generateSurveyStatements = (
  input: SurveyStatementsInput,
): Promise<string[]> =>
  callLLM(
    withOutputLanguage(
      [
        SYSTEM_GUARD,
        { role: "user", content: buildSurveyStatementsPrompt(input) },
      ],
      input.language,
    ),
    surveyStatementsOptions(process.env.SURVEY_STATEMENTS_MODEL),
  )
    .then((response) => {
      const result = validateSurveyStatements(extractJsonArray(response));
      return result.ok
        ? result.statements
        : Promise.reject(
            new Error(`Invalid survey statements: ${result.reason}`),
          );
    })
    .catch((error) => {
      console.error(
        "[LLM] Survey statement generation failed:",
        sanitizeErrorForLog(error),
      );
      return Promise.reject(new Error("Survey statement generation failed"));
    });

export async function generateSingleSurveyStatement(input: {
  sessionTitle: string;
  sessionGoal: string;
  initialContext: string;
  eventThreadContext: string;
  planMarkdown?: string;
  latestAnalysisMarkdown?: string;
  participantCount?: number;
  language?: ContentLanguage;
}): Promise<string> {
  const participantsLabel =
    typeof input.participantCount === "number"
      ? String(input.participantCount)
      : "unknown";

  const prompt = `
<role>
あなたはシニアリサーチャー兼コンサルタント。参加者への問いかけと分析や考察を繰り返しながら、認識の合意点・相違点・不明点を洗い出します。
</role>
<task>
ステートメントに対する全参加者のYES/NO回答を通じて、認識・解釈・価値観・利害・優先順位などを浮き彫りにし、収集したい認識の情報を収集します。
今までのEventThreadの内容を踏まえて、新たに1つのステートメントを生成してください。それに対して参加者全員がYES/NOで回答します。
ステートメントは以下を満たすこと。
- YES/NOの二択で答えられる断定文であること。
- 1文のみ、単体で意味が通じること。
- 解釈のブレが生じないよう、必要であれば5W1Hや具体例を明示してシャープに表現すること。
- 参加者の立ち位置がYES/NOで鮮明に分かれ、背後の動機が推測できるようにする。
- 今後も質問を繰り返すので、今回だけで調査目的を達成する必要はない。深掘りを急がずに、まず今集めるべき情報を集めてほしい。
- contextに含まれるexisting_statementsは過去に生成済みの質問である。これらと同じ内容・同じ趣旨の質問を生成してはならない。異なる切り口や新たな観点からステートメントを作成すること。
</task>
<session>
  <title>${input.sessionTitle}</title>
  <goal>${input.sessionGoal}</goal>
  <participants>${participantsLabel}</participants>
</session>
<context>
  ${input.eventThreadContext}
  <initial_context>${input.initialContext}</initial_context>
</context>
<output>JSON配列（例: ["文1"]）のみを返してください。配列の中身は1つだけにしてください。</output>
`;

  try {
    const response = await callLLM(
      withOutputLanguage(
        [SYSTEM_GUARD, { role: "user", content: prompt }],
        input.language,
      ),
      {
        reasoning_max_tokens: 1,
        model: FAST_MODEL,
      },
    );
    const parsed = extractJsonArray(response);
    if (!parsed || parsed.length === 0) {
      throw new Error("LLM response was not valid JSON array");
    }
    return parsed[0];
  } catch (error) {
    console.error(
      "[LLM] Single survey statement generation failed:",
      sanitizeErrorForLog(error),
    );
    throw new Error("Single survey statement generation failed");
  }
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

  try {
    const response = await callLLM(
      withOutputLanguage(
        [SYSTEM_GUARD, { role: "user", content: prompt }],
        input.language,
      ),
      {
        model: ACCURATE_MODEL,
      },
    );
    return response.trim();
  } catch (error) {
    console.error(
      "[LLM] Survey analysis generation failed:",
      sanitizeErrorForLog(error),
    );
    throw new Error("Survey analysis generation failed");
  }
}
