// Five-point response scale stored as integers (-2..2). Labels are looked up
// from the `responses` message namespace — never persisted as display text.
export type ScaleValue = -2 | -1 | 0 | 1 | 2;

export const responseLabelKey = {
  2: "strongAgree",
  1: "agree",
  0: "unsure",
  [-1]: "disagree",
  [-2]: "strongDisagree",
} as const satisfies Record<ScaleValue, string>;

export type ResponseLabelKey = (typeof responseLabelKey)[ScaleValue];
