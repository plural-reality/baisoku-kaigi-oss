"use client";

import axios from "axios";
import { ArrowUpRight, Loader2, Pencil, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import {
  DecidimImport,
  type DecidimImportResult,
} from "@/components/DecidimImport";
import { FileUpload } from "@/components/FileUpload";
import { TemplateSelector } from "@/components/TemplateSelector";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredBadge } from "@/components/ui/required-badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";
import { createAuthorizationHeader } from "@/lib/auth-header";
import {
  type ContentLanguage,
  contentLanguageNames,
  contentLanguages,
  isContentLanguage,
  toContentLanguage,
} from "@/lib/content-language";
import { defaultTitle, pageTitle } from "@/lib/metadata";
import { sanitizeErrorForLog } from "@/lib/sanitize-error";
import { type SessionTemplate, sessionTemplates } from "@/lib/templates";
import { useUserId } from "@/lib/useUserId";

type SuggestionField = "backgroundInfo" | "purpose";

type Suggestion = {
  field: SuggestionField;
  message: string;
};

type CreateSessionPayload = Readonly<{
  title: string;
  context: string;
  goal: string;
  facilitatorContext: string;
  facilitatorGoal: string;
  language: ContentLanguage;
  initialQuestions?: string[];
  sourceUrl?: string;
}>;

// Text this page writes *into* the session (file markers, question feedback)
// is session content, so it follows the session language, not the UI locale.
const CONTENT_MARKERS: Record<
  ContentLanguage,
  {
    file: (fileName: string, summarized: boolean) => string;
    feedback: (question: string) => string;
  }
> = {
  ja: {
    file: (fileName, summarized) =>
      `\n\n--- ${fileName} より${summarized ? "要約" : "抽出"} ---\n`,
    feedback: (question) => `[質問「${question}」へのフィードバック]`,
  },
  en: {
    file: (fileName, summarized) =>
      `\n\n--- ${summarized ? "Summary of" : "Extracted from"} ${fileName} ---\n`,
    feedback: (question) => `[Feedback on the question "${question}"]`,
  },
};

const fileMarkers = (fileName: string): string[] =>
  contentLanguages.flatMap((language) => [
    CONTENT_MARKERS[language].file(fileName, true),
    CONTENT_MARKERS[language].file(fileName, false),
  ]);

const FIELD_META: Record<SuggestionField, { elementId: string }> = {
  backgroundInfo: { elementId: "backgroundInfo" },
  purpose: { elementId: "purpose" },
};

const inferFieldFromMessage = (message: string): SuggestionField => {
  const lower = message.toLowerCase();
  const includes = (keywords: string[]) =>
    keywords.some((keyword) => lower.includes(keyword));

  // i18n-allow: matches Japanese words in the AI message; not displayed
  const backgroundKeywords = [
    "背景",
    "人数",
    "関係性",
    "役割",
    "状況",
    "経緯",
    "チーム",
    "メンバー",
    "コミュニケーション",
    "誰が",
    "background",
    "context",
    "how many",
    "relationship",
    "role",
    "situation",
    "history",
    "team",
    "member",
    "who ",
  ];

  if (includes(backgroundKeywords)) {
    return "backgroundInfo";
  }

  return "purpose";
};

