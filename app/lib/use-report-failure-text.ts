import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { decodeReportFailure } from "./report-failure";

// Words a stored report failure (see report-failure.ts) in the viewer's language.
export const useReportFailureText = () => {
  const t = useTranslations("reportFailure");
  return useCallback(
    (message: string | null): string | null => {
      if (!message) return null;
      const failure = decodeReportFailure(message);
      if (!failure) return message;
      const text = t(failure.code);
      return failure.detail
        ? `${text} ${t("detail", { detail: failure.detail })}`
        : text;
    },
    [t],
  );
};
