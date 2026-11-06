"use client";

import axios from "axios";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  Link,
  Loader2,
  Printer,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { ConsensusBeeswarm } from "@/components/ConsensusBeeswarm";
import {
  type BeeswarmStatementInput,
  placeableData,
  toDatum,
} from "@/components/consensus-beeswarm-layout";
import ReportMap from "@/components/ReportMap";
import { ReportMarkdown } from "@/components/report/ReportMarkdown";
import { Button } from "@/components/ui/Button";
import { ViralCTA } from "@/components/ViralCTA";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";
import { createAuthorizationHeader } from "@/lib/auth-header";
import { getParticipantBearer } from "@/lib/participant-identity";
import { templateOfRequest } from "@/lib/report-template-prompts";
import { useReportFailureText } from "@/lib/use-report-failure-text";
import { useUserId } from "@/lib/useUserId";
import { cn } from "@/lib/utils";

type SessionReportStatus = "pending" | "generating" | "completed" | "failed";

interface SessionReport {
  id: string;
  sessionId: string;
  version: number;
  status: SessionReportStatus;
  requestMarkdown: string;
  contentMarkdown: string | null;
  promptSnapshot: Record<string, unknown> | null;
  createdBy: string;
  model: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

type SessionSnapshot = {
  session?: {
    title?: string;
    goal?: string;
    context?: string;
  };
};

const getSnapshotSession = (
  snapshot: SessionReport["promptSnapshot"],
): SessionSnapshot["session"] | null => {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const session = (snapshot as SessionSnapshot).session;
  if (!session || typeof session !== "object") {
    return null;
  }

  const sessionData = session as {
    title?: unknown;
    goal?: unknown;
    context?: unknown;
  };
  return {
    title:
      typeof sessionData.title === "string" ? sessionData.title : undefined,
    goal: typeof sessionData.goal === "string" ? sessionData.goal : undefined,
    context:
      typeof sessionData.context === "string" ? sessionData.context : undefined,
  };
};

export default function SessionReportPrintPage({
  sessionId,
  accessToken,
  reportId,
}: {
  sessionId: string;
  accessToken: string;
  reportId: string;
}) {
  const { userId, isLoading: isUserLoading } = useUserId();
  const [report, setReport] = useState<SessionReport | null>(null);
  const [statements, setStatements] = useState<BeeswarmStatementInput[]>([]);
  const [loading, setLoading] = useState(true);
  const t = useTranslations("printReport");
  const tTemplate = useTranslations("reportTemplates");
  const reportFailureText = useReportFailureText();
  const locale = useLocale();
  const [error, setError] = useState<"loadFailed" | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [urlCopyStatus, setUrlCopyStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [infoOpen, setInfoOpen] = useState({ goal: true, context: false });

  useEffect(() => {
    if (isUserLoading || !userId) return;

    const fetchReport = async () => {
      try {
        setLoading(true);
        const response = await axios.get(
          `/api/sessions/${sessionId}/${accessToken}/reports/${reportId}`,
          {
            headers: createAuthorizationHeader(getParticipantBearer()),
          },
        );
        setReport(response.data.data as SessionReport);
        trackEvent(ANALYTICS_EVENTS.REPORT_VIEWED, {
          sessionId,
          reportId,
        });
        setError(null);
      } catch (err) {
        console.error("Failed to load report:", err);
        setError("loadFailed");
      } finally {
        setLoading(false);
      }
    };

    // Fetch the session's statements for the 合意度マップ. Independent of the
    // report fetch — a failure here just hides the chart, it never blocks the
    // report from rendering.
    const fetchStatements = async () => {
      try {
        const response = await axios.get(
          `/api/sessions/${sessionId}/${accessToken}`,
          {
            headers: createAuthorizationHeader(getParticipantBearer()),
          },
        );
        const fetched = response.data?.data?.statements;
        setStatements(Array.isArray(fetched) ? fetched : []);
      } catch (err) {
        console.error("Failed to load statements for beeswarm:", err);
        setStatements([]);
      }
    };

    void fetchReport();
    void fetchStatements();
  }, [sessionId, accessToken, reportId, userId, isUserLoading]);

  const hasConsensusData = useMemo(
    () => placeableData(statements.map(toDatum)).length > 0,
    [statements],
  );

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      trackEvent(ANALYTICS_EVENTS.REPORT_SHARED, {
        sessionId,
        type: "url_copy",
      });
      setUrlCopyStatus("copied");
      setTimeout(() => setUrlCopyStatus("idle"), 2000);
    } catch {
      setUrlCopyStatus("error");
      setTimeout(() => setUrlCopyStatus("idle"), 2000);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopy = async () => {
    if (!report?.contentMarkdown) return;

    try {
      await navigator.clipboard.writeText(report.contentMarkdown);
      trackEvent(ANALYTICS_EVENTS.REPORT_SHARED, {
        sessionId,
        type: "markdown_copy",
      });
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 2000);
    } catch (err) {
      console.error("Failed to copy report:", err);
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-svh bg-background dark:bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-svh bg-background dark:bg-background flex flex-col items-center justify-center gap-6 px-4">
        <div className="text-center space-y-2">
          <h2 className="scroll-m-20 text-2xl font-semibold tracking-tight">
            {error ? t("errorTitle") : t("notFoundTitle")}
          </h2>
          <p className="text-sm text-muted-foreground leading-7">
            {error ? t(error) : t("notFoundBody")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Button>
      </div>
    );
  }

  const snapshotSession = getSnapshotSession(report.promptSnapshot);
  const requestTemplate = templateOfRequest(report.requestMarkdown ?? "");
  const sessionTitle = snapshotSession?.title?.trim() || t("fallbackTitle");
  const sessionGoal = snapshotSession?.goal?.trim();
  const sessionContext = snapshotSession?.context?.trim();
  const createdAtLabel = new Date(report.createdAt).toLocaleString(locale, {
    hour12: false,
  });
  const completedAtLabel = report.completedAt
    ? new Date(report.completedAt).toLocaleString(locale, {
        hour12: false,
      })
    : null;

  const toggleInfo = (key: "goal" | "context") => {
    setInfoOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="min-h-svh bg-background dark:bg-background text-foreground print:bg-white print:text-black">
      <div className="mx-auto max-w-4xl px-6 py-8 space-y-8 print:max-w-none print:px-0 print:py-0 print:space-y-6">
        <AppHeader />

        <header className="space-y-4 border-b border-border pb-6 print:hidden">
          <div className="text-center space-y-3">
            <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight text-balance">
              {sessionTitle}
            </h1>
            <p className="text-xl text-muted-foreground">
              {t("version", {
                version: String(report.version).padStart(2, "0"),
              })}
            </p>
          </div>

          <div className="w-full">
            <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/30">
              <div className="border-b border-border/70 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleInfo("goal")}
                  aria-expanded={infoOpen.goal}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm font-semibold text-foreground/90 transition hover:bg-muted/60"
                >
                  <span>{t("goal")}</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      infoOpen.goal ? "rotate-180" : "",
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "px-4 pb-4 text-sm leading-7 text-muted-foreground whitespace-pre-wrap",
                    infoOpen.goal ? "block" : "hidden print:block",
                  )}
                >
                  {sessionGoal && sessionGoal.length > 0
                    ? sessionGoal
                    : t("notSet")}
                </div>
              </div>

              <div className="border-b border-border/70 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleInfo("context")}
                  aria-expanded={infoOpen.context}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm font-semibold text-foreground/90 transition hover:bg-muted/60"
                >
                  <span>{t("background")}</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      infoOpen.context ? "rotate-180" : "",
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "px-4 pb-4 text-sm leading-7 text-muted-foreground whitespace-pre-wrap",
                    infoOpen.context ? "block" : "hidden print:block",
                  )}
                >
                  {sessionContext && sessionContext.length > 0
                    ? sessionContext
                    : t("notSet")}
                </div>
              </div>
            </div>
          </div>
        </header>

        {report.requestMarkdown ? (
          <section className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/30 p-6 print:hidden">
            <div className="space-y-3">
              <h3 className="scroll-m-20 text-lg font-semibold tracking-tight text-indigo-900 dark:text-indigo-200">
                {t("request")}
              </h3>
              <p className="whitespace-pre-wrap leading-7 text-sm text-indigo-800 dark:text-indigo-300">
                {requestTemplate
                  ? tTemplate(`${requestTemplate}PromptDisplay`)
                  : report.requestMarkdown}
              </p>
            </div>
          </section>
        ) : null}

        {hasConsensusData ? (
          <section className="rounded-2xl border border-border bg-card dark:bg-card p-6 shadow-sm print:border-border/40 print:bg-transparent print:p-0 print:shadow-none">
            <div className="mb-3 space-y-1">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                {t("consensusMap")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("consensusMapHelp")}
              </p>
            </div>
            <ConsensusBeeswarm statements={statements} />
          </section>
        ) : null}

        <section className="rounded-2xl border border-border bg-card dark:bg-card p-6 shadow-sm print:hidden">
          <div className="mb-3 space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {t("reportMap")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("reportMapHelp")}
            </p>
          </div>
          <ReportMap
            sessionId={sessionId}
            accessToken={accessToken}
            userId={userId ?? ""}
          />
        </section>

        <section className="rounded-2xl border border-border bg-card dark:bg-card p-8 shadow-sm print:border-0 print:bg-transparent print:p-0 print:shadow-none">
          {report.status === "completed" && report.contentMarkdown ? (
            <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
              <p className="text-xs font-semibold text-muted-foreground">
                {t("body")}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyUrl}
                  className="gap-1.5 text-xs"
                >
                  <Link className="h-4 w-4" />
                  {urlCopyStatus === "copied"
                    ? t("copied")
                    : urlCopyStatus === "error"
                      ? t("copyFailed")
                      : t("copyUrl")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="gap-1.5 text-xs"
                >
                  <Copy className="h-4 w-4" />
                  {copyStatus === "copied"
                    ? t("copied")
                    : copyStatus === "error"
                      ? t("copyFailed")
                      : t("copyMarkdown")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePrint}
                  className="gap-1.5 text-xs"
                >
                  <Printer className="h-4 w-4" />
                  {t("print")}
                </Button>
              </div>
            </div>
          ) : null}
          {report.status === "completed" && report.contentMarkdown ? (
            <article className="markdown-body prose prose-slate dark:prose-invert max-w-none text-base leading-7 print:text-[12pt] prose-headings:scroll-m-20 prose-headings:tracking-tight prose-h1:text-4xl prose-h1:font-extrabold prose-h1:text-balance prose-h2:border-b prose-h2:pb-2 prose-h2:text-3xl prose-h2:font-semibold prose-h2:first:mt-0 prose-h3:text-2xl prose-h3:font-semibold prose-h4:text-xl prose-h4:font-semibold prose-p:leading-7 prose-p:[&:not(:first-child)]:mt-6 prose-blockquote:mt-6 prose-blockquote:border-l-2 prose-blockquote:pl-6 prose-blockquote:italic prose-code:relative prose-code:rounded prose-code:bg-muted prose-code:px-[0.3rem] prose-code:py-[0.2rem] prose-code:font-mono prose-code:text-sm prose-code:font-semibold prose-ul:my-6 prose-ul:[&:not(:first-child)]:mt-6 prose-ol:my-6 prose-ol:[&:not(:first-child)]:mt-6 prose-li:my-2">
              <ReportMarkdown
                sessionId={sessionId}
                accessToken={accessToken}
                reportId={reportId}
                userId={userId ?? ""}
              >
                {report.contentMarkdown}
              </ReportMarkdown>
            </article>
          ) : report.status === "failed" ? (
            <div className="py-8 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 dark:bg-destructive/20">
                <span className="text-2xl">⚠️</span>
              </div>
              <div className="space-y-2">
                <h3 className="scroll-m-20 text-lg font-semibold tracking-tight text-destructive">
                  {t("failed")}
                </h3>
                <p className="text-sm text-muted-foreground leading-7 max-w-md mx-auto">
                  {reportFailureText(report.errorMessage) ?? t("failedHint")}
                </p>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted dark:bg-muted/50">
                <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
              </div>
              <div className="space-y-2">
                <h3 className="scroll-m-20 text-lg font-semibold tracking-tight">
                  {t("generating")}
                </h3>
                <p className="text-sm text-muted-foreground leading-7 max-w-md mx-auto">
                  {t("notReady")}
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border/60 bg-muted/30 px-4 py-4 text-xs text-muted-foreground print:border-border/40 print:bg-transparent print:text-[9pt]">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
            <div className="space-y-1">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Model
              </dt>
              <dd className="font-mono text-foreground/80">{report.model}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {t("created")}
              </dt>
              <dd className="font-mono text-foreground/80">{createdAtLabel}</dd>
            </div>
            {completedAtLabel ? (
              <div className="space-y-1">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {t("completed")}
                </dt>
                <dd className="font-mono text-foreground/80">
                  {completedAtLabel}
                </dd>
              </div>
            ) : null}
            <div className="space-y-1 sm:col-span-3">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {t("sessionId")}
              </dt>
              <dd className="break-all font-mono text-foreground/80">
                {sessionId}
              </dd>
            </div>
            <div className="space-y-1 sm:col-span-3">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {t("reportId")}
              </dt>
              <dd className="break-all font-mono text-foreground/80">
                {report.id}
              </dd>
            </div>
          </dl>
        </section>

        <ViralCTA />
      </div>
    </div>
  );
}
