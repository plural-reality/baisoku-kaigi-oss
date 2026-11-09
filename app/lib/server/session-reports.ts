import {
  contentLanguageNames,
  toContentLanguage,
  withOutputLanguage,
} from "@/lib/content-language";
import {
  ACCURATE_MODEL,
  callLLMWithMeta,
  LLMAbortedError,
  LLMUnavailableError,
} from "@/lib/llm";
import { PROMPT_VERSIONS, withoutLlmMeta } from "@/lib/llm-models";
import { encodeReportFailure } from "@/lib/report-failure";
import { sanitizeErrorForLog } from "@/lib/sanitize-error";
import {
  sessionFacilitatorContext,
  sessionFacilitatorGoal,
  sessionParticipantContextFields,
} from "@/lib/session-context";
import { selectAllRange, supabase } from "@/lib/supabase";
import {
  UNTRUSTED_DATA_RULE,
  untrustedName,
  wrapUntrusted,
} from "@/lib/untrusted-text";

type ResponseValue = -2 | -1 | 0 | 1 | 2;

function getResponseLabel(value: ResponseValue): string {
  switch (value) {
    case 2:
      return "強く同意";
    case 1:
      return "同意";
    case 0:
      return "わからない・自信がない";
    case -1:
      return "反対";
    case -2:
      return "強く反対";
    default:
      return "Unknown";
  }
}

export type SessionReportStatus =
  | "pending"
  | "generating"
  | "completed"
  | "failed";

export type SessionReportRecord = {
  id: string;
  sessionId: string;
  version: number;
  status: SessionReportStatus;
  requestMarkdown: string;
  contentMarkdown: string | null;
  createdBy: string;
  model: string;
  errorMessage: string | null;
  tokenUsage: Record<string, unknown> | null;
  promptSnapshot: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type SessionRow = {
  id: string;
  title: string;
  context: string;
  goal: string;
  facilitator_context?: string | null;
  facilitator_goal?: string | null;
  language?: string | null;
};

type StatementRow = {
  id: string;
  text: string;
  order_index: number;
};

type ResponseRow = {
  statement_id: string;
  participant_user_id: string;
  response_type: "scale" | "free_text";
  value: ResponseValue | null;
  text_response: string | null;
};

type ParticipantRow = {
  user_id: string;
  name: string;
};

type TimelineStatement = {
  id: string;
  text: string;
  orderIndex: number;
};

type TimelineEntry = {
  id: string;
  type: string;
  createdAt: string;
  progress: number;
  agentId: string | null;
  userId: string | null;
  markdown: string | null;
  payloadSummary: string | null;
  statements: TimelineStatement[];
};

type ParticipantSummary = {
  userId: string;
  name: string;
  answeredCount: number;
  totalStatements: number;
  responses: {
    statementId: string;
    statementNumber: number;
    statementText: string;
    value: ResponseValue;
    valueLabel: string;
  }[];
  freeTextResponses: {
    statementId: string;
    statementNumber: number;
    statementText: string;
    text: string;
  }[];
};

type StatementStat = {
  statementId: string;
  statementNumber: number;
  text: string;
  percentages: {
    strongYes: number;
    yes: number;
    dontKnow: number;
    no: number;
    strongNo: number;
  };
  totalResponses: number;
  freeTextCount: number;
};

export type SessionReportPromptSnapshot = {
  session: SessionRow;
  participantSummaries: ParticipantSummary[];
  statementStats: StatementStat[];
  eventTimeline: TimelineEntry[];
};

function mapReportRow(row: {
  id: string;
  session_id: string;
  version: number;
  status: string;
  request_markdown: string;
  content_markdown: string | null;
  created_by: string;
  model: string;
  error_message: string | null;
  token_usage: unknown;
  prompt_snapshot: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}): SessionReportRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    version: row.version,
    status: row.status as SessionReportStatus,
    requestMarkdown: row.request_markdown,
    contentMarkdown: row.content_markdown,
    createdBy: row.created_by,
    model: row.model,
    errorMessage: row.error_message,
    tokenUsage: row.token_usage as Record<string, unknown> | null,
    promptSnapshot: row.prompt_snapshot as Record<string, unknown> | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

async function getNextReportVersion(sessionId: string): Promise<number> {
  const { data, error } = await supabase
    .from("session_reports")
    .select("version")
    .eq("session_id", sessionId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to compute next session report version: ${error.message}`,
    );
  }

  if (!data) {
    return 1;
  }

  return (data.version ?? 0) + 1;
}

export async function listSessionReports(
  sessionId: string,
): Promise<SessionReportRecord[]> {
  await expireStaleSessionReports(sessionId);
  const { data, error } = await supabase
    .from("session_reports")
    .select(
      "id, session_id, version, status, request_markdown, content_markdown, created_by, model, error_message, token_usage, prompt_snapshot, created_at, updated_at, completed_at",
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list session reports: ${error.message}`);
  }

  return (data ?? []).map(mapReportRow);
}

