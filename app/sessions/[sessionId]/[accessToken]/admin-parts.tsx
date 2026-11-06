"use client";

import { Info, Maximize2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type {
  StatementHighlight,
  StatementHighlightMetric,
} from "@/components/opinion/statement-highlights";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  getParticipantProgressRatio,
  getParticipantStatus,
  PARTICIPANT_STATUS_META,
} from "./participant-progress";

// Admin dashboard parts shared by the admin page and the marketing-site demo
// (/embed/demo), so the demo follows this UI without a hand-made copy.

export interface StatementResponseStats {
  strongYes: number;
  yes: number;
  dontKnow: number;
  no: number;
  strongNo: number;
  // raw integer people-counts per bucket (one dot per person == stated number).
  counts: {
    strongYes: number;
    yes: number;
    dontKnow: number;
    no: number;
    strongNo: number;
  };
  totalCount: number;
  freeTextCount: number;
  freeTextSamples: Array<{ participantUserId: string | null; text: string }>;
}

export interface StatementWithStats {
  id: string;
  sessionId: string;
  text: string;
  orderIndex: number;
  responses: StatementResponseStats;
  agreementScore: number;
}

export interface ParticipantProgress {
  userId: string;
  name: string;
  answeredCount: number;
  completionRate: number;
  totalStatements: number;
  updatedAt: string;
}

// Relative time in the viewer's locale (Intl), e.g. 5分前 / 5 minutes ago.
export const formatDateTime = (value: string, locale: string) => {
  const date = new Date(value);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (minutes < 1) return relative.format(0, "second");
  if (minutes < 60) return relative.format(-minutes, "minute");
  if (hours < 24) return relative.format(-hours, "hour");
  if (days < 7) return relative.format(-days, "day");

  return date.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

export const formatPercentage = (value: number) => {
  if (Number.isNaN(value)) return "0%";
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) {
    return `${Math.round(rounded)}%`;
  }
  return `${rounded.toFixed(1)}%`;
};

export interface MonitoringMetricProps {
  label: string;
  value: string;
  subLabel?: string;
  testId?: string;
  tone?: "default" | "emerald";
}

export function MonitoringMetric({
  label,
  value,
  subLabel,
  testId,
  tone = "default",
}: MonitoringMetricProps) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200/70 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-100"
      : "bg-card border-border text-foreground";
  return (
    <div
      data-testid={testId}
      className={`rounded-2xl border px-4 py-4 shadow-sm ${toneClass}`}
    >
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      {subLabel && (
        <p className="mt-2 text-xs text-muted-foreground">{subLabel}</p>
      )}
    </div>
  );
}

export interface ParticipantProgressRowProps {
  participant: ParticipantProgress;
  onExpand?: () => void;
}

