// Why a session report failed, stored in session_reports.error_message as a code
// (+ the provider's own reason) rather than a sentence: generation runs in the
// background with no viewer, so the admin page words it in its own language.
// Rows written before this keep their Japanese sentence and are shown as-is.
export const reportFailureCodes = [
  "interrupted",
  "timeout",
  "credits",
  "forbidden",
  "rateLimited",
  "unavailable",
] as const;
export type ReportFailureCode = (typeof reportFailureCodes)[number];

const PREFIX = "report-failure:";

export const encodeReportFailure = (
  code: ReportFailureCode,
  detail?: string | null,
): string => `${PREFIX}${code}${detail ? `:${detail}` : ""}`;

export const decodeReportFailure = (
  message: string,
): { code: ReportFailureCode; detail: string } | null => {
  if (!message.startsWith(PREFIX)) return null;
  const rest = message.slice(PREFIX.length);
  const separator = rest.indexOf(":");
  const code = separator === -1 ? rest : rest.slice(0, separator);
  const detail = separator === -1 ? "" : rest.slice(separator + 1);
  return (reportFailureCodes as readonly string[]).includes(code)
    ? { code: code as ReportFailureCode, detail }
    : null;
};