const renderSuggestionCard = (
  field: SuggestionField,
  suggestions: Suggestion[],
  _onClick: (field: SuggestionField) => void,
  aiAssistLabel: string,
) => {
  const fieldSuggestions = suggestions.filter(
    (suggestion) => suggestion.field === field,
  );
  if (fieldSuggestions.length === 0) return null;

  return (
    <Card className="border-indigo-100 bg-indigo-50/40 dark:border-indigo-900/60 dark:bg-indigo-950/50">
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-3">
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-100">
              <Sparkles className="h-3 w-3" />
              {aiAssistLabel}
            </span>
            {fieldSuggestions.length === 1 ? (
              <p className="text-sm leading-relaxed text-indigo-900 dark:text-indigo-100">
                {fieldSuggestions[0].message}
              </p>
            ) : (
              <ul className="list-disc list-inside space-y-2">
                {fieldSuggestions.map((suggestion) => (
                  <li
                    key={`${suggestion.field}-${suggestion.message}`}
                    className="text-sm leading-relaxed text-indigo-900 dark:text-indigo-100"
                  >
                    {suggestion.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const buildGoalFromInputs = (purpose: string) => purpose;

// Size of the edited region between two strings = total length minus the shared
// prefix and suffix. Unlike a substring check this is correct for edits in the
// middle of the value (e.g. editing `purpose` while `backgroundInfo` is filled),
// which is exactly where a naive `includes()` guard fails. Pure, no loops.
const commonAffixLen = (
  a: string,
  b: string,
  at: (s: string, i: number) => string,
): number => {
  const max = Math.min(a.length, b.length);
  const firstDiff = Array.from({ length: max }, (_, i) => i).find(
    (i) => at(a, i) !== at(b, i),
  );
  return firstDiff === undefined ? max : firstDiff;
};

const changedCharCount = (a: string, b: string): number => {
  if (a === b) return 0;
  const prefix = commonAffixLen(a, b, (s, i) => s[i]);
  const maxSuffix = Math.min(a.length, b.length) - prefix;
  const suffix = Math.min(
    commonAffixLen(a, b, (s, i) => s[s.length - 1 - i]),
    maxSuffix,
  );
  return Math.max(a.length, b.length) - prefix - suffix;
};

function NewSessionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userId, accessToken, isLoading: userLoading } = useUserId();
  const t = useTranslations("newSession");
  const tDecidim = useTranslations("decidimImport");
  const tSessionLanguage = useTranslations("sessionLanguage");
  const locale = useLocale();
  // Session (content) language: explicit ?language= wins, else the UI locale.
  const languageFromUrl = searchParams.get("language");
  const [language, setLanguage] = useState<ContentLanguage>(
    isContentLanguage(languageFromUrl)
      ? languageFromUrl
      : toContentLanguage(locale),
  );
  const templates = sessionTemplates(language);

  // テンプレート選択: URLパラメータがあればスキップ
  const hasUrlParams = !!(
    searchParams.get("title") ||
    searchParams.get("purpose") ||
    searchParams.get("topic") ||
    searchParams.get("background")
  );
  const templateFromUrl = searchParams.get("template");
  const initialTemplate = templateFromUrl
    ? templates.find((template) => template.id === templateFromUrl)
    : null;
  const [showTemplateSelector, setShowTemplateSelector] = useState(
    !hasUrlParams && !initialTemplate,
  );

  const [title, setTitle] = useState(
    initialTemplate?.prefill.title || searchParams.get("title") || "",
  );
  const [backgroundInfo, setBackgroundInfo] = useState(
    initialTemplate?.prefill.backgroundInfo ||
      searchParams.get("background") ||
      "",
  );
  const [purpose, setPurpose] = useState(
    initialTemplate?.prefill.purpose ||
      searchParams.get("purpose") ||
      searchParams.get("topic") ||
      "",
  );

  const handleTemplateSelect = (template: SessionTemplate) => {
    setTitle(template.prefill.title);
    setPurpose(template.prefill.purpose);
    setBackgroundInfo(template.prefill.backgroundInfo);
    setShowTemplateSelector(false);
  };

  const handleTemplateSkip = () => {
    setShowTemplateSelector(false);
  };

  const [decidimSource, setDecidimSource] = useState<Pick<
    DecidimImportResult,
    "sourceUrl" | "truncated"
  > | null>(null);

  // Background the host already wrote is kept; the draft's title and purpose
  // replace the fields, and the form stays editable before anything is created.
  const handleDecidimImported = (result: DecidimImportResult) => {
    setTitle(result.title);
    setPurpose(result.purpose);
    setBackgroundInfo((prev) =>
      prev.trim()
        ? `${prev.trim()}\n\n${result.background}`
        : result.background,
    );
    setDecidimSource({
      sourceUrl: result.sourceUrl,
      truncated: result.truncated,
    });
    setTitleError(null);
    setPurposeError(null);
    setShowTemplateSelector(false);
  };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<"createFailed" | null>(null);
  const [titleError, setTitleError] = useState<"titleRequired" | null>(null);
  const [purposeError, setPurposeError] = useState<"purposeRequired" | null>(
    null,
  );
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [highlightedField, setHighlightedField] =
    useState<SuggestionField | null>(null);
  const lastFormStateRef = useRef<string>("");
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const suggestionAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const lastPreviewStateRef = useRef<string>("");
  // Combined (title|purpose|background) input at the last generation — used by the
  // min-change guard below so incremental typing / streaming voice dictation does
  // not re-fire the expensive preview+suggestions LLM pair (incident 2026-06-02).
  const lastGenInputRef = useRef<string>("");
  // Previews are tagged with the language they were generated in. After a
  // language switch the old preview is hidden and never sent as
  // initialQuestions, including a late response from an earlier request.
  const [preview, setPreview] = useState<{
    language: ContentLanguage;
    questions: string[];
  } | null>(null);
  const previewQuestions =
    preview?.language === language ? preview.questions : [];
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<
    "rateLimited" | "previewFailed" | null
  >(null);
  const [expandedQuestionIndex, setExpandedQuestionIndex] = useState<
    number | null
  >(null);
  const [questionFeedback, setQuestionFeedback] = useState<string>("");

  useEffect(() => {
    document.title = pageTitle(t("pageTitle"), locale);
    return () => {
      document.title = defaultTitle(locale);
    };
  }, [t, locale]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      // Abort any in-flight preview/suggestion request on unmount. The debounce
      // effect deliberately no longer aborts on every dep change, so unmount is
      // the single place that tears these down.
      suggestionAbortRef.current?.abort();
      previewAbortRef.current?.abort();
    };
  }, []);

  const fetchSuggestions = useCallback(async () => {
    if (!userId) return;

    const currentFormState = JSON.stringify({
      backgroundInfo,
      purpose,
      language,
    });

    if (currentFormState === lastFormStateRef.current) {
      return;
    }

    lastFormStateRef.current = currentFormState;

    if (!backgroundInfo.trim() && !purpose.trim()) {
      setSuggestions([]);
      setIsSuggestionsLoading(false);
      return;
    }

    try {
      if (suggestionAbortRef.current) {
        suggestionAbortRef.current.abort();
      }
      const controller = new AbortController();
      suggestionAbortRef.current = controller;

      setIsSuggestionsLoading(true);

      const response = await axios.post<{
        suggestions: Array<Suggestion | string>;
      }>(
        "/api/sessions/form-suggestions",
        {
          backgroundInfo,
          purpose,
          language,
        },
        {
          headers: createAuthorizationHeader(accessToken),
          signal: controller.signal,
        },
      );

      const normalizedSuggestions: Suggestion[] = (
        response.data.suggestions || []
      ).map((item) => {
        if (typeof item === "string") {
          return {
            field: inferFieldFromMessage(item),
            message: item,
          };
        }
        return {
          ...item,
          field: item.field ?? inferFieldFromMessage(item.message),
        };
      });

      setSuggestions(normalizedSuggestions);
      setIsSuggestionsLoading(false);
    } catch (err) {
      if ((err as { name?: string }).name === "CanceledError") {
        return;
      }
      console.error("Failed to fetch suggestions:", sanitizeErrorForLog(err));
      setIsSuggestionsLoading(false);
    }
  }, [backgroundInfo, purpose, language, userId, accessToken]);

  const fetchPreviewQuestions = useCallback(async () => {
    if (!userId) return;

    const currentPreviewState = JSON.stringify({
      title,
      purpose,
      backgroundInfo,
      language,
    });

    if (currentPreviewState === lastPreviewStateRef.current) {
      return;
    }

    lastPreviewStateRef.current = currentPreviewState;

    if (!purpose.trim()) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    try {
      if (previewAbortRef.current) {
        previewAbortRef.current.abort();
      }
      const controller = new AbortController();
      previewAbortRef.current = controller;

      setIsPreviewLoading(true);
      setPreviewError(null);

      const goal = buildGoalFromInputs(purpose);

      const response = await axios.post(
        "/api/sessions/preview-questions",
        {
          title: title.trim(),
          goal,
          context: backgroundInfo.trim(),
          language,
        },
        {
          headers: createAuthorizationHeader(accessToken),
          signal: controller.signal,
        },
      );
      setPreview({ language, questions: response.data.questions });
    } catch (err) {
      if ((err as { name?: string }).name === "CanceledError") {
        return;
      }
      console.error("Failed to generate preview:", sanitizeErrorForLog(err));
      setPreview(null);
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      setPreviewError(status === 429 ? "rateLimited" : "previewFailed");
    } finally {
      setIsPreviewLoading(false);
    }
  }, [backgroundInfo, purpose, title, language, userId, accessToken]);

  // Auto-generate preview + suggestions, but only after input settles (trailing
  // debounce) AND only when the input changed materially (>= MIN_INPUT_DELTA
  // changed chars, measured by changedCharCount) since the last generation.
  // Previously this fired both LLM calls on a 100ms debounce on every keystroke,
  // so a fast typist / streaming voice dictation produced thousands of calls and
  // exhausted the shared OpenRouter budget (incident 2026-06-02).
  const PREVIEW_DEBOUNCE_MS = 2500;
  const MIN_INPUT_DELTA = 10;
  useEffect(() => {
    const debounceHandle = setTimeout(() => {
      // Wait until auth is ready: the fetchers no-op without a userId, so firing
      // now would record this input as "generated" and then permanently suppress
      // the real run once userId arrives (the effect reruns via callback deps).
      if (!userId) {
        return;
      }
      // The language prefix makes a language switch always count as a change.
      const normalized = `${language}${title}${purpose}${backgroundInfo}`
        .trim()
        .replace(/\s+/g, " ");
      const languageChanged =
        lastGenInputRef.current !== "" &&
        !lastGenInputRef.current.startsWith(`${language}`);
      const last = lastGenInputRef.current;
      // changedCharCount is separator-safe and measures edits in ANY field (a
      // substring check misses edits before the last field). Skip regenerating
      // when the input barely changed since the last generation (incremental
      // typing / streaming voice) — together with the trailing debounce this is
      // what stops the per-keystroke LLM fan-out.
      if (
        normalized === last ||
        (!languageChanged &&
          last !== "" &&
          changedCharCount(normalized, last) < MIN_INPUT_DELTA)
      ) {
        return;
      }
      lastGenInputRef.current = normalized;
      void fetchSuggestions();
      void fetchPreviewQuestions();
    }, PREVIEW_DEBOUNCE_MS);

    // Only clear the pending debounce here. We intentionally do NOT abort an
    // in-flight request on dep changes: a later skip would otherwise kill the
    // only running request and leave the preview empty. A superseding generation
    // aborts the previous one itself (see fetch* above); unmount aborts below.
    return () => {
      clearTimeout(debounceHandle);
    };
  }, [
    userId,
    title,
    purpose,
    backgroundInfo,
    language,
    fetchSuggestions,
    fetchPreviewQuestions,
  ]);

  const handleSuggestionClick = (field: SuggestionField) => {
    const fieldMeta = FIELD_META[field];
    if (!fieldMeta) return;

    const target = document.getElementById(fieldMeta.elementId);
    if (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement
    ) {
      target.focus();
    }

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    setHighlightedField(field);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedField(null);
    }, 2500);
  };

  const textareaClasses = (field: SuggestionField, hasError?: boolean) =>
    [
      "flex w-full rounded-md border border-input bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y max-h-[50dvh] break-words whitespace-pre-wrap",
      highlightedField === field
        ? "ring-2 ring-indigo-500 border-indigo-500 dark:ring-indigo-400 dark:border-indigo-400"
        : "",
      hasError ? "border-destructive focus-visible:ring-destructive" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const renderFieldAid = (field: SuggestionField, fallback: string) => {
    const hasSuggestions = suggestions.some(
      (suggestion) => suggestion.field === field,
    );
    const hasAnyInput = Boolean(backgroundInfo.trim() || purpose.trim());

    if (isSuggestionsLoading && hasAnyInput && !hasSuggestions) {
      return (
        <Card className="border-indigo-100 bg-indigo-50/40 dark:border-indigo-900/60 dark:bg-indigo-950/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-3">
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-100">
                  <Sparkles className="h-3 w-3" />
                  {t("aiAssist")}
                </span>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (!hasAnyInput || !hasSuggestions) {
      return <FieldDescription>{fallback}</FieldDescription>;
    }
    return renderSuggestionCard(
      field,
      suggestions,
      handleSuggestionClick,
      t("aiAssist"),
    );
  };

  const handleQuestionClick = (index: number) => {
    if (expandedQuestionIndex === index) {
      setExpandedQuestionIndex(null);
      setQuestionFeedback("");
    } else {
      setExpandedQuestionIndex(index);
      setQuestionFeedback("");
    }
  };

  const handleFeedbackSubmit = (question: string) => {
    if (!questionFeedback.trim()) return;

    const feedbackText = `${CONTENT_MARKERS[language].feedback(question)}\n${questionFeedback.trim()}\n\n`;
    setBackgroundInfo((prev) => prev + feedbackText);
    setQuestionFeedback("");
    setExpandedQuestionIndex(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // バリデーション
    setTitleError(null);
    setPurposeError(null);
    setError(null);

    let hasError = false;
    let firstErrorField: string | null = null;

    if (!title.trim()) {
      setTitleError("titleRequired");
      hasError = true;
      if (!firstErrorField) firstErrorField = "title";
    }

    if (!purpose.trim()) {
      setPurposeError("purposeRequired");
      hasError = true;
      if (!firstErrorField) firstErrorField = "purpose";
    }

    if (hasError && firstErrorField) {
      // エラーのあるフィールドまでスクロール
      setTimeout(() => {
        const element = document.getElementById(firstErrorField);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          element.focus();
        }
      }, 100);
      return;
    }

    setIsSubmitting(true);
    const goal = buildGoalFromInputs(purpose);
    const payload: CreateSessionPayload = {
      title: title.trim(),
      context: backgroundInfo.trim(),
      goal,
      facilitatorContext: backgroundInfo.trim(),
      facilitatorGoal: goal,
      language,
      ...(previewQuestions.length > 0
        ? { initialQuestions: previewQuestions }
        : {}),
      ...(decidimSource ? { sourceUrl: decidimSource.sourceUrl } : {}),
    };

    try {
      const response = await axios.post("/api/sessions", payload, {
        headers: createAuthorizationHeader(accessToken),
      });

      const sessionId = response.data.session.id;
      const adminAccessToken = response.data.session.adminAccessToken;
      trackEvent(ANALYTICS_EVENTS.SESSION_CREATED, { sessionId });
      // Stay submitting while the page navigates away: re-enabling the button here let a
      // second click create a second session.
      router.push(`/sessions/${sessionId}/${adminAccessToken}`);
    } catch (err) {
      console.error("Failed to create session:", sanitizeErrorForLog(err));
      setError("createFailed");
      setIsSubmitting(false);
    }
  };

  if (userLoading) {
    return (
      <div className="min-h-svh flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasPreviewQuestions = previewQuestions.length > 0;

  if (showTemplateSelector) {
    return (
      <div className="min-h-svh bg-background">
        <AppHeader />
        <div className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              {t("heading")}
            </h1>
          </div>
          <DecidimImport
            language={language}
            accessToken={accessToken}
            onImported={handleDecidimImported}
          />
          <TemplateSelector
            onSelect={handleTemplateSelect}
            onSkip={handleTemplateSkip}
            language={language}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background">
      <AppHeader />
      <div className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            {t("heading")}
          </h1>
          <p className="text-muted-foreground">{t("intro")}</p>
          <p className="text-muted-foreground mt-1">
            <a
              href="https://scrapbox.io/baisoku-kaigi/%E3%80%8C%E8%A3%9C%E8%B6%B3%E6%83%85%E5%A0%B1%E3%80%8D%E3%82%92%E3%81%9F%E3%81%8F%E3%81%95%E3%82%93%E6%9B%B8%E3%81%8F%E3%81%9F%E3%82%81%E3%81%AB%E9%9F%B3%E5%A3%B0%E5%85%A5%E5%8A%9B%E3%82%92%E6%B4%BB%E7%94%A8%E3%81%99%E3%82%8B"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              {t("voiceTip")}
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </a>
          </p>
        </div>

        {decidimSource ? (
          <Card data-testid="decidim-source" className="mb-6">
            <CardContent className="pt-6 space-y-2 text-sm">
              <p className="text-muted-foreground">
                {tDecidim("importedFrom")}
              </p>
              <a
                href={decidimSource.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block break-all underline underline-offset-2"
              >
                {decidimSource.sourceUrl}
              </a>
              {decidimSource.truncated && (
                <p className="text-muted-foreground">{tDecidim("truncated")}</p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDecidimSource(null)}
              >
                {tDecidim("remove")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <DecidimImport
            language={language}
            accessToken={accessToken}
            onImported={handleDecidimImported}
          />
        )}

        {/* Form and preview side by side from 54rem (864px), the width of an unfolded iPhone Duo. */}
        <div className="grid grid-cols-1 min-[54rem]:grid-cols-2 gap-6">
          <div className="order-2 min-[54rem]:order-1">
            {!previewError && isPreviewLoading && !hasPreviewQuestions && (
              <Card className="border-indigo-100 bg-indigo-50/40 dark:border-indigo-900/60 dark:bg-indigo-950/50 min-h-[600px] flex flex-col">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    {t("previewTitle")}
                  </CardTitle>
                  <CardDescription>{t("previewGenerating")}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden flex flex-col">
                  <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-border/60 bg-white dark:bg-slate-950/40 shadow-sm px-4 py-3"
                      >
                        <Skeleton className="h-4 w-full mb-2" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {previewError && (
              <Card className="border-destructive min-h-[600px] flex items-center justify-center">
                <CardContent className="pt-6">
                  <p className="text-sm text-destructive" role="alert">
                    {t(previewError)}
                  </p>
                </CardContent>
              </Card>
            )}

            {!previewError && hasPreviewQuestions && (
              <Card className="border-indigo-100 bg-indigo-50/40 dark:border-indigo-900/60 dark:bg-indigo-950/50 min-h-[600px] flex flex-col">
                <CardHeader className="pb-3 relative">
                  <CardTitle className="text-base text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    {t("previewTitle")}
                  </CardTitle>
                  <CardDescription>{t("previewDescription")}</CardDescription>
                  <div
                    className={`absolute right-6 top-6 flex items-center gap-2 text-xs text-muted-foreground transition-opacity ${
                      isPreviewLoading ? "opacity-100" : "opacity-0"
                    }`}
                    aria-live="polite"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>{t("updating")}</span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden flex flex-col">
                  <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                    {previewQuestions.map((q, index) => {
                      const feedbackId = `question-feedback-${index}`;

                      return (
                        <div
                          key={q}
                          className="rounded-lg border border-border/60 bg-white dark:bg-slate-950/40 shadow-sm"
                        >
                          <button
                            type="button"
                            className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/50"
                            onClick={() => handleQuestionClick(index)}
                          >
                            <span className="text-sm leading-relaxed text-slate-900 dark:text-slate-100 flex-1">
                              {q}
                            </span>
                            <span
                              className={`flex items-center gap-1 rounded-md px-2 py-1 transition-all ${
                                expandedQuestionIndex === index
                                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/70 dark:text-indigo-200"
                                  : "bg-muted text-slate-600 group-hover:bg-slate-200 dark:bg-slate-800/70 dark:text-slate-300 dark:group-hover:bg-slate-700/70"
                              }`}
                            >
                              <Pencil className="h-3 w-3" />
                              <span className="text-xs font-medium">
                                {t("addNote")}
                              </span>
                            </span>
                          </button>
                          {expandedQuestionIndex === index && (
                            <div className="border-t border-border/60 px-4 py-3 space-y-2">
                              <label
                                htmlFor={feedbackId}
                                className="text-xs text-muted-foreground"
                              >
                                {t("noteLabel")}
                              </label>
                              <Textarea
                                id={feedbackId}
                                value={questionFeedback}
                                onChange={(e) =>
                                  setQuestionFeedback(e.target.value)
                                }
                                rows={3}
                                autoResize
                                placeholder={t("notePlaceholder")}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedQuestionIndex(null);
                                    setQuestionFeedback("");
                                  }}
                                >
                                  {t("cancel")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleFeedbackSubmit(q);
                                  }}
                                  disabled={!questionFeedback.trim()}
                                >
                                  {t("add")}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-6 flex justify-end">
                    <div className="w-full space-y-3 sm:w-auto">
                      <Button
                        type="submit"
                        disabled={isSubmitting}
                        isLoading={isSubmitting}
                        onClick={handleSubmit}
                        className="w-full sm:w-auto"
                      >
                        {t("create")}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {!isPreviewLoading && !previewError && !hasPreviewQuestions && (
              <Card className="border-muted min-h-[600px] flex items-center justify-center">
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground text-center">
                    {t("previewEmpty")}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="order-1 min-[54rem]:order-2 min-[54rem]:sticky min-[54rem]:top-[calc(1.5rem+var(--safe-top))] min-[54rem]:self-start">
            <Card className="min-h-[600px]">
              <CardContent className="pt-6">
                <form onSubmit={handleSubmit} className="space-y-6">
                  <Field>
                    <FieldLabel
                      htmlFor="sessionLanguage"
                      className="text-base font-semibold"
                    >
                      {tSessionLanguage("label")}
                    </FieldLabel>
                    <select
                      id="sessionLanguage"
                      data-testid="session-language"
                      value={language}
                      onChange={(e) =>
                        setLanguage(toContentLanguage(e.target.value))
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-60"
                    >
                      {contentLanguages.map((value) => (
                        <option key={value} value={value} lang={value}>
                          {contentLanguageNames[value]}
                        </option>
                      ))}
                    </select>
                    <FieldDescription>
                      {tSessionLanguage("help")}
                    </FieldDescription>
                  </Field>

                  <Field data-invalid={!!titleError}>
                    <FieldLabel
                      htmlFor="title"
                      className="text-base font-semibold"
                    >
                      {t("titleLabel")}
                      <RequiredBadge>{t("requiredBadge")}</RequiredBadge>
                    </FieldLabel>
                    <Input
                      type="text"
                      id="title"
                      value={title}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        if (titleError) setTitleError(null);
                      }}
                      placeholder={t("titlePlaceholder")}
                      aria-invalid={!!titleError}
                      className={
                        titleError
                          ? "border-destructive focus-visible:ring-destructive"
                          : ""
                      }
                    />
                    {titleError ? (
                      <FieldError>{t(titleError)}</FieldError>
                    ) : (
                      <FieldDescription>{t("titleHelp")}</FieldDescription>
                    )}
                  </Field>

                  <Field data-invalid={!!purposeError}>
                    <FieldLabel
                      htmlFor="purpose"
                      className="text-base font-semibold"
                    >
                      {t("purposeLabel")}
                      <RequiredBadge>{t("requiredBadge")}</RequiredBadge>
                    </FieldLabel>
                    <Textarea
                      id="purpose"
                      value={purpose}
                      onChange={(e) => {
                        setPurpose(e.target.value);
                        if (purposeError) setPurposeError(null);
                      }}
                      rows={6}
                      autoResize
                      className={textareaClasses("purpose", !!purposeError)}
                      placeholder={t("purposePlaceholder")}
                      aria-invalid={!!purposeError}
                    />
                    {purposeError ? (
                      <FieldError>{t(purposeError)}</FieldError>
                    ) : (
                      renderFieldAid("purpose", t("purposeHelp"))
                    )}
                  </Field>

                  <Field>
                    <FieldLabel
                      htmlFor="backgroundInfo"
                      className="text-base font-semibold"
                    >
                      {t("backgroundLabel")}{" "}
                      <span className="ml-1.5 rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/60 dark:text-yellow-100">
                        {t("optional")}
                      </span>
                    </FieldLabel>
                    <Textarea
                      id="backgroundInfo"
                      value={backgroundInfo}
                      onChange={(e) => setBackgroundInfo(e.target.value)}
                      rows={4}
                      autoResize
                      className={textareaClasses("backgroundInfo")}
                      placeholder={t("backgroundPlaceholder")}
                    />
                    {renderFieldAid("backgroundInfo", t("backgroundHelp"))}
                    <FileUpload
                      language={language}
                      onTextExtracted={(text, fileName, summarized) => {
                        const header = CONTENT_MARKERS[language].file(
                          fileName,
                          summarized,
                        );
                        setBackgroundInfo((prev) => prev + header + text);
                      }}
                      onTextRemoved={(fileName) => {
                        setBackgroundInfo((prev) => {
                          const pattern = fileMarkers(fileName).find((marker) =>
                            prev.includes(marker),
                          );
                          if (pattern === undefined) return prev;
                          const startIdx = prev.indexOf(pattern);
                          const nextFileIdx = prev.indexOf(
                            "\n\n--- ",
                            startIdx + pattern.length,
                          );
                          return nextFileIdx === -1
                            ? prev.slice(0, startIdx)
                            : prev.slice(0, startIdx) + prev.slice(nextFileIdx);
                        });
                      }}
                    />
                  </Field>

                  {error && (
                    <Card className="border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/70 flex items-center justify-center">
                            <span className="text-red-600 dark:text-red-200 text-sm font-bold">
                              !
                            </span>
                          </div>
                          <p className="text-sm text-red-800 dark:text-red-100 font-medium">
                            {t(error)}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewSessionPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-svh flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NewSessionContent />
    </Suspense>
  );
}
