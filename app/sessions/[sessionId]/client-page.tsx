"use client";

import axios from "axios";
import {
  Check,
  ChevronDown,
  Copy,
  FileText,
  Loader2,
  MessageCircleQuestion,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AppHeader } from "@/components/AppHeader";
import { LegalConsentNotice } from "@/components/legal/LegalConsentNotice";
import { Markdown } from "@/components/Markdown";
import { ReportTasteSelect } from "@/components/report/ReportTasteSelect";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ViralCTA } from "@/components/ViralCTA";
import { type UiMessage, uiMessage } from "@/i18n/ui-message";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";
import { createAuthorizationHeader } from "@/lib/auth-header";
import {
  type ContentLanguage,
  contentLanguageNames,
  fallbackSuggestions,
  toContentLanguage,
} from "@/lib/content-language";
import { defaultTitle, pageTitle } from "@/lib/metadata";
import { sanitizeErrorForLog } from "@/lib/sanitize-error";
import { useUserId } from "@/lib/useUserId";
import { cn } from "@/lib/utils";
import {
  type ParticipantResponse,
  ResponseItemCard,
  type ResponseType,
  type ResponseValue,
  useResponseLabel,
} from "./response-item";

const STREAMING_TIMEOUT_MS = 30_000;
const MAX_SUGGESTIONS = 50;
const FREE_TEXT_MAX_LENGTH = 2000;

type ParticipantErrorKey =
  | "loadResponses"
  | "sessionNotFound"
  | "noAccess"
  | "loadSession"
  | "autoReportWithDetail"
  | "autoReport"
  | "withDetail"
  | "join"
  | "freeTextRequired"
  | "submitAnswer"
  | "loadNext"
  | "reflectionWithDetail"
  | "reflection"
  | "generateReport";
type ParticipantError = UiMessage<ParticipantErrorKey>;

type Statement = {
  id: string;
  text: string;
  sessionId: string;
  orderIndex: number;
};

type IndividualReport = {
  id: string;
  participantUserId: string;
  sessionId: string;
  contentMarkdown: string;
  createdAt: string;
};

type SessionState = "NEEDS_NAME" | "ANSWERING" | "REFLECTION" | "COMPLETED";

type SessionInfo = {
  id: string;
  title: string;
  goal: string;
  context: string;
  isPublic: boolean;
  hostUserId: string;
  createdAt: string;
  updatedAt: string;
  isHost: boolean;
  isParticipant: boolean;
  language?: ContentLanguage;
};

type GoalSection = {
  id: string;
  label: string;
  value: string;
};

type ReportTaste = {
  id: "neutral" | "encouraging" | "analytical" | "casual";
  emoji: string;
};

const REPORT_TASTES: ReportTaste[] = [
  { id: "neutral", emoji: "📊" },
  { id: "encouraging", emoji: "💪" },
  { id: "analytical", emoji: "🔍" },
  { id: "casual", emoji: "😊" },
];

