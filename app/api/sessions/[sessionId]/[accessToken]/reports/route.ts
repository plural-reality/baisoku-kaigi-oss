import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getUserIdFromRequest } from "@/lib/auth";
import { toPublicSessionReport } from "@/lib/server/report-public";
import {
  requireSessionAdminAccess,
  requireSessionAdminToken,
  SessionAccessError,
} from "@/lib/server/session-access";
import {
  createSessionReportRecord,
  expireStaleSessionReports,
  findActiveSessionReport,
  listSessionReports,
  triggerSessionReportGeneration,
} from "@/lib/server/session-reports";

function handleAccessError(error: unknown) {
  if (error instanceof SessionAccessError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  console.error(error);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; accessToken: string }> },
) {
  const { sessionId, accessToken } = await params;
  const userId = await getUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await requireSessionAdminToken(sessionId, accessToken);
    const reports = await listSessionReports(sessionId);
    return NextResponse.json({ data: reports.map(toPublicSessionReport) });
  } catch (error) {
    return handleAccessError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; accessToken: string }> },
) {
  const { sessionId, accessToken } = await params;
  const userId = await getUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return Sentry.startSpan(
    { name: "report.generate", op: "api" },
    async (span) => {
      span.setAttribute("session.id", sessionId);
      span.setAttribute("user.id", userId);

      let payload: { requestMarkdown?: string } = {};
      try {
        payload = (await request.json()) as { requestMarkdown?: string };
      } catch (error) {
        console.warn("Invalid request payload for session report:", error);
      }

      try {
        await requireSessionAdminAccess(sessionId, accessToken);

        // Idempotency guard at the authoritative boundary: if a report for this
        // session is already in flight, return it instead of starting another
        // LLM call. Stops the retry storm even when the client guard is bypassed
        // (stale list, another tab/admin, or a direct POST). Rows orphaned by a
        // restart are expired first so they neither block nor masquerade as
        // in-flight.
        await expireStaleSessionReports(sessionId);
        const active = await findActiveSessionReport(sessionId);
        if (active) {
          return NextResponse.json(
            { data: toPublicSessionReport(active) },
            { status: 202 },
          );
        }

        const { created, report } = await createSessionReportRecord({
          sessionId,
          userId,
          requestMarkdown: payload.requestMarkdown,
        });
        // A concurrent POST created the in-flight report first: return it
        // rather than starting a second LLM call for the same session.
        if (!created) {
          return NextResponse.json(
            { data: toPublicSessionReport(report) },
            { status: 202 },
          );
        }

        void triggerSessionReportGeneration(report.id);

        span.setAttribute("report.id", report.id);
        Sentry.logger.info("report.generate completed", {
          sessionId,
          reportId: report.id,
        });

        return NextResponse.json(
          { data: toPublicSessionReport(report) },
          {
            status: 201,
          },
        );
      } catch (error) {
        return handleAccessError(error);
      }
    },
  );
}
