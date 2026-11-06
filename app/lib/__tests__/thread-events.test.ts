import { describe, expect, it } from "vitest";

import {
  deriveThreadRecoveryHint,
  getThreadEventStatus,
} from "../thread-events";

describe("getThreadEventStatus", () => {
  it("marks event as failed when payload.error exists", () => {
    expect(
      getThreadEventStatus({
        type: "survey_analysis",
        payload: { error: "OpenRouter timeout" },
      }),
    ).toEqual({
      status: "failed",
      errorMessage: "OpenRouter timeout",
    });
  });

  it("marks survey as pending while statement IDs are empty", () => {
    expect(
      getThreadEventStatus({
        type: "survey",
        payload: { statementIds: [] },
        statementCount: 0,
      }),
    ).toEqual({
      status: "pending",
      errorMessage: null,
    });
  });

  it("marks survey as completed when statements exist", () => {
    expect(
      getThreadEventStatus({
        type: "survey",
        payload: { statementIds: ["st-1"] },
        statementCount: 1,
      }),
    ).toEqual({
      status: "completed",
      errorMessage: null,
    });
  });

  it("marks plan as pending when markdown is empty", () => {
    expect(
      getThreadEventStatus({
        type: "plan",
        payload: { markdown: "" },
      }),
    ).toEqual({
      status: "pending",
      errorMessage: null,
    });
  });

  it("marks analysis as completed when markdown exists", () => {
    expect(
      getThreadEventStatus({
        type: "survey_analysis",
        payload: { markdown: "## Analysis" },
      }),
    ).toEqual({
      status: "completed",
      errorMessage: null,
    });
  });
});

describe("deriveThreadRecoveryHint", () => {
  it("returns failed hint for latest failed event", () => {
    expect(
      deriveThreadRecoveryHint({
        shouldProceed: true,
        totalParticipants: 3,
        completedParticipants: 3,
        latestEvent: {
          type: "survey_analysis",
          status: "failed",
          errorMessage: "Failed to call LLM API",
        },
      }),
    ).toEqual({
      kind: "event_failed",
      eventType: "survey_analysis",
      errorMessage: "Failed to call LLM API",
      action: { type: "reanalyze" },
    });
  });

  it("does not expose analysis retry for failed plan events", () => {
    expect(
      deriveThreadRecoveryHint({
        shouldProceed: true,
        totalParticipants: 3,
        completedParticipants: 3,
        latestEvent: {
          type: "plan",
          status: "failed",
          errorMessage: "Failed to call LLM API",
        },
      }),
    ).toEqual({
      kind: "event_failed",
      eventType: "plan",
      errorMessage: "Failed to call LLM API",
      action: null,
    });
  });

  it("returns manual gate hint when auto generation is disabled after completion", () => {
    expect(
      deriveThreadRecoveryHint({
        shouldProceed: false,
        totalParticipants: 2,
        completedParticipants: 2,
        latestEvent: {
          type: "survey",
          status: "completed",
          errorMessage: null,
        },
      }),
    ).toEqual({
      kind: "auto_generation_disabled",
      errorMessage: null,
      action: { type: "reanalyze" },
    });
  });

  it("returns null when there is no recovery hint", () => {
    expect(
      deriveThreadRecoveryHint({
        shouldProceed: true,
        totalParticipants: 2,
        completedParticipants: 1,
        latestEvent: {
          type: "survey",
          status: "completed",
          errorMessage: null,
        },
      }),
    ).toBeNull();
  });
});
