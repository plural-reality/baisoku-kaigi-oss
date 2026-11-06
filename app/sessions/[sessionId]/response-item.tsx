"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode, type Ref } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { responseLabelKey } from "@/i18n/response-labels";
import { cn } from "@/lib/utils";

// One statement card of the participant answering timeline (past / active /
// future), shared by the session page and the marketing-site demo
// (/embed/demo), so the demo follows this UI without a hand-made copy.

export type ResponseValue = -2 | -1 | 0 | 1 | 2;
export type ResponseType = "scale" | "free_text";

export type ParticipantResponse = {
  id?: string;
  statementId: string;
  statementText: string;
  orderIndex: number;
  responseType: ResponseType;
  value: ResponseValue | null;
  textResponse?: string | null;
  createdAt: string;
};

export const RESPONSE_CHOICES: Array<{
  value: ResponseValue;
  emoji: string;
  idleClass: string;
  activeClass: string;
}> = [
  {
    value: 2,
    emoji: "💯",
    idleClass:
      "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/50",
    activeClass:
      "bg-emerald-500 text-white border-emerald-500 shadow-sm hover:bg-emerald-500 dark:bg-emerald-600 dark:border-emerald-600",
  },
  {
    value: 1,
    emoji: "✓",
    idleClass:
      "bg-green-100 text-green-800 border-green-200 hover:bg-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/50",
    activeClass:
      "bg-green-400 text-white border-green-400 shadow-sm hover:bg-green-400 dark:bg-green-500 dark:border-green-500",
  },
  {
    value: 0,
    emoji: "🤔",
    idleClass:
      "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950/50",
    activeClass:
      "bg-amber-400 text-slate-900 border-amber-400 shadow-sm hover:bg-amber-400 dark:bg-amber-500 dark:text-slate-100 dark:border-amber-500",
  },
  {
    value: -1,
    emoji: "✗",
    idleClass:
      "bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800 dark:hover:bg-rose-950/50",
    activeClass:
      "bg-rose-400 text-white border-rose-400 shadow-sm hover:bg-rose-400 dark:bg-rose-500 dark:border-rose-500",
  },
  {
    value: -2,
    emoji: "👎",
    idleClass:
      "bg-red-100 text-red-800 border-red-200 hover:bg-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/50",
    activeClass:
      "bg-red-600 text-white border-red-600 shadow-sm hover:bg-red-600 dark:bg-red-700 dark:border-red-700",
  },
];

export const responseEmoji = (value: ResponseValue | null) =>
  RESPONSE_CHOICES.find((item) => item.value === value)?.emoji ?? null;

// i18n-allow: 『』 marks highlights in the AI text; the marks are kept as written
export const renderHighlightedText = (text: string) => {
  const parts = text.split(/(『[^』]+』)/g);
  return parts.map((part) =>
    part.startsWith("『") && part.endsWith("』") ? (
      <mark
        key={part}
        className="bg-primary/15 text-primary rounded px-0.5 not-italic font-semibold"
        style={{ fontStyle: "normal" }}
      >
        {part}
      </mark>
    ) : (
      <Fragment key={part}>{part}</Fragment>
    ),
  );
};

export const useResponseLabel = () => {
  const tResponse = useTranslations("responses");
  return (value: ResponseValue | null) => {
    const emoji = responseEmoji(value);
    return emoji !== null && value !== null
      ? `${emoji} ${tResponse(responseLabelKey[value])}`
      : tResponse("answered");
  };
};

export type ResponseItemPhase = "past" | "active" | "future";

