export type ThreadEventType =
  | "plan"
  | "survey"
  | "survey_analysis"
  | "user_message";

export type ThreadEventStatus = "pending" | "completed" | "failed";

export type ThreadEventPayload = Record<string, unknown> | null | undefined;

// Recovery hints carry structure only; the admin UI renders the localized
// title/description/button from `kind`, `eventType` and `action`.
export type ThreadRecoveryAction = {
  type: "reanalyze";
};

export type ThreadRecoveryHint =
  | {
      kind: "event_failed";
      eventType: ThreadEventType;
      errorMessage: string | null;
      action: ThreadRecoveryAction | null;
    }
  | {
      kind: "auto_generation_disabled";
      errorMessage: null;
      action: ThreadRecoveryAction;
    };

const REANALYZE_ACTION: ThreadRecoveryAction = { type: "reanalyze" };

export function extractThreadEventError(
  payload: ThreadEventPayload,
): string | null {
  const error =
    payload && typeof payload.error === "string" ? payload.error : "";
  const trimmed = error.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getThreadEventStatus(input: {
  type: ThreadEventType;
  payload?: ThreadEventPayload;
  statementCount?: number;
}): { status: ThreadEventStatus; errorMessage: string | null } {
  const errorMessage = extractThreadEventError(input.payload);
  if (errorMessage) {
    return { status: "failed", errorMessage };
  }

  if (input.type === "user_message") {
    return { status: "completed", errorMessage: null };
  }

  if (input.type === "survey") {
    const payloadStatementIds = Array.isArray(input.payload?.statementIds)
      ? input.payload.statementIds
      : [];
    const statementCount = Math.max(
      input.statementCount ?? 0,
      payloadStatementIds.length,
    );
    return {
      status: statementCount > 0 ? "completed" : "pending",
      errorMessage: null,
    };
  }

  const markdown =
    input.payload && typeof input.payload.markdown === "string"
      ? input.payload.markdown.trim()
      : "";

  return {
    status: markdown.length > 0 ? "completed" : "pending",
    errorMessage: null,
  };
}

export function deriveThreadRecoveryHint(input: {
  shouldProceed: boolean;
  totalParticipants: number;
  completedParticipants: number;
  latestEvent:
    | {
        type: ThreadEventType;
        status: ThreadEventStatus;
        errorMessage?: string | null;
      }
    | null
    | undefined;
}): ThreadRecoveryHint | null {
  if (input.latestEvent?.status === "failed") {
    const canRetryAnalysis = input.latestEvent.type === "survey_analysis";
    return {
      kind: "event_failed",
      eventType: input.latestEvent.type,
      errorMessage: input.latestEvent.errorMessage ?? null,
      action: canRetryAnalysis ? REANALYZE_ACTION : null,
    };
  }

  if (
    !input.shouldProceed &&
    input.totalParticipants > 0 &&
    input.completedParticipants >= input.totalParticipants
  ) {
    return {
      kind: "auto_generation_disabled",
      errorMessage: null,
      action: REANALYZE_ACTION,
    };
  }

  return null;
}
