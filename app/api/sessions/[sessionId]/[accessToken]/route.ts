export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { toContentLanguage } from "@/lib/content-language";
import { sanitizeErrorForLog } from "@/lib/sanitize-error";
import { safeCompare } from "@/lib/server/session-access";
import { aliasNullableUserId, aliasUserId } from "@/lib/server/user-alias";
import { sessionAdminContextFields } from "@/lib/session-context";
import { selectAllRange, supabase } from "@/lib/supabase";

type ResponseValue = -2 | -1 | 0 | 1 | 2;

interface ResponseStats {
  strongYes: number; // percentage
  yes: number;
  dontKnow: number;
  no: number;
  strongNo: number;
  // raw integer people-counts per bucket, so the UI can render one dot per
  // person and keep the dot count == the stated number, exactly.
  counts: {
    strongYes: number;
    yes: number;
    dontKnow: number;
    no: number;
    strongNo: number;
  };
  totalCount: number;
  freeTextCount: number;
  freeTextSamples: Array<{ participantUserId: string | null; text: string }>;
}

interface StatementWithStats {
  id: string;
  sessionId: string;
  text: string;
  orderIndex: number;
  responses: ResponseStats;
  agreementScore: number;
}

interface ParticipantProgress {
  userId: string;
  name: string;
  answeredCount: number;
  completionRate: number;
  totalStatements: number;
  updatedAt: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; accessToken: string }> },
) {
  try {
    const { sessionId, accessToken } = await params;
    const userId = await getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized: User ID not found" },
        { status: 401 },
      );
    }

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select(
        "id, title, context, goal, facilitator_context, facilitator_goal, language, is_public, created_at, host_user_id, admin_access_token",
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
      console.error("Failed to load session for admin view:", sessionError);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }

    if (!safeCompare(session.admin_access_token, accessToken)) {
      return NextResponse.json(
        { error: "Forbidden: Invalid access token" },
        { status: 403 },
      );
    }

    const { data: statements, error: statementsError } = await supabase
      .from("statements")
      .select("id, session_id, text, order_index")
      .eq("session_id", sessionId)
      .order("order_index", { ascending: true });

    if (statementsError) {
      console.error(
        "Failed to fetch statements for admin view:",
        statementsError,
      );
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }

    const { data: responseRows, error: responsesError } = await selectAllRange(
      (from, to) =>
        supabase
          .from("responses")
          .select(
            "statement_id, value, participant_user_id, response_type, text_response",
          )
          .eq("session_id", sessionId)
          // Stable order: without it, PostgREST offset pagination
          // (selectAllRange) returns rows in a non-deterministic order that
          // shifts as responses are edited/added, making freeTextSamples (the
          // 自由記述 list on the report screen) reshuffle on every reload.
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
    );

    if (responsesError) {
      console.error(
        "Failed to fetch responses for admin view:",
        responsesError,
      );
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }

    const { data: participantRows, error: participantsError } =
      await selectAllRange((from, to) =>
        supabase
          .from("participants")
          .select("user_id, name, updated_at")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true })
          .range(from, to),
      );

    if (participantsError) {
      console.error(
        "Failed to fetch participants for admin view:",
        participantsError,
      );
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }

    const responseMap = new Map<
      string,
      {
        value: number | null;
        responseType: string;
        text: string | null;
        participantId: string | null;
      }[]
    >();
    const participantResponseCount = new Map<string, number>();

    (responseRows ?? []).forEach((response) => {
      const list = responseMap.get(response.statement_id) ?? [];
      list.push({
        value: response.value,
        responseType: response.response_type,
        text: response.text_response,
        participantId: response.participant_user_id ?? null,
      });
      responseMap.set(response.statement_id, list);

      if (response.participant_user_id) {
        const current = participantResponseCount.get(
          response.participant_user_id,
        );
        participantResponseCount.set(
          response.participant_user_id,
          (current ?? 0) + 1,
        );
      }
    });

    const totalStatements = statements?.length ?? 0;

    const participants: ParticipantProgress[] = (participantRows ?? []).map(
      (participant) => {
        const answeredCount =
          participantResponseCount.get(participant.user_id) ?? 0;
        const completionRate =
          totalStatements > 0
            ? Math.round((answeredCount / totalStatements) * 1000) / 10
            : 0;

        return {
          // Per-session alias, never the raw UUID (audit H2): the admin UI only
          // needs a stable join key across this session's endpoints.
          userId: aliasUserId(sessionId, participant.user_id),
          name: participant.name,
          answeredCount,
          completionRate,
          totalStatements,
          updatedAt: participant.updated_at,
        };
      },
    );

    const statementsWithStats: StatementWithStats[] = (statements ?? []).map(
      (statement) => {
        const statementResponses = responseMap.get(statement.id) ?? [];
        const scaleResponses = statementResponses.filter(
          (response) => response.responseType === "scale",
        );
        const freeTextResponses = statementResponses.filter(
          (response) => response.responseType === "free_text",
        );
        // Spectrum retention (shallow): free_text answers only come from the
        // 「わからない・自信がない」flow, so we collapse them to the center
        // (わからない) for the quantitative view — they count as respondents and
        // into the dontKnow bucket. Their natural-language text stays readable in
        // freeTextSamples below.
        const totalCount = scaleResponses.length + freeTextResponses.length;

        let strongYesCount = 0;
        let yesCount = 0;
        let dontKnowCount = freeTextResponses.length;
        let noCount = 0;
        let strongNoCount = 0;

        scaleResponses.forEach((response) => {
          const value = response.value as ResponseValue;
          switch (value) {
            case 2:
              strongYesCount++;
              break;
            case 1:
              yesCount++;
              break;
            case 0:
              dontKnowCount++;
              break;
            case -1:
              noCount++;
              break;
            case -2:
              strongNoCount++;
              break;
          }
        });

        const strongYesPercent =
          totalCount > 0 ? (strongYesCount / totalCount) * 100 : 0;
        const yesPercent = totalCount > 0 ? (yesCount / totalCount) * 100 : 0;
        const dontKnowPercent =
          totalCount > 0 ? (dontKnowCount / totalCount) * 100 : 0;
        const noPercent = totalCount > 0 ? (noCount / totalCount) * 100 : 0;
        const strongNoPercent =
          totalCount > 0 ? (strongNoCount / totalCount) * 100 : 0;

        const positiveCount = strongYesCount + yesCount;
        const negativeCount = strongNoCount + noCount;
        const agreementScore = Math.abs(positiveCount - negativeCount);

        return {
          id: statement.id,
          sessionId: statement.session_id,
          text: statement.text,
          orderIndex: statement.order_index,
          responses: {
            strongYes: Math.round(strongYesPercent * 100) / 100,
            yes: Math.round(yesPercent * 100) / 100,
            dontKnow: Math.round(dontKnowPercent * 100) / 100,
            no: Math.round(noPercent * 100) / 100,
            strongNo: Math.round(strongNoPercent * 100) / 100,
            counts: {
              strongYes: strongYesCount,
              yes: yesCount,
              dontKnow: dontKnowCount,
              no: noCount,
              strongNo: strongNoCount,
            },
            totalCount,
            freeTextCount: freeTextResponses.length,
            freeTextSamples: freeTextResponses.map((response) => ({
              participantUserId: aliasNullableUserId(
                sessionId,
                response.participantId,
              ),
              text: response.text ?? "",
            })),
          },
          agreementScore,
        };
      },
    );

    const adminContextFields = sessionAdminContextFields(session);

    return NextResponse.json({
      data: {
        id: session.id,
        title: session.title,
        context: adminContextFields.context,
        goal: adminContextFields.goal,
        facilitatorContext: adminContextFields.facilitatorContext,
        facilitatorGoal: adminContextFields.facilitatorGoal,
        language: toContentLanguage(session.language),
        isPublic: session.is_public,
        createdAt: session.created_at,
        statements: statementsWithStats,
        participants,
        totalStatements,
        totalParticipants: participants.length,
        canEdit: true,
      },
    });
  } catch (error) {
    console.error("Error fetching admin data:", sanitizeErrorForLog(error));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; accessToken: string }> },
) {
  try {
    const { sessionId, accessToken } = await params;
    const userId = await getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized: User ID not found" },
        { status: 401 },
      );
    }

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id, admin_access_token")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      if (sessionError?.code === "PGRST116") {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 },
        );
      }
      console.error("Failed to load session for update:", sessionError);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }

    if (!safeCompare(session.admin_access_token, accessToken)) {
      return NextResponse.json(
        { error: "Forbidden: Invalid access token" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { title, context, goal, facilitatorContext, facilitatorGoal } =
      body as {
        title?: unknown;
        context?: unknown;
        goal?: unknown;
        facilitatorContext?: unknown;
        facilitatorGoal?: unknown;
      };

    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Invalid title" }, { status: 400 });
    }

    // title のみ必須。goal / context / facilitator_* は任意:
    // 文字列で送られたら更新（空文字も可＝後から設定/クリアできる）、未指定なら既存値を温存。
    if (typeof context !== "undefined" && typeof context !== "string") {
      return NextResponse.json({ error: "Invalid context" }, { status: 400 });
    }

    if (typeof goal !== "undefined" && typeof goal !== "string") {
      return NextResponse.json({ error: "Invalid goal" }, { status: 400 });
    }

    if (
      typeof facilitatorGoal !== "undefined" &&
      typeof facilitatorGoal !== "string"
    ) {
      return NextResponse.json(
        { error: "Invalid facilitatorGoal" },
        { status: 400 },
      );
    }

    if (
      typeof facilitatorContext !== "undefined" &&
      typeof facilitatorContext !== "string"
    ) {
      return NextResponse.json(
        { error: "Invalid facilitatorContext" },
        { status: 400 },
      );
    }

    // 非破壊 PATCH: 送られたフィールドだけ更新し、未指定は温存する。
    // - goal/context（公開）: 文字列なら更新（空文字も可）。
    // - facilitator_*（本題）: 文字列なら trim（空文字なら null）。公開値で汚染しない。
    // AI 側は読み取り時に sessionFacilitatorGoal/Context で公開用へ fallback する。
    const settingsUpdate = {
      title: title.trim(),
      is_public: false,
      ...(typeof goal === "string" ? { goal: goal.trim() } : {}),
      ...(typeof context === "string" ? { context: context.trim() } : {}),
      ...(typeof facilitatorGoal === "string"
        ? { facilitator_goal: facilitatorGoal.trim() || null }
        : {}),
      ...(typeof facilitatorContext === "string"
        ? { facilitator_context: facilitatorContext.trim() || null }
        : {}),
    };

    const { data: updatedSession, error: updateError } = await supabase
      .from("sessions")
      .update(settingsUpdate)
      .eq("id", sessionId)
      .select(
        "id, title, context, goal, facilitator_context, facilitator_goal, is_public, created_at",
      )
      .single();

    if (updateError || !updatedSession) {
      console.error("Failed to update session:", updateError);
      return NextResponse.json(
        { error: "Failed to update session" },
        { status: 500 },
      );
    }

    const adminContextFields = sessionAdminContextFields(updatedSession);

    return NextResponse.json({
      data: {
        id: updatedSession.id,
        title: updatedSession.title,
        context: adminContextFields.context,
        goal: adminContextFields.goal,
        facilitatorContext: adminContextFields.facilitatorContext,
        facilitatorGoal: adminContextFields.facilitatorGoal,
        isPublic: updatedSession.is_public,
        createdAt: updatedSession.created_at,
      },
    });
  } catch (error) {
    console.error("Error updating session:", sanitizeErrorForLog(error));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; accessToken: string }> },
) {
  try {
    const { sessionId, accessToken } = await params;
    const userId = await getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized: User ID not found" },
        { status: 401 },
      );
    }

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id, admin_access_token")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      if (sessionError?.code === "PGRST116") {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 },
        );
      }
      console.error("Failed to load session for delete:", sessionError);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }

    if (!safeCompare(session.admin_access_token, accessToken)) {
      return NextResponse.json(
        { error: "Forbidden: Invalid access token" },
        { status: 403 },
      );
    }

    const { error: deleteError } = await supabase
      .from("sessions")
      .delete()
      .eq("id", sessionId);

    if (deleteError) {
      console.error("Failed to delete session:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete session" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Session deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting session:", sanitizeErrorForLog(error));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
