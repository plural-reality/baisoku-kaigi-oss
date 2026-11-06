export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { toContentLanguage } from "@/lib/content-language";
import { generateSurveyAnalysisMarkdown, type StatementStat } from "@/lib/llm";
import { ensureEventThreadForSession } from "@/lib/server/event-threads";
import {
  requireSessionAdminAccess,
  SessionAccessError,
} from "@/lib/server/session-access";
import { respondExclusive } from "@/lib/server/single-flight";
import {
  sessionFacilitatorContext,
  sessionFacilitatorGoal,
} from "@/lib/session-context";
import { selectAllRange, supabase } from "@/lib/supabase";

function truncate(value: string, length = 8) {
  if (value.length <= length) return value;
  return `${value.slice(0, length / 2)}…${value.slice(-length / 2)}`;
}

function buildStatementStats(
  statements: Array<{ id: string; text: string }>,
  responses: Array<{
    statement_id: string;
    value: number | null;
    response_type?: string;
    text_response?: string | null;
    participant_user_id?: string;
  }>,
  participantNameMap?: Map<string, string>,
): StatementStat[] {
  const responseMap = new Map<
    string,
    Array<{
      value: number | null;
      response_type?: string;
      text_response?: string | null;
      participant_user_id?: string;
    }>
  >();
  responses.forEach((response) => {
    const list = responseMap.get(response.statement_id) ?? [];
    list.push(response);
    responseMap.set(response.statement_id, list);
  });

  return statements.map((statement) => {
    const statementResponses = responseMap.get(statement.id) ?? [];
    const scaleResponses = statementResponses.filter(
      (response) => response.response_type !== "free_text",
    );
    const freeTextResponses = statementResponses.filter(
      (response) => response.response_type === "free_text",
    );
    const totalCount = scaleResponses.length;
    const counts = {
      strongYes: 0,
      yes: 0,
      dontKnow: 0,
      no: 0,
      strongNo: 0,
    };

    const participantResponses = scaleResponses.map((response) => {
      const participantId = response.participant_user_id;
      const participantName = participantId
        ? (participantNameMap?.get(participantId) ?? truncate(participantId))
        : "Unknown";

      switch (response.value ?? 0) {
        case 2:
          counts.strongYes++;
          break;
        case 1:
          counts.yes++;
          break;
        case 0:
          counts.dontKnow++;
          break;
        case -1:
          counts.no++;
          break;
        case -2:
          counts.strongNo++;
          break;
        default:
          break;
      }
      return {
        participantId: participantId ?? "unknown",
        participantName,
        value: response.value ?? 0,
      };
    });

    const toPercent = (count: number) =>
      totalCount > 0 ? Math.round((count / totalCount) * 1000) / 10 : 0;

    return {
      text: statement.text,
      totalCount,
      distribution: {
        strongYes: toPercent(counts.strongYes),
        yes: toPercent(counts.yes),
        dontKnow: toPercent(counts.dontKnow),
        no: toPercent(counts.no),
        strongNo: toPercent(counts.strongNo),
      },
      participantResponses,
      freeTextResponses: freeTextResponses
        .filter((entry) => Boolean(entry.text_response))
        .map((entry) => {
          const participantId = entry.participant_user_id;
          return {
            participantId: participantId ?? "unknown",
            participantName: participantId
              ? (participantNameMap?.get(participantId) ??
                truncate(participantId))
              : "Unknown",
            text: entry.text_response ?? "",
          };
        }),
    };
  });
}

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

  try {
    const { sessionId, accessToken } = await params;
    const session = await requireSessionAdminAccess(sessionId, accessToken);
    // One analysis per session at a time: a re-click after a CDN timeout must
    // not insert a second survey_analysis while the first is still running.
    return await respondExclusive(`thread-analyze:${sessionId}`, async () => {
      const thread = await ensureEventThreadForSession(session);

      // Collect statement IDs from survey events in this thread
      const { data: surveyEvents, error: surveyError } = await supabase
        .from("events")
        .select("payload")
        .eq("thread_id", thread.id)
        .eq("type", "survey")
        .order("order_index", { ascending: false })
        .limit(1);

      if (surveyError) {
        console.error("Failed to load survey events:", surveyError);
        return NextResponse.json(
          { error: "Failed to load survey data" },
          { status: 500 },
        );
      }

      // Get statement IDs from the latest survey event, or fall back to all statements
      let statementIds: string[] = [];
      if (surveyEvents && surveyEvents.length > 0) {
        const payload = (surveyEvents[0].payload ?? {}) as {
          statementIds?: string[];
        };
        statementIds = payload.statementIds ?? [];
      }

      // If no survey event with statementIds, get all statements for this session
      if (statementIds.length === 0) {
        const { data: allStatements, error: allStatementsError } =
          await supabase
            .from("statements")
            .select("id")
            .eq("session_id", sessionId);

        if (allStatementsError) {
          console.error("Failed to load statements:", allStatementsError);
          return NextResponse.json(
            { error: "Failed to load statements" },
            { status: 500 },
          );
        }
        statementIds = (allStatements ?? []).map((s) => s.id);
      }

      if (statementIds.length === 0) {
        return NextResponse.json(
          { error: "No statements found to analyze" },
          { status: 400 },
        );
      }

      // Fetch statements, responses, and participants
      const [statementsResult, responsesResult, participantCountResult] =
        await Promise.all([
          supabase.from("statements").select("id, text").in("id", statementIds),
          selectAllRange((from, to) =>
            supabase
              .from("responses")
              .select(
                "statement_id, value, participant_user_id, response_type, text_response",
              )
              .in("statement_id", statementIds)
              // Stable order so the LLM analysis input is deterministic and
              // offset pagination (selectAllRange) can't drop/duplicate rows.
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to),
          ),
          supabase
            .from("participants")
            .select("user_id", { count: "exact", head: true })
            .eq("session_id", sessionId),
        ]);

      if (statementsResult.error) {
        console.error("Failed to load statements:", statementsResult.error);
        return NextResponse.json(
          { error: "Failed to load statements" },
          { status: 500 },
        );
      }

      if (responsesResult.error) {
        console.error("Failed to load responses:", responsesResult.error);
        return NextResponse.json(
          { error: "Failed to load responses" },
          { status: 500 },
        );
      }

      const statements = statementsResult.data ?? [];
      const responses = responsesResult.data ?? [];
      const participantCount = participantCountResult.count ?? 0;

      // Build participant name map
      let participantNameMap: Map<string, string> | undefined;
      const participantUserIds = new Set(
        responses
          .map((r) => r.participant_user_id)
          .filter((id): id is string => Boolean(id)),
      );

      if (participantUserIds.size > 0) {
        const { data: participantRows } = await supabase
          .from("participants")
          .select("user_id, name")
          .eq("session_id", sessionId)
          .in("user_id", Array.from(participantUserIds));

        if (participantRows) {
          participantNameMap = new Map(
            participantRows.map((p) => [p.user_id, p.name]),
          );
        }
      }

      // Build event thread context (simplified)
      const { data: allEvents } = await supabase
        .from("events")
        .select("id, type, payload, order_index, created_at")
        .eq("thread_id", thread.id)
        .order("order_index", { ascending: true });

      const eventThreadContext = JSON.stringify(allEvents ?? []);

      // Build stats and call LLM
      const stats = buildStatementStats(
        statements,
        responses,
        participantNameMap,
      );

      const markdown = await generateSurveyAnalysisMarkdown({
        sessionTitle: session.title,
        sessionGoal: sessionFacilitatorGoal(session),
        initialContext: sessionFacilitatorContext(session),
        totalParticipants: participantCount,
        statements: stats,
        eventThreadContext,
        language: toContentLanguage(session.language),
      });

      // Create survey_analysis event
      const { data: analysisEvent, error: insertError } = await supabase
        .from("events")
        .insert({
          thread_id: thread.id,
          type: "survey_analysis",
          agent_id: null,
          progress: 1,
          payload: { statementIds, markdown },
        })
        .select("id")
        .single();

      if (insertError || !analysisEvent) {
        console.error("Failed to create analysis event:", insertError);
        return NextResponse.json(
          { error: "Failed to save analysis" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        eventId: analysisEvent.id,
        markdown,
      });
    });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    console.error("Failed to run analysis:", error);
    const isRateLimit =
      error instanceof Error && /rate limit/i.test(error.message);
    return isRateLimit
      ? NextResponse.json(
          { error: "LLM rate limit exceeded. Please try again shortly." },
          { status: 503, headers: { "Retry-After": "30" } },
        )
      : NextResponse.json({ error: "Failed to run analysis" }, { status: 500 });
  }
}
