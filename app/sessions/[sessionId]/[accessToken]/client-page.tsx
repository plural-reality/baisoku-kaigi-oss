"use client";

import axios from "axios";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileText,
  Heart,
  Info,
  Loader2,
  Maximize2,
  Pencil,
  Send,
  Settings,
  SquareArrowOutUpRight,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { ConsensusBeeswarm } from "@/components/ConsensusBeeswarm";
import { Markdown } from "@/components/Markdown";
import OpinionLandscape from "@/components/OpinionLandscape";
import { buildStatementHighlights } from "@/components/opinion/statement-highlights";
import { ReportMarkdown } from "@/components/report/ReportMarkdown";
import { ReportTasteSelect } from "@/components/report/ReportTasteSelect";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";
import { createAuthorizationHeader } from "@/lib/auth-header";
import { defaultTitle, pageTitle } from "@/lib/metadata";
import { getParticipantBearer } from "@/lib/participant-identity";
import {
  REPORT_TEMPLATE_PROMPTS,
  templateOfRequest,
} from "@/lib/report-template-prompts";
import { sanitizeErrorForLog } from "@/lib/sanitize-error";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  deriveThreadRecoveryHint,
  type ThreadEventStatus,
  type ThreadRecoveryHint,
} from "@/lib/thread-events";
import { useReportFailureText } from "@/lib/use-report-failure-text";
import { useUserId } from "@/lib/useUserId";
import {
  formatDateTime,
  formatPercentage,
  MonitoringMetric,
  type ParticipantProgress,
  ParticipantProgressRow,
  StatementHighlightColumn,
  StatementMeritProfile,
  type StatementWithStats,
} from "./admin-parts";
import { summarizeParticipants } from "./participant-progress";
import {
  createResponseLogColumns,
  type ResponseLogRow,
} from "./response-logs-columns";
import { ResponseLogsDataTable } from "./response-logs-data-table";

type ThreadEventType = "plan" | "survey" | "survey_analysis" | "user_message";

interface SessionAdminData {
  id: string;
  title: string;
  context: string;
  goal: string;
  facilitatorContext: string;
  facilitatorGoal: string;
  sourceUrl?: string | null;
  isPublic: boolean;
  createdAt: string;
  statements: StatementWithStats[];
  participants: ParticipantProgress[];
  totalStatements: number;
  totalParticipants: number;
}

interface ResponseLogStatement {
  id: string;
  text: string;
  orderIndex: number;
}

interface ResponseLogItem {
  statementId: string;
  statementText: string;
  orderIndex: number;
  responseType: "scale" | "free_text" | null;
  value: number | null;
  textResponse: string | null;
  answeredAt: string | null;
}

interface ResponseLogParticipant {
  userId: string;
  name: string;
  joinedAt: string;
  responses: ResponseLogItem[];
  individualReport: string | null;
}

interface ResponseLogsData {
  sessionId: string;
  participants: ResponseLogParticipant[];
  statements: ResponseLogStatement[];
  totalParticipants: number;
  totalStatements: number;
}

interface TimelineStatement {
  id: string;
  text: string;
  orderIndex: number;
}

interface TimelineEvent {
  id: string;
  type: ThreadEventType;
  agentId: string | null;
  userId: string | null;
  progress: number | string | null;
  status: ThreadEventStatus;
  errorMessage: string | null;
  payload: Record<string, unknown>;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  statements: TimelineStatement[];
}

