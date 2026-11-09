export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { toContentLanguage } from "@/lib/content-language";
import { buildSessionBrief, generateIndividualReport } from "@/lib/llm";
import { llmGenerationColumns } from "@/lib/llm-models";
import { warmReportStance } from "@/lib/server/report-stance";
import { respondExclusive } from "@/lib/server/single-flight";
import { sessionParticipantContextFields } from "@/lib/session-context";
import { supabase } from "@/lib/supabase";

type IndividualReportResponse = Parameters<
  typeof generateIndividualReport
>[0]["responses"][number];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const userId = await getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized: User ID not found" },
        { status: 401 },
      );
    }

    const { data: participant, error: participantError } = await supabase
      .from("participants")
      .select("user_id, session_id, name, latest_individual_report_id")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .single();

    if (participantError || !participant) {
      if (participantError?.code === "PGRST116") {
        return NextResponse.json(
          { error: "Forbidden: You are not a participant in this session" },
          { status: 403 },
        );
      }
      console.error(
        "Failed to load participant for individual report:",
        participantError,
      );
      return NextResponse.json(
        { error: "Failed to fetch individual report" },
        { status: 500 },
      );
    }

    if (!participant.latest_individual_report_id) {
      return NextResponse.json({ report: null });
    }

    const { data: report, error: reportError } = await supabase
      .from("individual_reports")
      .select(
        "id, participant_user_id, session_id, content_markdown, deep_dive_questions, created_at",
      )
      .eq("id", participant.latest_individual_report_id)
      .single();

    if (reportError) {
      if (reportError.code === "PGRST116") {
        return NextResponse.json({ report: null });
      }
      console.error("Failed to load latest individual report:", reportError);
      return NextResponse.json(
        { error: "Failed to fetch individual report" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      report: {
        id: report.id,
        participantUserId: report.participant_user_id,
        sessionId: report.session_id,
        contentMarkdown: report.content_markdown,
        createdAt: report.created_at,
      },
      deepDiveQuestions: Array.isArray(report.deep_dive_questions)
        ? report.deep_dive_questions
        : [],
    });
  } catch (error) {
    console.error("Error fetching individual report:", error);
    return NextResponse.json(
      { error: "Failed to fetch individual report" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const userId = await getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized: User ID not found" },
        { status: 401 },
      );
    }

    // One generation per participant at a time: a re-tap after a CDN timeout
    // must not run a second report LLM call while the first is still running.
    return await respondExclusive(
      `individual-report:${sessionId}:${userId}`,
      async () => {
        // Parse request body for optional taste parameter
        const body = await request.json().catch(() => ({}));
        const taste = typeof body.taste === "string" ? body.taste : "neutral";

        // Verify that the user is a participant in this session
        const { data: participant, error: participantError } = await supabase
          .from("participants")
          .select("user_id, session_id, name")
          .eq("user_id", userId)
          .eq("session_id", sessionId)
          .single();

        if (participantError || !participant) {
          if (participantError?.code === "PGRST116") {
            return NextResponse.json(
              { error: "Forbidden: You are not a participant in this session" },
              { status: 403 },
            );
          }
          console.error(
            "Failed to load participant for report generation:",
            participantError,
          );
          return NextResponse.json(
            { error: "Failed to generate individual report" },
            { status: 500 },
          );
        }

        // Get session context
        const { data: session, error: sessionError } = await supabase
          .from("sessions")
          .select(
            "id, title, context, goal, facilitator_context, facilitator_goal, language",
          )
          .eq("id", sessionId)
          .single();

        if (sessionError || !session) {
          if (sessionError?.code === "PGRST116") {
            return NextResponse.json(
              { error: "Session not found" },
              { status: 404 },
            );
          }
          console.error(
            "Failed to load session for report generation:",
            sessionError,
          );
          return NextResponse.json(
            { error: "Session not found" },
            { status: 404 },
          );
        }

        // Fetch all responses for this participant with statement text
        const { data: responses, error: responsesError } = await supabase
          .from("responses")
          .select("statement_id, value, response_type, text_response")
          .eq("participant_user_id", userId)
          .eq("session_id", sessionId);

        if (responsesError) {
          console.error(
            "Failed to load participant responses for report generation:",
            responsesError,
          );
          return NextResponse.json(
            { error: "Failed to generate individual report" },
            { status: 500 },
          );
        }

        if ((responses ?? []).length === 0) {
          return NextResponse.json(
            {
              error: "No responses found. Please answer some questions first.",
            },
            { status: 400 },
          );
        }

        const statementIds = Array.from(
          new Set((responses ?? []).map((response) => response.statement_id)),
        );

        const { data: statements, error: statementsError } = await supabase
          .from("statements")
          .select("id, text")
          .in("id", statementIds);

        if (statementsError) {
          console.error(
            "Failed to load statements for report generation:",
            statementsError,
          );
          return NextResponse.json(
            { error: "Failed to generate individual report" },
            { status: 500 },
          );
        }

        const statementTextMap = new Map(
          (statements ?? []).map((statement) => [statement.id, statement.text]),
        );

        // Format responses for LLM
        const responsesWithStatement: IndividualReportResponse[] = (
          responses ?? []
        ).map((response) => ({
          statementText: statementTextMap.get(response.statement_id) ?? "",
          responseType:
            response.response_type === "free_text" ? "free_text" : "scale",
          value: typeof response.value === "number" ? response.value : null,
          textResponse: response.text_response ?? undefined,
        }));

        // Fetch the participant's self-submitted reflections (追加の論点・ご意見)
        // so the report reflects the topics they raised themselves. Non-fatal:
        // a failure here must not block report generation.
        // Bound the prompt input: newest reflections first, capped in count and
        // per-item length so a participant posting many/long reflections cannot
        // blow past the LLM token limit or inflate cost (P2).
        const MAX_REFLECTIONS = 20;
        const MAX_REFLECTION_CHARS = 1000;
        const { data: reflectionRows, error: reflectionsError } = await supabase
          .from("participant_reflections")
          .select("text")
          .eq("participant_user_id", userId)
          .eq("session_id", sessionId)
          .order("submitted_at", { ascending: false })
          .limit(MAX_REFLECTIONS);

        if (reflectionsError) {
          console.error(
            "Failed to load participant reflections for report generation:",
            reflectionsError,
          );
        }

        const reflections = (reflectionRows ?? [])
          .map((row) =>
            typeof row.text === "string"
              ? row.text.trim().slice(0, MAX_REFLECTION_CHARS)
              : "",
          )
          .filter((text) => text.length > 0);

        // Generate individual report using LLM
        const participantContextFields =
          sessionParticipantContextFields(session);
        const sessionBrief = buildSessionBrief(
          participantContextFields.goal,
          participantContextFields.context,
        );
        const { reportMarkdown, deepDiveQuestions, llm } =
          await generateIndividualReport({
            sessionTitle: session.title,
            context: sessionBrief,
            responses: responsesWithStatement,
            userName: participant.name,
            taste,
            reflections,
            language: toContentLanguage(session.language),
          });

        // Save report to database, including deep-dive questions so the client can
        // display them after page reload without re-generating, and the model /
        // prompt version / generation id that produced it.
        const { data: report, error: reportError } = await supabase
          .from("individual_reports")
          .insert({
            participant_user_id: userId,
            session_id: sessionId,
            content_markdown: reportMarkdown,
            deep_dive_questions: deepDiveQuestions,
            ...llmGenerationColumns(llm),
          })
          .select(
            "id, participant_user_id, session_id, content_markdown, deep_dive_questions, created_at",
          )
          .single();

        if (reportError || !report) {
          console.error("Failed to insert individual report:", reportError);
          return NextResponse.json(
            { error: "Failed to generate individual report" },
            { status: 500 },
          );
        }

        // Update participant's latest report reference
        const { error: updateParticipantError } = await supabase
          .from("participants")
          .update({
            latest_individual_report_id: report.id,
          })
          .eq("user_id", userId)
          .eq("session_id", sessionId);

        if (updateParticipantError) {
          console.error(
            "Failed to update participant with latest report:",
            updateParticipantError,
          );
          return NextResponse.json(
            { error: "Failed to generate individual report" },
            { status: 500 },
          );
        }

        // じぶんレポート地図のホバー用「立ち位置の一言」を先に生成してキャッシュを温める
        // (作成時に1件だけ生成=一括不要・タイムアウト無し、ホバー時はキャッシュヒットで即時)。
        warmReportStance(
          report.content_markdown,
          toContentLanguage(session.language),
        );

        return NextResponse.json({
          report: {
            id: report.id,
            participantUserId: report.participant_user_id,
            sessionId: report.session_id,
            contentMarkdown: report.content_markdown,
            createdAt: report.created_at,
          },
          deepDiveQuestions: Array.isArray(report.deep_dive_questions)
            ? report.deep_dive_questions
            : deepDiveQuestions,
        });
      },
    );
  } catch (error) {
    console.error("Error generating individual report:", error);
    return NextResponse.json(
      { error: "Failed to generate individual report" },
      { status: 500 },
    );
  }
}