// Hard ceiling on one report generation. callLLM alone can run 5 attempts x
// 300s plus backoff (~29 min), which used to outlive the 5-minute staleness
// window: a second generation could start while the first was still running.
// The LLM call is aborted at this budget, so a live row never goes stale.
export const REPORT_GENERATION_BUDGET_MS = 10 * 60 * 1000;

// How long a "pending"/"generating" row is treated as genuinely in flight.
// Strictly longer than the generation budget, so only a row whose process died
// (restart/deploy mid-generation) can be older than this.
export const ACTIVE_REPORT_STALE_MS = 15 * 60 * 1000;

export const INTERRUPTED_REPORT_MESSAGE = encodeReportFailure("interrupted");

const IN_FLIGHT_STATUSES = ["pending", "generating"] as const;

// A process restart mid-generation left rows "generating" forever: the admin
// UI kept polling every 5s with the generate button disabled, and no server
// path ever finished them. Expire such rows to "failed" so the UI shows the
// reason and lets the admin retry. Lazily applied on read, so no scheduler is
// needed; the row is only touched when someone is looking at the session.
export async function expireStaleSessionReports(
  sessionId: string,
  now: number = Date.now(),
): Promise<void> {
  const staleBefore = new Date(now - ACTIVE_REPORT_STALE_MS).toISOString();
  const { error } = await supabase
    .from("session_reports")
    .update({
      status: "failed",
      error_message: INTERRUPTED_REPORT_MESSAGE,
      updated_at: new Date(now).toISOString(),
    })
    .eq("session_id", sessionId)
    .in("status", [...IN_FLIGHT_STATUSES])
    .lt("updated_at", staleBefore);

  if (error) {
    throw new Error(`Failed to expire stale session reports: ${error.message}`);
  }
}

// The most recent still-in-flight report for a session, if any. Used at the API
// boundary to make report generation idempotent — a second request while one is
// in flight returns the existing report instead of starting another LLM call.
// Concurrent POSTs are settled by the partial unique index
// session_reports_one_in_flight_idx (see createSessionReportRecord).
export async function findActiveSessionReport(
  sessionId: string,
): Promise<SessionReportRecord | null> {
  const freshSince = new Date(
    Date.now() - ACTIVE_REPORT_STALE_MS,
  ).toISOString();
  const { data, error } = await supabase
    .from("session_reports")
    .select(
      "id, session_id, version, status, request_markdown, content_markdown, created_by, model, error_message, token_usage, prompt_snapshot, created_at, updated_at, completed_at",
    )
    .eq("session_id", sessionId)
    .in("status", [...IN_FLIGHT_STATUSES])
    .gte("updated_at", freshSince)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw new Error(`Failed to check active session report: ${error.message}`);
  }

  return data ? mapReportRow(data) : null;
}

export async function getSessionReportById(
  reportId: string,
): Promise<SessionReportRecord | null> {
  const { data, error } = await supabase
    .from("session_reports")
    .select(
      "id, session_id, version, status, request_markdown, content_markdown, created_by, model, error_message, token_usage, prompt_snapshot, created_at, updated_at, completed_at",
    )
    .eq("id", reportId)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw new Error(`Failed to load session report: ${error.message}`);
  }

  return data ? mapReportRow(data) : null;
}

const UNIQUE_VIOLATION = "23505";

