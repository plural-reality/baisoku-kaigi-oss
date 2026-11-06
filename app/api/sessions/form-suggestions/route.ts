export const dynamic = "force-dynamic";

import { extractJsonArray } from "@agents/llm";
import { recordLLMUsage, withLLMLimit } from "@agents/llm-limiter";
import { withRetry } from "@agents/llm-retry";
import axios from "axios";
import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getHostUserIdFromRequest } from "@/lib/auth";
import { toContentLanguage, withOutputLanguage } from "@/lib/content-language";
import { FAST_MODEL } from "@/lib/llm";
import {
  cacheKeyFor,
  readCache,
  takeRateSlot,
  writeCache,
} from "@/lib/llm-user-guard";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = FAST_MODEL;

interface FormSuggestionRequest {
  backgroundInfo: string;
  purpose: string;
  language?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    // Require an authenticated identity: this endpoint calls the OpenRouter LLM,
    // so leaving it unauthenticated exposes API cost to anonymous abuse.
    const userId = await getHostUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized: Missing user ID" },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 },
      );
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const { backgroundInfo, purpose, language } = body as FormSuggestionRequest;
    const contentLanguage = toContentLanguage(language);
    const normalizedBackgroundInfo =
      typeof backgroundInfo === "string" ? backgroundInfo : "";
    const normalizedPurpose = typeof purpose === "string" ? purpose : "";

    if (
      normalizedBackgroundInfo.trim().length === 0 &&
      normalizedPurpose.trim().length === 0
    ) {
      return NextResponse.json({ suggestions: [] });
    }

    // Per-user guard (incident 2026-06-02): identical inputs are served from a
    // short-lived cache without an LLM call, and one identity is capped to a few
    // distinct suggestion generations per minute. /sessions/new fires this on
    // every form change alongside preview-questions, so without this a fast /
    // voice-streaming input drains the shared OpenRouter budget.
    const inputParts = [
      normalizedPurpose.trim(),
      normalizedBackgroundInfo.trim(),
      contentLanguage,
    ];
    const cacheKey = cacheKeyFor("suggestions", userId, inputParts);
    const cached = readCache<unknown[]>(cacheKey);
    if (cached) {
      return NextResponse.json({ suggestions: cached });
    }

    const rate = takeRateSlot("suggestions", userId);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          message: (await getTranslations("newSession"))("rateLimited"),
          retryAfter: rate.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfterSeconds) },
        },
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }

    const prompt = `あなたは優しく親切なファシリテーターです。ユーザーが認識を洗い出すセッションを作成しようとしています。以下のフォーム入力内容を見て、情報が不足している場合に、具体的で読みやすい質問を各項目で提案してください。

**現在の入力内容:**

【何をするために倍速会議を使うのですか？】
    ${normalizedPurpose.trim() || "（未入力）"}

【背景情報】
    ${normalizedBackgroundInfo.trim() || "（未入力）"}

**指摘の観点:**
- 目的: 倍速会議を使う目的は何か、洗い出したいのは現状認識なのか・課題なのか・理想像なのか・価値観なのか、具体的にどんなトピックなのか、それを整理して見出したいのは合意点なのか・相違点なのか・何を誰もわかっていないのかなのか、認識を洗い出して整理したいと思ったきっかけとなった出来事や感情や困りごとはなんなのか、認識を洗い出すことを通じて何をしたいのか、集団がどうなったらいいのか
- 背景情報: どんな集団なのか（人数、役割、関係性）、どんな問題の背景があるのか、どんな状況なのか

**出力形式:**
もし情報が十分に書かれていて、特に追加で聞くべきことがない場合は、空の配列を返してください: []

もし情報が不足している場合は、具体的で読みやすい質問を1〜3個、JSON配列形式で出力してください:
["質問1", "質問2", "質問3"]

質問は「〜について教えてください」「〜はどうですか？」のような優しい口調で、具体的に何を書けばいいかイメージしやすい形にしてください。抽象的な質問は避けてください。

質問はそれぞれ50〜100文字程度になるように調整してください。

JSON配列のみを出力し、他の説明文は含めないでください。`;

    if (process.env.NODE_ENV !== "production") {
      console.log("=== Form Suggestion LLM Input ===");
      console.log("Model:", MODEL);
      console.log(prompt);
      console.log("=================================\n");
    }

    const response = await withRetry(() =>
      withLLMLimit(() =>
        axios.post(
          OPENROUTER_API_URL,
          {
            model: MODEL,
            messages: withOutputLanguage(
              [{ role: "user", content: prompt }],
              contentLanguage,
            ),
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://cartographer.app",
              "X-Title": "Cartographer",
            },
            timeout: 15000, // 15 second timeout
          },
        ),
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
      console.warn(
        "LLM response was missing choices, returning empty suggestions",
        { responseData: response.data },
      );
      return NextResponse.json({ suggestions: [] });
    }
    const output = choices[0]?.message?.content;
    if (output === undefined || output === null) {
      console.warn(
        "LLM response choice was missing message content, returning empty suggestions",
        { choice: choices[0] },
      );
      return NextResponse.json({ suggestions: [] });
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("=== Form Suggestion LLM Output ===");
      console.log(output);
      console.log("==================================\n");
    }

    // Robustly extract a string[] from the model output. extractJsonArray
    // handles code fences, bracket-in-string truncation, trailing commas and
    // bullet fallbacks, returning null (never throwing) when nothing parses —
    // so a malformed response degrades to [] instead of a 500.
    const suggestions = extractJsonArray(output) ?? [];

    writeCache(cacheKey, suggestions);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Form suggestion error:", error);

    if (axios.isAxiosError(error)) {
      console.error("LLM API Error:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });

      if (error.response?.status === 429) {
        return NextResponse.json(
          { error: "Rate limit exceeded" },
          { status: 429 },
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to generate suggestions" },
      { status: 500 },
    );
  }
}
