"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type BeeswarmStatementInput,
  dotColor,
  layoutBeeswarm,
  placeableData,
  toDatum,
} from "./consensus-beeswarm-layout";

const VIEW_W = 600;
// Small horizontal inset — just enough room for the largest dot radius so the
// axis/gradient span nearly the full card width (matching the cards below).
const PAD_X = 16;

// 合意度マップ: every statement as one dot on a 全員反対↔全員賛成 axis (position =
// agree rate among 賛否 voters). Position alone tells the story — center = 賛否が
// 割れる (対立), ends = まとまり — so the top3 lists below read straight off the
// axis. Hover a dot (or its card) to surface the breakdown; click to open its card.
export function ConsensusBeeswarm({
  statements,
  height = 240,
  highlightedId = null,
  onHover,
  onOpenStatement,
}: {
  statements: BeeswarmStatementInput[];
  height?: number;
  // Externally-driven emphasis (e.g. hovering a card highlights its dot).
  highlightedId?: string | null;
  onHover?: (id: string | null) => void;
  // Click a dot → open that statement's detail modal (same as clicking a card).
  onOpenStatement?: (id: string) => void;
}) {
  const t = useTranslations("beeswarm");
  const [hideLowVotes, setHideLowVotes] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Click pins the tooltip only when there is no detail modal to open (e.g. the
  // report/print page). On the admin page, click opens the modal instead.
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const placeable = useMemo(
    () => placeableData(statements.map(toDatum)),
    [statements],
  );
  // Low-response filter uses 賛否 votes (= what x depends on), not total
  // responses, so a "1 賛成 / 12 わからない" statement is treated as low-signal.
  const data = useMemo(
    () => (hideLowVotes ? placeable.filter((d) => d.voteCount > 1) : placeable),
    [placeable, hideLowVotes],
  );
  const hiddenCount = placeable.length - data.length;
  const hasSizeVariation = useMemo(
    () => new Set(data.map((d) => d.voteCount)).size > 1,
    [data],
  );

  const layout = useMemo(
    () =>
      layoutBeeswarm(data, {
        width: VIEW_W,
        height,
        padX: PAD_X,
        minR: 5,
        maxR: 13,
      }),
    [data, height],
  );

  const tooltipId = pinnedId ?? hoveredId;
  const emphasizedId = pinnedId ?? hoveredId ?? highlightedId;
  const active = useMemo(
    () => layout.find((p) => p.datum.id === tooltipId) ?? null,
    [layout, tooltipId],
  );

  const setHover = (id: string | null) => {
    setHoveredId(id);
    onHover?.(id);
  };

  // A pinned tooltip (report page) is dismissed by Escape or an outside click.
  useEffect(() => {
    if (!pinnedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinnedId(null);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setPinnedId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [pinnedId]);

  if (placeable.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
        {t("noVotes")}
      </p>
    );
  }

  // Render the emphasized dot last so it sits on top of its neighbours.
  const ordered = [...layout].sort(
    (a, b) =>
      (a.datum.id === emphasizedId ? 1 : 0) -
      (b.datum.id === emphasizedId ? 1 : 0),
  );

  return (
    <div ref={containerRef} className="w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {hasSizeVariation ? t("legendWithSize") : t("legend")}
        </p>
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground print:hidden">
          <input
            type="checkbox"
            checked={hideLowVotes}
            onChange={(e) => setHideLowVotes(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-foreground"
          />
          {t("hideLowVotes")}
        </label>
      </div>

      {layout.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          {t("nothingToShow")}
        </p>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${VIEW_W} ${height}`}
            className="block h-auto w-full"
            role="img"
            aria-label={t("chartLabel")}
          >
            <line
              x1={PAD_X}
              y1={height / 2}
              x2={VIEW_W - PAD_X}
              y2={height / 2}
              stroke="rgb(148 163 184 / 0.35)"
              strokeWidth={1}
            />
            {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
              <line
                key={tick}
                x1={PAD_X + tick * (VIEW_W - 2 * PAD_X)}
                y1={height / 2 - 5}
                x2={PAD_X + tick * (VIEW_W - 2 * PAD_X)}
                y2={height / 2 + 5}
                stroke="rgb(148 163 184 / 0.45)"
                strokeWidth={1}
              />
            ))}
            {ordered.map((dot) => {
              const id = dot.datum.id;
              const isEmphasized = id === emphasizedId;
              // 確信度 = 賛否を選んだ割合。わからないが多いほど薄くなり、「ほぼ全員
              // わからない」の論点が「全員賛成」の緑に見えてしまうのを防ぐ。
              const certainty =
                dot.datum.responseCount > 0
                  ? dot.datum.voteCount / dot.datum.responseCount
                  : 1;
              const baseOpacity = 0.25 + 0.75 * certainty;
              const activate = () => {
                if (onOpenStatement) onOpenStatement(id);
                else setPinnedId((prev) => (prev === id ? null : id));
              };
              return (
                // biome-ignore lint/a11y/useSemanticElements: an SVG <circle> cannot be a native <button>; role + keyboard handlers give it equivalent semantics.
                <circle
                  key={id}
                  cx={dot.x}
                  cy={dot.y}
                  r={dot.r}
                  fill={dotColor(dot.datum.agreeRate as number)}
                  fillOpacity={isEmphasized ? 1 : baseOpacity}
                  // currentColor follows `text-foreground` → black ring in light
                  // mode, white ring in dark mode (visible on any dot color).
                  stroke={isEmphasized ? "currentColor" : "none"}
                  strokeWidth={isEmphasized ? 2.5 : 0}
                  className="cursor-pointer text-foreground outline-none transition-[stroke,fill-opacity] duration-150"
                  role="button"
                  tabIndex={0}
                  aria-label={t(
                    onOpenStatement ? "dotLabelDetail" : "dotLabelPin",
                    {
                      pct: Math.round((dot.datum.agreeRate as number) * 100),
                      votes: dot.datum.voteCount,
                    },
                  )}
                  onMouseEnter={() => setHover(id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(id)}
                  onBlur={() => setHover(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    activate();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      activate();
                    }
                  }}
                />
              );
            })}
          </svg>

          {active ? (
            <div
              className="pointer-events-none absolute z-20 w-[min(280px,80vw)] -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-lg"
              style={{
                left: `${(active.x / VIEW_W) * 100}%`,
                top: `${(active.y / height) * 100}%`,
                marginTop: -(active.r + 8),
              }}
            >
              <p className="mb-1 line-clamp-4 text-xs leading-relaxed text-foreground">
                {active.datum.text}
              </p>
              <p className="text-[11px] font-semibold text-foreground">
                {t("agreePct", {
                  pct: Math.round((active.datum.agreeRate as number) * 100),
                })}
                <span className="ml-1 font-normal text-muted-foreground">
                  {t("ofVoters", { votes: active.datum.voteCount })}
                </span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                <span className="text-emerald-600 dark:text-emerald-400">
                  {t("agreeCount", { count: active.datum.agreeCount })}
                </span>
                <span className="mx-1">{t("separator")}</span>
                <span className="text-rose-600 dark:text-rose-400">
                  {t("disagreeCount", { count: active.datum.disagreeCount })}
                </span>
                <span className="mx-1">{t("separator")}</span>
                {t("unsureCount", { count: active.datum.dontKnowCount })}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("confidence", {
                  pct:
                    active.datum.responseCount > 0
                      ? Math.round(
                          (active.datum.voteCount /
                            active.datum.responseCount) *
                            100,
                        )
                      : 100,
                })}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* Gradient legend + axis labels */}
      <div
        className="mt-1.5 h-1.5 rounded-full"
        style={{
          marginLeft: `${(PAD_X / VIEW_W) * 100}%`,
          marginRight: `${(PAD_X / VIEW_W) * 100}%`,
          background:
            "linear-gradient(to right, #e04e4e, #d4a643, #a8c44b, #68cd52)",
        }}
      />
      <div
        className="mt-1 flex justify-between text-[11px] font-semibold"
        style={{
          marginLeft: `${(PAD_X / VIEW_W) * 100}%`,
          marginRight: `${(PAD_X / VIEW_W) * 100}%`,
        }}
      >
        <span className="text-rose-600 dark:text-rose-400">
          {t("allDisagree")}
        </span>
        <span className="text-muted-foreground">{t("divided")}</span>
        <span className="text-emerald-600 dark:text-emerald-400">
          {t("allAgree")}
        </span>
      </div>

      {hideLowVotes && hiddenCount > 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground print:hidden">
          {t("hiddenCount", { count: hiddenCount })}
        </p>
      ) : null}
    </div>
  );
}
