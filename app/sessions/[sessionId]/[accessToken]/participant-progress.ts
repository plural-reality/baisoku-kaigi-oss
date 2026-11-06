export interface ParticipantProgressSnapshot {
  answeredCount: number;
  completionRate: number;
  totalStatements: number;
}

export type ParticipantStatus = "not_started" | "in_progress" | "completed";

export interface ParticipantSummary {
  averageCompletion: number;
  inProgressCount: number;
  completedCount: number;
  notStartedCount: number;
}

export const PARTICIPANT_STATUS_META: Record<
  ParticipantStatus,
  {
    badgeClassName: string;
    cardClassName: string;
  }
> = {
  not_started: {
    badgeClassName: "border-transparent bg-muted text-muted-foreground",
    cardClassName: "border-border bg-card",
  },
  in_progress: {
    badgeClassName: "border-transparent bg-warning-soft text-warning",
    cardClassName: "border-border bg-card",
  },
  completed: {
    badgeClassName: "border-transparent bg-success-soft text-success",
    cardClassName: "border-border bg-card",
  },
};

export function getParticipantStatus(
  participant: ParticipantProgressSnapshot,
): ParticipantStatus {
  if (participant.answeredCount === 0) {
    return "not_started";
  }

  if (
    participant.totalStatements > 0 &&
    participant.answeredCount >= participant.totalStatements
  ) {
    return "completed";
  }

  return "in_progress";
}

export function getParticipantProgressRatio(
  participant: ParticipantProgressSnapshot,
): number {
  if (participant.totalStatements <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.round((participant.answeredCount / participant.totalStatements) * 100),
  );
}

export function summarizeParticipants(
  participants: ParticipantProgressSnapshot[],
): ParticipantSummary {
  if (participants.length === 0) {
    return {
      averageCompletion: 0,
      inProgressCount: 0,
      completedCount: 0,
      notStartedCount: 0,
    };
  }

  const averageCompletion =
    participants.reduce((sum, item) => sum + item.completionRate, 0) /
    participants.length;

  let completedCount = 0;
  let inProgressCount = 0;
  let notStartedCount = 0;

  participants.forEach((participant) => {
    const status = getParticipantStatus(participant);
    if (status === "completed") {
      completedCount++;
      return;
    }
    if (status === "in_progress") {
      inProgressCount++;
      return;
    }
    notStartedCount++;
  });

  return {
    averageCompletion,
    inProgressCount,
    completedCount,
    notStartedCount,
  };
}
