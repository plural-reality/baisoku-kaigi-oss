export const dynamic = "force-dynamic";

import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { ensureEventThreadForSession } from "@/lib/server/event-threads";
import {
  requireSessionAdminToken,
  SessionAccessError,
} from "@/lib/server/session-access";
import { supabase } from "@/lib/supabase";

export async function PATCH(
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
    { name: "event-thread.should-proceed", op: "api" },
    async (span) => {
      try {
        const { sessionId, accessToken } = await params;
        span.setAttribute("session.id", sessionId);
        span.setAttribute("user.id", userId);

        const session = await requireSessionAdminToken(sessionId, accessToken);
        const thread = await ensureEventThreadForSession(session);
        const body = await request.json();
        const { shouldProceed } = body as { shouldProceed?: unknown };

        if (typeof shouldProceed !== "boolean") {
          return NextResponse.json(
            { error: "Invalid shouldProceed value" },
            { status: 400 },
          );
        }

        const { data: updatedThread, error: updateError } = await supabase
          .from("event_threads")
          .update({
            should_proceed: shouldProceed,
            updated_at: new Date().toISOString(),
          })
          .eq("id", thread.id)
          .select("id, should_proceed, created_at, updated_at")
          .single();

        if (updateError || !updatedThread) {
          console.error("Failed to update should_proceed:", updateError);
          return NextResponse.json(
            { error: "Failed to update event thread" },
            { status: 500 },
          );
        }

        span.setAttribute("thread.id", updatedThread.id);
        span.setAttribute("should_proceed", String(shouldProceed));
        Sentry.logger.info("event-thread.should-proceed completed", {
          sessionId,
          threadId: updatedThread.id,
          shouldProceed: String(shouldProceed),
        });

        return NextResponse.json({
          thread: {
            id: updatedThread.id,
            shouldProceed: updatedThread.should_proceed,
            createdAt: updatedThread.created_at,
            updatedAt: updatedThread.updated_at,
          },
        });
      } catch (error) {
        if (error instanceof SessionAccessError) {
          return NextResponse.json(
            { error: error.message },
            { status: error.status },
          );
        }

        console.error("Failed to toggle shouldProceed:", error);
        return NextResponse.json(
          { error: "Failed to update event thread" },
          { status: 500 },
        );
      }
    },
  );
}
