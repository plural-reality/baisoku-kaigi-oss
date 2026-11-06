"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";

export interface ResponseLogItem {
  statementId: string;
  statementText: string;
  orderIndex: number;
  responseType: "scale" | "free_text" | null;
  value: number | null;
  textResponse: string | null;
  answeredAt: string | null;
}

export interface ResponseLogParticipant {
  userId: string;
  name: string;
  joinedAt: string;
  responses: ResponseLogItem[];
}

// フラットなテーブル行の型定義
export type ResponseLogRow = {
  participantUserId: string;
  participantName: string;
  joinedAt: string;
} & Record<string, ResponseLogItem | string>;

export function formatDateTime(isoString: string, locale = "ja"): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Shared scale (賛否) badge: colored circle (±value) + 賛成/反対 label. Used by
// both the response-log table and the per-participant detail modal so the two
// views render answers identically.
export function ScaleBadge({ value }: { value: number | null }) {
  const tGrade = useTranslations("grades");
  const tLogs = useTranslations("responseLogs");
  const tone =
    value === 1 || value === 2
      ? "bg-success-soft text-success"
      : value === -1 || value === -2
        ? "bg-warning-soft text-warning"
        : "bg-muted text-muted-foreground";
  const label =
    value === 2
      ? tGrade("strongAgree")
      : value === 1
        ? tGrade("agree")
        : value === 0
          ? tLogs("unsureLong")
          : value === -1
            ? tGrade("disagree")
            : value === -2
              ? tGrade("strongDisagree")
              : tLogs("unanswered");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      <span className="font-semibold">
        {value !== null ? (value > 0 ? `+${value}` : value) : "?"}
      </span>
      {label}
    </span>
  );
}

function Unanswered() {
  const tLogs = useTranslations("responseLogs");
  return (
    <span className="text-xs text-muted-foreground">{tLogs("unanswered")}</span>
  );
}

function JoinedAt({ value }: { value: string }) {
  const locale = useLocale();
  return (
    <span className="text-xs text-muted-foreground">
      {formatDateTime(value, locale)}
    </span>
  );
}

function ColumnLabel({
  messageKey,
  values,
}: {
  messageKey: "participant" | "statementNumber" | "reportColumn";
  values?: Record<string, number>;
}) {
  const tLogs = useTranslations("responseLogs");
  return <>{tLogs(messageKey, values)}</>;
}

export function renderResponseCell(
  response: ResponseLogItem | null | undefined,
) {
  if (!response || response.responseType === null) {
    return <Unanswered />;
  }

  if (response.responseType === "scale") {
    return <ScaleBadge value={response.value} />;
  }

  if (response.responseType === "free_text") {
    return (
      <div className="max-w-xs">
        <p
          className="text-xs text-muted-foreground"
          title={response.textResponse ?? undefined}
        >
          {response.textResponse}
        </p>
      </div>
    );
  }

  return <Unanswered />;
}

export function createResponseLogColumns(
  statements: Array<{ id: string; text: string; orderIndex: number }>,
  onOpenParticipant?: (userId: string) => void,
): ColumnDef<ResponseLogRow>[] {
  const baseColumns: ColumnDef<ResponseLogRow>[] = [
    {
      accessorKey: "participantName",
      header: () => <ColumnLabel messageKey="participant" />,
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">
            {row.original.participantName}
          </span>
          <JoinedAt value={row.original.joinedAt} />
        </div>
      ),
    },
  ];

  const statementColumns: ColumnDef<ResponseLogRow>[] = statements.map(
    (statement) => ({
      accessorKey: `statement_${statement.id}`,
      header: () => (
        <div className="flex flex-col gap-1 min-w-[200px]">
          <span className="text-xs text-muted-foreground">
            <ColumnLabel
              messageKey="statementNumber"
              values={{ number: statement.orderIndex + 1 }}
            />
          </span>
          <span className="text-xs font-normal" title={statement.text}>
            {statement.text}
          </span>
        </div>
      ),
      cell: ({ row }) => {
        const response = row.original[
          `statement_${statement.id}`
        ] as ResponseLogItem;
        return renderResponseCell(response);
      },
    }),
  );

  const reportColumn: ColumnDef<ResponseLogRow> = {
    accessorKey: "individualReport",
    header: () => (
      <div className="min-w-[180px] text-xs">
        <ColumnLabel messageKey="reportColumn" />
      </div>
    ),
    cell: ({ row }) => {
      const report = (row.original.individualReport as string) ?? "";
      if (!report) {
        return <span className="text-xs text-muted-foreground">—</span>;
      }
      const userId = row.original.participantUserId;
      return (
        <button
          type="button"
          onClick={() => onOpenParticipant?.(userId)}
          className="line-clamp-2 max-w-[220px] whitespace-pre-wrap text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {report}
        </button>
      );
    },
  };

  return [...baseColumns, reportColumn, ...statementColumns];
}
