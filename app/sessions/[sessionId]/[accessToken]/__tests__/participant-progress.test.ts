import { describe, expect, it } from "vitest";

import {
  getParticipantProgressRatio,
  getParticipantStatus,
  summarizeParticipants,
} from "../participant-progress";

describe("participant-progress helpers", () => {
  it("classifies participants into not_started, in_progress, completed", () => {
    expect(
      getParticipantStatus({
        answeredCount: 0,
        completionRate: 0,
        totalStatements: 5,
      }),
    ).toBe("not_started");

    expect(
      getParticipantStatus({
        answeredCount: 2,
        completionRate: 40,
        totalStatements: 5,
      }),
    ).toBe("in_progress");

    expect(
      getParticipantStatus({
        answeredCount: 5,
        completionRate: 100,
        totalStatements: 5,
      }),
    ).toBe("completed");
  });

  it("summarizes progress buckets without mixing not_started into in_progress", () => {
    const summary = summarizeParticipants([
      { answeredCount: 0, completionRate: 0, totalStatements: 4 },
      { answeredCount: 1, completionRate: 25, totalStatements: 4 },
      { answeredCount: 4, completionRate: 100, totalStatements: 4 },
    ]);

    expect(summary).toEqual({
      averageCompletion: 41.666666666666664,
      inProgressCount: 1,
      completedCount: 1,
      notStartedCount: 1,
    });
  });

  it("calculates progress ratio safely", () => {
    expect(
      getParticipantProgressRatio({
        answeredCount: 0,
        completionRate: 0,
        totalStatements: 0,
      }),
    ).toBe(0);

    expect(
      getParticipantProgressRatio({
        answeredCount: 3,
        completionRate: 60,
        totalStatements: 5,
      }),
    ).toBe(60);
  });
});
