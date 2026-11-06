export const dynamic = "force-dynamic";

import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  requireSessionAdminAccess,
  SessionAccessError,
} from "@/lib/server/session-access";
import { aliasUserId } from "@/lib/server/user-alias";
import { selectAllRange, supabase } from "@/lib/supabase";

type StatementRow = {
  id: string;
  text: string;
  order_index: number;
};

type ParticipantRow = {
  user_id: string;
  name: string;
  created_at: string;
};

type ResponseRow = {
  id: string;
  participant_user_id: string;
  session_id: string;
  statement_id: string;
  response_type: "scale" | "free_text";
  value: number | null;
  text_response: string | null;
  created_at: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; accessToken: string }> },
) {
  return Sentry.startSpan(
    { name: "response-log.create", op: "api" },
    async (span) => {
      try {
        const { sessionId, accessToken } = await params;
        const userId = await getUserIdFromRequest(request);

        if (!userId) {
          return NextResponse.json(
            { error: "Unauthorized: Missing user ID" },
            { status: 401 },
          );
        }

        span.setAttribute("session.id", sessionId);
        span.setAttribute("user.id", userId);

        // Verify session access (checks both access token and host user)
        await requireSessionAdminAccess(sessionId, accessToken);

        // Fetch all participants
        const { data: participants, error: participantsError } =
          await selectAllRange((from, to) =>
            supabase
              .from("participants")
              .select("user_id, name, created_at")
              .eq("session_id", sessionId)
              .order("created_at", { ascending: true })
              .range(from, to),
          );

        if (participantsError) {
          console.error("Failed to fetch participants:", participantsError);
          return NextResponse.json(
            { error: "Failed to fetch participants" },
            { status: 500 },
          );
        }

        // Fetch all statements
        const { data: statements, error: statementsError } = await supabase
          .from("statements")
          .select("id, text, order_index")
          .eq("session_id", sessionId)
          .order("order_index", { ascending: true });

        if (statementsError) {
          console.error("Failed to fetch statements:", statementsError);
          return NextResponse.json(
            { error: "Failed to fetch statements" },
            { status: 500 },
          );
        }

        // Fetch all responses for this session
        const { data: responses, error: responsesError } = await selectAllRange(
          (from, to) =>
            supabase
              .from("responses")
              .select(
                "id, participant_user_id, session_id, statement_id, response_type, value, text_response, created_at",
              )
              .eq("session_id", sessionId)
              .order("created_at", { ascending: true })
              .range(from, to),
        );

        if (responsesError) {
          console.error("Failed to fetch responses:", responsesError);
          return NextResponse.json(
            { error: "Failed to fetch responses" },
            { status: 500 },
          );
        }

        // Map responses by participant and statement
        const responseMap = new Map<string, Map<string, ResponseRow>>();
        (responses ?? []).forEach((response) => {
          const r = response as unknown as ResponseRow;
          const participantResponses =
            responseMap.get(r.participant_user_id) ??
            new Map<string, ResponseRow>();
          participantResponses.set(r.statement_id, r);
          responseMap.set(r.participant_user_id, participantResponses);
        });

        // Latest individual report (自分レポート) per participant.
        const { data: reports } = await selectAllRange((from, to) =>
          supabase
            .from("individual_reports")
            .select("participant_user_id, content_markdown, created_at")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: false })
            .range(from, to),
        );
        const reportMap = new Map<string, string>();
        (reports ?? []).forEach((rep) => {
          const r = rep as {
            participant_user_id: string;
            content_markdown: string;
          };
          if (!reportMap.has(r.participant_user_id)) {
            reportMap.set(r.participant_user_id, r.content_markdown);
          }
        });

        // Build the response logs
        const responseLogs = (participants ?? []).map(
          (participant: ParticipantRow) => {
            const participantResponses =
              responseMap.get(participant.user_id) ?? new Map();
            const statementResponses = (statements ?? []).map(
              (statement: StatementRow) => {
                const response = participantResponses.get(statement.id);
                return {
                  statementId: statement.id,
                  statementText: statement.text,
                  orderIndex: statement.order_index,
                  responseType: response?.response_type ?? null,
                  value: response?.value ?? null,
                  textResponse: response?.text_response ?? null,
                  answeredAt: response?.created_at ?? null,
                };
              },
            );

            return {
              // Per-session alias, never the raw UUID (audit H2).
              userId: aliasUserId(sessionId, participant.user_id),
              name: participant.name,
              joinedAt: participant.created_at,
              responses: statementResponses,
              individualReport: reportMap.get(participant.user_id) ?? null,
            };
          },
        );

        span.setAttribute("participants.count", participants?.length ?? 0);
        span.setAttribute("statements.count", statements?.length ?? 0);
        Sentry.logger.info("response-log.create completed", {
          sessionId,
          totalParticipants: String(participants?.length ?? 0),
          totalStatements: String(statements?.length ?? 0),
        });

        return NextResponse.json({
          data: {
            sessionId,
            participants: responseLogs,
            statements: (statements ?? []).map((s: StatementRow) => ({
              id: s.id,
              text: s.text,
              orderIndex: s.order_index,
            })),
            totalParticipants: participants?.length ?? 0,
            totalStatements: statements?.length ?? 0,
          },
        });
      } catch (error) {
        if (error instanceof SessionAccessError) {
          return NextResponse.json(
            { error: error.message },
            { status: error.status },
          );
        }
        console.error("Failed to fetch response logs:", error);
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 },
        );
      }
    },
  );
}