export type CreateSessionReportResult =
  | { readonly created: true; readonly report: SessionReportRecord }
  | { readonly created: false; readonly report: SessionReportRecord };

// Creates the pending row, or returns the report another request created
// concurrently. Two indexes make this race-free: one in-flight report per
// session, and a unique (session_id, version). On a conflict we either hand
// back the in-flight report (another POST won) or recompute the version once
// (a completed report took our version number).
export async function createSessionReportRecord(options: {
  sessionId: string;
  userId: string;
  requestMarkdown?: string;
}): Promise<CreateSessionReportResult> {
  const attempt = async (
    retriesLeft: number,
  ): Promise<CreateSessionReportResult> => {
    const inserted = await insertSessionReportRecord(options);
    if (inserted.status === "created") {
      return { created: true, report: inserted.report };
    }
    const active = await findActiveSessionReport(options.sessionId);
    if (active) {
      return { created: false, report: active };
    }
    if (retriesLeft > 0) {
      return attempt(retriesLeft - 1);
    }
    throw new Error(
      "Failed to create session report record: conflicting concurrent insert",
    );
  };
  return attempt(1);
}

async function insertSessionReportRecord(options: {
  sessionId: string;
  userId: string;
  requestMarkdown?: string;
}): Promise<
  { status: "created"; report: SessionReportRecord } | { status: "conflict" }
> {
  const version = await getNextReportVersion(options.sessionId);
  const trimmedRequest = options.requestMarkdown?.trim() ?? "";
  const { data, error } = await supabase
    .from("session_reports")
    .insert({
      session_id: options.sessionId,
      version,
      status: "pending",
      request_markdown: trimmedRequest,
      created_by: options.userId,
      // The model we intend to call; overwritten with the one OpenRouter
      // actually resolved once the generation completes.
      model: ACCURATE_MODEL,
      prompt_version: PROMPT_VERSIONS.sessionReport,
    })
    .select(
      "id, session_id, version, status, request_markdown, content_markdown, created_by, model, error_message, token_usage, prompt_snapshot, created_at, updated_at, completed_at",
    )
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    return { status: "conflict" };
  }
  if (error || !data) {
    throw new Error(
      `Failed to create session report record: ${error?.message ?? "unknown error"}`,
    );
  }

  return { status: "created", report: mapReportRow(data) };
}

