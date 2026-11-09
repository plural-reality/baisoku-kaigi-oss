import type { SurveyStatementsInput } from "../../agents/llm";

export type Criterion = Readonly<{
  id: string;
  kind: "required" | "forbidden";
  rule: string;
  evidence: string;
}>;
export type SurveyCase = Readonly<{
  id: string;
  tags: readonly string[];
  source: "synthetic";
  acceptableExample: string;
  input: SurveyStatementsInput;
  criteria: readonly Criterion[];
  failureExample: Readonly<{ statement: string; violates: readonly string[] }>;
}>;
export type Judgment = Readonly<{
  judgeId: string;
  criteria: readonly Readonly<{
    id: string;
    verdict: "pass" | "fail" | "unrated";
    evidence: string;
  }>[];
}>;
