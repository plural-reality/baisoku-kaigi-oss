// Spend guard for run.ts. Pure so it can be tested without calling OpenRouter.
// Spent is the larger of the credits drop since the start (lags behind) and
// the cost OpenRouter reported for finished calls (misses failed attempts).
export type BudgetInput = Readonly<{
  creditsAtStart: number;
  remaining: number;
  reportedCostUsd: number;
  maxUsd: number;
  minRemainingUsd: number;
}>;

export const budgetDecision = (input: BudgetInput) => {
  const spentUsd = Math.max(
    input.creditsAtStart - input.remaining,
    input.reportedCostUsd,
  );
  const stop =
    input.remaining < input.minRemainingUsd
      ? `remaining credits $${input.remaining.toFixed(4)} < $${input.minRemainingUsd}`
      : spentUsd >= input.maxUsd
        ? `spent $${spentUsd.toFixed(4)} >= --max-usd $${input.maxUsd}`
        : null;
  return { spentUsd, stop };
};
