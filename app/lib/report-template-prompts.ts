// The request each report template sends to the AI. Written in Japanese, the
// canonical prompt language (ADR 2026-10-16), and stored as-is in
// session_reports.request_markdown — so screens that show a stored request
// recognise these and show the template's localised description instead.
export const REPORT_TEMPLATE_PROMPTS = {
  empathy:
    "参加者の感情や心理的な側面に配慮し、共感的で温かみのある表現を用いてレポートをまとめてください。対立よりも相互理解を促す視点で記述し、前向きな雰囲気を作ることを意識してください。",
  logical:
    "論理的で明確な構成を重視し、意思決定に必要な情報を簡潔にまとめてください。データや数値、合意・対立のポイントを明確に示し、次のアクションにつながる提言を含めてください。",
  psychopath:
    "感情的な共感や寄り添いは一切廃してください。論理、事実、真実のみでレポートを構成してください。参加者が矛盾した意見を持っている場合は、個人名を明示しながら鋭くその点を指摘してください。曖昧な表現は避け、明確で容赦のない分析を行ってください。",
} as const;

export type ReportTemplatePromptId = keyof typeof REPORT_TEMPLATE_PROMPTS;

export const templateOfRequest = (
  requestMarkdown: string,
): ReportTemplatePromptId | null =>
  (
    Object.entries(REPORT_TEMPLATE_PROMPTS) as [
      ReportTemplatePromptId,
      string,
    ][]
  ).find(([, prompt]) => prompt === requestMarkdown.trim())?.[0] ?? null;
