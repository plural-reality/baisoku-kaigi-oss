"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";

import { cn } from "@/lib/utils";

export type ReportTasteOption = {
  value: string;
  label: string;
  icon?: ReactNode;
};

type ReportTasteSelectProps = {
  label?: string;
  value: string;
  options: ReportTasteOption[];
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  iconWrapperClassName?: string;
  placeholderLabel?: string;
};

export function ReportTasteSelect({
  label,
  value,
  options,
  onClick,
  disabled,
  className,
  buttonClassName,
  iconWrapperClassName,
  placeholderLabel,
}: ReportTasteSelectProps) {
  const t = useTranslations("reportTasteSelect");
  const buttonId = useId();
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel =
    selectedOption?.label ?? placeholderLabel ?? t("placeholder");
  const selectedIcon = selectedOption?.icon ?? null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={buttonId}
        className="text-xs font-medium text-muted-foreground"
      >
        {label ?? t("label")}
      </label>
      <button
        id={buttonId}
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border/70 bg-muted/50 px-4 py-2.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-border hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          buttonClassName,
        )}
      >
        {selectedIcon ? (
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center",
              iconWrapperClassName,
            )}
          >
            {selectedIcon}
          </span>
        ) : null}
        <span className="flex-1 text-left">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}