// Helper function to fetch suggestions with streaming
async function fetchSuggestionsStreaming(
  sessionId: string,
  statementId: string,
  authToken: string,
  onSuggestion: (suggestion: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let suggestionCount = 0;

  try {
    const response = await fetch(
      `/api/sessions/${sessionId}/statements/${statementId}/suggestions`,
      {
        headers: createAuthorizationHeader(authToken),
        signal,
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No reader available");
    }

    // タイムアウト: 一定時間以内にストリーミング完了しなければ中断
    timeoutId = setTimeout(() => {
      reader.cancel().catch(() => {});
    }, STREAMING_TIMEOUT_MS);

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            onComplete();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.suggestion) {
              // 上限チェック
              if (suggestionCount >= MAX_SUGGESTIONS) continue;
              suggestionCount++;
              onSuggestion(parsed.suggestion);
            }
          } catch (e) {
            console.warn("Failed to parse streaming data:", e);
          }
        }
      }
    }

    onComplete();
  } catch (error) {
    if (signal?.aborted) return;
    console.error("Streaming error:", sanitizeErrorForLog(error));
    onError(error as Error);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// i18n-allow: matches labels in Japanese session text; not displayed
const normalizeGoalLabel = (label: string | null) => {
  if (!label) return null;
  const normalized = label.replace(/\s/g, "");
  const lower = normalized.toLowerCase();
  if (
    normalized.includes("何のため") ||
    normalized.includes("目的") ||
    lower.includes("purpose")
  ) {
    return "purpose" as const;
  }
  if (
    normalized.includes("何の認識") ||
    normalized.includes("認識") ||
    lower.includes("focus")
  ) {
    return "focus" as const;
  }
  return null;
};

export default function SessionPage({ sessionId }: { sessionId: string }) {
  const t = useTranslations("participant");
  const tError = useTranslations("participantErrors");
  const tTaste = useTranslations("reportTastes");
  const tSessionLanguage = useTranslations("sessionLanguage");
  const locale = useLocale();
  const { userId, accessToken, isLoading: userLoading } = useUserId();
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const sessionLanguage = toContentLanguage(sessionInfo?.language);
  // Read inside the suggestion-prefetch effect without re-running it when the
  // session info arrives (the fallback only matters on a network failure).
  const sessionLanguageRef = useRef<ContentLanguage>(sessionLanguage);
  sessionLanguageRef.current = sessionLanguage;
  const [isSessionInfoLoading, setIsSessionInfoLoading] = useState(true);
  const [sessionInfoError, setSessionInfoError] =
    useState<ParticipantError | null>(null);
  const [state, setState] = useState<SessionState>("NEEDS_NAME");
  const [hasStarted, setHasStarted] = useState(false);
  const [infoOpen, setInfoOpen] = useState({ goal: true, context: false });
  const [name, setName] = useState("");
  const [currentStatement, setCurrentStatement] = useState<Statement | null>(
    null,
  );
  const [prefetchedStatement, setPrefetchedStatement] = useState<
    Statement | null | undefined
  >(undefined);
  const [remainingQuestions, setRemainingQuestions] = useState<number | null>(
    null,
  );
  const [prefetchedRemainingQuestions, setPrefetchedRemainingQuestions] =
    useState<number | null>(null);
  const [allStatements, setAllStatements] = useState<Statement[]>([]);
  const [currentStatementIndex, setCurrentStatementIndex] = useState<
    number | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [showScrollToActive, setShowScrollToActive] = useState(false);
  const [error, setError] = useState<ParticipantError | null>(null);
  const [freeTextInput, setFreeTextInput] = useState("");
  const [isSubmittingFreeText, setIsSubmittingFreeText] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [prefetchedAiSuggestions, setPrefetchedAiSuggestions] = useState<
    string[] | undefined
  >(undefined);
  const [individualReport, setIndividualReport] =
    useState<IndividualReport | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isCheckingParticipation, setIsCheckingParticipation] = useState(false);
  const [isLoadingReport, setIsLoadingReport] = useState(true);
  const [participantResponses, setParticipantResponses] = useState<
    ParticipantResponse[]
  >([]);
  const [_isLoadingResponses, setIsLoadingResponses] = useState(false);
  const [responsesError, setResponsesError] = useState<ParticipantError | null>(
    null,
  );
  const [reflectionText, setReflectionText] = useState("");
  const [isSubmittingReflection, setIsSubmittingReflection] = useState(false);
  const [reflectionSubmissionError, setReflectionSubmissionError] =
    useState<ParticipantError | null>(null);
  const [expandedDeepDiveQuestions, setExpandedDeepDiveQuestions] = useState<
    Set<string>
  >(new Set());
  const [deepDiveAnswers, setDeepDiveAnswers] = useState<
    Record<string, string>
  >({});
  const [submittedDeepDiveQuestions, setSubmittedDeepDiveQuestions] = useState<
    Set<string>
  >(new Set());
  const [submittingDeepDiveQuestion, setSubmittingDeepDiveQuestion] = useState<
    string | null
  >(null);
  const [submittedReflectionText, setSubmittedReflectionText] = useState<
    string | null
  >(null);
  const [isEditingReflection, setIsEditingReflection] = useState(false);
  const [isTasteModalOpen, setIsTasteModalOpen] = useState(false);
  const [selectedTaste, setSelectedTaste] = useState<string>("neutral");
  const [individualReportCopyStatus, setIndividualReportCopyStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const hasJustCompletedRef = useRef(false);
  // Monotonic token so a stale report generation that resolves after a newer
  // one cannot overwrite the displayed report (P2: stale overwrite).
  const reportGenSeqRef = useRef(0);
  const hasInitialResponsesRef = useRef(false);
  const previousStatementIdRef = useRef<string | null>(null);
  const pendingAnswerStatementIdsRef = useRef<Set<string>>(new Set());
  const prefetchedStatementIdRef = useRef<string | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const currentSuggestionsAbortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const freeTextSectionRef = useRef<HTMLDivElement | null>(null);
  const currentQuestionRef = useRef<HTMLDivElement | null>(null);
  const [expandedPastIds, setExpandedPastIds] = useState<Set<string>>(
    new Set(),
  );
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [deepDiveQuestions, setDeepDiveQuestions] = useState<
    { question: string; topic: string }[]
  >([]);

  const togglePastExpansion = useCallback((statementId: string) => {
    setExpandedPastIds((prev) => {
      const next = new Set(prev);
      if (next.has(statementId)) {
        next.delete(statementId);
      } else {
        next.add(statementId);
      }
      return next;
    });
  }, []);
  const sessionInfoId = sessionInfo?.id;
  const currentStatementId = currentStatement?.id ?? null;
  const totalQuestions = allStatements.length;
  const progressPercent =
    totalQuestions > 0 && remainingQuestions !== null
      ? Math.min(
          100,
          Math.max(
            0,
            ((totalQuestions - remainingQuestions) / totalQuestions) * 100,
          ),
        )
      : null;
  const sortResponsesByRecency = useCallback((items: ParticipantResponse[]) => {
    return [...items].sort((a, b) => {
      const timeDiff =
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }

      return a.orderIndex - b.orderIndex;
    });
  }, []);
  const previewStatement = useMemo(() => {
    const answeredIds = new Set(participantResponses.map((r) => r.statementId));
    if (currentStatementIndex === null || currentStatementIndex < 0) {
      return prefetchedStatement ?? null;
    }

    for (let i = currentStatementIndex + 1; i < allStatements.length; i++) {
      const candidate = allStatements[i];
      if (candidate && !answeredIds.has(candidate.id)) {
        return candidate;
      }
    }

    return prefetchedStatement ?? null;
  }, [
    allStatements,
    participantResponses,
    currentStatementIndex,
    prefetchedStatement,
  ]);

  const responsesByStatementId = useMemo(() => {
    return new Map(
      participantResponses.map((response) => [response.statementId, response]),
    );
  }, [participantResponses]);

  const orderedStatements = useMemo(() => {
    const statementMap = new Map<string, Statement>();
    const addStatement = (statement: Statement | null | undefined) => {
      if (!statement) return;
      statementMap.set(statement.id, statement);
    };

    allStatements.forEach(addStatement);
    participantResponses.forEach((response) => {
      if (!statementMap.has(response.statementId)) {
        statementMap.set(response.statementId, {
          id: response.statementId,
          text: response.statementText,
          orderIndex: response.orderIndex,
          sessionId,
        });
      }
    });
    addStatement(currentStatement);
    addStatement(previewStatement);

    return Array.from(statementMap.values()).sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
  }, [
    allStatements,
    participantResponses,
    currentStatement,
    previewStatement,
    sessionId,
  ]);

  const answeredHistory = useMemo(
    () =>
      orderedStatements.filter((statement) =>
        responsesByStatementId.has(statement.id),
      ),
    [orderedStatements, responsesByStatementId],
  );

  const activeStatementIndex = useMemo(() => {
    if (!currentStatement) return null;
    const index = orderedStatements.findIndex(
      (statement) => statement.id === currentStatement.id,
    );
    return index >= 0 ? index : null;
  }, [orderedStatements, currentStatement]);
  const currentQuestionNumber = useMemo(() => {
    if (activeStatementIndex !== null) {
      return activeStatementIndex + 1;
    }
    if (currentStatementIndex !== null) {
      return currentStatementIndex + 1;
    }
    return null;
  }, [activeStatementIndex, currentStatementIndex]);
  const shouldShowHeader =
    state === "ANSWERING" &&
    progressPercent !== null &&
    currentQuestionNumber !== null &&
    totalQuestions > 0;

  useEffect(() => {
    if (!currentStatementId) {
      setCurrentStatementIndex(null);
      return;
    }
    if (allStatements.length === 0) return;
    const index = allStatements.findIndex(
      (statement) => statement.id === currentStatementId,
    );
    setCurrentStatementIndex(index !== -1 ? index : null);
  }, [currentStatementId, allStatements]);
  const fetchParticipantResponses = useCallback(
    async (signal?: AbortSignal) => {
      if (!userId) return;
      setIsLoadingResponses(true);
      setResponsesError(null);

      try {
        const response = await axios.get(
          `/api/sessions/${sessionId}/responses`,
          {
            headers: createAuthorizationHeader(accessToken),
            signal,
          },
        );

        const items = (response.data.responses ?? []) as Array<{
          id?: string;
          statementId: string;
          statementText: string;
          orderIndex?: number;
          responseType?: ResponseType;
          value?: ResponseValue | null;
          textResponse?: string | null;
          createdAt?: string;
        }>;

        const mapped = items.map((item) => ({
          id: item.id,
          statementId: item.statementId,
          statementText: item.statementText,
          orderIndex: item.orderIndex ?? 0,
          responseType: item.responseType ?? "scale",
          value: item.value ?? null,
          textResponse: item.textResponse ?? null,
          createdAt: item.createdAt ?? new Date().toISOString(),
        }));

        setParticipantResponses(sortResponsesByRecency(mapped));
      } catch (err) {
        if (signal?.aborted) return;
        console.error(
          "Failed to fetch participant responses:",
          sanitizeErrorForLog(err),
        );
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setParticipantResponses([]);
          setResponsesError(null);
        } else {
          setResponsesError(uiMessage("loadResponses"));
        }
      } finally {
        if (!signal?.aborted) {
          setIsLoadingResponses(false);
        }
      }
    },
    [sessionId, userId, sortResponsesByRecency, accessToken],
  );
  const upsertParticipantResponse = useCallback(
    (
      statement: Statement,
      response: {
        responseType: ResponseType;
        value: ResponseValue | null;
        textResponse?: string | null;
      },
    ) => {
      setParticipantResponses((prev) => {
        const existing = prev.find((item) => item.statementId === statement.id);
        const nextResponse: ParticipantResponse = {
          id: existing?.id,
          statementId: statement.id,
          statementText: statement.text,
          orderIndex: statement.orderIndex,
          responseType: response.responseType,
          value: response.value,
          textResponse: response.textResponse ?? null,
          createdAt: new Date().toISOString(), // Always update timestamp for sorting
        };

        if (existing) {
          // Update existing response - put it at the beginning (most recent)
          const filtered = prev.filter(
            (item) => item.statementId !== statement.id,
          );
          return [nextResponse, ...filtered];
        }

        // Add new response at the beginning (most recent)
        return [nextResponse, ...prev];
      });
    },
    [], // No dependencies - stable function
  );

  const revertParticipantResponse = useCallback(
    (statementId: string, previous: ParticipantResponse | null) => {
      setParticipantResponses((prev) => {
        if (previous) {
          const exists = prev.some((item) => item.statementId === statementId);
          if (exists) {
            // Replace existing with previous version
            return prev.map((item) =>
              item.statementId === statementId ? previous : item,
            );
          }
          // Add back the previous response
          return [previous, ...prev];
        }
        // Remove the response
        return prev.filter((item) => item.statementId !== statementId);
      });
    },
    [], // No dependencies - stable function
  );

  const syncParticipantResponseFromServer = useCallback(
    (payload: {
      id: string;
      statementId: string;
      value: number | null;
      responseType: ResponseType;
      textResponse?: string | null;
      statementText?: string;
      orderIndex?: number;
      createdAt: string;
    }) => {
      setParticipantResponses((prev) => {
        const existingIndex = prev.findIndex(
          (item) => item.statementId === payload.statementId,
        );

        if (existingIndex === -1) return prev;

        const existing = prev[existingIndex];
        if (!existing) return prev;

        const updated = {
          ...existing,
          id: payload.id,
          value: payload.value as ResponseValue | null,
          responseType: payload.responseType,
          textResponse: payload.textResponse ?? existing.textResponse,
          statementText: payload.statementText ?? existing.statementText ?? "",
          orderIndex: payload.orderIndex ?? existing.orderIndex ?? 0,
          createdAt: payload.createdAt,
        };

        // Move to front if timestamp changed (indicates new update)
        if (payload.createdAt !== existing.createdAt) {
          const filtered = prev.filter((_, i) => i !== existingIndex);
          return [updated, ...filtered];
        }

        // Just update in place if timestamp same
        const newArray = [...prev];
        newArray[existingIndex] = updated;
        return newArray;
      });
    },
    [], // No dependencies - stable function
  );

  const buildExcludeQuery = useCallback(
    (additionalIds: string[] = []) => {
      const ids = new Set<string>(additionalIds.filter(Boolean));

      if (currentStatement) {
        ids.add(currentStatement.id);
      }

      pendingAnswerStatementIdsRef.current.forEach((id) => {
        ids.add(id);
      });

      if (ids.size === 0) {
        return "";
      }

      const query = Array.from(ids)
        .map((id) => `excludeStatementId=${encodeURIComponent(id)}`)
        .join("&");

      return `?${query}`;
    },
    [currentStatement],
  );

  const enterReflectionMode = useCallback(() => {
    setReflectionSubmissionError(null);
    setReflectionText("");
    setCurrentStatement(null);
    setPrefetchedStatement(undefined);
    setRemainingQuestions(0);
    setPrefetchedRemainingQuestions(null);
    setAiSuggestions([]);
    setIsLoadingSuggestions(false);
    setPrefetchedAiSuggestions(undefined);
    hasJustCompletedRef.current = true;
    setState("REFLECTION");
  }, []);

  const enterCompletedState = useCallback(() => {
    hasJustCompletedRef.current = true;
    setState("COMPLETED");
    setCurrentStatement(null);
    setPrefetchedStatement(undefined);
    setRemainingQuestions(0);
    setPrefetchedRemainingQuestions(null);
    setAiSuggestions([]);
    setIsLoadingSuggestions(false);
    setPrefetchedAiSuggestions(undefined);
  }, []);

  useEffect(() => {
    if (!userId || userLoading) return;

    const controller = new AbortController();

    const fetchSessionInfo = async () => {
      setIsSessionInfoLoading(true);
      try {
        const response = await axios.get(`/api/sessions/${sessionId}`, {
          headers: createAuthorizationHeader(accessToken),
          signal: controller.signal,
        });
        setSessionInfo(response.data.session ?? null);
        setSessionInfoError(null);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        console.error(
          "Failed to fetch session info:",
          sanitizeErrorForLog(err),
        );
        setSessionInfo(null);
        if (axios.isAxiosError(err)) {
          if (err.response?.status === 404) {
            setSessionInfoError(uiMessage("sessionNotFound"));
          } else if (err.response?.status === 403) {
            setSessionInfoError(uiMessage("noAccess"));
          } else {
            setSessionInfoError(uiMessage("loadSession"));
          }
        } else {
          setSessionInfoError(uiMessage("loadSession"));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSessionInfoLoading(false);
        }
      }
    };

    fetchSessionInfo();

    return () => controller.abort();
  }, [userId, userLoading, sessionId, accessToken]);

  useEffect(() => {
    if (!userId || userLoading) return;
    if (isSessionInfoLoading) return;
    if (sessionInfoError) return;
    if (!sessionInfoId) return;
    if (state !== "NEEDS_NAME") return;

    const controller = new AbortController();

    // Check if already participating
    const checkParticipation = async () => {
      setIsCheckingParticipation(true);
      try {
        const [nextResp, responsesResp] = await Promise.all([
          axios.get(`/api/sessions/${sessionId}/statements/next`, {
            headers: createAuthorizationHeader(accessToken),
            signal: controller.signal,
          }),
          axios
            .get(`/api/sessions/${sessionId}/responses`, {
              headers: createAuthorizationHeader(accessToken),
              signal: controller.signal,
            })
            .catch((err) => {
              const expectedMissingParticipant =
                axios.isAxiosError(err) && err.response?.status === 404;
              if (
                !expectedMissingParticipant &&
                !axios.isCancel(err) &&
                !controller.signal.aborted
              ) {
                console.error(
                  "Failed to load initial responses:",
                  sanitizeErrorForLog(err),
                );
              }
              return {
                data: { responses: [], _failed: true } as {
                  responses: unknown[];
                  _failed: boolean;
                },
              };
            }),
        ]);

        if (controller.signal.aborted) return;

        const responsesData = responsesResp.data as {
          responses?: Array<{
            id?: string;
            statementId: string;
            statementText: string;
            orderIndex?: number;
            responseType?: ResponseType;
            value?: ResponseValue | null;
            textResponse?: string | null;
            createdAt?: string;
          }>;
          _failed?: boolean;
        };
        const initialResponsesFailed = responsesData._failed === true;

        const mappedResponses = (responsesData.responses ?? []).map((item) => ({
          id: item.id,
          statementId: item.statementId,
          statementText: item.statementText,
          orderIndex: item.orderIndex ?? 0,
          responseType: item.responseType ?? "scale",
          value: item.value ?? null,
          textResponse: item.textResponse ?? null,
          createdAt: item.createdAt ?? new Date().toISOString(),
        }));
        setParticipantResponses(sortResponsesByRecency(mappedResponses));

        // 成功時のみ ref を立てる。失敗時は後続 useEffect で再試行。
        if (!initialResponsesFailed) {
          hasInitialResponsesRef.current = true;
        }

        if (nextResp.data.statement) {
          setCurrentStatement(nextResp.data.statement);
          setRemainingQuestions(nextResp.data.remainingCount ?? null);
          if (nextResp.data.allStatements) {
            setAllStatements(nextResp.data.allStatements);
            const index = nextResp.data.allStatements.findIndex(
              (s: Statement) => s.id === nextResp.data.statement.id,
            );
            setCurrentStatementIndex(index !== -1 ? index : null);
          }
          setSessionInfo((prev) =>
            prev ? { ...prev, isParticipant: true } : prev,
          );
          setState("ANSWERING");
        } else {
          setRemainingQuestions(nextResp.data.remainingCount ?? 0);
          setSessionInfo((prev) =>
            prev ? { ...prev, isParticipant: true } : prev,
          );
          setState("COMPLETED");
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        // If error is 401, user hasn't joined yet
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          setState("NEEDS_NAME");
          setSessionInfo((prev) =>
            prev ? { ...prev, isParticipant: false } : prev,
          );
        } else {
          setState("NEEDS_NAME");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsCheckingParticipation(false);
        }
      }
    };

    checkParticipation();

    return () => controller.abort();
  }, [
    userId,
    userLoading,
    sessionId,
    sessionInfoId,
    isSessionInfoLoading,
    sessionInfoError,
    state,
    accessToken,
    sortResponsesByRecency,
  ]);

  // Reset UI state when statement changes
  useEffect(() => {
    if (currentStatement) {
      setShowAlternatives(false);
      setFreeTextInput("");
    }
  }, [currentStatement]);

  // Prefetch next statement and AI suggestions when current statement is displayed
  useEffect(() => {
    if (!userId || userLoading) return;
    if (state !== "ANSWERING") return;
    if (!currentStatement) return;

    // Abort any in-flight streaming from previous statement
    currentSuggestionsAbortRef.current?.abort("statement changed");
    prefetchAbortRef.current?.abort("statement changed");

    // Check if this statement came from prefetch
    const isFromPrefetch =
      prefetchedStatementIdRef.current === currentStatement.id;

    if (isFromPrefetch) {
      // This statement came from prefetch, suggestions are already set
      // Reset the ref for next time
      prefetchedStatementIdRef.current = null;
    } else {
      // This is a fresh statement (e.g., first load, or fallback path)
      // Need to fetch suggestions for current statement
      setAiSuggestions([]);
      setIsLoadingSuggestions(true);

      const currentAbort = new AbortController();
      currentSuggestionsAbortRef.current = currentAbort;

      const prefetchCurrentSuggestions = async () => {
        const suggestions: string[] = [];

        await fetchSuggestionsStreaming(
          sessionId,
          currentStatement.id,
          accessToken ?? userId,
          (suggestion) => {
            if (currentAbort.signal.aborted) return;
            suggestions.push(suggestion);
            setAiSuggestions([...suggestions]);
          },
          () => {
            if (currentAbort.signal.aborted) return;
            setIsLoadingSuggestions(false);
          },
          (err) => {
            if (currentAbort.signal.aborted) return;
            console.error(
              "Failed to fetch AI suggestions:",
              sanitizeErrorForLog(err),
            );
            setAiSuggestions([
              ...fallbackSuggestions[sessionLanguageRef.current],
            ]);
            setIsLoadingSuggestions(false);
          },
          currentAbort.signal,
        );
      };

      prefetchCurrentSuggestions();
    }

    // Always reset prefetch state and prefetch next statement
    setPrefetchedStatement(undefined);
    setPrefetchedRemainingQuestions(null);
    setPrefetchedAiSuggestions(undefined);

    const nextAbort = new AbortController();
    prefetchAbortRef.current = nextAbort;

    const prefetchNextStatementAndSuggestions = async () => {
      try {
        const excludeQuery = buildExcludeQuery();
        const response = await axios.get(
          `/api/sessions/${sessionId}/statements/next${excludeQuery}`,
          {
            headers: createAuthorizationHeader(accessToken),
            signal: nextAbort.signal,
          },
        );

        if (nextAbort.signal.aborted) return;

        if (response.data.statement) {
          const nextStatement = response.data.statement;
          setPrefetchedStatement(nextStatement);
          setPrefetchedRemainingQuestions(response.data.remainingCount ?? null);

          // Prefetch suggestions for the next statement with streaming
          const prefetchedSuggestions: string[] = [];

          fetchSuggestionsStreaming(
            sessionId,
            nextStatement.id,
            accessToken ?? userId,
            (suggestion) => {
              if (nextAbort.signal.aborted) return;
              prefetchedSuggestions.push(suggestion);
              setPrefetchedAiSuggestions([...prefetchedSuggestions]);
            },
            () => {
              // Streaming complete
            },
            (err) => {
              if (nextAbort.signal.aborted) return;
              console.error(
                "Failed to prefetch AI suggestions for next statement:",
                err,
              );
              setPrefetchedAiSuggestions([
                ...fallbackSuggestions[sessionLanguageRef.current],
              ]);
            },
            nextAbort.signal,
          ).catch((err) => {
            if (nextAbort.signal.aborted) return;
            console.error(
              "Prefetch streaming error:",
              sanitizeErrorForLog(err),
            );
          });
        } else {
          // null means this is the last question
          setPrefetchedStatement(null);
          setPrefetchedRemainingQuestions(0);
          setPrefetchedAiSuggestions(undefined);
        }
      } catch (err) {
        if (nextAbort.signal.aborted) return;
        console.error("Prefetch failed:", sanitizeErrorForLog(err));
        setPrefetchedStatement(undefined);
        setPrefetchedRemainingQuestions(null);
        setPrefetchedAiSuggestions(undefined);
      }
    };

    prefetchNextStatementAndSuggestions();

    return () => {
      currentSuggestionsAbortRef.current?.abort("cleanup");
      prefetchAbortRef.current?.abort("cleanup");
    };
  }, [
    userId,
    userLoading,
    sessionId,
    currentStatement,
    state,
    buildExcludeQuery,
    accessToken,
  ]);

  useEffect(() => {
    if (!userId || userLoading) return;
    if (state === "NEEDS_NAME") return;

    const fetchIndividualReport = async () => {
      setIsLoadingReport(true);
      try {
        const response = await axios.get(
          `/api/sessions/${sessionId}/individual-report`,
          { headers: createAuthorizationHeader(accessToken) },
        );
        setIndividualReport(response.data.report);
        setDeepDiveQuestions(response.data.deepDiveQuestions ?? []);
      } catch (err) {
        if (axios.isAxiosError(err)) {
          // 403 means not a participant; 404 is handled as no report yet.
          if (err.response?.status === 403) {
            setIndividualReport(null);
            return;
          }
          if (err.response?.status === 404) {
            setIndividualReport(null);
            return;
          }
        }
        console.error(
          "Failed to fetch individual report:",
          sanitizeErrorForLog(err),
        );
      } finally {
        setIsLoadingReport(false);
      }
    };

    fetchIndividualReport();
  }, [userId, userLoading, sessionId, state, accessToken]);

  // 初回のみ: paint 前に同期スクロール (instant)
  useLayoutEffect(() => {
    if (state !== "ANSWERING" || !currentStatementId) return;
    if (previousStatementIdRef.current !== null) return;
    if (!currentQuestionRef.current) return;
    previousStatementIdRef.current = currentStatementId;
    currentQuestionRef.current.scrollIntoView({ block: "center" });
  }, [state, currentStatementId]);

  // 2回目以降: smooth スクロール
  useEffect(() => {
    if (state !== "ANSWERING" || !currentStatementId) return;
    if (previousStatementIdRef.current === currentStatementId) return;
    if (!currentQuestionRef.current) return;
    previousStatementIdRef.current = currentStatementId;

    let finishTimeout: number | null = null;
    const startTimeout = window.setTimeout(() => {
      setIsAutoScrolling(true);
      setShowScrollToActive(false);
      currentQuestionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      finishTimeout = window.setTimeout(() => {
        setIsAutoScrolling(false);
      }, 800);
    }, 150);

    return () => {
      window.clearTimeout(startTimeout);
      if (finishTimeout) {
        window.clearTimeout(finishTimeout);
      }
    };
  }, [currentStatementId, state]);

  useEffect(() => {
    if (state !== "ANSWERING") return;
    if (!currentStatementId) return;
    if (!currentQuestionRef.current) return;

    const target = currentQuestionRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!isAutoScrolling) {
          setShowScrollToActive(!entry.isIntersecting);
        }
      },
      {
        root: null,
        threshold: 0.2,
        rootMargin: "0px",
      },
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [currentStatementId, state, isAutoScrolling]);

  useEffect(() => {
    if (!userId || userLoading) return;
    if (state === "NEEDS_NAME") return;
    if (hasInitialResponsesRef.current) {
      // checkParticipation が初回フェッチ済み
      return;
    }
    hasInitialResponsesRef.current = true;
    fetchParticipantResponses();
  }, [userId, userLoading, state, fetchParticipantResponses]);

  // Auto-generate report when all questions are answered (even before reflection submission)
  useEffect(() => {
    if (!userId || userLoading) return;
    if (state !== "COMPLETED" && state !== "REFLECTION") return;

    // Only auto-generate if we just transitioned out of answering (not on page reload)
    if (!hasJustCompletedRef.current) return;

    // Wait for initial report fetch to complete to avoid race condition
    if (isLoadingReport) return;

    // Reset the flag after using it
    hasJustCompletedRef.current = false;

    // Automatically generate/update report when user completes all questions
    const autoGenerateReport = async () => {
      setIsGeneratingReport(true);
      setError(null);

      try {
        reportGenSeqRef.current += 1;
        const seq = reportGenSeqRef.current;
        const response = await axios.post(
          `/api/sessions/${sessionId}/individual-report`,
          {},
          { headers: createAuthorizationHeader(accessToken) },
        );

        // Latest-wins: ignore a stale generation superseded by a newer one.
        if (seq === reportGenSeqRef.current) {
          setIndividualReport(response.data.report);
          setDeepDiveQuestions(response.data.deepDiveQuestions ?? []);
        }
      } catch (err) {
        console.error(
          "Failed to auto-generate report:",
          sanitizeErrorForLog(err),
        );
        // Show error to user so they know auto-generation failed
        if (axios.isAxiosError(err) && err.response?.data?.error) {
          setError(
            uiMessage("autoReportWithDetail", {
              detail: err.response.data.error,
            }),
          );
        } else {
          setError(uiMessage("autoReport"));
        }
      } finally {
        setIsGeneratingReport(false);
      }
    };

    autoGenerateReport();
  }, [userId, userLoading, sessionId, state, isLoadingReport, accessToken]);

  const handleJoinSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    setIsLoading(true);
    setError(null);

    try {
      await axios.post(
        `/api/sessions/${sessionId}/participants`,
        { name },
        { headers: createAuthorizationHeader(accessToken) },
      );

      // Fetch first statement
      const response = await axios.get(
        `/api/sessions/${sessionId}/statements/next`,
        { headers: createAuthorizationHeader(accessToken) },
      );

      if (response.data.statement) {
        setCurrentStatement(response.data.statement);
        setState("ANSWERING");
        setRemainingQuestions(response.data.remainingCount ?? null);

        // Store all statements for timeline view
        if (response.data.allStatements) {
          setAllStatements(response.data.allStatements);
          // Find current statement index
          const index = response.data.allStatements.findIndex(
            (s: Statement) => s.id === response.data.statement.id,
          );
          setCurrentStatementIndex(index !== -1 ? index : null);
        }
      } else {
        // Set flag to trigger auto-generation (edge case: no questions in session)
        hasJustCompletedRef.current = true;
        setState("COMPLETED");
        setRemainingQuestions(0);
      }
      trackEvent(ANALYTICS_EVENTS.PARTICIPANT_JOINED, { sessionId });
      setSessionInfo((prev) =>
        prev ? { ...prev, isParticipant: true } : prev,
      );
    } catch (err) {
      console.error("Failed to join session:", sanitizeErrorForLog(err));
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(uiMessage("withDetail", { detail: err.response.data.error }));
      } else {
        setError(uiMessage("join"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitResponse = async (payload: {
    responseType: ResponseType;
    value?: ResponseValue;
    textResponse?: string;
  }) => {
    if (!userId || !currentStatement || isLoading) return;
    if (
      payload.responseType === "free_text" &&
      (!payload.textResponse || payload.textResponse.trim().length === 0)
    ) {
      setError(uiMessage("freeTextRequired"));
      return;
    }
    if (payload.responseType === "free_text") {
      setIsSubmittingFreeText(true);
    }

    const previousStatement = currentStatement;
    const cachedNextStatement = prefetchedStatement;
    const previousResponse = participantResponses.find(
      (item) => item.statementId === previousStatement.id,
    );
    const previousResponseSnapshot = previousResponse
      ? { ...previousResponse }
      : null;

    setError(null);
    upsertParticipantResponse(previousStatement, {
      responseType: payload.responseType,
      value: payload.responseType === "scale" ? (payload.value ?? null) : null,
      textResponse:
        payload.responseType === "free_text"
          ? (payload.textResponse ?? "")
          : null,
    });
    trackEvent(ANALYTICS_EVENTS.RESPONSE_SUBMITTED, {
      sessionId,
      responseType: payload.responseType,
    });
    pendingAnswerStatementIdsRef.current.add(previousStatement.id);
    const clearPendingStatement = () => {
      pendingAnswerStatementIdsRef.current.delete(previousStatement.id);
    };
    const revertOnFailure = () => {
      revertParticipantResponse(previousStatement.id, previousResponseSnapshot);
    };

    const headers = createAuthorizationHeader(accessToken);

    try {
      if (cachedNextStatement === null) {
        setIsLoading(true);

        const postResult = await axios.post(
          `/api/sessions/${sessionId}/responses`,
          {
            statementId: previousStatement.id,
            value: payload.value,
            responseType: payload.responseType,
            textResponse: payload.textResponse,
          },
          { headers },
        );

        const serverResponse = postResult.data?.response;
        if (serverResponse) {
          syncParticipantResponseFromServer(serverResponse);
        }

        clearPendingStatement();

        enterReflectionMode();
        if (payload.responseType === "free_text") {
          setFreeTextInput("");
        }

        setIsLoading(false);
        return;
      }

      if (cachedNextStatement) {
        // Batch all state updates together for performance
        const hasPrefetchedSuggestions = prefetchedAiSuggestions !== undefined;

        if (hasPrefetchedSuggestions) {
          prefetchedStatementIdRef.current = cachedNextStatement.id;
        }

        // Single batched state update
        setCurrentStatement(cachedNextStatement);
        setPrefetchedStatement(undefined);
        setRemainingQuestions(prefetchedRemainingQuestions ?? null);
        setPrefetchedRemainingQuestions(null);
        setAiSuggestions(
          hasPrefetchedSuggestions ? prefetchedAiSuggestions : [],
        );
        setIsLoadingSuggestions(!hasPrefetchedSuggestions);
        setPrefetchedAiSuggestions(undefined);

        axios
          .post(
            `/api/sessions/${sessionId}/responses`,
            {
              statementId: previousStatement.id,
              value: payload.value,
              responseType: payload.responseType,
              textResponse: payload.textResponse,
            },
            { headers },
          )
          .then((res) => {
            const serverResponse = res.data?.response;
            if (serverResponse) {
              syncParticipantResponseFromServer(serverResponse);
            }
          })
          .catch((err) => {
            console.error("Failed to submit answer:", sanitizeErrorForLog(err));
            revertOnFailure();
            // Don't show error message for background submission
          })
          .finally(() => {
            clearPendingStatement();
          });
        if (payload.responseType === "free_text") {
          setFreeTextInput("");
        }
        return;
      }

      setIsLoading(true);

      const [postResult, nextResult] = await Promise.allSettled([
        axios.post(
          `/api/sessions/${sessionId}/responses`,
          {
            statementId: previousStatement.id,
            value: payload.value,
            responseType: payload.responseType,
            textResponse: payload.textResponse,
          },
          { headers },
        ),
        axios.get(
          `/api/sessions/${sessionId}/statements/next${buildExcludeQuery([previousStatement.id])}`,
          { headers },
        ),
      ]);

      clearPendingStatement();

      // 回答送信の結果を処理
      if (postResult.status === "fulfilled") {
        const serverResponse = postResult.value.data?.response;
        if (serverResponse) {
          syncParticipantResponseFromServer(serverResponse);
        }
      } else {
        console.error(
          "Failed to submit answer:",
          sanitizeErrorForLog(postResult.reason),
        );
        revertOnFailure();
        const err = postResult.reason;
        if (axios.isAxiosError(err) && err.response?.data?.error) {
          setError(
            uiMessage("withDetail", { detail: err.response.data.error }),
          );
        } else {
          setError(uiMessage("submitAnswer"));
        }
        setIsLoading(false);
        if (payload.responseType === "free_text") {
          setFreeTextInput("");
        }
        return;
      }

      // 次の質問取得の結果を処理
      if (nextResult.status === "fulfilled") {
        const nextStatement = nextResult.value.data?.statement ?? null;
        const remainingCount = nextResult.value.data?.remainingCount ?? null;

        if (nextStatement) {
          setCurrentStatement(nextStatement);
          setRemainingQuestions(remainingCount);
          setAiSuggestions([]);
          setIsLoadingSuggestions(true);
          setPrefetchedAiSuggestions(undefined);

          if (nextResult.value.data?.allStatements) {
            setAllStatements(nextResult.value.data.allStatements);
            const index = nextResult.value.data.allStatements.findIndex(
              (s: Statement) => s.id === nextStatement.id,
            );
            setCurrentStatementIndex(index !== -1 ? index : null);
          }
        } else {
          enterReflectionMode();
        }
      } else {
        console.error(
          "Failed to fetch next statement:",
          sanitizeErrorForLog(nextResult.reason),
        );
        setError(uiMessage("loadNext"));
      }

      setIsLoading(false);
      if (payload.responseType === "free_text") {
        setFreeTextInput("");
      }
    } catch (err) {
      clearPendingStatement();
      console.error("Failed to submit answer:", sanitizeErrorForLog(err));
      revertOnFailure();
      setError(uiMessage("submitAnswer"));
      setIsLoading(false);
    } finally {
      if (payload.responseType === "free_text") {
        setIsSubmittingFreeText(false);
      }
    }
  };

  const handleAnswer = async (value: ResponseValue) => {
    if (value === 0) {
      setShowAlternatives((prev) => !prev);
      return;
    }
    return handleSubmitResponse({ responseType: "scale", value });
  };

  const handleSuggestionClick = async (suggestion: string) => {
    return handleSubmitResponse({
      responseType: "free_text",
      textResponse: suggestion,
    });
  };

  const scrollToActive = () => {
    if (!currentQuestionRef.current) return;
    setIsAutoScrolling(true);
    setShowScrollToActive(false);
    currentQuestionRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    window.setTimeout(() => {
      setIsAutoScrolling(false);
    }, 1000);
  };

  const handleSubmitReflection = async (overrideText?: string) => {
    if (!userId || isSubmittingReflection) return;

    setIsSubmittingReflection(true);
    setReflectionSubmissionError(null);

    const submissionText = (overrideText ?? reflectionText).trim();

    try {
      // Only persist a reflection when there is content. The empty "skip" path
      // still needs the /statements/next re-poll below to advance, but must not
      // create empty participant_reflections rows (P3).
      if (submissionText.length > 0) {
        await axios.post(
          `/api/sessions/${sessionId}/reflections`,
          { text: submissionText },
          { headers: createAuthorizationHeader(accessToken) },
        );
      }

      if (submissionText.length > 0) {
        setSubmittedReflectionText(submissionText);
        setIsEditingReflection(false);
      }
      setReflectionText("");
      setIsLoading(true);

      try {
        const nextStatementResponse = await axios.get(
          `/api/sessions/${sessionId}/statements/next`,
          { headers: createAuthorizationHeader(accessToken) },
        );
        const statement = nextStatementResponse.data?.statement ?? null;
        const nextRemainingCount =
          nextStatementResponse.data?.remainingCount ?? null;

        if (statement) {
          // Batch all state updates together
          setCurrentStatement(statement);
          setPrefetchedStatement(undefined);
          setState("ANSWERING");
          setRemainingQuestions(nextRemainingCount);
          setAiSuggestions([]);
          setIsLoadingSuggestions(true);
          setPrefetchedAiSuggestions(undefined);
        } else {
          enterCompletedState();
        }
      } catch (err) {
        console.error(
          "Failed to fetch next statement after reflection:",
          sanitizeErrorForLog(err),
        );
        setError(uiMessage("loadNext"));
      } finally {
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Failed to submit reflection:", sanitizeErrorForLog(err));
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setReflectionSubmissionError(
          uiMessage("reflectionWithDetail", {
            detail: err.response.data.error,
          }),
        );
      } else {
        setReflectionSubmissionError(uiMessage("reflection"));
      }
    } finally {
      setIsSubmittingReflection(false);
    }
  };

  const handleSubmitDeepDiveAnswer = async (question: string) => {
    if (!userId || submittingDeepDiveQuestion) return;
    const answer = (deepDiveAnswers[question] ?? "").trim();
    if (!answer) return;

    setSubmittingDeepDiveQuestion(question);
    try {
      await axios.post(
        `/api/sessions/${sessionId}/reflections`,
        { text: `${question}\n\n${answer}` },
        { headers: createAuthorizationHeader(accessToken) },
      );
      setSubmittedDeepDiveQuestions((prev) => new Set([...prev, question]));
      setExpandedDeepDiveQuestions((prev) => {
        const next = new Set(prev);
        next.delete(question);
        return next;
      });
    } catch (err) {
      console.error(
        "Failed to submit deep dive answer:",
        sanitizeErrorForLog(err),
      );
    } finally {
      setSubmittingDeepDiveQuestion(null);
    }
  };

  const handleGenerateReport = async (taste?: string) => {
    if (!userId) return;

    setIsGeneratingReport(true);
    setError(null);

    const tasteToUse = taste || selectedTaste;

    try {
      reportGenSeqRef.current += 1;
      const seq = reportGenSeqRef.current;
      const response = await axios.post(
        `/api/sessions/${sessionId}/individual-report`,
        { taste: tasteToUse },
        { headers: createAuthorizationHeader(accessToken) },
      );

      // Latest-wins: ignore a stale generation superseded by a newer one.
      if (seq === reportGenSeqRef.current) {
        setIndividualReport(response.data.report);
        setDeepDiveQuestions(response.data.deepDiveQuestions ?? []);
      }
      trackEvent(ANALYTICS_EVENTS.REPORT_GENERATED, {
        sessionId,
        type: "individual",
      });
      setIsTasteModalOpen(false);
    } catch (err) {
      console.error("Failed to generate report:", sanitizeErrorForLog(err));
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(uiMessage("withDetail", { detail: err.response.data.error }));
      } else {
        setError(uiMessage("generateReport"));
      }
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleCopyIndividualReport = async () => {
    if (!individualReport?.contentMarkdown) return;

    try {
      await navigator.clipboard.writeText(individualReport.contentMarkdown);
      trackEvent(ANALYTICS_EVENTS.REPORT_SHARED, {
        sessionId,
        type: "individual_copy",
      });
      setIndividualReportCopyStatus("copied");
      setTimeout(() => setIndividualReportCopyStatus("idle"), 2000);
    } catch (err) {
      console.error("Failed to copy report:", sanitizeErrorForLog(err));
      setIndividualReportCopyStatus("error");
      setTimeout(() => setIndividualReportCopyStatus("idle"), 2000);
    }
  };

  // Update document title when session info is available
  useEffect(() => {
    if (sessionInfo?.title) {
      document.title = pageTitle(
        t("pageTitle", { title: sessionInfo.title }),
        locale,
      );
    }
    return () => {
      document.title = defaultTitle(locale);
    };
  }, [sessionInfo?.title, t, locale]);

  const toggleInfo = useCallback((key: "goal" | "context") => {
    setInfoOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const goalSections = useMemo<GoalSection[]>(() => {
    const goal = sessionInfo?.goal?.trim();
    if (!goal) return [];

    const lines = goal
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const buckets: Record<"purpose" | "focus", string[]> = {
      purpose: [],
      focus: [],
    };
    const fallback: string[] = [];

    for (const line of lines) {
      let label: string | null = null;
      let value = line;
      const bracketMatch = line.match(/^【(.+?)】(.*)$/);
      if (bracketMatch) {
        label = bracketMatch[1]?.trim() || null;
        value = bracketMatch[2]?.trim() || "";
      } else {
        const asciiIndex = line.indexOf(":");
        // i18n-allow: parses a full-width colon in session text
        const jpIndex = line.indexOf("：");
        const colonIndex =
          asciiIndex === -1
            ? jpIndex
            : jpIndex === -1
              ? asciiIndex
              : Math.min(asciiIndex, jpIndex);
        if (colonIndex !== -1) {
          label = line.slice(0, colonIndex).trim() || null;
          value = line.slice(colonIndex + 1).trim() || "";
        }
      }

      if (!value) continue;
      const normalized = normalizeGoalLabel(label);
      if (normalized) {
        buckets[normalized].push(value);
      } else {
        fallback.push(label ? `${label} ${value}` : value);
      }
    }

    const sections: GoalSection[] = [];
    if (buckets.purpose.length > 0) {
      sections.push({
        id: "purpose",
        label: t("goalPurpose"),
        value: buckets.purpose.join("\n"),
      });
    }
    if (buckets.focus.length > 0) {
      sections.push({
        id: "focus",
        label: t("goalFocus"),
        value: buckets.focus.join("\n"),
      });
    }
    if (sections.length === 0 && fallback.length > 0) {
      sections.push({
        id: "goal",
        label: t("goalFallback"),
        value: fallback.join("\n"),
      });
    }

    return sections;
  }, [sessionInfo?.goal, t]);

  const responseLabel = useResponseLabel();
  const tasteOptions = REPORT_TASTES.map((taste) => ({
    value: taste.id,
    label: tTaste(`${taste.id}Label`),
    icon: <span className="text-base">{taste.emoji}</span>,
  }));
  const showError = (message: ParticipantError | null) =>
    message ? tError(message.key, message.values) : null;
  const sessionLanguageNotice =
    sessionInfo?.language && sessionInfo.language !== locale
      ? tSessionLanguage("conductedIn", {
          language: contentLanguageNames[sessionLanguage],
        })
      : null;

  if (userLoading || isSessionInfoLoading || isCheckingParticipation) {
    return (
      <div className="min-h-svh bg-background">
        <div className="max-w-3xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8 space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Card>
            <CardHeader>
              <Skeleton className="h-7 w-24 mb-2" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (sessionInfoError) {
    return (
      <div className="min-h-svh bg-background">
        <div className="max-w-3xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">
              {t("sessionFallbackTitle")}
            </h1>
          </div>
          <Card>
            <CardContent className="pt-6 pb-6">
              <p className="text-sm text-muted-foreground">
                {showError(sessionInfoError)}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background dark:bg-black">
      {/* Header */}
      {shouldShowHeader ? (
        <AppHeader
          sticky
          centerContent={
            <span className="text-xs font-medium text-muted-foreground">
              {t("questionProgress", {
                current: currentQuestionNumber,
                total: totalQuestions,
              })}
            </span>
          }
          belowContent={
            <Progress value={progressPercent} className="h-1 rounded-none" />
          }
        />
      ) : (
        <AppHeader />
      )}

      <div
        className={`max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 ${
          state === "ANSWERING" ? "pt-4 pb-0" : "pt-4 pb-12"
        }`}
      >
        <div className="mb-8 space-y-8">
          {state === "NEEDS_NAME" && !hasStarted && (
            <header className="space-y-4 border-b border-border pb-6">
              <div className="text-center space-y-3">
                <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight text-balance">
                  {sessionInfo?.title ?? t("sessionFallbackTitle")}
                </h1>
                {sessionLanguageNotice && (
                  <p
                    data-testid="session-language-notice"
                    className="text-sm text-muted-foreground"
                  >
                    {sessionLanguageNotice}
                  </p>
                )}
              </div>
              <div className="mx-auto w-full max-w-3xl">
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
                        infoOpen.goal ? "block" : "hidden",
                      )}
                    >
                      {goalSections.length > 0 ? (
                        <div className="space-y-3">
                          {goalSections.map((section) => (
                            <div key={section.id} className="space-y-1">
                              <p className="text-xs font-semibold text-foreground/80">
                                {section.label}
                              </p>
                              <p className="whitespace-pre-line">
                                {section.value}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        t("notSet")
                      )}
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
                        infoOpen.context ? "block" : "hidden",
                      )}
                    >
                      {sessionInfo?.context?.trim()
                        ? sessionInfo.context
                        : t("notSet")}
                    </div>
                  </div>
                  <div className="border-t border-border/70 bg-card p-4">
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => setHasStarted(true)}
                    >
                      {t("start")}
                    </Button>
                  </div>
                </div>
              </div>
            </header>
          )}
          {state === "NEEDS_NAME" && hasStarted && (
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-3">
                {sessionInfo?.title ?? t("sessionFallbackTitle")}
              </h1>
            </div>
          )}
        </div>

        {state === "NEEDS_NAME" && hasStarted && (
          <Card>
            <CardHeader>
              <CardTitle>{t("welcome")}</CardTitle>
              <CardDescription>{t("enterName")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleJoinSession} className="space-y-4">
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder={t("namePlaceholder")}
                />
                {error && (
                  <p className="text-sm text-destructive">{showError(error)}</p>
                )}
                <Button
                  type="submit"
                  disabled={isLoading}
                  isLoading={isLoading}
                  className="w-full"
                >
                  {t("join")}
                </Button>
                <LegalConsentNotice />
              </form>
            </CardContent>
          </Card>
        )}

        {state === "ANSWERING" && currentStatement && (
          <main
            ref={containerRef}
            className="relative w-full max-w-xl mx-auto min-h-svh flex flex-col items-center gap-6 pb-40"
          >
            {responsesError && (
              <div className="w-full rounded-md border border-destructive/20 bg-destructive/10 p-3">
                <p className="text-sm text-destructive">
                  {showError(responsesError)}
                </p>
              </div>
            )}

            {orderedStatements.map((statement, index) => {
              const response = responsesByStatementId.get(statement.id);
              const isActive = statement.id === currentStatement.id;
              const isPast =
                activeStatementIndex !== null && index < activeStatementIndex;
              const distance =
                activeStatementIndex !== null
                  ? index - activeStatementIndex
                  : 0;
              const isPastCollapsed =
                isPast && !expandedPastIds.has(statement.id);
              const showResumeBanner =
                isActive &&
                participantResponses.length > 0 &&
                activeStatementIndex !== null &&
                activeStatementIndex > 0;

              return (
                <Fragment key={statement.id}>
                  {showResumeBanner && (
                    <div
                      data-testid="resume-banner"
                      className="w-full rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary"
                    >
                      {t.rich("resumeBanner", {
                        answered: participantResponses.length,
                        current: currentQuestionNumber ?? "",
                        strong: (chunks) => <strong>{chunks}</strong>,
                      })}
                    </div>
                  )}
                  <ResponseItemCard
                    statement={statement}
                    phase={isActive ? "active" : isPast ? "past" : "future"}
                    distance={distance}
                    response={response}
                    isLoading={isLoading}
                    isPastCollapsed={isPastCollapsed}
                    alternativesOpen={showAlternatives}
                    itemRef={isActive ? currentQuestionRef : undefined}
                    onTogglePast={() => togglePastExpansion(statement.id)}
                    onAnswer={handleAnswer}
                    onEdit={() => {
                      if (!response) return;
                      setCurrentStatement(statement);
                      // If the response was free_text, open the alternatives section
                      const isFreeText = response.responseType === "free_text";
                      setShowAlternatives(isFreeText);

                      // Scroll to free text section after a short delay
                      if (isFreeText) {
                        requestAnimationFrame(() => {
                          setTimeout(() => {
                            freeTextSectionRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }, 300);
                        });
                      }
                    }}
                  >
                    {showAlternatives && (
                      <div className="mt-6 space-y-3">
                        <div className="space-y-4 rounded-lg border border-border/60 bg-muted/30 p-4 animate-in slide-in-from-top-2 duration-200">
                          <div className="space-y-2">
                            <p className="text-sm font-bold text-foreground">
                              {t("otherOptions")}
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                handleSubmitResponse({
                                  responseType: "scale",
                                  value: 0,
                                })
                              }
                              disabled={isLoading || isSubmittingFreeText}
                              className={cn(
                                "w-full px-4 py-3.5 text-left rounded-lg border text-sm font-semibold transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
                                response?.value === 0
                                  ? "border-amber-300 bg-card dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:border-amber-400 text-amber-700 dark:text-amber-400"
                                  : response &&
                                      response.responseType === "scale"
                                    ? "border-border bg-muted/50 hover:bg-muted hover:border-border/80 text-muted-foreground"
                                    : "border-amber-300 bg-card dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:border-amber-400 text-amber-700 dark:text-amber-400",
                              )}
                            >
                              {t("notConfident")}
                            </button>
                          </div>

                          {isLoadingSuggestions &&
                          aiSuggestions.length === 0 ? (
                            <div className="space-y-3">
                              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>{t("aiThinking")}</span>
                              </div>
                              {[1, 2, 3].map((i) => (
                                <div
                                  key={i}
                                  className="relative h-14 bg-gradient-to-r from-muted via-muted/50 to-muted rounded-lg overflow-hidden"
                                >
                                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/10 to-transparent animate-shimmer" />
                                  <div className="px-4 py-3.5 opacity-20 text-sm">
                                    {t("generatingOptions")}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="mb-2">
                                <p className="text-xs font-semibold text-foreground">
                                  {t("suggestionsTitle")}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {t("suggestionsDescription")}
                                </p>
                              </div>
                              {isLoadingSuggestions && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <span>{t("generatingRemaining")}</span>
                                </div>
                              )}
                              {aiSuggestions.map((suggestion, index) => (
                                <button
                                  key={suggestion}
                                  type="button"
                                  onClick={() =>
                                    handleSuggestionClick(suggestion)
                                  }
                                  disabled={isLoading || isSubmittingFreeText}
                                  className="w-full px-4 py-3.5 text-left rounded-lg border border-border bg-card hover:bg-accent hover:border-primary/30 text-sm text-foreground transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed animate-fade-in"
                                  style={{
                                    animationDelay: `${index * 100}ms`,
                                  }}
                                >
                                  {suggestion}
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="pt-3 border-t border-border/60 space-y-3">
                            <div ref={freeTextSectionRef} />
                            <div>
                              <p className="text-sm font-bold text-foreground mb-1">
                                {t("freeTextTitle")}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {t("freeTextHelp")}
                              </p>
                            </div>
                            <Textarea
                              value={freeTextInput}
                              onChange={(event) =>
                                setFreeTextInput(
                                  event.target.value.slice(
                                    0,
                                    FREE_TEXT_MAX_LENGTH,
                                  ),
                                )
                              }
                              rows={4}
                              autoResize
                              maxLength={FREE_TEXT_MAX_LENGTH}
                              placeholder={t("freeTextPlaceholder")}
                              disabled={isLoading || isSubmittingFreeText}
                            />
                            {freeTextInput.length >
                              FREE_TEXT_MAX_LENGTH * 0.8 && (
                              <p className="text-xs text-muted-foreground text-right">
                                {freeTextInput.length} / {FREE_TEXT_MAX_LENGTH}
                              </p>
                            )}
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                  handleSubmitResponse({
                                    responseType: "free_text",
                                    textResponse: freeTextInput,
                                  })
                                }
                                disabled={
                                  isLoading ||
                                  isSubmittingFreeText ||
                                  freeTextInput.trim().length === 0
                                }
                                isLoading={isSubmittingFreeText}
                              >
                                {t("submitFreeText")}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {error && (
                      <p className="text-sm text-destructive mt-4">
                        {showError(error)}
                      </p>
                    )}
                  </ResponseItemCard>
                </Fragment>
              );
            })}

            <div className="h-40 flex items-start justify-center pt-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  {t("noMoreQuestions")}
                </p>
              </div>
            </div>
          </main>
        )}

        {state === "ANSWERING" && (
          <div
            className={cn(
              "fixed bottom-[calc(1.5rem+var(--safe-bottom))] right-[calc(1.5rem+var(--safe-right))] z-50 transition-all duration-300",
              showScrollToActive
                ? "translate-y-0 opacity-100"
                : "translate-y-6 opacity-0 pointer-events-none",
            )}
          >
            <Button
              type="button"
              onClick={scrollToActive}
              className="rounded-full px-5 py-2.5 shadow-lg"
            >
              {t("jumpToCurrent")}
              <MessageCircleQuestion className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* 完了の祝辞 + 折りたたみ回答履歴を1枚のカードに連結 */}
        {(state === "REFLECTION" || state === "COMPLETED") && (
          <>
            {(state === "COMPLETED" || answeredHistory.length > 0) && (
              <Card data-testid="completed-card" className="overflow-hidden">
                {state === "COMPLETED" && (
                  <CardContent className="px-6 pt-8 pb-6 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="text-5xl">🎉</div>
                      <p className="text-xl font-semibold">
                        {t("completedTitle")}
                      </p>
                      <p className="max-w-sm text-sm text-muted-foreground">
                        {t("completedBody")}
                      </p>
                    </div>
                  </CardContent>
                )}
                {answeredHistory.length > 0 && (
                  <>
                    <button
                      type="button"
                      data-testid="answer-history-toggle"
                      onClick={() => setIsHistoryOpen((prev) => !prev)}
                      aria-expanded={isHistoryOpen}
                      aria-controls="answer-history-content"
                      className={cn(
                        "w-full text-left transition-colors hover:bg-muted/40",
                        state === "COMPLETED"
                          ? "border-t border-border/60"
                          : "rounded-t-xl",
                      )}
                    >
                      <CardHeader className="py-4">
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="text-base font-semibold">
                            {t("answerHistory", {
                              count: answeredHistory.length,
                            })}
                          </CardTitle>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                              isHistoryOpen && "rotate-180",
                            )}
                          />
                        </div>
                      </CardHeader>
                    </button>
                    {isHistoryOpen && (
                      <CardContent
                        id="answer-history-content"
                        className="space-y-3 pt-0"
                      >
                        {answeredHistory.map((statement) => {
                          const response = responsesByStatementId.get(
                            statement.id,
                          );
                          return (
                            <div
                              key={statement.id}
                              className="flex items-start justify-between gap-3 border-t border-border/50 pt-3 first:border-t-0 first:pt-0 dark:border-border/30"
                            >
                              <p className="flex-1 text-sm text-foreground">
                                {statement.text}
                              </p>
                              <div className="shrink-0 text-right">
                                {response?.responseType === "scale" &&
                                response.value !== null ? (
                                  <span
                                    className={cn(
                                      "inline-block rounded-full px-2 py-0.5 text-xs font-bold",
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
                                ) : response?.textResponse?.trim().length ? (
                                  <span className="inline-block max-w-[12rem] text-left text-sm text-muted-foreground line-clamp-3">
                                    {response.textResponse}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    {t("noText")}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </CardContent>
                    )}
                  </>
                )}
              </Card>
            )}
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="scroll-m-20 text-2xl font-semibold tracking-tight">
                      {t("myReport")}
                    </CardTitle>
                  </div>
                  <CardDescription className="text-muted-foreground">
                    {t("myReportDescription")}
                  </CardDescription>
                  <div className="space-y-3 rounded-xl border border-border/50 bg-muted/30 p-4">
                    <ReportTasteSelect
                      value={selectedTaste}
                      options={tasteOptions}
                      onClick={() => setIsTasteModalOpen(true)}
                      disabled={isGeneratingReport}
                    />
                    <Button
                      onClick={() => setIsTasteModalOpen(true)}
                      disabled={isGeneratingReport}
                      isLoading={isGeneratingReport}
                      className="h-12 w-full justify-center gap-3 rounded-lg text-base font-semibold shadow-sm transition-all hover:shadow-md"
                    >
                      {individualReport
                        ? t("updateReport")
                        : t("generateReport")}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {isLoadingReport && <Separator />}
              <CardContent>
                {error && (
                  <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/10 p-3">
                    <p className="text-sm text-destructive">
                      {showError(error)}
                    </p>
                  </div>
                )}
                {isGeneratingReport && (
                  <div className="mb-6 flex flex-col items-center justify-center space-y-4 border-b pb-6 pt-8">
                    <Spinner className="h-10 w-10 text-primary" />
                    <div className="space-y-2 text-center">
                      <p className="text-base font-medium text-foreground">
                        {t("generatingReport")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t("generatingReportHint")}
                      </p>
                    </div>
                  </div>
                )}
                {isLoadingReport ? (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/5" />
                    <div className="pt-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="mt-3 h-4 w-full" />
                      <Skeleton className="mt-3 h-4 w-3/4" />
                    </div>
                  </div>
                ) : individualReport ? (
                  <div className="rounded-2xl border border-border bg-card dark:bg-card p-6 shadow-sm">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-muted-foreground">
                        {t("reportBody")}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCopyIndividualReport}
                        className="gap-1.5 text-xs"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {individualReportCopyStatus === "copied"
                          ? t("copied")
                          : individualReportCopyStatus === "error"
                            ? t("copyFailed")
                            : t("copyMarkdown")}
                      </Button>
                    </div>
                    <div
                      className={cn(
                        "markdown-body prose prose-slate dark:prose-invert max-w-none",
                        "prose-headings:scroll-m-20 prose-headings:tracking-tight",
                        "prose-h1:text-4xl prose-h1:font-extrabold prose-h1:text-balance",
                        "prose-h2:border-b prose-h2:pb-2 prose-h2:text-3xl prose-h2:font-semibold prose-h2:first:mt-0",
                        "prose-h3:text-2xl prose-h3:font-semibold",
                        "prose-h4:text-xl prose-h4:font-semibold",
                        "prose-p:leading-7 prose-p:[&:not(:first-child)]:mt-6",
                        "prose-blockquote:mt-6 prose-blockquote:border-l-2 prose-blockquote:pl-6 prose-blockquote:italic",
                        "prose-code:relative prose-code:rounded prose-code:bg-muted prose-code:px-[0.3rem] prose-code:py-[0.2rem] prose-code:font-mono prose-code:text-sm prose-code:font-semibold",
                        "prose-lead:text-xl prose-lead:text-muted-foreground",
                        isGeneratingReport && "opacity-60",
                      )}
                    >
                      <Markdown>{individualReport.contentMarkdown}</Markdown>
                    </div>
                  </div>
                ) : !isGeneratingReport ? (
                  <div className="py-8 text-center">
                    <div className="mb-3 mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted dark:bg-muted/50">
                      <FileText className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("reportPending")}
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* 追加の論点・ご意見(回答完了後の画面に集約) */}
            <Card>
              <CardHeader>
                <CardTitle>{t("moreTopics")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {deepDiveQuestions.length > 0 && (
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold">
                        {t("deepDiveTitle")}
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("deepDiveHelp")}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {deepDiveQuestions.map((q) => {
                        const isExpanded = expandedDeepDiveQuestions.has(
                          q.question,
                        );
                        const isSubmitted = submittedDeepDiveQuestions.has(
                          q.question,
                        );
                        const isSubmitting =
                          submittingDeepDiveQuestion === q.question;
                        return (
                          <div
                            key={q.question}
                            className="rounded-lg border border-secondary overflow-hidden"
                          >
                            <button
                              type="button"
                              data-testid="deepdive-question"
                              onClick={() =>
                                setExpandedDeepDiveQuestions((prev) => {
                                  const next = new Set(prev);
                                  isExpanded
                                    ? next.delete(q.question)
                                    : next.add(q.question);
                                  return next;
                                })
                              }
                              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors bg-secondary/40 hover:bg-secondary/70"
                            >
                              <MessageCircleQuestion className="h-4 w-4 shrink-0 text-secondary-foreground/50" />
                              <span
                                className={cn(
                                  "flex-1 text-secondary-foreground",
                                  isSubmitted &&
                                    "text-secondary-foreground/50 line-through",
                                )}
                              >
                                {q.question}
                              </span>
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 shrink-0 text-secondary-foreground/50 transition-transform",
                                  isExpanded && "rotate-180",
                                )}
                              />
                            </button>
                            {isExpanded && (
                              <div className="border-t border-secondary bg-secondary/20 px-4 pb-4 pt-3 space-y-3">
                                <Textarea
                                  value={deepDiveAnswers[q.question] ?? ""}
                                  onChange={(e) =>
                                    setDeepDiveAnswers((prev) => ({
                                      ...prev,
                                      [q.question]: e.target.value,
                                    }))
                                  }
                                  rows={3}
                                  autoResize
                                  placeholder={t("deepDivePlaceholder")}
                                  disabled={isSubmitting}
                                />
                                <div className="flex justify-end">
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => {
                                      void handleSubmitDeepDiveAnswer(
                                        q.question,
                                      );
                                    }}
                                    disabled={
                                      isSubmitting ||
                                      !(
                                        deepDiveAnswers[q.question] ?? ""
                                      ).trim()
                                    }
                                    isLoading={isSubmitting}
                                  >
                                    {isSubmitted ? t("update") : t("send")}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <Separator />

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold">
                    {t("freeTextHeading")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t("reflectionHelp")}
                  </p>
                  {submittedReflectionText && !isEditingReflection ? (
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <p className="whitespace-pre-wrap text-sm">
                            {submittedReflectionText}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-xs"
                          onClick={() => {
                            setIsEditingReflection(true);
                            setReflectionText(submittedReflectionText);
                          }}
                        >
                          {t("editReflection")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Textarea
                        data-testid="reflection-textarea"
                        value={reflectionText}
                        onChange={(event) =>
                          setReflectionText(event.target.value)
                        }
                        rows={6}
                        autoResize
                        placeholder={t("reflectionPlaceholder")}
                        disabled={isSubmittingReflection}
                      />
                      {reflectionSubmissionError && (
                        <p className="text-sm text-destructive">
                          {showError(reflectionSubmissionError)}
                        </p>
                      )}
                      <div className="flex justify-end gap-3">
                        {isEditingReflection ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isSubmittingReflection}
                            onClick={() => {
                              setIsEditingReflection(false);
                              setReflectionText("");
                            }}
                          >
                            {t("cancel")}
                          </Button>
                        ) : (
                          state !== "COMPLETED" && (
                            <Button
                              type="button"
                              variant="outline"
                              disabled={isSubmittingReflection}
                              data-testid="skip-reflection"
                              onClick={() => {
                                void handleSubmitReflection("");
                              }}
                            >
                              {t("skipReflection")}
                            </Button>
                          )
                        )}
                        <Button
                          type="button"
                          onClick={() => {
                            void handleSubmitReflection();
                          }}
                          disabled={isSubmittingReflection}
                          isLoading={isSubmittingReflection}
                          data-testid="submit-reflection"
                        >
                          {isEditingReflection
                            ? t("update")
                            : state === "COMPLETED"
                              ? t("send")
                              : t("sendAndContinue")}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            <ViralCTA />

            {/* Taste Selection Modal */}
            <AlertDialog
              open={isTasteModalOpen}
              onOpenChange={setIsTasteModalOpen}
            >
              <AlertDialogContent className="max-w-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-2xl">
                    {t("chooseTaste")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("chooseTasteHelp")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="grid gap-3 py-4">
                  {REPORT_TASTES.map((taste) => (
                    <button
                      key={taste.id}
                      type="button"
                      onClick={() => {
                        setSelectedTaste(taste.id);
                      }}
                      disabled={isGeneratingReport}
                      className={cn(
                        "group relative flex items-start gap-4 rounded-lg border-2 p-4 text-left transition-colors shadow-sm hover:border-primary/40 hover:bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed",
                        selectedTaste === taste.id
                          ? "border-primary/70 bg-primary/10 shadow-md"
                          : "border-border/60 bg-muted/40",
                      )}
                    >
                      <div className="text-3xl">{taste.emoji}</div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground">
                            {tTaste(`${taste.id}Label`)}
                          </p>
                          {selectedTaste === taste.id && (
                            <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                              {t("selected")}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {tTaste(`${taste.id}Description`)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setIsTasteModalOpen(false)}
                    disabled={isGeneratingReport}
                  >
                    {t("cancel")}
                  </Button>
                  <Button
                    onClick={() => handleGenerateReport()}
                    disabled={isGeneratingReport}
                    isLoading={isGeneratingReport}
                  >
                    {t("generateWithTaste")}
                  </Button>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </div>
  );
}
