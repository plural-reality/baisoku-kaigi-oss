export const dynamic = "force-dynamic";

import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { toContentLanguage } from "@/lib/content-language";
import { ensureEventThreadForSession } from "@/lib/server/event-threads";
import {
  requireSessionAdminToken,
  SessionAccessError,
} from "@/lib/server/session-access";
import { respondExclusive } from "@/lib/server/single-flight";
import {
  sessionFacilitatorContext,
  sessionFacilitatorGoal,
} from "@/lib/session-context";
import { supabase } from "@/lib/supabase";
import { generateSurveyStatements } from "../../../../../../../agents/llm";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; accessToken: string }> },
) {
  const userId = await getUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized: Missing user ID" },
      { status: 401 },
    );
  }

  return Sentry.startSpan(
    { name: "statements.generate", op: "api" },
    async (span) => {
      try {
        const { sessionId, accessToken } = await params;
        span.setAttribute("session.id", sessionId);
        span.setAttribute("user.id", userId);

        const session = await requireSessionAdminToken(sessionId, accessToken);
        // One generation per session at a time: a re-click after a CDN
        // timeout (524) must not append a second batch while the first is
        // still being generated server-side.
        return await respondExclusive(
          `statements-generate:${sessionId}`,
          async () => {
            const thread = await ensureEventThreadForSession(session);

            // Fetch context for LLM
            const { data: events, error: eventsError } = await supabase
              .from("events")
              .select(
                "id, type, agent_id, user_id, progress, payload, order_index, created_at",
              )
              .eq("thread_id", thread.id)
              .order("order_index", { ascending: true });

            if (eventsError) {
              console.error("Failed to fetch events for context:", eventsError);
              return NextResponse.json(
                { error: "Failed to load event thread" },
                { status: 500 },
              );
            }

            const { count: participantCount } = await supabase
              .from("participants")
              .select("user_id", { count: "exact", head: true })
              .eq("session_id", sessionId);

            // Fetch existing statements so the LLM can avoid generating duplicates
            const { data: existingStatements } = await supabase
              .from("statements")
              .select("text")
              .eq("session_id", sessionId)
              .order("order_index", { ascending: true });

            const existingQuestionsContext =
              existingStatements && existingStatements.length > 0
                ? `\n<existing_statements>\n${existingStatements.map((s, i) => `  <statement index="${i + 1}">${s.text}</statement>`).join("\n")}\n</existing_statements>`
                : "";

            // Generate statements (15 questions)
            const statementTexts = await generateSurveyStatements({
              sessionTitle: session.title,
              sessionGoal: sessionFacilitatorGoal(session),
              initialContext: sessionFacilitatorContext(session),
              eventThreadContext:
                JSON.stringify(events) + existingQuestionsContext,
              participantCount: participantCount ?? 0,
              language: toContentLanguage(session.language),
            });

            span.setAttribute(
              "statements.generated_count",
              statementTexts.length,
            );

            if (statementTexts.length === 0) {
              return NextResponse.json(
                { error: "No statements generated" },
                { status: 500 },
              );
            }

            // Atomic, per-session-serialized append (audit M4): the RPC assigns
            // order_index under a per-session advisory lock, so concurrent generation
            // cannot produce duplicate order_index (replaces read-MAX-then-insert).
            const { data: insertedStatements, error: insertError } = (await (
              supabase.rpc as CallableFunction
            )("append_session_statements", {
              p_session_id: sessionId,
              p_texts: statementTexts,
            })) as {
              data: Array<{
                id: string;
                text: string;
                order_index: number;
              }> | null;
              error: { message?: string } | null;
            };

            if (insertError || !insertedStatements) {
              console.error(
                "Failed to insert generated statements:",
                insertError,
              );
              return NextResponse.json(
                { error: "Failed to save generated statements" },
                { status: 500 },
              );
            }

            span.setAttribute(
              "statements.inserted_count",
              insertedStatements.length,
            );
            Sentry.logger.info("statements.generate completed", {
              sessionId,
              generatedCount: String(statementTexts.length),
              insertedCount: String(insertedStatements.length),
            });

            return NextResponse.json({
              statements: insertedStatements.map((s) => ({
                id: s.id,
                text: s.text,
                orderIndex: s.order_index,
              })),
            });
          },
        );
      } catch (error) {
        if (error instanceof SessionAccessError) {
          return NextResponse.json(
            { error: error.message },
            { status: error.status },
          );
        }

        console.error("Failed to generate statements:", error);
        return NextResponse.json(
          { error: "Failed to generate statements" },
          { status: 500 },
        );
      }
    },
  );
}