export function ParticipantProgressRow({
  participant,
  onExpand,
}: ParticipantProgressRowProps) {
  const tA = useTranslations("admin");
  const tStatus = useTranslations("participantStatus");
  const locale = useLocale();
  const completionLabel = formatPercentage(participant.completionRate);
  const updatedLabel = formatDateTime(participant.updatedAt, locale);
  const progressRatio = getParticipantProgressRatio(participant);
  const status = getParticipantStatus(participant);
  const statusMeta = PARTICIPANT_STATUS_META[status];
  const activityLabel =
    status === "not_started"
      ? tA("joinedRelative", { time: updatedLabel })
      : tA("updatedRelative", { time: updatedLabel });
  const statusLabel = tStatus(status);

  return (
    <div
      data-testid="participant-progress-card"
      className={`flex h-full flex-col gap-2 rounded-xl border p-3 shadow-sm ${statusMeta.cardClassName}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">
              {participant.name || tA("anonymous")}
            </p>
            {onExpand ? (
              <button
                type="button"
                data-testid="participant-status-badge"
                onClick={onExpand}
                aria-label={tA("openParticipantLabel", { status: statusLabel })}
                title={tA("openParticipantTitle")}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0 text-[10px] font-semibold transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 ${statusMeta.badgeClassName}`}
              >
                {statusLabel}
                <Maximize2 className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : (
              <Badge
                data-testid="participant-status-badge"
                variant="outline"
                className={`px-2 py-0 text-[10px] ${statusMeta.badgeClassName}`}
              >
                {statusLabel}
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground dark:text-muted-foreground">
            {activityLabel}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-foreground">
            {completionLabel}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {participant.answeredCount}/{participant.totalStatements}
          </p>
        </div>
      </div>
      <Progress value={progressRatio} className="mt-2 h-1" />
    </div>
  );
}

export type HighlightTone = "agree" | "conflict" | "unsure";
export type AdminStatementHighlight = StatementHighlight<StatementWithStats>;

// 5-point grade gradient (強く反対 → 強く賛成), shared by the merit profile and
// the per-card accent tints. red → orange → amber → lime → green.
export const MINI_AGREE_COLOR: Record<number, string> = {
  [-2]: "#ef4444",
  [-1]: "#f97316",
  [0]: "#f59e0b",
  [1]: "#84cc16",
  [2]: "#10b981",
};

// --- 賛否の分布バー -------------------------------------------------------
// Per-statement 賛否 distribution as a single 100%-stacked bar over the 4
// 賛否 grades (強く反対 → 強く賛成), colored red→green. わからない is "no opinion"
// (not an ordinal grade), so it is EXCLUDED from the bar and reported separately.
// No median label/line — the color balance shows the lean, and it stays
// consistent with the 合意度マップ axis (反対=左/赤, 賛成=右/緑).
export const MJ_GRADE_KEY = {
  [-2]: "strongDisagree",
  [-1]: "disagree",
  [1]: "agree",
  [2]: "strongAgree",
} as const satisfies Record<number, string>;
export type MjGrade = keyof typeof MJ_GRADE_KEY;

export type MeritProfile = {
  voteCount: number;
  dontKnowCount: number;
  segs: { v: number; n: number; pct: number }[];
};

// dontKnowCount folds in free-text answerers (matches responses.counts).
export function meritProfile(
  responses: StatementWithStats["responses"],
): MeritProfile {
  const c = responses.counts;
  const grades = [
    { v: -2, n: c.strongNo },
    { v: -1, n: c.no },
    { v: 1, n: c.yes },
    { v: 2, n: c.strongYes },
  ];
  const voteCount = grades.reduce((a, g) => a + g.n, 0);
  return {
    voteCount,
    dontKnowCount: c.dontKnow,
    segs: grades.map((g) => ({
      v: g.v,
      n: g.n,
      pct: voteCount > 0 ? (g.n / voteCount) * 100 : 0,
    })),
  };
}

// Replaces the old per-statement beeswarm. `full` adds a per-grade legend with
// people-counts (used in the detail modal); the compact form is just the bar.
export function StatementMeritProfile({
  responses,
  full = false,
}: {
  responses: StatementWithStats["responses"];
  full?: boolean;
}) {
  const tA = useTranslations("admin");
  const tGrade = useTranslations("grades");
  const gradeLabel = (v: number) => tGrade(MJ_GRADE_KEY[v as MjGrade]);
  const m = meritProfile(responses);
  if (m.voteCount === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        {tA("noVotes")}
        {m.dontKnowCount > 0
          ? tA("unsureCountParen", { count: m.dontKnowCount })
          : ""}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {/* 賛否 distribution: 反対(赤) ← → 賛成(緑), 100% of 賛否 voters */}
      <div
        role="img"
        className="relative h-4 w-full overflow-hidden rounded"
        aria-label={tA("distributionLabel", {
          parts: m.segs
            .map((s) =>
              tA("gradeCount", { grade: gradeLabel(s.v), count: s.n }),
            )
            .join(tA("separator")),
        })}
      >
        <div className="flex h-full w-full">
          {m.segs.map((s) =>
            s.pct > 0 ? (
              <div
                key={s.v}
                style={{
                  width: `${s.pct}%`,
                  backgroundColor: MINI_AGREE_COLOR[s.v],
                }}
                title={tA("gradeCountPct", {
                  grade: gradeLabel(s.v),
                  count: s.n,
                  pct: Math.round(s.pct),
                })}
              />
            ) : null,
          )}
        </div>
      </div>
      {full ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5 text-[11px] text-muted-foreground">
          {m.segs.map((s) => (
            <span key={s.v} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: MINI_AGREE_COLOR[s.v] }}
              />
              {gradeLabel(s.v)} {s.n}
            </span>
          ))}
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        {tA("voteSummary", { votes: m.voteCount, unsure: m.dontKnowCount })}
      </p>
    </div>
  );
}

