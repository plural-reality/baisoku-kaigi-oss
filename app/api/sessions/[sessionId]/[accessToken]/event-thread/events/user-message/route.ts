export const dynamic = "force-dynamic";

import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { ensureEventThreadForSession } from "@/lib/server/event-threads";
import {
  requireSessionAdminToken,
  SessionAccessError,
} from "@/lib/server/session-access";
import { aliasNullableUserId } from "@/lib/server/user-alias";
import { supabase } from "@/lib/supabase";

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
    { name: "event-thread.user-message", op: "api" },
    async (span) => {
      try {
        const { sessionId, accessToken } = await params;
        span.setAttribute("session.id", sessionId);
        span.setAttribute("user.id", userId);

        const session = await requireSessionAdminToken(sessionId, accessToken);
        const thread = await ensureEventThreadForSession(session);
        const body = await request.json();
        const { markdown } = body as { markdown?: unknown };

        if (typeof markdown !== "string" || markdown.trim().length === 0) {
          return NextResponse.json(
            { error: "Message content is required" },
            { status: 400 },
          );
        }

        const { data: event, error: insertError } = await supabase
          .from("events")
          .insert({
            thread_id: thread.id,
            type: "user_message",
            user_id: userId,
            progress: 1,
            payload: {
              markdown: markdown.trim(),
              metadata: { source: "admin_console" },
            },
          })
          .select(
            "id, type, agent_id, user_id, progress, payload, order_index, created_at, updated_at",
          )
          .single();

        if (insertError || !event) {
          console.error("Failed to append user message event:", insertError);
          return NextResponse.json(
            { error: "Failed to send message" },
            { status: 500 },
          );
        }

        span.setAttribute("event.id", event.id);
        Sentry.logger.info("event-thread.user-message completed", {
          sessionId,
          threadId: thread.id,
          eventId: event.id,
        });

        return NextResponse.json({
          event: {
            id: event.id,
            type: event.type,
            agentId: event.agent_id,
            userId: aliasNullableUserId(sessionId, event.user_id),
            progress: Number(event.progress ?? 1),
            payload: event.payload ?? {},
            orderIndex: Number(event.order_index ?? 0),
            createdAt: event.created_at,
            updatedAt: event.updated_at,
          },
        });
      } catch (error) {
        if (error instanceof SessionAccessError) {
          return NextResponse.json(
            { error: error.message },
            { status: error.status },
          );
        }

        console.error("Failed to send user message:", error);
        return NextResponse.json(
          { error: "Failed to send message" },
          { status: 500 },
        );
      }
    },
  );
}
