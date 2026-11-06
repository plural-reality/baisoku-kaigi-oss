"use client";

import axios from "axios";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { responseLabelKey, type ScaleValue } from "@/i18n/response-labels";
import { createAuthorizationHeader } from "@/lib/auth-header";
import { getParticipantBearer } from "@/lib/participant-identity";

interface StatementResponse {
  participantUserId: string | null;
  participantName: string;
  responseType: "scale" | "free_text";
  value: number | null;
  textResponse: string | null;
}

interface StatementData {
  statement: {
    id: string;
    number: number;
    text: string;
  };
  responses: StatementResponse[];
}

interface StatementTagPopoverProps {
  statementNumber: number;
  sessionId: string;
  accessToken: string;
  reportId: string;
  userId: string;
}

// Simple cache to avoid refetching on every hover
const dataCache = new Map<string, StatementData>();

export function StatementTagPopover({
  statementNumber,
  sessionId,
  accessToken,
  reportId,
  userId,
}: StatementTagPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const t = useTranslations("statementPopover");
  // Worded here, in the viewer's language, rather than by the API.
  const tResponse = useTranslations("responses");
  const [error, setError] = useState<"loadFailed" | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLButtonElement>(null);

  const cacheKey = `${sessionId}-${statementNumber}`;

  const fetchData = useCallback(async () => {
    const cached = dataCache.get(cacheKey);
    if (cached) {
      setData(cached);
      return;
    }

    // Wait for the participant identity (the bearer is read from storage below).
    if (!userId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await axios.get(
        `/api/sessions/${sessionId}/${accessToken}/reports/${reportId}/statement-responses`,
        {
          params: { statementNumber },
          headers: createAuthorizationHeader(getParticipantBearer()),
        },
      );
      const result = response.data as StatementData;
      dataCache.set(cacheKey, result);
      setData(result);
    } catch (err) {
      console.error("Failed to fetch statement responses:", err);
      setError("loadFailed");
    } finally {
      setLoading(false);
    }
  }, [sessionId, accessToken, reportId, statementNumber, userId, cacheKey]);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    // Small delay before opening to avoid accidental triggers
    timeoutRef.current = setTimeout(() => {
      const el = containerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        // Clamp the centered popover (w-80 = 320px) inside the viewport.
        const half = 160;
        const margin = 8;
        const center = Math.min(
          Math.max(rect.left + rect.width / 2, half + margin),
          window.innerWidth - half - margin,
        );
        setCoords({ left: center, top: rect.bottom + 8 });
      }
      setIsOpen(true);
      if (!data && !loading) {
        void fetchData();
      }
    }, 150);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    // Delay before closing to allow moving to popover
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getValueBgColor = (value: number | null) =>
    value === null
      ? "bg-muted text-muted-foreground"
      : value >= 1
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-100"
        : value <= -1
          ? "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-100"
          : "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-100";

  return (
    <>
      <button
        ref={containerRef}
        type="button"
        className="relative inline-block bg-transparent p-0"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
        aria-expanded={isOpen}
      >
        <Badge
          variant="secondary"
          className="cursor-help font-mono text-[11px] text-foreground/90 shadow-sm transition-shadow hover:shadow"
        >
          #{statementNumber}
        </Badge>
      </button>

      {isOpen &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          // Portaled to <body> with position:fixed so the popover escapes the
          // report's overflow-y-auto scroll container (which otherwise clips it)
          // and always renders on top of every other element.
          // biome-ignore lint/a11y/noStaticElementInteractions: hover bridge that keeps the portaled popover open while the cursor moves onto it; the <button> trigger is the real control
          <div
            className="fixed z-50 w-80"
            style={{
              left: coords.left,
              top: coords.top,
              transform: "translateX(-50%)",
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div className="relative">
              <div
                className="rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg"
                data-testid="statement-tag-popover-surface"
              >
                {loading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}

                {error && (
                  <div className="text-center text-sm text-destructive">
                    {t(error)}
                  </div>
                )}

                {data && !loading && (
                  <div className="space-y-3">
                    <div className="border-b border-border pb-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("statementNumber", {
                          number: data.statement.number,
                        })}
                      </div>
                      <div className="mt-1 text-sm font-medium text-popover-foreground">
                        {data.statement.text}
                      </div>
                    </div>

                    {data.responses.length === 0 ? (
                      <div className="text-center text-xs text-muted-foreground">
                        {t("noResponses")}
                      </div>
                    ) : (
                      <div className="max-h-48 space-y-2 overflow-y-auto">
                        {data.responses.map((response) => (
                          <div
                            key={
                              response.participantUserId ??
                              response.participantName
                            }
                            className="flex items-start gap-2 text-sm"
                          >
                            <span className="shrink-0 font-medium text-popover-foreground">
                              {response.participantName}:
                            </span>
                            {response.responseType === "scale" ? (
                              <span
                                className={`rounded px-1.5 py-0.5 text-xs font-medium ${getValueBgColor(response.value)}`}
                              >
                                {response.value !== null &&
                                  tResponse(
                                    responseLabelKey[
                                      response.value as ScaleValue
                                    ],
                                  )}
                              </span>
                            ) : (
                              <span className="rounded bg-muted px-2 py-1 text-xs font-normal text-foreground">
                                {response.textResponse}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Arrow */}
              <div className="absolute -top-2 left-1/2 h-0 w-0 -translate-x-1/2 border-x-8 border-b-8 border-x-transparent border-b-popover drop-shadow-sm" />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