export function StatementHighlightColumn({
  title,
  tone,
  items,
  metric,
  info,
  onOpenStatement,
  nameMap,
  highlightedId,
  onHover,
}: {
  title: string;
  tone: HighlightTone;
  items: AdminStatementHighlight[];
  metric: StatementHighlightMetric;
  info: string;
  onOpenStatement?: (statementId: string) => void;
  // Resolves a free-text sample's participantUserId → display name for the
  // per-card 自由記述 preview (mirrors the modal's attribution).
  nameMap: Record<string, string>;
  // Shared hover with the 合意度マップ (hovering a card emphasizes its dot).
  highlightedId: string | null;
  onHover: (statementId: string | null) => void;
}) {
  const tA = useTranslations("admin");
  // Accent tints aligned to the grade semantics (賛成=emerald / わからない=
  // amber) so the page reads as one palette. 対立 uses rose for "tension".
  const toneClass = {
    agree:
      "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800/50",
    conflict:
      "bg-rose-50 border-rose-200 dark:bg-rose-950/20 dark:border-rose-800/50",
    unsure:
      "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/50",
  }[tone];
  const badgeClass = {
    agree:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
    conflict:
      "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
    unsure:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  }[tone];

  const unsureSuffix = (item: AdminStatementHighlight) =>
    item.dontKnowCount > 0
      ? tA("metricUnsureSuffix", { count: item.dontKnowCount })
      : "";
  const metricLine = (item: AdminStatementHighlight) =>
    ({
      consensus:
        item.agreeCount >= item.disagreeCount
          ? `${tA("metricConsensusAgree", {
              pct: item.agreePct,
              votes: item.voteCount,
              count: item.agreeCount,
            })}${unsureSuffix(item)}`
          : `${tA("metricConsensusDisagree", {
              pct: item.disagreePct,
              votes: item.voteCount,
              count: item.disagreeCount,
            })}${unsureSuffix(item)}`,
      conflict: tA("metricConflict", {
        agree: item.agreeCount,
        disagree: item.disagreeCount,
      }),
      dontKnow: tA("metricUnsure", {
        pct: item.dontKnowPct,
        respondents: item.respondents,
        count: item.dontKnowCount,
      }),
    })[metric];

  // Each column is a subgrid section so the header + same-rank cards line up
  // across the three columns (equal row heights). On mobile it collapses to a
  // normal vertical stack.
  return (
    <section className="relative grid content-start gap-3 lg:row-span-4 lg:grid-rows-subgrid">
      {/* The section anchors the info popover, so it spans the card instead of running past the
          screen's edge from an icon near it. */}
      <h3 className="flex items-center gap-1 text-sm font-semibold text-foreground">
        {title}
        <span className="group inline-flex">
          {/* A button so a tap (Safari does not focus a tapped button, hence the explicit focus) or the keyboard opens it too. */}
          <button
            type="button"
            aria-label={info}
            onClick={(event) => event.currentTarget.focus()}
            className="inline-flex rounded-sm"
          >
            <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground transition hover:text-foreground" />
          </button>
          <span className="pointer-events-none invisible absolute inset-x-0 top-7 z-20 rounded-lg border border-border bg-popover p-2.5 text-[11px] font-normal leading-relaxed text-popover-foreground opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
            {info}
          </span>
        </span>
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tA("notEnoughData")}</p>
      ) : (
        items.map((item, index) => (
          <button
            type="button"
            key={item.statement.id}
            onClick={() => onOpenStatement?.(item.statement.id)}
            onMouseEnter={() => onHover(item.statement.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(item.statement.id)}
            onBlur={() => onHover(null)}
            aria-label={tA("viewAnswersFor", {
              statement: item.statement.text,
            })}
            className={`group flex h-full w-full flex-col rounded-2xl border px-4 py-3 text-left shadow-sm transition hover:shadow-md hover:ring-2 hover:ring-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 ${toneClass} ${
              highlightedId === item.statement.id
                ? "ring-2 ring-foreground/40"
                : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}
              >
                #{index + 1}
              </span>
              <Maximize2
                className="h-3.5 w-3.5 text-muted-foreground opacity-50 transition group-hover:opacity-100"
                aria-hidden="true"
              />
            </div>
            {/* Reserve 3 lines for the question so the bar/metric/自由記述 below
                line up across all cards in a row (1–3 line questions, clamp at 3). */}
            <p className="mt-2 line-clamp-3 min-h-[4.25rem] text-sm font-bold text-foreground leading-relaxed">
              {item.statement.text}
            </p>
            <div className="mt-2">
              <StatementMeritProfile responses={item.statement.responses} />
            </div>
            {/* Reserve 2 lines so the 自由記述 box starts at the same height across
                cards; remaining slack pools as empty space at the card bottom. */}
            <p className="mt-3 min-h-[2.5rem] text-xs text-foreground">
              {metricLine(item)}
            </p>
            {item.statement.responses.freeTextSamples.length > 0 && (
              <div className="mt-3 rounded-xl border border-border bg-muted/70 px-3 py-2 text-[11px] text-muted-foreground shadow-inner">
                <span className="font-semibold text-foreground">
                  {tA("freeTextCount", {
                    count: item.statement.responses.freeTextSamples.length,
                  })}
                </span>
                <div className="mt-2 space-y-1">
                  {item.statement.responses.freeTextSamples
                    .slice(0, 2)
                    .map((s) => (
                      <div
                        key={`${item.statement.id}-${s.participantUserId ?? ""}-${s.text}`}
                        className="whitespace-pre-wrap break-words text-muted-foreground"
                      >
                        {tA("bullet")}
                        {s.text}
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          —{" "}
                          {s.participantUserId
                            ? (nameMap[s.participantUserId] ?? tA("anonymous"))
                            : tA("anonymous")}
                        </span>
                      </div>
                    ))}
                  {item.statement.responses.freeTextSamples.length > 2 && (
                    <div className="text-[10px] text-muted-foreground">
                      {tA("moreItems", {
                        count:
                          item.statement.responses.freeTextSamples.length - 2,
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </button>
        ))
      )}
    </section>
  );
}
