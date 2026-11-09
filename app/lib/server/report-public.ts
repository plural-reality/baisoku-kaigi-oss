// Client-facing projection of a session report (audit H2, found on staging
// 2026-10-07): `created_by` and the user ids inside the stored prompt snapshot
// (participantSummaries[].userId, eventTimeline[].userId) are raw UUIDs. Alias
// them per session on the way out. Server-side readers (statement responses,
// prompt building) keep using the unaliased record from session-reports.ts.
//
// Separate module (not session-reports.ts) so route tests that mock the data
// layer still exercise the real projection.

import type { SessionReportRecord } from "@/lib/server/session-reports";
import { aliasUserId } from "@/lib/server/user-alias";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const aliasUserIdsIn = (sessionId: string, items: unknown): unknown =>
  Array.isArray(items)
    ? items.map((item) =>
        isRecord(item) && typeof item.userId === "string"
          ? { ...item, userId: aliasUserId(sessionId, item.userId) }
          : item,
      )
    : items;

export const toPublicSessionReport = (
  report: SessionReportRecord,
): SessionReportRecord => {
  const snapshot = report.promptSnapshot;
  return {
    ...report,
    // Raw OpenRouter usage (tokens, cost) is internal telemetry, not report content.
    ...("tokenUsage" in report ? { tokenUsage: null } : {}),
    createdBy:
      typeof report.createdBy === "string"
        ? aliasUserId(report.sessionId, report.createdBy)
        : report.createdBy,
    promptSnapshot: isRecord(snapshot)
      ? {
          ...snapshot,
          participantSummaries: aliasUserIdsIn(
            report.sessionId,
            snapshot.participantSummaries,
          ),
          eventTimeline: aliasUserIdsIn(
            report.sessionId,
            snapshot.eventTimeline,
          ),
        }
      : snapshot,
  };
};