interface AgentSnapshot {
  id: string;
  agentType: string;
  state: string;
  statePayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface EventThreadSummary {
  id: string;
  shouldProceed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface EventThreadResponse {
  session: {
    id: string;
    title: string;
    context: string;
    goal: string;
    isPublic: boolean;
  };
  thread: EventThreadSummary;
  events: TimelineEvent[];
  agents: AgentSnapshot[];
}

type SessionReportStatus = "pending" | "generating" | "completed" | "failed";

// 409 from a single-flight guarded route: the previous run is still going.
const isGenerationBusy = (err: unknown): boolean =>
  axios.isAxiosError(err) && err.response?.status === 409;

interface SessionReport {
  id: string;
  sessionId: string;
  version: number;
  status: SessionReportStatus;
  requestMarkdown: string;
  contentMarkdown: string | null;
  createdBy: string;
  model: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const REPORT_STATUS_KEYS: readonly SessionReportStatus[] = [
  "pending",
  "generating",
  "completed",
  "failed",
];

type ReportTemplatesT = ReturnType<typeof useTranslations<"reportTemplates">>;
type AdminT = ReturnType<typeof useTranslations<"admin">>;

// Stored request prompts are matched against the (Japanese, canonical) template
// prompts; only the displayed label is localised.
const getReportTasteLabel = (
  report: SessionReport,
  tTemplate: ReportTemplatesT,
): string => {
  const trimmedPrompt = report.requestMarkdown.trim();
  if (!trimmedPrompt) {
    return tTemplate("autoName");
  }

  return tTemplate(`${templateOfRequest(trimmedPrompt) ?? "freeform"}Name`);
};

const getReportStatusLabel = (
  status: SessionReportStatus,
  t: AdminT,
): string =>
  REPORT_STATUS_KEYS.includes(status) ? t(`reportStatus_${status}`) : status;

type ReportTemplateType = "empathy" | "logical" | "psychopath" | "freeform";
type ReportModeType = "auto" | "custom";

// 判別共用体型：freeform以外はpromptフィールドを持たない
type ConfirmedReportStyle =
  | { type: "auto" }
  | { type: "empathy" }
  | { type: "logical" }
  | { type: "psychopath" }
  | { type: "freeform"; prompt: string };

// ConfirmedReportStyleからプロンプト文字列を取得するヘルパー
function getStylePrompt(style: ConfirmedReportStyle): string {
  if (style.type === "freeform") {
    return style.prompt;
  }
  if (style.type === "auto") {
    return "";
  }
  // empathy, logical, psychopathはREPORT_TEMPLATESから導出
  const template = REPORT_TEMPLATES.find((t) => t.id === style.type);
  return template?.prompt ?? "";
}

// Display text (name, description, sample preview, prompt summary) lives in the
// `reportTemplates` messages. `prompt` is the instruction sent to the LLM and
// stays in Japanese — the session language rule sets the output language.
interface ReportTemplate {
  id: ReportTemplateType;
  icon: typeof FileText;
  prompt: string;
  color: string;
}

const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: "empathy",
    icon: Heart,
    prompt: REPORT_TEMPLATE_PROMPTS.empathy,
    color:
      "bg-pink-100 border-pink-200 hover:bg-pink-200 text-pink-900 dark:bg-pink-950/30 dark:border-pink-800 dark:hover:bg-pink-950/50 dark:text-pink-300",
  },
  {
    id: "logical",
    icon: Brain,
    prompt: REPORT_TEMPLATE_PROMPTS.logical,
    color:
      "bg-blue-100 border-blue-200 hover:bg-blue-200 text-blue-900 dark:bg-blue-950/30 dark:border-blue-800 dark:hover:bg-blue-950/50 dark:text-blue-300",
  },
  {
    id: "psychopath",
    icon: Zap,
    prompt: REPORT_TEMPLATE_PROMPTS.psychopath,
    color:
      "bg-purple-100 border-purple-200 hover:bg-purple-200 text-purple-900 dark:bg-purple-950/30 dark:border-purple-800 dark:hover:bg-purple-950/50 dark:text-purple-300",
  },
  {
    id: "freeform",
    icon: Settings,
    prompt: "",
    color: "bg-muted border-border hover:bg-secondary text-foreground",
  },
];

const REPORT_STYLE_OPTIONS = [
  { value: "auto", icon: <FileText className="h-4 w-4" /> },
  {
    value: "empathy",
    icon: <Heart className="h-4 w-4 text-pink-600 dark:text-pink-500" />,
  },
  {
    value: "logical",
    icon: <Brain className="h-4 w-4 text-blue-600 dark:text-blue-500" />,
  },
  {
    value: "psychopath",
    icon: <Zap className="h-4 w-4 text-purple-600 dark:text-purple-500" />,
  },
  { value: "freeform", icon: <Settings className="h-4 w-4" /> },
] as const;

const EVENT_TYPE_META: Record<
  ThreadEventType,
  { accent: string; badge: string }
> = {
  plan: {
    accent: "text-sky-700 dark:text-primary",
    badge:
      "bg-sky-50 text-sky-700 border-sky-200 dark:bg-muted dark:text-foreground dark:border-border",
  },
  survey: {
    accent: "text-emerald-700 dark:text-primary",
    badge:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-muted dark:text-foreground dark:border-border",
  },
  survey_analysis: {
    accent: "text-purple-700 dark:text-primary",
    badge:
      "bg-purple-50 text-purple-700 border-purple-200 dark:bg-muted dark:text-foreground dark:border-border",
  },
  user_message: {
    accent: "text-slate-700 dark:text-primary",
    badge:
      "bg-slate-50 text-slate-700 border-slate-200 dark:bg-muted dark:text-foreground dark:border-border",
  },
};

const SHARE_QR_SIZE = 176;
const FULLSCREEN_QR_SIZE = 768;
const ADMIN_DATA_REFRESH_INTERVAL_MS = 3000;

const truncateText = (text: string, maxLength: number) => {
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}…`;
};

const CSV_HEADER_KEYS = [
  "csvParticipantId",
  "csvParticipantName",
  "csvJoinedAt",
  "csvQuestionNumber",
  "csvQuestion",
  "csvResponseType",
  "csvValue",
  "csvFreeText",
  "csvAnsweredAt",
] as const;

const convertResponseLogsToCSV = (
  logsData: ResponseLogsData,
  t: AdminT,
): string => {
  // Header row
  const headers = CSV_HEADER_KEYS.map((key) => t(key));

  const rows: string[][] = [headers];

  // Data rows
  logsData.participants.forEach((participant) => {
    participant.responses.forEach((response) => {
      const row = [
        participant.userId,
        participant.name,
        participant.joinedAt,
        (response.orderIndex + 1).toString(),
        response.statementText,
        response.responseType ?? t("csvUnanswered"),
        response.value !== null ? response.value.toString() : "",
        response.textResponse ?? "",
        response.answeredAt ?? "",
      ];
      rows.push(row);
    });
  });

  // Convert to CSV format
  return rows
    .map((row) =>
      row
        .map((cell) => {
          // Escape double quotes and wrap in quotes if contains comma, newline, or quote
          const escaped = cell.replace(/"/g, '""');
          if (
            escaped.includes(",") ||
            escaped.includes("\n") ||
            escaped.includes('"')
          ) {
            return `"${escaped}"`;
          }
          return escaped;
        })
        .join(","),
    )
    .join("\n");
};

const downloadCSV = (csvContent: string, filename: string) => {
  // Add BOM for UTF-8 to ensure proper encoding in Excel
  const bom = "\uFEFF";
  const blob = new Blob([bom + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Above this many participants, the per-person progress cards stop being useful
// (you can't scan 300 of them), so we show a sample and blur/gate the rest with
// a pointer to the full 回答ログ / 自分レポート.
const PARTICIPANT_CARD_LIMIT = 30;
// How many cards are shown sharply before the blurred teaser kicks in.
const PARTICIPANT_CARD_PREVIEW = 12;

export default function AdminPage({
  sessionId,
  accessToken,
}: {
  sessionId: string;
  accessToken: string;
}) {
  const { userId, isLoading: isUserIdLoading } = useUserId();
  const tA = useTranslations("admin");
  const reportFailureText = useReportFailureText();
  const tTemplate = useTranslations("reportTemplates");
  const displayRequest = (requestMarkdown: string) => {
    const template = templateOfRequest(requestMarkdown);
    return template ? tTemplate(`${template}PromptDisplay`) : requestMarkdown;
  };
  const tEvent = useTranslations("eventTypes");
  const locale = useLocale();

  const [data, setData] = useState<SessionAdminData | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [threadData, setThreadData] = useState<EventThreadResponse | null>(
    null,
  );
  const [threadLoading, setThreadLoading] = useState(true);
  const [threadError, setThreadError] = useState<string | null>(null);

  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingContext, setEditingContext] = useState("");
  const [editingGoal, setEditingGoal] = useState("");
  const [editingFacilitatorContext, setEditingFacilitatorContext] =
    useState("");
  const [editingFacilitatorGoal, setEditingFacilitatorGoal] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const settingsFormRef = useRef<HTMLFormElement>(null);

  const [messageDraft, setMessageDraft] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [togglingProceed, setTogglingProceed] = useState(false);
  const [isReanalyzingThread, setIsReanalyzingThread] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>(
    {},
  );
  const [shareUrl, setShareUrl] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [isShareQrFullscreen, setIsShareQrFullscreen] = useState(false);
  const threadContainerRef = useRef<HTMLDivElement | null>(null);
  const lastThreadEventIdRef = useRef<string | null>(null);
  const [threadFade, setThreadFade] = useState({ top: false, bottom: false });
  const updateThreadFade = useCallback(() => {
    const el = threadContainerRef.current;
    if (!el) return;
    const top = el.scrollTop > 4;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 4;
    setThreadFade((prev) =>
      prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
    );
  }, []);
  const [reports, setReports] = useState<SessionReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [creatingReport, setCreatingReport] = useState(false);
  const [reportCopyStatus, setReportCopyStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [showReportModal, setShowReportModal] = useState(false);
  const [, setReportMode] = useState<ReportModeType | null>(null);
  const [selectedTemplate, setSelectedTemplate] =
    useState<ReportTemplateType | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [confirmedStyle, setConfirmedStyle] = useState<ConfirmedReportStyle>({
    type: "auto",
  });

  const [isGeneratingQuestion, setIsGeneratingQuestion] = useState(false);
  const [showGenerateQuestionDialog, setShowGenerateQuestionDialog] =
    useState(false);
  const [generatedQuestions, setGeneratedQuestions] = useState<string[]>([]);
  const [generateQuestionError, setGenerateQuestionError] = useState<
    string | null
  >(null);
  const [showResponseLog, setShowResponseLog] = useState(false);
  const [responseLogsData, setResponseLogsData] =
    useState<ResponseLogsData | null>(null);
  const [responseLogsLoading, setResponseLogsLoading] = useState(false);
  const [responseLogsError, setResponseLogsError] = useState<string | null>(
    null,
  );

  const fetchAdminData = useCallback(
    async (withSpinner = true) => {
      if (!userId) return;

      try {
        if (withSpinner) {
          setLoading(true);
        }
        const response = await axios.get(
          `/api/sessions/${sessionId}/${accessToken}`,
          {
            headers: createAuthorizationHeader(getParticipantBearer()),
          },
        );
        const responseData = response.data.data as SessionAdminData & {
          canEdit?: boolean;
        };
        setData({
          ...responseData,
          goal: responseData.goal ?? "",
          context: responseData.context ?? "",
          // facilitator_* は公開用 goal/context と独立。空なら空のまま扱い、
          // 公開用の値で埋めない（混合・汚染を防ぐ）。
          facilitatorGoal: responseData.facilitatorGoal ?? "",
          facilitatorContext: responseData.facilitatorContext ?? "",
          statements: responseData.statements ?? [],
          participants: responseData.participants ?? [],
          totalStatements:
            typeof responseData.totalStatements === "number"
              ? responseData.totalStatements
              : (responseData.statements?.length ?? 0),
          totalParticipants:
            typeof responseData.totalParticipants === "number"
              ? responseData.totalParticipants
              : (responseData.participants?.length ?? 0),
        });
        setCanEdit(responseData.canEdit ?? false);
        setError(null);
      } catch (err: unknown) {
        console.error("Failed to fetch admin data:", sanitizeErrorForLog(err));
        if (axios.isAxiosError(err) && err.response?.status === 403) {
          setError(tA("errNoAccess"));
        } else {
          setError(tA("errLoadData"));
        }
      } finally {
        if (withSpinner) {
          setLoading(false);
        }
      }
    },
    [sessionId, accessToken, userId, tA],
  );

  const fetchEventThread = useCallback(
    async (withSpinner = false) => {
      if (!userId) return;
      if (withSpinner) {
        setThreadLoading(true);
      }

      const fetchWithRetry = async (attemptsLeft: number): Promise<void> => {
        try {
          const response = await axios.get(
            `/api/sessions/${sessionId}/${accessToken}/event-thread`,
            {
              headers: createAuthorizationHeader(getParticipantBearer()),
            },
          );
          setThreadData(response.data);
          setThreadError(null);
        } catch (err) {
          const is404 = axios.isAxiosError(err) && err.response?.status === 404;
          if (is404 && attemptsLeft > 0) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            return fetchWithRetry(attemptsLeft - 1);
          }
          console.error(
            "Failed to fetch event thread:",
            sanitizeErrorForLog(err),
          );
          setThreadError(tA("errLoadThread"));
        }
      };

      try {
        await fetchWithRetry(5);
      } finally {
        setThreadLoading(false);
      }
    },
    [sessionId, accessToken, userId, tA],
  );

  const fetchReports = useCallback(
    async (withSpinner = false) => {
      if (!userId) return;
      if (withSpinner) {
        setReportsLoading(true);
      }
      try {
        const response = await axios.get(
          `/api/sessions/${sessionId}/${accessToken}/reports`,
          {
            headers: createAuthorizationHeader(getParticipantBearer()),
          },
        );
        const list = (response.data.data ?? []) as SessionReport[];
        setReports(list);
        setReportsError(null);
        setSelectedReportId((current) => {
          if (list.length === 0) {
            return null;
          }
          if (current && list.some((report) => report.id === current)) {
            return current;
          }
          return list[0].id;
        });
      } catch (err) {
        console.error(
          "Failed to fetch session reports:",
          sanitizeErrorForLog(err),
        );
        setReportsError(tA("errLoadReports"));
      } finally {
        setReportsLoading(false);
      }
    },
    [sessionId, accessToken, userId, tA],
  );

  const fetchResponseLogs = useCallback(async () => {
    if (!userId) return;
    setResponseLogsLoading(true);
    try {
      const response = await axios.get(
        `/api/sessions/${sessionId}/${accessToken}/response-logs`,
        {
          headers: createAuthorizationHeader(getParticipantBearer()),
        },
      );
      setResponseLogsData(response.data.data as ResponseLogsData);
      setResponseLogsError(null);
    } catch (err) {
      console.error("Failed to fetch response logs:", sanitizeErrorForLog(err));
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        setResponseLogsError(tA("errLogsForbidden"));
      } else {
        setResponseLogsError(tA("errLoadLogs"));
      }
    } finally {
      setResponseLogsLoading(false);
    }
  }, [sessionId, accessToken, userId, tA]);

  useEffect(() => {
    if (isUserIdLoading) return;
    void fetchAdminData(true);
  }, [fetchAdminData, isUserIdLoading]);

  useEffect(() => {
    if (isUserIdLoading || !userId) return;

    const supabase = getSupabaseBrowserClient();
    let refreshTimeoutId: number | null = null;

    const scheduleRefresh = () => {
      if (refreshTimeoutId !== null) {
        window.clearTimeout(refreshTimeoutId);
      }
      refreshTimeoutId = window.setTimeout(() => {
        refreshTimeoutId = null;
        void fetchAdminData(false);
      }, 250);
    };

    const channel = supabase
      .channel(`admin-session-${sessionId}-participants`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "participants",
          filter: `session_id=eq.${sessionId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "responses",
          filter: `session_id=eq.${sessionId}`,
        },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      if (refreshTimeoutId !== null) {
        window.clearTimeout(refreshTimeoutId);
      }
      void supabase.removeChannel(channel);
    };
  }, [fetchAdminData, isUserIdLoading, sessionId, userId]);

  useEffect(() => {
    if (isUserIdLoading || !userId) return;

    // Realtime should update immediately; this keeps the admin view consistent
    // when the subscription stalls or the browser misses an event.
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchAdminData(false);
    }, ADMIN_DATA_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [fetchAdminData, isUserIdLoading, userId]);

  useEffect(() => {
    if (isUserIdLoading || !userId) return;
    void fetchEventThread(true);
    const intervalId = window.setInterval(() => {
      void fetchEventThread();
    }, 6000);
    return () => window.clearInterval(intervalId);
  }, [fetchEventThread, isUserIdLoading, userId]);

  useEffect(() => {
    if (isUserIdLoading || !userId) return;
    void fetchReports(true);
  }, [fetchReports, isUserIdLoading, userId]);

  const hasActiveReport = useMemo(
    () =>
      reports.some(
        (report) =>
          report.status === "pending" || report.status === "generating",
      ),
    [reports],
  );

  // `creatingReport` only covers the brief POST; generation continues in the
  // background. Gate the generate buttons on an in-flight report too, so a
  // failing report can't be retried into a storm (17 blind retries in one
  // session exhausted the daily key limit).
  const isReportInFlight = creatingReport || hasActiveReport;

  useEffect(() => {
    if (!userId || !hasActiveReport) return;
    const intervalId = window.setInterval(() => {
      void fetchReports();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [fetchReports, hasActiveReport, userId]);

  // Track report completion and show toast
  const prevReportsRef = useRef<SessionReport[]>([]);
  useEffect(() => {
    const prevReports = prevReportsRef.current;
    prevReportsRef.current = reports;

    // Check if any report just transitioned to "completed"
    reports.forEach((report) => {
      const prevReport = prevReports.find((r) => r.id === report.id);
      if (
        prevReport &&
        (prevReport.status === "pending" ||
          prevReport.status === "generating") &&
        report.status === "completed"
      ) {
        toast.success(tA("toastReportDone"), {
          description: tA("toastReportDoneBody", { version: report.version }),
          duration: 5000,
        });
      } else if (
        prevReport &&
        (prevReport.status === "pending" ||
          prevReport.status === "generating") &&
        report.status === "failed"
      ) {
        toast.error(tA("toastReportFailed"), {
          description: reportFailureText(report.errorMessage) ?? tA("tryLater"),
          duration: 5000,
        });
      }
    });
  }, [reports, reportFailureText, tA]);

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? null,
    [reports, selectedReportId],
  );

  // 編集ダイアログを開いている間は data の再取得（3秒ポーリング / Realtime）で
  // 入力中の値を上書きしないよう、ダイアログが閉じているときだけ data から再シードする。
  useEffect(() => {
    if (data && !isEditingSettings) {
      setEditingTitle(data.title);
      setEditingContext(data.context);
      setEditingGoal(data.goal);
      setEditingFacilitatorContext(data.facilitatorContext);
      setEditingFacilitatorGoal(data.facilitatorGoal);
    }
  }, [data, isEditingSettings]);

  useEffect(() => {
    if (threadData?.events) {
      setExpandedEvents((prev) => {
        const next = { ...prev };
        threadData.events.forEach((event) => {
          if (typeof next[event.id] === "undefined") {
            next[event.id] = false;
          }
        });
        return next;
      });
    }
  }, [threadData]);

  useEffect(() => {
    const events = threadData?.events ?? [];
    if (!events.length) return;
    const lastEventId = events[events.length - 1]?.id;
    if (!lastEventId) return;
    const isInitial = lastThreadEventIdRef.current === null;
    if (lastThreadEventIdRef.current !== lastEventId) {
      lastThreadEventIdRef.current = lastEventId;
      const container = threadContainerRef.current;
      if (!container) return;
      window.requestAnimationFrame(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: isInitial ? "auto" : "smooth",
        });
      });
    }
  }, [threadData?.events]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute scroll fades when log content height changes
  useEffect(() => {
    const raf = window.requestAnimationFrame(updateThreadFade);
    return () => window.cancelAnimationFrame(raf);
  }, [updateThreadFade, threadData?.events, threadError, expandedEvents]);

  useEffect(() => {
    if (data?.title) {
      document.title = pageTitle(
        tA("pageTitle", { title: data.title }),
        locale,
      );
    }
    return () => {
      document.title = defaultTitle(locale);
    };
  }, [data, tA, locale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setShareUrl(`${window.location.origin}/sessions/${sessionId}`);
  }, [sessionId]);

  const shareQrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=${SHARE_QR_SIZE}x${SHARE_QR_SIZE}&data=${encodeURIComponent(
        shareUrl,
      )}`
    : null;
  const fullscreenQrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=${FULLSCREEN_QR_SIZE}x${FULLSCREEN_QR_SIZE}&data=${encodeURIComponent(
        shareUrl,
      )}`
    : null;

  const persistSettings = async (): Promise<boolean> => {
    if (!userId || !canEdit) return false;

    setIsSavingSettings(true);
    setSettingsMessage(null);
    setSettingsError(null);

    try {
      const response = await axios.patch(
        `/api/sessions/${sessionId}/${accessToken}`,
        {
          title: editingTitle,
          context: editingContext,
          goal: editingGoal,
          facilitatorContext: editingFacilitatorContext,
          facilitatorGoal: editingFacilitatorGoal,
        },
        {
          headers: createAuthorizationHeader(getParticipantBearer()),
        },
      );

      const updated = response.data.data as {
        title: string;
        context: string;
        goal: string;
        facilitatorContext: string;
        facilitatorGoal: string;
      };

      setData((prev) =>
        prev
          ? {
              ...prev,
              title: updated.title,
              context: updated.context,
              goal: updated.goal,
              facilitatorContext: updated.facilitatorContext,
              facilitatorGoal: updated.facilitatorGoal,
            }
          : prev,
      );
      setSettingsMessage(tA("settingsSaved"));
      return true;
    } catch (err) {
      console.error(
        "Failed to update session settings:",
        sanitizeErrorForLog(err),
      );
      setSettingsError(tA("settingsFailed"));
      return false;
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSaveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    const saved = await persistSettings();
    if (saved) {
      setIsEditingSettings(false);
    }
  };

  // 保存してから参加者ページへ遷移する。保存後に window.open すると
  // ユーザー操作の活性が切れてポップアップブロックされるため、同一タブ遷移にする。
  const handleSaveAndPreview = async () => {
    if (!shareUrl) return;
    // type="button" のため form の必須バリデーション（セッション名・公開用の目的）が
    // 走らない。保存前にネイティブのバリデーション UI を発火させ、未入力なら中断する。
    if (settingsFormRef.current && !settingsFormRef.current.reportValidity()) {
      return;
    }
    const saved = await persistSettings();
    if (saved) {
      window.location.href = shareUrl;
    }
  };

  const handleSendMessage = async () => {
    if (!userId || !canEdit || messageDraft.trim().length === 0) return;
    setSendingMessage(true);
    try {
      await axios.post(
        `/api/sessions/${sessionId}/${accessToken}/event-thread/events/user-message`,
        { markdown: messageDraft },
        {
          headers: createAuthorizationHeader(getParticipantBearer()),
        },
      );
      setMessageDraft("");
      await fetchEventThread();
    } catch (err) {
      console.error("Failed to send message:", sanitizeErrorForLog(err));
      toast.error(tA("toastMessageFailed"), {
        description: tA("tryLater"),
        duration: 5000,
      });
    } finally {
      setSendingMessage(false);
    }
  };

  const handleToggleShouldProceed = async () => {
    if (!userId || !canEdit || !threadData?.thread) return;
    setTogglingProceed(true);
    try {
      const response = await axios.patch(
        `/api/sessions/${sessionId}/${accessToken}/event-thread/should-proceed`,
        { shouldProceed: !threadData.thread.shouldProceed },
        {
          headers: createAuthorizationHeader(getParticipantBearer()),
        },
      );
      const updatedThread = response.data.thread as {
        id: string;
        shouldProceed: boolean;
        createdAt: string;
        updatedAt: string;
      };
      setThreadData((prev) =>
        prev
          ? {
              ...prev,
              thread: updatedThread,
            }
          : prev,
      );
    } catch (err) {
      console.error(
        "Failed to toggle shouldProceed:",
        sanitizeErrorForLog(err),
      );
      toast.error(tA("toastToggleFailed"), {
        description: tA("tryLater"),
        duration: 5000,
      });
    } finally {
      setTogglingProceed(false);
    }
  };

  const handleReanalyzeThread = async () => {
    if (
      !userId ||
      !canEdit ||
      isReanalyzingThread ||
      threadRecoveryAction?.type !== "reanalyze"
    ) {
      return;
    }
    setIsReanalyzingThread(true);
    try {
      await axios.post(
        `/api/sessions/${sessionId}/${accessToken}/event-thread/analyze`,
        {},
        {
          headers: createAuthorizationHeader(getParticipantBearer()),
        },
      );
      await fetchEventThread();
      toast.success(tA("toastRetryStarted"), {
        description: tA("toastRetryStartedBody"),
        duration: 4000,
      });
    } catch (err) {
      console.error("Failed to reanalyze thread:", sanitizeErrorForLog(err));
      // A CDN timeout does not stop the server-side run: refresh so an
      // analysis that completed (or is still running) shows up.
      void fetchEventThread();
      if (isGenerationBusy(err)) {
        toast.info(tA("generationInProgress"), { duration: 5000 });
        return;
      }
      toast.error(tA("toastRetryFailed"), {
        description: tA("tryLater"),
        duration: 5000,
      });
    } finally {
      setIsReanalyzingThread(false);
    }
  };

  const handleDeleteSession = async () => {
    if (!canEdit) return;

    try {
      setDeleting(true);
      await axios.delete(`/api/sessions/${sessionId}/${accessToken}`, {
        headers: createAuthorizationHeader(getParticipantBearer()),
      });
      window.location.href = "/";
    } catch (err) {
      console.error("Failed to delete session:", sanitizeErrorForLog(err));
      toast.error(tA("toastDeleteFailed"), {
        description: tA("tryLater"),
        duration: 5000,
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      trackEvent(ANALYTICS_EVENTS.REPORT_SHARED, {
        sessionId,
        type: "link_copy",
      });
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    } catch (err) {
      console.error("Failed to copy link:", sanitizeErrorForLog(err));
      setCopyStatus("error");
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    }
  };

  const handleOpenShareLink = () => {
    if (!shareUrl) return;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  const handleCloseReportModal = () => {
    setShowReportModal(false);
    setReportMode(null);
    setSelectedTemplate(null);
    setCustomPrompt("");
  };

  const handleSelectTemplate = (templateId: ReportTemplateType) => {
    // 選択状態のみ更新、ピッカーには反映しない
    setSelectedTemplate(templateId);
  };

  const handleConfirmTemplate = () => {
    // 「決定」ボタンを押した時にスタイルを確定
    if (selectedTemplate === "freeform") {
      setConfirmedStyle({ type: "freeform", prompt: customPrompt });
    } else if (selectedTemplate) {
      // empathy, logical, psychopathはtypeだけで確定（promptは導出）
      setConfirmedStyle({ type: selectedTemplate });
    } else {
      // selectedTemplate が null の場合はスタンダード
      setConfirmedStyle({ type: "auto" });
    }
    handleCloseReportModal();
  };

  const handleGenerateReport = async () => {
    if (!userId) return;
    if (isReportInFlight) return;

    // getStylePromptでプロンプトを導出
    const finalPrompt = getStylePrompt(confirmedStyle);

    try {
      setCreatingReport(true);
      const response = await axios.post(
        `/api/sessions/${sessionId}/${accessToken}/reports`,
        {
          requestMarkdown: finalPrompt,
        },
        {
          headers: createAuthorizationHeader(getParticipantBearer()),
        },
      );

      const created = response.data.data as SessionReport;
      trackEvent(ANALYTICS_EVENTS.REPORT_GENERATED, {
        sessionId,
        type: "session",
      });
      setReports((prev) => {
        const others = prev.filter((report) => report.id !== created.id);
        return [created, ...others];
      });
      setSelectedReportId(created.id);
      setReportsError(null);
      handleCloseReportModal();
    } catch (err) {
      console.error(
        "Failed to start session report generation:",
        sanitizeErrorForLog(err),
      );
      setReportsError(tA("errStartReport"));
    } finally {
      setCreatingReport(false);
    }
  };

  const handleCopyReportMarkdown = async () => {
    if (!selectedReport?.contentMarkdown) return;
    try {
      await navigator.clipboard.writeText(selectedReport.contentMarkdown);
      trackEvent(ANALYTICS_EVENTS.REPORT_SHARED, {
        sessionId,
        type: "markdown_copy",
      });
      setReportCopyStatus("copied");
    } catch (err) {
      console.error(
        "Failed to copy report markdown:",
        sanitizeErrorForLog(err),
      );
      setReportCopyStatus("error");
    } finally {
      window.setTimeout(() => setReportCopyStatus("idle"), 2000);
    }
  };

  const handleGenerateQuestion = async () => {
    if (!userId || !canEdit || isGeneratingQuestion) return;

    try {
      setIsGeneratingQuestion(true);
      setGenerateQuestionError(null);
      const response = await axios.post(
        `/api/sessions/${sessionId}/${accessToken}/statements/generate`,
        {},
        {
          headers: createAuthorizationHeader(getParticipantBearer()),
        },
      );

      const newStatements = response.data.statements;
      if (newStatements && newStatements.length > 0) {
        // Refresh data to show the new statements
        await fetchAdminData(false);
        setGeneratedQuestions(
          newStatements
            .map((statement: { text?: string }) => statement.text ?? "")
            .filter((text: string) => text.length > 0),
        );
        toast.success(tA("toastQuestionsDone"), {
          description: tA("toastQuestionsDoneBody", {
            count: newStatements.length,
          }),
          duration: 5000,
        });
      } else {
        setGenerateQuestionError(tA("errGenerateQuestions"));
      }
    } catch (err) {
      console.error("Failed to generate questions:", sanitizeErrorForLog(err));
      // A CDN timeout (524) does not stop the server: refresh so questions it
      // went on to append show up instead of tempting a duplicate re-click.
      void fetchAdminData(false);
      if (isGenerationBusy(err)) {
        setGenerateQuestionError(tA("generationInProgress"));
        return;
      }
      setGenerateQuestionError(tA("errGenerateQuestions"));
      toast.error(tA("toastQuestionsFailed"), {
        description: tA("tryLater"),
        duration: 5000,
      });
    } finally {
      setIsGeneratingQuestion(false);
    }
  };

  const participants = data?.participants ?? [];
  const totalParticipants =
    data?.totalParticipants ?? participants?.length ?? 0;
  const _totalStatements =
    data?.totalStatements ?? data?.statements?.length ?? 0;
  const statements = data?.statements ?? [];

  const participantSummary = useMemo(
    () => summarizeParticipants(participants),
    [participants],
  );

  const rankedParticipants = useMemo(() => {
    return [...participants].sort(
      (a, b) => b.completionRate - a.completionRate,
    );
  }, [participants]);

  const statementHighlights = useMemo(
    () => buildStatementHighlights(statements),
    [statements],
  );

  const participantNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    participants.forEach((p) => {
      if (p.userId) map[p.userId] = p.name || tA("anonymous");
    });
    return map;
  }, [participants, tA]);

  // Shared hover between the 合意度マップ dots and the top3 cards (hovering one
  // emphasizes the matching dot/card). Position alone links them — 対立度=中央 /
  // まとまり=両端 — so no dot numbers or frames are needed.
  const [highlightedStatementId, setHighlightedStatementId] = useState<
    string | null
  >(null);

  // Which statement's 集まった回答 (merit profile + 自然言語) is shown in the modal,
  // opened by clicking a highlight card.
  const [modalStatementId, setModalStatementId] = useState<string | null>(null);
  // Which participant's detail (回答ログ・自分レポート) is shown in the modal.
  const [modalParticipantId, setModalParticipantId] = useState<string | null>(
    null,
  );
  const openParticipantModal = useCallback(
    (userId: string) => {
      setModalParticipantId(userId);
      if (!responseLogsData) void fetchResponseLogs();
    },
    [responseLogsData, fetchResponseLogs],
  );

  const latestActionableEvent = useMemo(
    () =>
      (threadData?.events ?? [])
        .filter((event) => event.type !== "user_message")
        .at(-1) ?? null,
    [threadData?.events],
  );

  const threadRecoveryHint = useMemo<ThreadRecoveryHint | null>(
    () =>
      deriveThreadRecoveryHint({
        shouldProceed: threadData?.thread?.shouldProceed ?? false,
        totalParticipants,
        completedParticipants: participantSummary.completedCount,
        latestEvent: latestActionableEvent,
      }),
    [
      latestActionableEvent,
      participantSummary.completedCount,
      threadData?.thread?.shouldProceed,
      totalParticipants,
    ],
  );
  const threadRecoveryAction = threadRecoveryHint?.action ?? null;

  if (isUserIdLoading || loading) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground dark:text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-svh bg-background">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <Card className="border-red-200/70 bg-red-50/80 dark:border-red-800/70 dark:bg-red-950/50">
            <CardContent className="pt-6">
              <p className="text-red-700 dark:text-red-400">{error}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-background">
        <p className="text-muted-foreground">{tA("sessionNotFound")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background">
      <AppHeader />
      <div className="max-w-[90rem] mx-auto px-6 py-10 space-y-10">
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold text-foreground">
                {data.title}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCopyLink}
                className="gap-1.5"
                data-testid="header-copy-share-link"
              >
                {copyStatus === "copied" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copyStatus === "copied"
                  ? tA("copied")
                  : copyStatus === "error"
                    ? tA("copyFailed")
                    : tA("copy")}
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  onClick={() => handleGenerateReport()}
                  disabled={isReportInFlight}
                  isLoading={isReportInFlight}
                  className="gap-1.5"
                  data-testid="header-generate-report-button"
                >
                  <FileText className="h-4 w-4" />
                  {tA("generateReport")}
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* Two columns from 54rem (864px): an unfolded iPhone Duo (870–950px wide in Safari) fits both. */}
        <div className="grid gap-8 min-[54rem]:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="space-y-8">
            <Card data-testid="participant-section">
              <CardHeader>
                <CardTitle>{tA("participantsTitle")}</CardTitle>
                <CardDescription>
                  {tA("participantsDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <MonitoringMetric
                    label={tA("statParticipants")}
                    value={tA("peopleCount", { count: totalParticipants })}
                    testId="monitoring-metric-participants"
                  />
                  <MonitoringMetric
                    label={tA("statAverageRate")}
                    value={formatPercentage(
                      participantSummary.averageCompletion,
                    )}
                    testId="monitoring-metric-average-completion"
                    tone="emerald"
                  />
                  <MonitoringMetric
                    label={tA("statCompleted")}
                    value={tA("peopleCount", {
                      count: participantSummary.completedCount,
                    })}
                    subLabel={tA("statNotStarted", {
                      count: participantSummary.notStartedCount,
                    })}
                    testId="monitoring-metric-completed"
                  />
                  <MonitoringMetric
                    label={tA("statInProgress")}
                    value={tA("peopleCount", {
                      count: participantSummary.inProgressCount,
                    })}
                    testId="monitoring-metric-in-progress"
                  />
                </div>

                {participants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {tA("noParticipants")}
                  </p>
                ) : participants.length > PARTICIPANT_CARD_LIMIT ? (
                  <div className="relative">
                    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                      {rankedParticipants
                        .slice(0, PARTICIPANT_CARD_PREVIEW)
                        .map((participant) => (
                          <ParticipantProgressRow
                            key={participant.userId}
                            participant={participant}
                            onExpand={() =>
                              openParticipantModal(participant.userId)
                            }
                          />
                        ))}
                    </div>
                    {/* blurred teaser of the rest */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none mt-2.5 grid select-none gap-2.5 blur-[3px] sm:grid-cols-2 xl:grid-cols-3"
                    >
                      {rankedParticipants
                        .slice(
                          PARTICIPANT_CARD_PREVIEW,
                          PARTICIPANT_CARD_PREVIEW + 6,
                        )
                        .map((participant) => (
                          <ParticipantProgressRow
                            key={participant.userId}
                            participant={participant}
                          />
                        ))}
                    </div>
                    {/* gate overlay */}
                    <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 bg-gradient-to-t from-card via-card/85 to-transparent pt-20 pb-3">
                      <p className="text-sm font-medium text-foreground">
                        {tA("moreParticipants", {
                          count: participants.length - PARTICIPANT_CARD_PREVIEW,
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tA("allLogsHint")}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowResponseLog(true);
                          void fetchResponseLogs();
                        }}
                        className="mt-1 gap-2"
                      >
                        <FileText className="h-4 w-4" />
                        {tA("showLogs")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {rankedParticipants.map((participant) => (
                      <ParticipantProgressRow
                        key={participant.userId}
                        participant={participant}
                        onExpand={() =>
                          openParticipantModal(participant.userId)
                        }
                      />
                    ))}
                  </div>
                )}
                {/* Always mounted: also opened from the response-log table's report cell */}
                <ParticipantDetailDialog
                  open={modalParticipantId !== null}
                  onOpenChange={(open) =>
                    setModalParticipantId(open ? modalParticipantId : null)
                  }
                  participant={responseLogsData?.participants.find(
                    (p) => p.userId === modalParticipantId,
                  )}
                  loading={responseLogsLoading}
                />
              </CardContent>
              <CardFooter className="flex flex-wrap justify-end gap-4 border-t pt-6">
                {canEdit && (
                  <AlertDialog
                    open={showGenerateQuestionDialog}
                    onOpenChange={(open) => {
                      setShowGenerateQuestionDialog(open);
                      if (!open) {
                        setGeneratedQuestions([]);
                        setGenerateQuestionError(null);
                      }
                    }}
                  >
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isGeneratingQuestion}
                        className="gap-2"
                      >
                        <Bot className="h-4 w-4" />
                        {tA("generateMoreQuestions")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {generatedQuestions.length > 0
                            ? tA("questionsGenerated")
                            : tA("generateQuestionsConfirm")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {generatedQuestions.length > 0
                            ? tA("questionsAdded")
                            : tA("generateQuestionsHelp")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="space-y-3">
                        {generateQuestionError && (
                          <p className="text-xs text-rose-600 dark:text-rose-400">
                            {generateQuestionError}
                          </p>
                        )}
                        {generatedQuestions.length > 0 ? (
                          <>
                            <p className="text-xs font-medium text-muted-foreground">
                              {tA("addedPreview", {
                                count: generatedQuestions.length,
                              })}
                            </p>
                            <div className="max-h-60 space-y-2 overflow-y-auto">
                              {generatedQuestions.map((question) => (
                                <div
                                  key={question}
                                  className="rounded-lg border border-border/80 bg-background/80 p-3 text-sm text-foreground shadow-sm"
                                >
                                  <p className="text-sm leading-relaxed">
                                    {question}
                                  </p>
                                </div>
                              ))}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              {tA("reloadHint")}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {tA("addedPreviewPending")}
                          </p>
                        )}
                      </div>
                      <AlertDialogFooter>
                        {generatedQuestions.length > 0 ? (
                          <AlertDialogCancel>{tA("close")}</AlertDialogCancel>
                        ) : (
                          <>
                            <AlertDialogCancel>
                              {tA("cancel")}
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={(event) => {
                                event.preventDefault();
                                void handleGenerateQuestion();
                              }}
                              disabled={isGeneratingQuestion}
                            >
                              {isGeneratingQuestion ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  {tA("generating")}
                                </>
                              ) : (
                                tA("generate")
                              )}
                            </AlertDialogAction>
                          </>
                        )}
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                {/* When the blur gate is shown it already has this CTA, so the
                    footer one is hidden to avoid a duplicate button. */}
                {participants.length <= PARTICIPANT_CARD_LIMIT && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowResponseLog(true);
                      void fetchResponseLogs();
                    }}
                    disabled={participants.length === 0}
                    className="gap-2"
                  >
                    <FileText className="h-4 w-4" />
                    {tA("showLogs")}
                  </Button>
                )}
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <CardTitle>{tA("reportTitle")}</CardTitle>
                    <CardDescription>{tA("reportDescription")}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {canEdit ? (
                  <div className="space-y-3 rounded-xl border border-border/50 bg-muted/30 p-4">
                    <ReportTasteSelect
                      value={confirmedStyle.type}
                      options={REPORT_STYLE_OPTIONS.map((option) => ({
                        ...option,
                        label: tTemplate(`${option.value}Name`),
                      }))}
                      onClick={() => {
                        setShowReportModal(true);
                        setReportMode("custom");
                      }}
                      disabled={isReportInFlight}
                    />

                    <Button
                      type="button"
                      size="lg"
                      onClick={() => handleGenerateReport()}
                      disabled={isReportInFlight}
                      isLoading={isReportInFlight}
                      className="h-12 w-full justify-center gap-3 rounded-lg text-base font-semibold shadow-sm transition-all hover:shadow-md"
                      data-testid="generate-report-button"
                    >
                      <FileText className="h-5 w-5" />
                      <span>{tA("generateReport")}</span>
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                    {tA("hostOnlyReport")}
                  </div>
                )}

                <Dialog
                  open={showReportModal}
                  onOpenChange={setShowReportModal}
                >
                  <DialogContent className="max-w-4xl max-h-[90dvh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="text-2xl">
                        {tA("chooseReportStyle")}
                      </DialogTitle>
                      <DialogDescription>
                        {tA("chooseReportStyleHelp")}
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6">
                      <div className="flex flex-col gap-6 lg:flex-row">
                        {/* 左側: テンプレートリスト */}
                        <div className="flex-1 space-y-2">
                          {/* スタンダード */}
                          <Card
                            className={`cursor-pointer transition-all hover:shadow-md ${
                              selectedTemplate === null
                                ? "border-primary bg-primary/5 ring-2 ring-primary ring-offset-2"
                                : "hover:border-primary/50"
                            } ${creatingReport ? "pointer-events-none opacity-50" : ""}`}
                            onClick={() =>
                              !creatingReport && setSelectedTemplate(null)
                            }
                          >
                            <CardContent className="flex items-start gap-3 p-4">
                              <div className="rounded-lg bg-muted p-2">
                                <FileText className="h-5 w-5 text-muted-foreground" />
                              </div>
                              <div className="flex-1">
                                <h3 className="font-semibold text-foreground">
                                  {tTemplate("autoName")}
                                </h3>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {tTemplate("autoDescription")}
                                </p>
                              </div>
                            </CardContent>
                          </Card>

                          {REPORT_TEMPLATES.filter(
                            (t) => t.id !== "freeform",
                          ).map((template) => {
                            const Icon = template.icon;
                            const isSelected = selectedTemplate === template.id;
                            return (
                              <Card
                                key={template.id}
                                className={`cursor-pointer transition-all hover:shadow-md ${
                                  isSelected
                                    ? "border-primary bg-primary/5 ring-2 ring-primary ring-offset-2"
                                    : "hover:border-primary/50"
                                } ${creatingReport ? "pointer-events-none opacity-50" : ""}`}
                                onClick={() =>
                                  !creatingReport &&
                                  handleSelectTemplate(template.id)
                                }
                              >
                                <CardContent className="flex items-start gap-3 p-4">
                                  <div className="rounded-lg bg-muted p-2">
                                    <Icon className="h-5 w-5 text-muted-foreground" />
                                  </div>
                                  <div className="flex-1">
                                    <h3 className="font-semibold text-foreground">
                                      {tTemplate(`${template.id}Name`)}
                                    </h3>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                      {tTemplate(`${template.id}Description`)}
                                    </p>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}

                          {/* 自由記述は区切り線の下に表示 */}
                          <div className="border-t border-border pt-2 mt-3">
                            <Card
                              className={`cursor-pointer border-dashed transition-all hover:shadow-md ${
                                selectedTemplate === "freeform"
                                  ? "border-primary bg-primary/5 ring-2 ring-primary ring-offset-2"
                                  : "hover:border-primary/50"
                              } ${creatingReport ? "pointer-events-none opacity-50" : ""}`}
                              onClick={() =>
                                !creatingReport &&
                                handleSelectTemplate("freeform")
                              }
                            >
                              <CardContent className="flex items-start gap-3 p-4">
                                <div className="rounded-lg bg-muted p-2">
                                  <Settings className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div className="flex-1">
                                  <h3 className="font-semibold text-foreground">
                                    {tTemplate("freeformName")}
                                  </h3>
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {tTemplate("freeformDescription")}
                                  </p>
                                </div>
                              </CardContent>
                            </Card>
                          </div>
                        </div>

                        {/* 右側: レポートプレビュー */}
                        <div className="flex-1">
                          <Card className="sticky top-0">
                            <CardHeader className="pb-3">
                              <div className="flex items-center justify-between">
                                <CardTitle className="text-base">
                                  {selectedTemplate === "freeform"
                                    ? tA("promptTitle")
                                    : tA("reportPreviewTitle")}
                                </CardTitle>
                                {selectedTemplate !== "freeform" &&
                                  selectedTemplate !== null && (
                                    <div className="group relative">
                                      {/* A button so a tap (Safari does not focus a tapped button, hence the explicit focus) or the keyboard opens it too. */}
                                      <button
                                        type="button"
                                        aria-label={tA("aiPromptLabel")}
                                        onClick={(event) =>
                                          event.currentTarget.focus()
                                        }
                                        className="block rounded-sm"
                                      >
                                        <Info className="h-4 w-4 cursor-help text-muted-foreground transition hover:text-foreground" />
                                      </button>
                                      <div className="pointer-events-none invisible absolute right-0 top-6 z-10 w-80 max-w-[calc(100vw-4rem)] rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg opacity-0 transition-all group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                                        <div className="mb-1 font-semibold">
                                          {tA("aiPromptLabel")}
                                        </div>
                                        {tTemplate(
                                          `${selectedTemplate}PromptDisplay`,
                                        )}
                                      </div>
                                    </div>
                                  )}
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {selectedTemplate === "freeform" ? (
                                <>
                                  <Textarea
                                    id="templatePrompt"
                                    aria-label={tA("reportPromptLabel")}
                                    value={customPrompt}
                                    onChange={(e) =>
                                      setCustomPrompt(e.target.value)
                                    }
                                    rows={10}
                                    autoResize
                                    maxLength={5000}
                                    placeholder={tA("reportPromptPlaceholder")}
                                  />
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">
                                      {customPrompt.length} / 5000
                                    </span>
                                    <Button
                                      type="button"
                                      onClick={handleConfirmTemplate}
                                      disabled={
                                        creatingReport || !customPrompt.trim()
                                      }
                                      size="sm"
                                    >
                                      {tA("confirm")}
                                    </Button>
                                  </div>
                                </>
                              ) : selectedTemplate ? (
                                <>
                                  <div className="min-h-[240px] max-h-[400px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                                    {tTemplate(`${selectedTemplate}Preview`)}
                                  </div>
                                  <div className="flex justify-end">
                                    <Button
                                      type="button"
                                      onClick={handleConfirmTemplate}
                                      disabled={creatingReport}
                                      size="sm"
                                    >
                                      {tA("confirm")}
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="min-h-[240px] max-h-[400px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                                    {tTemplate("freeformSample")}
                                  </div>
                                  <div className="flex justify-end">
                                    <Button
                                      type="button"
                                      onClick={handleConfirmTemplate}
                                      disabled={creatingReport}
                                      size="sm"
                                    >
                                      {tA("confirm")}
                                    </Button>
                                  </div>
                                </>
                              )}
                            </CardContent>
                          </Card>
                        </div>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                {reportsError && (
                  <div className="rounded-2xl border border-status-pending/40 bg-status-pending/15 px-4 py-3 text-sm text-status-pending-foreground">
                    {reportsError}
                  </div>
                )}

                {reportsLoading ? (
                  <div className="space-y-4">
                    <div className="h-12 animate-pulse rounded-2xl bg-muted/80" />
                    <div className="h-[420px] animate-pulse rounded-2xl bg-muted/80" />
                  </div>
                ) : reports.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
                    {canEdit ? tA("noReportsHost") : tA("noReports")}
                  </div>
                ) : selectedReport ? (
                  <div className="space-y-6">
                    {selectedReport.requestMarkdown.trim() ? (
                      <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-foreground">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          {tA("reportRequest")}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                          {displayRequest(selectedReport.requestMarkdown)}
                        </p>
                      </div>
                    ) : null}

                    <div className="min-h-[360px]">
                      <div className="flex h-full flex-col gap-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <select
                            id="reportVersionSelect"
                            aria-label={tA("reportVersionLabel")}
                            value={selectedReportId ?? ""}
                            onChange={(event) =>
                              setSelectedReportId(event.target.value)
                            }
                            className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-card lg:max-w-xs"
                          >
                            {reports.map((report) => (
                              <option key={report.id} value={report.id}>
                                {[
                                  `v${String(report.version).padStart(2, "0")}`,
                                  getReportTasteLabel(report, tTemplate),
                                  getReportStatusLabel(report.status, tA),
                                ].join(tA("separator"))}
                              </option>
                            ))}
                          </select>
                          <div className="flex flex-wrap gap-2 lg:justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={
                                selectedReport.status !== "completed" ||
                                !selectedReport.contentMarkdown
                              }
                              onClick={handleCopyReportMarkdown}
                              className="gap-1.5 text-xs"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              {reportCopyStatus === "copied"
                                ? tA("copied")
                                : reportCopyStatus === "error"
                                  ? tA("copyFailed")
                                  : tA("copyMarkdown")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-xs"
                              disabled={
                                selectedReport.status !== "completed" ||
                                !selectedReport.contentMarkdown
                              }
                              onClick={() =>
                                window.open(
                                  `/sessions/${sessionId}/${accessToken}/reports/${selectedReport.id}/print`,
                                  "_blank",
                                )
                              }
                            >
                              <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                              {tA("openReportPage")}
                            </Button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto rounded-2xl border border-border/60 bg-background/90 p-5 dark:bg-card/90">
                          {selectedReport.status === "completed" &&
                          selectedReport.contentMarkdown ? (
                            <div className="markdown-body prose prose-slate dark:prose-invert max-w-none text-sm leading-relaxed">
                              <ReportMarkdown
                                sessionId={sessionId}
                                accessToken={accessToken}
                                reportId={selectedReport.id}
                                userId={userId ?? ""}
                              >
                                {selectedReport.contentMarkdown}
                              </ReportMarkdown>
                            </div>
                          ) : selectedReport.status === "failed" ? (
                            <div className="text-sm text-rose-600 dark:text-rose-400">
                              {tA("reportFailed")}
                              <br />
                              {reportFailureText(selectedReport.errorMessage) ??
                                tA("checkLogs")}
                            </div>
                          ) : (
                            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                              <p>{tA("reportGenerating")}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {tA("reportGeneratingHint")}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
                    {tA("selectReportHint")}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="space-y-2">
                  <CardTitle>{tA("issuesTitle")}</CardTitle>
                  <CardDescription>{tA("issuesDescription")}</CardDescription>
                </div>
              </CardHeader>

              <CardContent
                className="space-y-6"
                data-testid="issue-highlights-section"
              >
                <section
                  className="space-y-2"
                  data-testid="consensus-beeswarm-section"
                >
                  <h3 className="text-sm font-semibold text-foreground">
                    {tA("consensusMap")}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {tA("consensusMapHelp")}
                  </p>
                  <ConsensusBeeswarm
                    statements={statements}
                    highlightedId={highlightedStatementId}
                    onHover={setHighlightedStatementId}
                    onOpenStatement={setModalStatementId}
                  />
                </section>

                <div className="grid gap-x-6 gap-y-3 lg:grid-cols-3 lg:grid-rows-[auto_auto_auto_auto]">
                  <StatementHighlightColumn
                    title={tA("topConflict")}
                    tone="conflict"
                    metric="conflict"
                    info={tA("topConflictInfo")}
                    items={statementHighlights.conflict}
                    onOpenStatement={setModalStatementId}
                    nameMap={participantNameMap}
                    highlightedId={highlightedStatementId}
                    onHover={setHighlightedStatementId}
                  />
                  <StatementHighlightColumn
                    title={tA("topUnsure")}
                    tone="unsure"
                    metric="dontKnow"
                    info={tA("topUnsureInfo")}
                    items={statementHighlights.dontKnow}
                    onOpenStatement={setModalStatementId}
                    nameMap={participantNameMap}
                    highlightedId={highlightedStatementId}
                    onHover={setHighlightedStatementId}
                  />
                  <StatementHighlightColumn
                    title={tA("topConsensus")}
                    tone="agree"
                    metric="consensus"
                    info={tA("topConsensusInfo")}
                    items={statementHighlights.consensus}
                    onOpenStatement={setModalStatementId}
                    nameMap={participantNameMap}
                    highlightedId={highlightedStatementId}
                    onHover={setHighlightedStatementId}
                  />
                </div>
                <StatementDetailDialog
                  open={modalStatementId !== null}
                  onOpenChange={(open) =>
                    setModalStatementId(open ? modalStatementId : null)
                  }
                  statement={statements.find((s) => s.id === modalStatementId)}
                  nameMap={participantNameMap}
                  onOpenParticipant={(uid) => {
                    setModalStatementId(null);
                    openParticipantModal(uid);
                  }}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="space-y-2">
                  <CardTitle>{tA("reportMapTitle")}</CardTitle>
                  <CardDescription>
                    {tA("reportMapDescription")}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent data-testid="opinion-groups-section">
                <OpinionLandscape
                  sessionId={sessionId}
                  userId={userId ?? ""}
                  accessToken={accessToken}
                  onSelectParticipant={openParticipantModal}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <CardTitle>{tA("activityLog")}</CardTitle>
                    <CardDescription>
                      {tA("activityLogDescription")}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right">
                    <ThreadStatusToggle
                      shouldProceed={threadData?.thread?.shouldProceed ?? false}
                      onToggle={handleToggleShouldProceed}
                      disabled={!canEdit || !threadData?.thread}
                      isLoading={togglingProceed}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {threadData?.thread?.shouldProceed
                        ? tA("autoOn")
                        : tA("autoOff")}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {threadRecoveryHint && (
                  <div className="rounded-2xl border border-status-pending/40 bg-status-pending/15 px-4 py-3 text-sm text-status-pending-foreground">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-semibold">
                          {threadRecoveryHint.kind === "event_failed"
                            ? tA("hintFailedTitle", {
                                label: tEvent(threadRecoveryHint.eventType),
                              })
                            : tA("hintDisabledTitle")}
                        </p>
                        <p>
                          {threadRecoveryHint.kind ===
                          "auto_generation_disabled"
                            ? tA("hintDisabledBody")
                            : threadRecoveryHint.action
                              ? tA("hintFailedRetryBody")
                              : tA("hintFailedManualBody")}
                        </p>
                        {threadRecoveryHint.errorMessage && (
                          <p className="text-xs text-status-pending-foreground/80">
                            {tA("detail", {
                              message: threadRecoveryHint.errorMessage,
                            })}
                          </p>
                        )}
                      </div>
                      {canEdit &&
                        threadRecoveryAction?.type === "reanalyze" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleReanalyzeThread}
                            disabled={isReanalyzingThread}
                          >
                            {isReanalyzingThread ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {tA("retrying")}
                              </>
                            ) : (
                              tA("reanalyze")
                            )}
                          </Button>
                        )}
                    </div>
                  </div>
                )}
                <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/70">
                  {threadLoading && (
                    <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-background/90 to-background/30 py-2 text-center text-xs text-muted-foreground">
                      {tA("updating")}
                    </div>
                  )}
                  <div
                    ref={threadContainerRef}
                    onScroll={updateThreadFade}
                    className="h-[620px] overflow-y-auto px-6 py-6 space-y-5 [scrollbar-gutter:stable]"
                  >
                    {threadError ? (
                      <div className="rounded-2xl border border-status-pending/40 bg-status-pending/15 px-4 py-3 text-sm text-status-pending-foreground">
                        {threadError}
                      </div>
                    ) : threadData?.events.length ? (
                      threadData.events.map((event) => {
                        const isHostMessage = event.type === "user_message";
                        const expanded = Boolean(expandedEvents[event.id]);
                        return (
                          <ThreadEventBubble
                            key={event.id}
                            event={event}
                            isHostMessage={isHostMessage}
                            expanded={expanded}
                            onToggle={() =>
                              setExpandedEvents((prev) => ({
                                ...prev,
                                [event.id]: !prev[event.id],
                              }))
                            }
                          />
                        );
                      })
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {tA("noEvents")}
                      </p>
                    )}
                  </div>
                  <div
                    aria-hidden
                    className={`pointer-events-none absolute inset-x-0 top-0 h-8 rounded-t-2xl bg-gradient-to-b from-card to-transparent transition-opacity duration-200 ${threadFade.top ? "opacity-100" : "opacity-0"}`}
                  />
                  <div
                    aria-hidden
                    className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-2xl bg-gradient-to-t from-card to-transparent transition-opacity duration-200 ${threadFade.bottom ? "opacity-100" : "opacity-0"}`}
                  />
                </div>

                {canEdit && (
                  <div className="space-y-3 rounded-xl border border-border/50 bg-muted/30 p-4">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="adminMessage"
                        className="text-sm font-medium"
                      >
                        {tA("aiNote")}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {tA("aiNoteHelp")}
                      </p>
                    </div>
                    <div className="flex items-end gap-2">
                      <Textarea
                        id="adminMessage"
                        value={messageDraft}
                        onChange={(event) =>
                          setMessageDraft(event.target.value)
                        }
                        rows={2}
                        autoResize
                        placeholder={tA("aiNotePlaceholder")}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleSendMessage}
                        disabled={
                          sendingMessage || messageDraft.trim().length === 0
                        }
                        isLoading={sendingMessage}
                        size="sm"
                        className="shrink-0"
                      >
                        <Send className="h-4 w-4" />
                        {tA("addNote")}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-8">
            <Card>
              <CardHeader>
                <CardTitle>{tA("shareTitle")}</CardTitle>
                <CardDescription>{tA("shareDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <label
                    htmlFor="shareLink"
                    className="text-xs font-medium text-foreground"
                  >
                    {tA("copyUrl")}
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="shareLink"
                      readOnly
                      value={shareUrl}
                      className="text-sm"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCopyLink}
                      className="gap-1.5 px-3 text-xs"
                      data-testid="copy-share-link"
                    >
                      {copyStatus === "copied" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copyStatus === "copied"
                        ? tA("copied")
                        : copyStatus === "error"
                          ? tA("copyFailed")
                          : tA("copy")}
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleOpenShareLink}
                    className="gap-1.5 text-xs"
                    disabled={!shareUrl}
                  >
                    <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                    {tA("openParticipantPage")}
                  </Button>
                </div>
                <div className="relative rounded-2xl border border-border bg-gradient-to-br from-slate-50 to-white px-6 py-6 text-center shadow-inner dark:border-border dark:from-slate-900/40 dark:to-slate-950/40">
                  {shareQrUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsShareQrFullscreen(true)}
                      className="absolute right-4 top-4 gap-1.5 rounded-full border border-border bg-card px-3 text-xs text-muted-foreground shadow-sm hover:bg-accent"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      {tA("enlarge")}
                    </Button>
                  )}
                  {shareQrUrl ? (
                    <Image
                      src={shareQrUrl}
                      alt={tA("qrAlt")}
                      width={SHARE_QR_SIZE}
                      height={SHARE_QR_SIZE}
                      unoptimized
                      className="mx-auto h-[176px] w-[176px] rounded-xl border border-border bg-white object-contain p-2 shadow-sm dark:border-border dark:bg-white"
                    />
                  ) : (
                    <div className="mx-auto flex h-[176px] w-[176px] items-center justify-center rounded-xl border border-dashed border-border bg-card text-xs text-muted-foreground">
                      {tA("qrFailed")}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            <Dialog
              open={isShareQrFullscreen}
              onOpenChange={setIsShareQrFullscreen}
            >
              <DialogContent className="max-w-5xl border-white/10 bg-black/85 p-8 backdrop-blur-sm">
                <DialogHeader>
                  <DialogTitle className="text-3xl font-semibold text-white text-center">
                    {tA("qrScan")}
                  </DialogTitle>
                </DialogHeader>
                {fullscreenQrUrl && (
                  <div className="flex justify-center">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
                      <Image
                        src={fullscreenQrUrl}
                        alt={tA("qrAlt")}
                        width={FULLSCREEN_QR_SIZE}
                        height={FULLSCREEN_QR_SIZE}
                        unoptimized
                        className="h-auto w-full max-w-[min(95vw,880px)] rounded-2xl border border-white bg-white p-6 shadow-lg"
                      />
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <CardTitle>{tA("settingsTitle")}</CardTitle>
                    <CardDescription>
                      {canEdit
                        ? tA("settingsDescriptionEditable")
                        : tA("settingsDescription")}
                    </CardDescription>
                  </div>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditingSettings(true)}
                      className="gap-1.5 text-xs"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {tA("edit")}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.12em] dark:text-muted-foreground">
                    {tA("sessionName")}
                  </p>
                  <p
                    className="mt-1 text-sm leading-relaxed text-foreground"
                    title={data.title ?? undefined}
                  >
                    {data.title ? truncateText(data.title, 160) : tA("notSet")}
                  </p>
                </div>

                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {tA("coreBrief")}
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tA("coreBriefHelp")}
                  </p>
                  <div className="space-y-4 text-sm text-muted-foreground">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.12em] dark:text-muted-foreground">
                        {tA("purpose")}
                      </p>
                      <p
                        className="mt-1 leading-relaxed"
                        title={data.facilitatorGoal ?? undefined}
                      >
                        {data.facilitatorGoal
                          ? truncateText(data.facilitatorGoal, 160)
                          : tA("notSet")}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.12em] dark:text-muted-foreground">
                        {tA("background")}
                      </p>
                      <p
                        className="mt-1 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
                        title={data.facilitatorContext ?? undefined}
                      >
                        {data.facilitatorContext
                          ? truncateText(data.facilitatorContext, 160)
                          : tA("notSet")}
                      </p>
                    </div>
                    {data.sourceUrl && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.12em] dark:text-muted-foreground">
                          {tA("source")}
                        </p>
                        <a
                          href={data.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid="session-source-url"
                          className="mt-1 block break-all underline underline-offset-2"
                        >
                          {data.sourceUrl}
                        </a>
                      </div>
                    )}
                  </div>
                </section>

                <section className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {tA("participantBrief")}
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tA("participantBriefHelp")}
                  </p>
                  {data.goal || data.context ? (
                    <div className="space-y-4 text-sm text-muted-foreground">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.12em] dark:text-muted-foreground">
                          {tA("participantPurpose")}
                        </p>
                        <p
                          className="mt-1 leading-relaxed"
                          title={data.goal ?? undefined}
                        >
                          {data.goal
                            ? truncateText(data.goal, 160)
                            : tA("notSet")}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.12em] dark:text-muted-foreground">
                          {tA("participantBackground")}
                        </p>
                        <p
                          className="mt-1 leading-relaxed whitespace-pre-wrap"
                          title={data.context ?? undefined}
                        >
                          {data.context
                            ? truncateText(data.context, 160)
                            : tA("notSet")}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {tA("notOverridden")}
                    </p>
                  )}
                </section>
              </CardContent>
            </Card>

            <Dialog
              open={isEditingSettings}
              onOpenChange={setIsEditingSettings}
            >
              <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{tA("editSettings")}</DialogTitle>
                  <DialogDescription>
                    {tA("editSettingsHelp")}
                  </DialogDescription>
                </DialogHeader>
                <form
                  ref={settingsFormRef}
                  onSubmit={handleSaveSettings}
                  className="space-y-6"
                >
                  <div className="space-y-1.5">
                    <label
                      htmlFor="sessionTitle"
                      className="text-xs font-medium text-foreground"
                    >
                      {tA("sessionName")}
                    </label>
                    <Input
                      id="sessionTitle"
                      type="text"
                      value={editingTitle}
                      onChange={(event) => setEditingTitle(event.target.value)}
                      required
                      className="text-sm"
                    />
                  </div>

                  <section className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          {tA("coreBrief")}
                        </h3>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {tA("coreBriefEditHelp")}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="facilitatorGoal"
                        className="text-xs font-medium text-foreground"
                      >
                        {tA("purpose")}
                      </label>
                      <Textarea
                        id="facilitatorGoal"
                        value={editingFacilitatorGoal}
                        onChange={(event) =>
                          setEditingFacilitatorGoal(event.target.value)
                        }
                        rows={5}
                        autoResize
                        className="rounded-xl"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="facilitatorContext"
                        className="text-xs font-medium text-foreground"
                      >
                        {tA("background")}
                      </label>
                      <Textarea
                        id="facilitatorContext"
                        value={editingFacilitatorContext}
                        onChange={(event) =>
                          setEditingFacilitatorContext(event.target.value)
                        }
                        rows={5}
                        autoResize
                        className="rounded-xl"
                      />
                    </div>
                  </section>

                  <section className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          {tA("participantBrief")}
                        </h3>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleSaveAndPreview}
                          disabled={isSavingSettings || !shareUrl}
                          isLoading={isSavingSettings}
                          title={tA("previewTitle")}
                          className="ml-auto gap-1.5 text-xs"
                        >
                          <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                          {tA("preview")}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {tA("participantBriefEditHelp")}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="sessionGoal"
                        className="text-xs font-medium text-foreground"
                      >
                        {tA("participantPurpose")}
                      </label>
                      <Textarea
                        id="sessionGoal"
                        value={editingGoal}
                        onChange={(event) => setEditingGoal(event.target.value)}
                        rows={4}
                        autoResize
                        placeholder={tA("participantPurposePlaceholder")}
                        className="rounded-xl bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="sessionContext"
                        className="text-xs font-medium text-foreground"
                      >
                        {tA("participantBackground")}
                      </label>
                      <Textarea
                        id="sessionContext"
                        value={editingContext}
                        onChange={(event) =>
                          setEditingContext(event.target.value)
                        }
                        rows={4}
                        autoResize
                        placeholder={tA("participantBackgroundPlaceholder")}
                        className="rounded-xl bg-background"
                      />
                    </div>
                  </section>

                  {(settingsMessage || settingsError) && (
                    <div
                      className={`rounded-2xl border px-4 py-3 text-sm ${
                        settingsError
                          ? "border-status-failed/40 bg-status-failed/15 text-status-failed-foreground"
                          : "border-status-completed/40 bg-status-completed/15 text-status-completed-foreground"
                      }`}
                    >
                      {settingsError ?? settingsMessage}
                    </div>
                  )}

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsEditingSettings(false);
                        setSettingsMessage(null);
                        setSettingsError(null);
                        if (data) {
                          setEditingTitle(data.title);
                          setEditingContext(data.context);
                          setEditingGoal(data.goal);
                          setEditingFacilitatorContext(data.facilitatorContext);
                          setEditingFacilitatorGoal(data.facilitatorGoal);
                        }
                      }}
                      className="gap-1.5 text-xs"
                    >
                      {tA("cancel")}
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSavingSettings}
                      isLoading={isSavingSettings}
                      size="sm"
                      className="gap-1.5 text-xs"
                    >
                      {tA("saveChanges")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Card>
              <CardHeader>
                <CardTitle>{tA("manageTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {canEdit && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={deleting}
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        {tA("deleteSession")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {tA("deleteConfirm")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {tA("deleteWarning")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tA("cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDeleteSession}
                          disabled={deleting}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {deleting ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {tA("deleting")}
                            </>
                          ) : (
                            tA("delete")
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Response Log Modal */}
        {showResponseLog && (
          <div className="fixed inset-0 z-50 m-0 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
            <button
              type="button"
              aria-label={tA("closeModal")}
              className="absolute inset-0 z-0 h-full w-full cursor-pointer bg-transparent focus:outline-none"
              onClick={() => setShowResponseLog(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setShowResponseLog(false);
                }
              }}
            />
            <div
              className="relative z-10 w-full max-w-7xl max-h-[90dvh] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-label={tA("responseLogs")}
            >
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">
                    {tA("responseLogs")}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tA("responseLogsDescription")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {responseLogsData && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const csvContent = convertResponseLogsToCSV(
                          responseLogsData,
                          tA,
                        );
                        const timestamp = new Date()
                          .toISOString()
                          .slice(0, 19)
                          .replace(/:/g, "-");
                        downloadCSV(
                          csvContent,
                          `response-logs-${sessionId}-${timestamp}.csv`,
                        );
                      }}
                      className="gap-2"
                    >
                      <Download className="h-4 w-4" />
                      {tA("exportCsv")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowResponseLog(false)}
                    className="text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>
              <div
                className="overflow-y-auto px-6 py-6"
                style={{ maxHeight: "calc(90dvh - 80px)" }}
              >
                {responseLogsLoading ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      {tA("loading")}
                    </p>
                  </div>
                ) : responseLogsError ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Info className="h-8 w-8 text-rose-400" />
                    <p className="mt-3 text-sm text-rose-600">
                      {responseLogsError}
                    </p>
                  </div>
                ) : responseLogsData ? (
                  <div className="space-y-6">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="rounded-xl border border-border bg-card px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {tA("participantCount")}
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-card-foreground">
                          {tA("peopleCount", {
                            count: responseLogsData.totalParticipants,
                          })}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border bg-card px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {tA("questionCount")}
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-card-foreground">
                          {tA("questionsUnit", {
                            count: responseLogsData.totalStatements,
                          })}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border bg-card px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {tA("totalResponses")}
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-card-foreground">
                          {tA("responsesUnit", {
                            count: responseLogsData.participants.reduce(
                              (sum, p) =>
                                sum +
                                p.responses.filter(
                                  (r) => r.responseType !== null,
                                ).length,
                              0,
                            ),
                          })}
                        </p>
                      </div>
                    </div>

                    <ResponseLogsDataTable
                      columns={createResponseLogColumns(
                        responseLogsData.statements,
                        (userId) => setModalParticipantId(userId),
                      )}
                      data={responseLogsData.participants.map(
                        (participant): ResponseLogRow => {
                          const row: ResponseLogRow = {
                            participantUserId: participant.userId,
                            participantName: participant.name,
                            joinedAt: participant.joinedAt,
                            individualReport:
                              participant.individualReport ?? "",
                          };
                          participant.responses.forEach((response) => {
                            row[`statement_${response.statementId}`] = response;
                          });
                          return row;
                        },
                      )}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadStatusToggle({
  shouldProceed,
  onToggle,
  disabled,
  isLoading,
}: {
  shouldProceed: boolean;
  onToggle: () => void;
  disabled: boolean;
  isLoading: boolean;
}) {
  const tA = useTranslations("admin");
  const statusDescription = shouldProceed
    ? tA("autoTitleOn")
    : tA("autoTitleOff");
  const isDisabled = disabled || isLoading;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={shouldProceed}
        data-state={shouldProceed ? "checked" : "unchecked"}
        onClick={onToggle}
        disabled={isDisabled}
        aria-label={tA("autoToggleLabel")}
        title={statusDescription}
        className="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
      >
        <span
          data-state={shouldProceed ? "checked" : "unchecked"}
          className="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
        />
      </button>
      {isLoading && (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

interface ThreadEventBubbleProps {
  event: TimelineEvent;
  isHostMessage: boolean;
  expanded: boolean;
  onToggle: () => void;
}

function ThreadEventBubble({
  event,
  isHostMessage,
  expanded,
  onToggle,
}: ThreadEventBubbleProps) {
  const markdownProseClass =
    "markdown-body prose prose-sm dark:prose-invert max-w-none text-foreground [&_ol]:list-decimal [&_ul]:list-disc";
  const fadeGradientClass = isHostMessage
    ? "from-primary/5 via-primary/3 to-transparent dark:from-primary/5 dark:via-primary/3"
    : "from-card/95 via-card/60 to-transparent dark:from-card/95 dark:via-card/60";

  const wrapWithFade = (node: ReactElement) => ({
    content: (
      <div className="relative pb-2">
        {node}
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t ${fadeGradientClass}`}
        />
      </div>
    ),
    hasFade: true,
  });

  const plainContent = (node: ReactElement) => ({
    content: node,
    hasFade: false,
  });

  const tA = useTranslations("admin");
  const tEvent = useTranslations("eventTypes");
  const locale = useLocale();
  const meta = {
    ...(EVENT_TYPE_META[event.type] ?? {
      accent: "text-muted-foreground",
      badge: "bg-muted text-muted-foreground border-border",
    }),
    label: event.type in EVENT_TYPE_META ? tEvent(event.type) : event.type,
  };

  const markdown =
    typeof event.payload.markdown === "string"
      ? (event.payload.markdown as string)
      : "";
  const errorMessage =
    typeof event.errorMessage === "string" ? event.errorMessage : "";

  const showToggle =
    event.type === "survey"
      ? event.statements.length > 3
      : markdown.length > 240;

  const progressValue =
    typeof event.progress === "number"
      ? event.progress
      : Number(event.progress ?? 0);
  const _progressPercent = Math.max(
    0,
    Math.min(100, Math.round(progressValue * 100)),
  );

  const visibleStatements =
    event.type === "survey" && !expanded && event.statements.length > 3
      ? event.statements.slice(0, 3)
      : event.statements;

  const totalSurveyStatements =
    event.type === "survey" ? event.statements.length : 0;

  const statementsList = (
    <div className="space-y-2">
      {event.type === "survey" && totalSurveyStatements > 0 ? (
        <p className="text-base text-foreground">
          {tA("newQuestionsCreated", { count: totalSurveyStatements })}
        </p>
      ) : null}
      {visibleStatements.map((statement) => (
        <div
          key={statement.id}
          className="rounded-2xl border border-border bg-card/90 px-3 py-2 text-sm text-foreground shadow-sm"
        >
          <span className="mr-2 text-[11px] font-medium text-muted-foreground">
            #{statement.orderIndex + 1}
          </span>
          {statement.text}
        </div>
      ))}
      {/* {!expanded && event.statements.length > visibleStatements.length && (
        <p className="text-[11px] text-muted-foreground">
          {tA("moreStatements", {
            count: event.statements.length - visibleStatements.length,
          })}
        </p>
      )} */}
    </div>
  );

  const showFade = showToggle && !expanded;

  const toggleButton = showToggle ? (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {expanded ? (
        <>
          <ChevronUp className="h-3 w-3" />
          {tA("close")}
        </>
      ) : (
        <>
          <ChevronDown className="h-3 w-3" />
          {tA("showAll")}
        </>
      )}
    </button>
  ) : null;

  const content = (() => {
    if (event.type === "survey" && visibleStatements.length > 0) {
      return showFade
        ? wrapWithFade(statementsList)
        : plainContent(statementsList);
    }

    if (errorMessage) {
      return plainContent(
        <div className="space-y-2">
          <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
            {tA("generationFailed")}
          </p>
          <p className="text-xs whitespace-pre-wrap break-words text-rose-600/90 dark:text-rose-300/90">
            {errorMessage}
          </p>
        </div>,
      );
    }

    if (markdown) {
      const markdownNode = (
        <div className={markdownProseClass}>
          <Markdown>{markdown}</Markdown>
        </div>
      );

      if (expanded || !showToggle) {
        return plainContent(markdownNode);
      }

      return wrapWithFade(
        <div className={`${markdownProseClass} max-h-48 overflow-hidden`}>
          <Markdown>{markdown}</Markdown>
        </div>,
      );
    }

    return plainContent(
      <p className="text-sm text-muted-foreground">{tA("preparing")}</p>,
    );
  })();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div
          className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${meta.badge}`}
        >
          <span>{meta.label}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          #{String(event.orderIndex).padStart(3, "0")}
          {tA("separator")}
          {formatDateTime(event.updatedAt, locale)}
        </span>
      </div>
      <div
        className={`w-full rounded-xl border px-4 py-3 ${
          isHostMessage
            ? "border-dashed border-border bg-muted/40"
            : "border-border bg-card/90 shadow-sm"
        }`}
      >
        <div className="flex flex-col gap-0">
          {content.content}
          {toggleButton && (
            <div
              className={`flex justify-start ${content.hasFade ? "-mt-1" : "mt-2"}`}
            >
              {toggleButton}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// One statement's distribution: the Majority Judgment merit profile (5-point
// grade bar + median + per-grade counts), then the natural-language answers.
// Shared by the inline 全設問 list and the per-statement modal so both match.
function StatementAnswerDetail({
  statement,
  nameMap,
  onOpenParticipant,
}: {
  statement: StatementWithStats;
  nameMap: Record<string, string>;
  // Click a free-text author to open their 回答ログ・自分レポート (same dialog as 参加者状況の把握).
  onOpenParticipant?: (userId: string) => void;
}) {
  const tA = useTranslations("admin");
  const r = statement.responses;
  return (
    <div className="space-y-3">
      {/* The merit profile's per-grade legend covers the counts (full mode). */}
      <StatementMeritProfile responses={r} full />
      {r.freeTextSamples.length > 0 ? (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground">
            {tA("freeTextHeader", { count: r.freeTextSamples.length })}
          </p>
          <ul className="mt-1 space-y-1.5">
            {r.freeTextSamples.map((s) => {
              const uid = s.participantUserId;
              const name = uid
                ? (nameMap[uid] ?? tA("anonymous"))
                : tA("anonymous");
              return (
                <li
                  key={`${statement.id}-${uid ?? ""}-${s.text}`}
                  className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-3 py-2 text-sm leading-relaxed text-foreground"
                >
                  {tA("quotedText", { text: s.text })}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    —{" "}
                    {uid && onOpenParticipant ? (
                      <button
                        type="button"
                        onClick={() => onOpenParticipant(uid)}
                        className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                      >
                        {name}
                      </button>
                    ) : (
                      name
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{tA("noFreeText")}</p>
      )}
    </div>
  );
}

// Modal showing one statement's 集まった回答 (beeswarm + 自然言語). Opened by
// clicking a highlight card. Mirrors ParticipantDetailDialog's layout. Data comes
// from the already-loaded statements payload — no extra fetch.
function StatementDetailDialog({
  statement,
  nameMap,
  open,
  onOpenChange,
  onOpenParticipant,
}: {
  statement: StatementWithStats | undefined;
  nameMap: Record<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenParticipant?: (userId: string) => void;
}) {
  const tA = useTranslations("admin");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base leading-relaxed">
            {statement
              ? `#${statement.orderIndex + 1} ${statement.text}`
              : tA("statement")}
          </DialogTitle>
          {statement && (
            <DialogDescription>
              {tA("respondentsCount", {
                count: statement.responses.totalCount,
              })}
            </DialogDescription>
          )}
        </DialogHeader>
        {statement ? (
          <StatementAnswerDetail
            statement={statement}
            nameMap={nameMap}
            onOpenParticipant={onOpenParticipant}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {tA("statementNotFound")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Modal showing a participant's 自分レポート + their answer log (scale label or
// free-text). Opened from the card's expand button and from the response-log
// table's report cell. Data comes from the already-fetched response-logs payload.
function ParticipantDetailDialog({
  participant,
  loading,
  open,
  onOpenChange,
}: {
  participant: ResponseLogParticipant | undefined;
  loading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tA = useTranslations("admin");
  const tGrade = useTranslations("grades");
  const locale = useLocale();
  const responses = participant?.responses ?? [];
  const total = responses.length;
  const answered = responses.filter((r) => r.responseType !== null).length;
  const freeTextCount = responses.filter(
    (r) => r.responseType === "free_text" || (r.textResponse ?? "") !== "",
  ).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {tA("participantLogsTitle", {
              name: participant?.name ?? tA("participantFallback"),
            })}
          </DialogTitle>
          {participant && (
            <DialogDescription>
              {tA("joinedAt", {
                time: formatDateTime(participant.joinedAt, locale),
              })}
            </DialogDescription>
          )}
        </DialogHeader>
        {!participant ? (
          <p className="text-sm text-muted-foreground">
            {loading ? tA("loadingHistory") : tA("noParticipantDetail")}
          </p>
        ) : (
          <div className="space-y-5">
            {participant.individualReport ? (
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-[11px] font-semibold text-muted-foreground">
                  {tA("personalReport")}
                </p>
                <div className="markdown-body prose prose-slate dark:prose-invert max-w-none mt-2">
                  <Markdown>{participant.individualReport}</Markdown>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                {tA("noPersonalReport")}
              </p>
            )}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold text-muted-foreground">
                  {tA("responseLogs")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {tA("answeredOf", { answered, total })}
                  {freeTextCount > 0 &&
                    tA("freeTextSuffix", { count: freeTextCount })}
                </p>
              </div>
              {/* Mirrors the participant's じぶんレポート 回答履歴 rows (same pill
                  colors / row layout) so the two views read identically. */}
              <ul className="space-y-3">
                {responses.map((r) => {
                  const label = tGrade(
                    r.value === 2
                      ? "strongAgree"
                      : r.value === 1
                        ? "agree"
                        : r.value === 0
                          ? "unsure"
                          : r.value === -1
                            ? "disagree"
                            : "strongDisagree",
                  );
                  const pillClass =
                    r.value === 2 || r.value === 1
                      ? "bg-success-soft text-success"
                      : r.value === -1 || r.value === -2
                        ? "bg-warning-soft text-warning"
                        : "bg-muted text-muted-foreground";
                  return (
                    <li
                      key={r.statementId}
                      className="flex items-start justify-between gap-3 border-t border-border/50 pt-3 first:border-t-0 first:pt-0 dark:border-border/30"
                    >
                      <p className="flex-1 text-sm text-foreground">
                        {r.statementText}
                      </p>
                      <div className="shrink-0 text-right">
                        {r.responseType === "scale" && r.value !== null ? (
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${pillClass}`}
                          >
                            {label}
                          </span>
                        ) : (r.textResponse ?? "").trim().length ? (
                          <span className="inline-block max-w-[12rem] text-left text-sm text-muted-foreground line-clamp-3">
                            {r.textResponse}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {tA("noText")}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