async function fetchSessionRow(sessionId: string): Promise<SessionRow> {
  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id, title, context, goal, facilitator_context, facilitator_goal, language",
    )
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to fetch session context: ${error?.message ?? "not found"}`,
    );
  }

  return data;
}

async function fetchStatements(sessionId: string): Promise<StatementRow[]> {
  const { data, error } = await supabase
    .from("statements")
    .select("id, text, order_index")
    .eq("session_id", sessionId)
    .order("order_index", { ascending: true });

  if (error) {
    throw new Error(`Failed to load statements: ${error.message}`);
  }

  return data ?? [];
}

async function fetchResponses(sessionId: string): Promise<ResponseRow[]> {
  const { data, error } = await selectAllRange((from, to) =>
    supabase
      .from("responses")
      .select(
        "statement_id, participant_user_id, value, response_type, text_response",
      )
      .eq("session_id", sessionId)
      // Stable order so the AI report input (and its 自由記述 lines) is
      // deterministic across regenerations and safe under offset pagination.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  if (error) {
    throw new Error(`Failed to load responses: ${error.message}`);
  }

  return data as unknown as ResponseRow[];
}

async function fetchParticipants(sessionId: string): Promise<ParticipantRow[]> {
  const { data, error } = await selectAllRange((from, to) =>
    supabase
      .from("participants")
      .select("user_id, name")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .range(from, to),
  );

  if (error) {
    throw new Error(`Failed to load participants: ${error.message}`);
  }

  return data;
}

async function fetchTimelineEntries(
  sessionId: string,
  statementsById: Map<string, StatementRow>,
): Promise<TimelineEntry[]> {
  const { data: thread, error: threadError } = await supabase
    .from("event_threads")
    .select("id")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (threadError && threadError.code !== "PGRST116") {
    throw new Error(
      `Failed to lookup event thread: ${threadError.message ?? "unknown error"}`,
    );
  }

  if (!thread) {
    return [];
  }

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select(
      "id, type, agent_id, user_id, progress, payload, order_index, created_at",
    )
    .eq("thread_id", thread.id)
    .order("order_index", { ascending: true });

  if (eventsError) {
    throw new Error(`Failed to fetch event timeline: ${eventsError.message}`);
  }

  return (events ?? []).map((event) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const markdown =
      typeof payload.markdown === "string"
        ? (payload.markdown as string)
        : null;
    const statementIds = Array.isArray(
      (payload as { statementIds?: string[] }).statementIds,
    )
      ? ((payload as { statementIds?: string[] }).statementIds as string[])
      : [];
    const statements = statementIds
      .map((id) => statementsById.get(id))
      .filter((stmt): stmt is StatementRow => Boolean(stmt))
      .map((stmt) => ({
        id: stmt.id,
        text: stmt.text,
        orderIndex: stmt.order_index ?? 0,
      }));

    const payloadSummary = buildPayloadSummary(payload);

    return {
      id: event.id,
      type: event.type,
      createdAt: event.created_at,
      progress: Number(event.progress ?? 0),
      agentId: event.agent_id,
      userId: event.user_id,
      markdown,
      payloadSummary,
      statements,
    };
  });
}

export function buildPayloadSummary(
  payload: Record<string, unknown>,
): string | null {
  const cloned: Record<string, unknown> = withoutLlmMeta(payload);

  if (typeof cloned.markdown === "string") {
    delete cloned.markdown;
  }

  if (
    Array.isArray((cloned as { statementIds?: string[] }).statementIds) &&
    ((cloned as { statementIds?: string[] }).statementIds as string[]).length >
      0
  ) {
    delete cloned.statementIds;
  }

  const keys = Object.keys(cloned);

  if (keys.length === 0) {
    return null;
  }

  const summary = JSON.stringify(cloned, null, 2);
  if (summary.length <= 1200) {
    return summary;
  }
  return `${summary.slice(0, 1197)}...`;
}

export function buildParticipantSummaries(
  participants: ParticipantRow[],
  responses: ResponseRow[],
  statementsById: Map<string, StatementRow>,
  totalStatements: number,
): ParticipantSummary[] {
  const participantMap = new Map<string, ParticipantSummary>();

  participants.forEach((participant) => {
    participantMap.set(participant.user_id, {
      userId: participant.user_id,
      name: participant.name,
      answeredCount: 0,
      totalStatements,
      responses: [],
      freeTextResponses: [],
    });
  });

  responses.forEach((response) => {
    const participant = participantMap.get(response.participant_user_id);
    if (!participant) return;
    const statement = statementsById.get(response.statement_id);
    if (!statement) return;
    const statementNumber = (statement.order_index ?? 0) + 1;
    if (response.response_type === "free_text") {
      participant.freeTextResponses.push({
        statementId: statement.id,
        statementNumber,
        statementText: statement.text,
        text: response.text_response ?? "",
      });
      return;
    }
    if (response.value === null) return;
    participant.responses.push({
      statementId: statement.id,
      statementNumber,
      statementText: statement.text,
      value: response.value,
      valueLabel: getResponseLabel(response.value),
    });
  });

  participantMap.forEach((participant) => {
    participant.responses.sort((a, b) => a.statementNumber - b.statementNumber);
    participant.freeTextResponses.sort(
      (a, b) => a.statementNumber - b.statementNumber,
    );
    participant.answeredCount =
      participant.responses.length + participant.freeTextResponses.length;
  });

  return Array.from(participantMap.values());
}

export function buildStatementStats(
  statements: StatementRow[],
  responses: ResponseRow[],
): StatementStat[] {
  const responseMap = new Map<string, ResponseRow[]>();

  responses.forEach((response) => {
    const list = responseMap.get(response.statement_id) ?? [];
    list.push(response);
    responseMap.set(response.statement_id, list);
  });

  return statements.map((statement) => {
    const list = responseMap.get(statement.id) ?? [];
    const scaleResponses = list.filter(
      (response) => response.response_type === "scale",
    );
    const freeTextCount = list.filter(
      (response) => response.response_type === "free_text",
    ).length;
    const totalResponses = scaleResponses.length;
    const values = scaleResponses
      .map((item) => item.value)
      .filter((value): value is ResponseValue => value !== null);
    const counts = {
      strongYes: values.filter((v) => v === 2).length,
      yes: values.filter((v) => v === 1).length,
      dontKnow: values.filter((v) => v === 0).length,
      no: values.filter((v) => v === -1).length,
      strongNo: values.filter((v) => v === -2).length,
    };

    const toPercent = (value: number) =>
      totalResponses === 0
        ? 0
        : Math.round((value / totalResponses) * 1000) / 10;

    return {
      statementId: statement.id,
      statementNumber: (statement.order_index ?? 0) + 1,
      text: statement.text,
      percentages: {
        strongYes: toPercent(counts.strongYes),
        yes: toPercent(counts.yes),
        dontKnow: toPercent(counts.dontKnow),
        no: toPercent(counts.no),
        strongNo: toPercent(counts.strongNo),
      },
      totalResponses,
      freeTextCount,
    };
  });
}

function formatParticipantSummaries(
  participants: ParticipantSummary[],
): string {
  if (participants.length === 0) {
    return "参加者の回答はまだありません。";
  }

  return participants
    .map((participant) => {
      // Name and free text are participant-authored → isolated as data (audit H1).
      const header = `### ${untrustedName(participant.name)} (${participant.answeredCount}/${participant.totalStatements})`;
      if (
        participant.responses.length === 0 &&
        participant.freeTextResponses.length === 0
      ) {
        return `${header}\n- まだ回答はありません。`;
      }
      const lines = participant.responses.map(
        (response) =>
          `- [${response.valueLabel}] #${response.statementNumber} ${response.statementText}`,
      );
      const freeTextLines = participant.freeTextResponses.map(
        (response) =>
          `- [自由記述] #${response.statementNumber} ${response.statementText} → ${wrapUntrusted(response.text, { kind: "free_text" })}`,
      );
      const merged = [...lines, ...freeTextLines];
      return `${header}\n${merged.join("\n")}`;
    })
    .join("\n\n");
}

