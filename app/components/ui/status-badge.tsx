import { useTranslations } from "next-intl";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { Badge } from "./badge";

type SessionReportStatus = "pending" | "generating" | "completed" | "failed";

const STATUS_CLASS: Record<SessionReportStatus, string> = {
  pending: "bg-warning-soft text-warning",
  generating: "bg-info-soft text-info",
  completed: "bg-success-soft text-success",
  failed: "bg-danger-soft text-danger",
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  status: SessionReportStatus;
}

export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const t = useTranslations("admin");

  return (
    <Badge
      variant="outline"
      className={cn("border-transparent", STATUS_CLASS[status], className)}
      {...props}
    >
      {t(`reportStatus_${status}`)}
    </Badge>
  );
}
