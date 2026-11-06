export interface StatementHighlightCounts {
  strongYes: number;
  yes: number;
  dontKnow: number;
  no: number;
  strongNo: number;
}

export interface StatementHighlightSource {
  responses: {
    counts: StatementHighlightCounts;
    totalCount: number;
  };
}

export type StatementHighlightMetric = "conflict" | "dontKnow" | "consensus";

export interface StatementHighlight<
  TStatement extends StatementHighlightSource = StatementHighlightSource,
> {
  statement: TStatement;
  respondents: number;
  voteCount: number;
  agreeCount: number;
  disagreeCount: number;
  dontKnowCount: number;
  agreePct: number;
  disagreePct: number;
  dontKnowPct: number;
  consensusPct: number;
  conflictStd: number;
  splitScore: number;
}

export type StatementHighlights<
  TStatement extends StatementHighlightSource = StatementHighlightSource,
> = Record<StatementHighlightMetric, StatementHighlight<TStatement>[]>;

const pct = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 100) : 0;

const conflictStd = (c: StatementHighlightCounts): number => {
  const nonNeutral = c.strongNo + c.no + c.yes + c.strongYes;
  const weightedSum = c.strongNo * -2 + c.no * -1 + c.yes + c.strongYes * 2;
  const mean = nonNeutral > 0 ? weightedSum / nonNeutral : 0;
  const variance =
    nonNeutral > 0
      ? (c.strongNo * (-2 - mean) ** 2 +
          c.no * (-1 - mean) ** 2 +
          c.yes * (1 - mean) ** 2 +
          c.strongYes * (2 - mean) ** 2) /
        nonNeutral
      : 0;

  return Math.sqrt(variance);
};

const enrichStatement = <TStatement extends StatementHighlightSource>(
  statement: TStatement,
): StatementHighlight<TStatement> => {
  const c = statement.responses.counts;
  const respondents = statement.responses.totalCount;
  const agreeCount = c.yes + c.strongYes;
  const disagreeCount = c.no + c.strongNo;
  const dontKnowCount = c.dontKnow;
  const voteCount = agreeCount + disagreeCount;
  const agreePct = pct(agreeCount, voteCount);
  const disagreePct = pct(disagreeCount, voteCount);
  const dontKnowPct = pct(dontKnowCount, respondents);
  const consensusPct = Math.max(agreePct, disagreePct);
  const std = conflictStd(c);
  const splitScore =
    voteCount > 0 ? (100 - Math.abs(agreePct - 50) * 2) * 100 + std : -1;

  return {
    statement,
    respondents,
    voteCount,
    agreeCount,
    disagreeCount,
    dontKnowCount,
    agreePct,
    disagreePct,
    dontKnowPct,
    consensusPct,
    conflictStd: std,
    splitScore,
  };
};

const answered = <TStatement extends StatementHighlightSource>(
  item: StatementHighlight<TStatement>,
): boolean => item.respondents > 0;

const tieByRespondents = <TStatement extends StatementHighlightSource>(
  a: StatementHighlight<TStatement>,
  b: StatementHighlight<TStatement>,
): number => b.respondents - a.respondents;

const topBy =
  <TStatement extends StatementHighlightSource>(
    key: (item: StatementHighlight<TStatement>) => number,
  ) =>
  (
    items: readonly StatementHighlight<TStatement>[],
  ): StatementHighlight<TStatement>[] =>
    [...items]
      .filter(answered)
      .sort((a, b) =>
        key(b) === key(a) ? tieByRespondents(a, b) : key(b) - key(a),
      )
      .slice(0, 3);

export const buildStatementHighlights = <
  TStatement extends StatementHighlightSource,
>(
  statements: readonly TStatement[],
): StatementHighlights<TStatement> => {
  const enriched = statements.map(enrichStatement);

  return {
    conflict: topBy<TStatement>((item) => item.splitScore)(enriched),
    dontKnow: topBy<TStatement>((item) => item.dontKnowPct)(enriched),
    consensus: topBy<TStatement>((item) => item.consensusPct)(enriched),
  };
};
