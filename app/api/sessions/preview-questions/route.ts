export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getHostUserIdFromRequest } from "@/lib/auth";
import { toContentLanguage } from "@/lib/content-language";
import {
  cacheKeyFor,
  readCache,
  takeRateSlot,
  writeCache,
} from "@/lib/llm-user-guard";
import { generateSurveyStatements } from "../../../../agents/llm";

export async function POST(request: NextRequest) {
  try {
    const userId = await getHostUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized: Missing user ID" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { title, context, goal, language } = body as {
      title?: unknown;
      context?: unknown;
      goal?: unknown;
      language?: unknown;
    };
    const contentLanguage = toContentLanguage(language);

    if (typeof title !== "string") {
      return NextResponse.json(
        { error: "Invalid value for title" },
        { status: 400 },
      );
    }

    if (typeof goal !== "string" || goal.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing required field: goal" },
        { status: 400 },
      );
    }

    if (typeof context !== "string") {
      return NextResponse.json(
        { error: "Invalid value for context" },
        { status: 400 },
      );
    }

    const trimmedTitle = title.trim();
    const trimmedGoal = goal.trim();
    const normalizedContext = context.trim();

    // Per-user guard (incident 2026-06-02): serve a recent identical result from
    // cache without an LLM call, and cap how many *distinct* previews one identity
    // can generate per minute. The global agents/llm-limiter only caps total
    // throughput; without this, one fast-typing / voice-streaming form (or a
    // token-holding abuser) drains the shared OpenRouter budget for everyone.
    const inputParts = [
      trimmedTitle,
      trimmedGoal,
      normalizedContext,
      contentLanguage,
    ];
    const cacheKey = cacheKeyFor("preview", userId, inputParts);
    const cached = readCache<string[]>(cacheKey);
    if (cached) {
      return NextResponse.json({ questions: cached });
    }

    const rate = takeRateSlot("preview", userId);
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

    // Generate 15 questions
    try {
      const statementTexts = await generateSurveyStatements({
        sessionTitle: trimmedTitle,
        sessionGoal: trimmedGoal,
        initialContext: normalizedContext,
        eventThreadContext: "[]", // No event thread context for preview
        participantCount: 0,
        language: contentLanguage,
      });

      writeCache(cacheKey, statementTexts);
      return NextResponse.json({ questions: statementTexts });
    } catch (genError) {
      console.error("Failed to generate preview statements:", genError);
      return NextResponse.json(
        { error: "Failed to generate questions" },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Preview generation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