function formatStatementStats(stats: StatementStat[]): string {
  if (stats.length === 0) {
    return "ステートメントが未設定です。";
  }

  return stats
    .map((stat) => {
      const header = `### #${stat.statementNumber} ${stat.text}`;
      if (stat.totalResponses === 0) {
        const noScale = "- まだスケール回答がありません。";
        const freeTextLine =
          stat.freeTextCount > 0 ? `- 自由記述: ${stat.freeTextCount}件` : null;
        return `${header}\n${[noScale, freeTextLine].filter(Boolean).join("\n")}`;
      }
      return `${header}
- 強く同意: ${stat.percentages.strongYes}%
- 同意: ${stat.percentages.yes}%
- わからない・自信がない: ${stat.percentages.dontKnow}%
- 反対: ${stat.percentages.no}%
- 強く反対: ${stat.percentages.strongNo}%
- 自由記述: ${stat.freeTextCount}件`;
    })
    .join("\n\n");
}

function indentBlock(text: string, indent = 2): string {
  const pad = " ".repeat(indent);
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

function formatEventTimeline(events: TimelineEntry[]): string {
  if (events.length === 0) {
    return "イベントはまだ登録されていません。";
  }

  return events
    .map((event, index) => {
      const timestamp = new Date(event.createdAt).toLocaleString("ja-JP", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = [
        `${index + 1}. [${timestamp}] ${event.type.toUpperCase()}`,
        `   - Agent: ${event.agentId ?? "system"}`,
        `   - User: ${event.userId ?? "n/a"}`,
        `   - Progress: ${Math.round(event.progress * 100)}%`,
      ];
      if (event.statements.length > 0) {
        const statementText = event.statements
          .map((statement) => `#${statement.orderIndex + 1} ${statement.text}`)
          .join(" / ");
        parts.push(`   - Statements: ${statementText}`);
      }
      if (event.markdown) {
        parts.push(`   - Markdown:\n${indentBlock(event.markdown, 6)}`);
      }
      if (event.payloadSummary) {
        parts.push(`   - Payload:\n${indentBlock(event.payloadSummary, 6)}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");
}

function buildPromptSections(snapshot: SessionReportPromptSnapshot): {
  participantSection: string;
  statementSection: string;
  timelineSection: string;
  sessionSection: string;
} {
  const participantSection = `## 参加者ごとの回答まとめ\n${formatParticipantSummaries(snapshot.participantSummaries)}`;
  const statementSection = `## ステートメント別の回答比率\n${formatStatementStats(snapshot.statementStats)}`;
  const timelineSection = `## Event Thread の記録（時系列）\n${formatEventTimeline(snapshot.eventTimeline)}`;
  const participantContextFields = sessionParticipantContextFields(
    snapshot.session,
  );
  const sessionContextLines = [
    `- タイトル: ${snapshot.session.title}`,
    `- 回答者向けゴール: ${participantContextFields.goal || "(未設定)"}`,
    `- 回答者向けコンテキスト: ${participantContextFields.context || "(未設定)"}`,
    `- ファシリテーター用ゴール: ${sessionFacilitatorGoal(snapshot.session) || "(未設定)"}`,
    `- ファシリテーター用コンテキスト: ${sessionFacilitatorContext(snapshot.session) || "(未設定)"}`,
  ].join("\n");
  const sessionSection = `## セッション情報\n${sessionContextLines}`;

  return {
    participantSection,
    statementSection,
    timelineSection,
    sessionSection,
  };
}

function buildPromptMessages(options: {
  snapshot: SessionReportPromptSnapshot;
  requestMarkdown: string;
}): { system: string; user: string } {
  const sections = buildPromptSections(options.snapshot);
  const languageName =
    contentLanguageNames[toContentLanguage(options.snapshot.session.language)];
  const adminSection = options.requestMarkdown
    ? `## Admin Priority Request\n${options.requestMarkdown}`
    : "";

  const requirements = `## レポート作成の指示
Part 1: インサイトまとめ
- 認識の合意点、相違点、誰も確信を持てていない点を整理してください。
- 特に意外性のある発見を優先的に抽出してください。
- 参加者単位の分析や、似た傾向を持つ人たちのクラスタも示してください。

Part 2:
- ここまでのインサイトや情報を踏まえ、セッションのGoal達成に役立つ考察やレポートの構成を考え、書いてください。

フォーマット:
- GFM準拠のMarkdownのみを出力してください。
- タイトルやセクション見出しを活用し、読みやすい構造にしてください。
- 必ず${languageName}で記述し、簡潔かつ洞察的なトーンを保ってください。
- 問い（ステートメント）を参照する際は、必ず「#n」形式（例: #1, #5, #12）を使用してください。この形式はフロントエンドでインタラクティブな表示に利用されます。

図・図表:
- ASCIIアート（コードブロックでの擬似的な作図）は使わないでください。表示が崩れて読めません。
- 分類・象限・対立軸・関係・フローなど「構造や概念の図」は必ず \`\`\`mermaid フェンスで書いてください（フロントが図として描画します）。
  - 4象限の分類（合意マップ等）は quadrantChart。例:
    \`\`\`mermaid
    quadrantChart
      title 合意マップ
      x-axis "反対少" --> "反対多"
      y-axis "合意低" --> "合意高"
      quadrant-1 "即実行"
      quadrant-2 "深い議論"
      quadrant-3 "情報提供"
      quadrant-4 "様子見"
      "#10 光回線": [0.05, 0.87]
      "#5 集落集約": [0.43, 0.29]
    \`\`\`
    - x-axis / y-axis / quadrant-1〜4 のラベルと点のラベルは必ず "..." で囲んでください（括弧やコロンを素で書くと描画できません）。
  - 対立軸・関係・流れは graph。例:
    \`\`\`mermaid
    graph LR
      A[集約・合理化] --- B[分散・維持]
    \`\`\`
- 正しい構文の mermaid のみ書いてください（自信がなければ図をやめて GFM の表か箇条書きにする）。
- 賛否・合意度などの「実データの分布」はシステムが別途チャートで表示するので、本文で数値のグラフを作図しないでください（必要なら表で簡潔に示す）。`;

  const userMessage = [
    adminSection,
    sections.sessionSection,
    sections.participantSection,
    sections.statementSection,
    sections.timelineSection,
    requirements,
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemMessage = `あなたは組織開発に長けたファシリテーターです。提供されたデータから高品質な分析レポートを作成し、Markdownで${languageName}の出力のみを返してください。

${UNTRUSTED_DATA_RULE}`;

  return {
    system: systemMessage,
    user: userMessage,
  };
}

export async function generateSessionReport(
  reportId: string,
  budgetMs: number = REPORT_GENERATION_BUDGET_MS,
): Promise<void> {
  const { data: reportRow, error: reportError } = await supabase
    .from("session_reports")
    .select(
      "id, session_id, status, request_markdown, created_by, version, prompt_snapshot",
    )
    .eq("id", reportId)
    .maybeSingle();

  if (reportError || !reportRow) {
    console.error("Session report not found:", reportError);
    return;
  }

  if (reportRow.status === "completed") {
    return;
  }

  await supabase
    .from("session_reports")
    .update({
      status: "generating",
      updated_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", reportId);

  try {
    const session = await fetchSessionRow(reportRow.session_id);
    const statements = await fetchStatements(reportRow.session_id);
    const statementsById = new Map(
      statements.map((statement) => [statement.id, statement]),
    );
    const responses = await fetchResponses(reportRow.session_id);
    const participants = await fetchParticipants(reportRow.session_id);
    const timeline = await fetchTimelineEntries(
      reportRow.session_id,
      statementsById,
    );

    const snapshot: SessionReportPromptSnapshot = {
      session,
      participantSummaries: buildParticipantSummaries(
        participants,
        responses,
        statementsById,
        statements.length,
      ),
      statementStats: buildStatementStats(statements, responses),
      eventTimeline: timeline,
    };

    const prompt = buildPromptMessages({
      snapshot,
      requestMarkdown: reportRow.request_markdown ?? "",
    });

    const generation = await callLLMWithMeta(
      withOutputLanguage(
        [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        toContentLanguage(session.language),
      ),
      ACCURATE_MODEL,
      { signal: AbortSignal.timeout(budgetMs) },
    );

    await supabase
      .from("session_reports")
      .update({
        status: "completed",
        content_markdown: generation.content,
        prompt_snapshot: snapshot,
        model: generation.model,
        prompt_version: PROMPT_VERSIONS.sessionReport,
        generation_id: generation.generationId,
        token_usage: generation.usage,
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", reportId);
  } catch (error) {
    console.error(
      "Failed to generate session report:",
      sanitizeErrorForLog(error),
    );
    await supabase
      .from("session_reports")
      .update({
        status: "failed",
        error_message: describeReportFailure(error),
        updated_at: new Date().toISOString(),
      })
      .eq("id", reportId);
  }
}

// Admin-facing failure reason for a session report. Maps the upstream LLM status
// to an actionable reason so the admin sees the real cause rather than a blind
// generic error (and stops blindly retrying into the same wall). 403 is
// deliberately NOT asserted as a key-limit — it can also be moderation/permission
// — so the wording hedges and the provider's own reason is kept when present.
function describeReportFailure(error: unknown): string {
  if (error instanceof LLMAbortedError) {
    return encodeReportFailure("timeout");
  }
  if (error instanceof LLMUnavailableError) {
    const code =
      error.status === 402
        ? "credits"
        : error.status === 403
          ? "forbidden"
          : error.status === 429
            ? "rateLimited"
            : "unavailable";
    return encodeReportFailure(
      code,
      error.status === 429 ? null : error.providerMessage,
    );
  }
  return error instanceof Error
    ? error.message
    : "Unknown error while generating report";
}

export async function triggerSessionReportGeneration(
  reportId: string,
): Promise<void> {
  try {
    await generateSessionReport(reportId);
  } catch (error) {
    console.error(
      "Session report generation task failed:",
      sanitizeErrorForLog(error),
    );
  }
}