export function ResponseItemCard({
  statement,
  phase,
  distance,
  response,
  isLoading,
  isPastCollapsed,
  alternativesOpen,
  itemRef,
  onTogglePast,
  onAnswer,
  onEdit,
  children,
}: {
  statement: { id: string; text: string };
  phase: ResponseItemPhase;
  // Steps from the active card; future cards fade with distance.
  distance: number;
  response: ParticipantResponse | undefined;
  isLoading: boolean;
  isPastCollapsed: boolean;
  alternativesOpen: boolean;
  itemRef?: Ref<HTMLDivElement>;
  onTogglePast?: () => void;
  onAnswer?: (value: ResponseValue) => void;
  onEdit?: () => void;
  // Rendered under the answer buttons of the active card (alternatives, errors).
  children?: ReactNode;
}) {
  const t = useTranslations("participant");
  const tResponse = useTranslations("responses");
  const responseLabel = useResponseLabel();
  const isActive = phase === "active";
  const isPast = phase === "past";
  const isFuture = phase === "future";
  const pastContentId = `past-card-content-${statement.id}`;

  return (
    <div
      ref={itemRef}
      data-testid="response-item"
      className={cn(
        "w-full transform transition-all duration-500 ease-out",
        isActive && "scale-100 opacity-100 translate-y-0 z-20",
        isPast && "scale-[0.96] opacity-60 -translate-y-2 z-10",
        isFuture && "scale-[0.94] translate-y-4 z-0 blur-[0.5px]",
      )}
      style={{
        opacity: isFuture
          ? Math.max(0.5, 0.9 - distance * 0.1)
          : isPast
            ? 0.6
            : 1,
        willChange: isActive ? "transform, opacity" : "auto",
        transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <Card
        className={cn(
          "relative overflow-hidden transition-all duration-500 ease-out",
          isActive &&
            "shadow-xl ring-4 ring-primary/10 border-primary/50 dark:ring-primary/20 dark:border-primary/60",
          isActive && isLoading && "opacity-50 pointer-events-none",
          isFuture &&
            "bg-muted/30 dark:bg-muted/20 border-dashed pointer-events-none",
        )}
        style={{
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {isPast ? (
          <button
            type="button"
            onClick={onTogglePast}
            aria-expanded={!isPastCollapsed}
            aria-controls={pastContentId}
            className="w-full text-left hover:bg-muted/40 transition-colors"
          >
            <CardHeader className={isPastCollapsed ? "py-3" : "pb-6"}>
              <div className="flex items-center justify-between gap-3">
                <CardTitle
                  className={cn(
                    "text-muted-foreground transition-all duration-300",
                    isPastCollapsed &&
                      "text-sm font-medium line-clamp-1 flex-1",
                  )}
                >
                  {statement.text}
                </CardTitle>
                {isPastCollapsed && response && (
                  <span className="shrink-0 text-xs flex items-center gap-2">
                    {response.responseType === "scale" &&
                    response.value !== null ? (
                      <span
                        data-testid="response-value"
                        className={cn(
                          "px-2 py-0.5 rounded-full text-xs font-bold",
                          response.value === 2 &&
                            "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
                          response.value === 1 &&
                            "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
                          response.value === 0 &&
                            "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
                          response.value === -1 &&
                            "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400",
                          response.value === -2 &&
                            "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
                        )}
                      >
                        {responseLabel(response.value)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("hasText")}
                      </span>
                    )}
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        !isPastCollapsed && "rotate-180",
                      )}
                    />
                  </span>
                )}
              </div>
            </CardHeader>
          </button>
        ) : (
          <CardHeader className="pb-6">
            <CardTitle
              key={isActive ? statement.id : undefined}
              className={cn(
                "transition-all duration-300",
                isActive && "question-change",
                isFuture && "text-muted-foreground/60",
              )}
            >
              {isActive
                ? renderHighlightedText(statement.text)
                : statement.text}
            </CardTitle>
          </CardHeader>
        )}

        {isPast && response && !isPastCollapsed && (
          <CardContent id={pastContentId} className="pt-0 pb-6">
            <div className="flex items-center gap-3 pt-4 border-t border-border/50 dark:border-border/30">
              {response.responseType === "free_text" ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    {t("yourAnswer")}
                  </span>
                  <div
                    className="flex-1 text-sm text-foreground line-clamp-2"
                    data-testid="response-value"
                  >
                    {response.textResponse?.trim().length
                      ? response.textResponse
                      : t("noText")}
                  </div>
                </>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground">
                    {t("yourAnswer")}
                  </span>
                  <div
                    className={cn(
                      "px-3 py-1 rounded-full text-sm font-bold flex items-center gap-2",
                      response.value === 2 &&
                        "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
                      response.value === 1 &&
                        "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
                      response.value === 0 &&
                        "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
                      response.value === -1 &&
                        "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400",
                      response.value === -2 &&
                        "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
                    )}
                  >
                    <span data-testid="response-value">
                      {responseLabel(response.value)}
                    </span>
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={onEdit}
                className="ml-auto text-xs text-primary hover:text-primary/80 font-medium underline"
              >
                {t("edit")}
              </button>
            </div>
          </CardContent>
        )}

        {isActive && (
          <CardContent className="pt-0 pb-6">
            <div className="bg-muted/80 dark:bg-muted/30 backdrop-blur-sm border-t border-border dark:border-border/30 -mx-6 px-3 sm:px-4 py-3 sm:py-4">
              <div className="grid grid-cols-5 gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => onAnswer?.(2)}
                  disabled={isLoading}
                  className={cn(
                    "group relative flex flex-col items-center justify-center gap-1.5 sm:gap-2 px-1 sm:px-3 py-4 sm:py-5 border-2 rounded-lg transition-all shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
                    response?.value === 2
                      ? "bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-600 hover:border-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
                      : response && response.responseType === "scale"
                        ? "bg-muted hover:bg-muted/80 text-muted-foreground/50 border-border hover:border-border/80"
                        : "bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-600 hover:border-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700",
                  )}
                >
                  <div className="text-xl sm:text-3xl leading-none">👍</div>
                  <span className="text-[11px] sm:text-xs font-semibold text-center leading-tight">
                    {tResponse("strongAgree")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onAnswer?.(1)}
                  disabled={isLoading}
                  className={cn(
                    "group relative flex flex-col items-center justify-center gap-1.5 sm:gap-2 px-1 sm:px-3 py-4 sm:py-5 border-2 rounded-lg transition-all shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
                    response?.value === 1
                      ? "bg-green-500 hover:bg-green-600 text-white border-green-600 hover:border-green-700 dark:bg-green-500 dark:hover:bg-green-600"
                      : response && response.responseType === "scale"
                        ? "bg-muted hover:bg-muted/80 text-muted-foreground/50 border-border hover:border-border/80"
                        : "bg-green-500 hover:bg-green-600 text-white border-green-600 hover:border-green-700 dark:bg-green-500 dark:hover:bg-green-600",
                  )}
                >
                  <div className="text-xl sm:text-3xl leading-none">✓</div>
                  <span className="text-[11px] sm:text-xs font-semibold text-center leading-tight">
                    {tResponse("agree")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onAnswer?.(0)}
                  disabled={isLoading}
                  className={cn(
                    "group relative flex flex-col items-center justify-center gap-1.5 sm:gap-2 px-1 sm:px-3 py-4 sm:py-5 border-2 rounded-lg transition-all shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
                    response?.value === 0
                      ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-600 hover:border-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
                      : response && response.responseType === "scale"
                        ? "bg-muted hover:bg-muted/80 text-muted-foreground/50 border-border hover:border-border/80"
                        : "bg-amber-500 hover:bg-amber-600 text-white border-amber-600 hover:border-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600",
                  )}
                >
                  <div className="text-xl sm:text-3xl leading-none">🤔</div>
                  <span className="text-[11px] sm:text-xs font-semibold text-center leading-tight">
                    {alternativesOpen
                      ? t("unsureToggleOpen")
                      : t("unsureToggleClosed")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onAnswer?.(-1)}
                  disabled={isLoading}
                  className={cn(
                    "group relative flex flex-col items-center justify-center gap-1.5 sm:gap-2 px-1 sm:px-3 py-4 sm:py-5 border-2 rounded-lg transition-all shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
                    response?.value === -1
                      ? "bg-rose-500 hover:bg-rose-600 text-white border-rose-600 hover:border-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600"
                      : response && response.responseType === "scale"
                        ? "bg-muted hover:bg-muted/80 text-muted-foreground/50 border-border hover:border-border/80"
                        : "bg-rose-500 hover:bg-rose-600 text-white border-rose-600 hover:border-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600",
                  )}
                >
                  <div className="text-xl sm:text-3xl leading-none">✗</div>
                  <span className="text-[11px] sm:text-xs font-semibold text-center leading-tight">
                    {tResponse("disagree")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onAnswer?.(-2)}
                  disabled={isLoading}
                  className={cn(
                    "group relative flex flex-col items-center justify-center gap-1.5 sm:gap-2 px-1 sm:px-3 py-4 sm:py-5 border-2 rounded-lg transition-all shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
                    response?.value === -2
                      ? "bg-red-600 hover:bg-red-700 text-white border-red-700 hover:border-red-800 dark:bg-red-700 dark:hover:bg-red-800"
                      : response && response.responseType === "scale"
                        ? "bg-muted hover:bg-muted/80 text-muted-foreground/50 border-border hover:border-border/80"
                        : "bg-red-600 hover:bg-red-700 text-white border-red-700 hover:border-red-800 dark:bg-red-700 dark:hover:bg-red-800",
                  )}
                >
                  <div className="text-xl sm:text-3xl leading-none">👎</div>
                  <span className="text-[11px] sm:text-xs font-semibold text-center leading-tight">
                    {tResponse("strongDisagree")}
                  </span>
                </button>
              </div>

              {children}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
