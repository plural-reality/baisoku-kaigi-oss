"use client";

import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ConsensusBeeswarm } from "@/components/ConsensusBeeswarm";
import { buildStatementHighlights } from "@/components/opinion/statement-highlights";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { Locale } from "@/i18n/locales";
import {
  formatPercentage,
  MonitoringMetric,
  ParticipantProgressRow,
  StatementHighlightColumn,
} from "@/sessions/[sessionId]/[accessToken]/admin-parts";
import { summarizeParticipants } from "@/sessions/[sessionId]/[accessToken]/participant-progress";
import {
  type ParticipantResponse,
  ResponseItemCard,
} from "@/sessions/[sessionId]/response-item";
import {
  DEMO_ANSWERS,
  DEMO_TITLE,
  demoNameMap,
  demoParticipants,
  demoStatements,
  demoTimeline,
} from "./fixtures";
import type { DemoScene } from "./scenes";

const PLAY_MESSAGE = { type: "baisoku-kaigi-demo", action: "play" } as const;
// Sent to the embedding page once the scene has rendered, so it can tell a
// working frame from an error page (a gateway error still fires `load`) and
// fall back to a still image when this never arrives.
const READY_MESSAGE = { type: "baisoku-kaigi-demo", event: "ready" } as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
};

// Milliseconds since the scene last (re)started, capped at `durationMs`. A
// scene plays once on load and again on every play message from the embedding
// page. With reduced motion it jumps straight to the final state.
const useSceneClock = (durationMs: number) => {
  const reduced = useReducedMotion();
  const [plays, setPlays] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Partial<typeof PLAY_MESSAGE> | null;
      if (data?.type === PLAY_MESSAGE.type && data.action === "play") {
        setPlays((n) => n + 1);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `plays` restarts the clock
  useEffect(() => {
    if (reduced) {
      setElapsed(durationMs);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(durationMs, now - start);
      setElapsed(t);
      raf = t < durationMs ? requestAnimationFrame(tick) : 0;
    };
    setElapsed(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [plays, reduced, durationMs]);

  return elapsed;
};

// Scroll offset that keeps `target` near the top third of the viewport.
const useFollow = (
  target: HTMLElement | null,
  container: HTMLElement | null,
  deps: unknown,
) => {
  const [y, setY] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the step changes
  useLayoutEffect(() => {
    if (!target || !container) return;
    const top =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top;
    setY(Math.max(0, top - window.innerHeight * 0.3));
  }, [target, container, deps]);
  return y;
};

// --- 回答（参加者の画面）----------------------------------------------------
const STEP_MS = 1500;
const SELECT_AT_MS = 700;

function ParticipantScene({ locale }: { locale: Locale }) {
  const t = useTranslations("participant");
  const statements = useMemo(() => demoTimeline(locale), [locale]);
  const elapsed = useSceneClock(DEMO_ANSWERS.length * STEP_MS);
  const step = Math.min(DEMO_ANSWERS.length, Math.floor(elapsed / STEP_MS));
  const selecting =
    step < DEMO_ANSWERS.length && elapsed - step * STEP_MS >= SELECT_AT_MS;
  const [main, setMain] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState<HTMLDivElement | null>(null);
  const y = useFollow(active, main, step);

  const responseOf = (index: number): ParticipantResponse | undefined =>
    index < step || (index === step && selecting)
      ? {
          statementId: statements[index].id,
          statementText: statements[index].text,
          orderIndex: index,
          responseType: "scale",
          value: DEMO_ANSWERS[index],
          createdAt: new Date(0).toISOString(),
        }
      : undefined;

  return (
    <div className="min-h-svh bg-background">
      <AppHeader
        sticky
        embedded
        centerContent={
          <span className="text-xs font-medium text-muted-foreground">
            {t("questionProgress", {
              current: step + 1,
              total: statements.length,
            })}
          </span>
        }
        belowContent={
          <Progress
            value={(step / statements.length) * 100}
            className="h-1 rounded-none"
          />
        }
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 pt-4 pb-0">
        <div className="mb-8 space-y-8">
          <main
            ref={setMain}
            className="relative w-full max-w-xl mx-auto min-h-svh flex flex-col items-center gap-6 pb-40 transition-transform duration-700 ease-out"
            style={{ transform: `translateY(${-y}px)` }}
          >
            {statements.map((statement, index) => (
              <ResponseItemCard
                key={statement.id}
                statement={statement}
                phase={
                  index < step ? "past" : index === step ? "active" : "future"
                }
                distance={index - step}
                response={responseOf(index)}
                isLoading={false}
                isPastCollapsed
                alternativesOpen={false}
                itemRef={index === step ? setActive : undefined}
              />
            ))}
          </main>
        </div>
      </div>
    </div>
  );
}

// --- 論点の可視化（管理画面）------------------------------------------------
const FILL_MS = 2500;
const SCROLL_MS = 1000;
const HOVER_FROM_MS = 3600;
const HOVER_EVERY_MS = 1000;
const ISSUES_MS = 7000;

// The admin page around a scene; `scrollProgress` (0..1) scrolls it until
// `scrollTarget` reaches the top of the frame (or the page ends).
function AdminFrame({
  locale,
  scrollProgress = 0,
  scrollTarget,
  children,
}: {
  locale: Locale;
  scrollProgress?: number;
  scrollTarget?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const overflow = Math.max(0, content.scrollHeight - window.innerHeight);
      const target = scrollTarget?.current;
      const toTarget = target
        ? target.getBoundingClientRect().top -
          content.getBoundingClientRect().top -
          24
        : 0;
      setDistance(Math.min(overflow, Math.max(0, toTarget)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollTarget]);

  return (
    <div
      ref={contentRef}
      className="min-h-svh bg-background"
      style={{ transform: `translateY(${-distance * scrollProgress}px)` }}
    >
      <AppHeader embedded />
      <div className="max-w-[90rem] mx-auto px-6 py-10 space-y-10">
        <header className="space-y-4">
          <h1 className="text-3xl font-semibold text-foreground">
            {DEMO_TITLE[locale]}
          </h1>
        </header>
        {children}
      </div>
    </div>
  );
}

function IssuesScene({ locale }: { locale: Locale }) {
  const tA = useTranslations("admin");
  const elapsed = useSceneClock(ISSUES_MS);
  const fill = 0.25 + 0.75 * easeOut(elapsed / FILL_MS);
  const statements = useMemo(
    () => demoStatements(locale, Math.round(fill * 20) / 20),
    [locale, fill],
  );
  const highlights = useMemo(
    () => buildStatementHighlights(statements),
    [statements],
  );
  const nameMap = useMemo(() => demoNameMap(locale), [locale]);
  // Walk the #1 card of each column, as a host pointing at the map would.
  const tour = [
    highlights.conflict[0],
    highlights.dontKnow[0],
    highlights.consensus[0],
  ].filter(Boolean);
  const hoverIndex = Math.floor((elapsed - HOVER_FROM_MS) / HOVER_EVERY_MS);
  const highlightedId =
    hoverIndex >= 0 && hoverIndex < tour.length
      ? tour[hoverIndex].statement.id
      : null;
  const noop = () => {};
  const columnsRef = useRef<HTMLDivElement>(null);

  return (
    <AdminFrame
      locale={locale}
      scrollProgress={easeOut((elapsed - FILL_MS) / SCROLL_MS)}
      scrollTarget={columnsRef}
    >
      <Card>
        <CardHeader>
          <div className="space-y-2">
            <CardTitle>{tA("issuesTitle")}</CardTitle>
            <CardDescription>{tA("issuesDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              {tA("consensusMap")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {tA("consensusMapHelp")}
            </p>
            <ConsensusBeeswarm
              statements={statements}
              highlightedId={highlightedId}
            />
          </section>
          <div
            ref={columnsRef}
            className="grid gap-x-6 gap-y-3 lg:grid-cols-3 lg:grid-rows-[auto_auto_auto_auto]"
          >
            <StatementHighlightColumn
              title={tA("topConflict")}
              tone="conflict"
              metric="conflict"
              info={tA("topConflictInfo")}
              items={highlights.conflict}
              nameMap={nameMap}
              highlightedId={highlightedId}
              onHover={noop}
            />
            <StatementHighlightColumn
              title={tA("topUnsure")}
              tone="unsure"
              metric="dontKnow"
              info={tA("topUnsureInfo")}
              items={highlights.dontKnow}
              nameMap={nameMap}
              highlightedId={highlightedId}
              onHover={noop}
            />
            <StatementHighlightColumn
              title={tA("topConsensus")}
              tone="agree"
              metric="consensus"
              info={tA("topConsensusInfo")}
              items={highlights.consensus}
              nameMap={nameMap}
              highlightedId={highlightedId}
              onHover={noop}
            />
          </div>
        </CardContent>
      </Card>
    </AdminFrame>
  );
}

// --- 参加者状況の把握（管理画面）--------------------------------------------
const PARTICIPANTS_MS = 4000;

function ParticipantsScene({ locale }: { locale: Locale }) {
  const tA = useTranslations("admin");
  const elapsed = useSceneClock(PARTICIPANTS_MS);
  const progress =
    Math.round((0.35 + 0.65 * easeOut(elapsed / PARTICIPANTS_MS)) * 20) / 20;
  const participants = useMemo(
    () =>
      demoParticipants(locale, progress).sort(
        (a, b) => b.completionRate - a.completionRate,
      ),
    [locale, progress],
  );
  const summary = summarizeParticipants(participants);

  return (
    <AdminFrame locale={locale}>
      <Card>
        <CardHeader>
          <CardTitle>{tA("participantsTitle")}</CardTitle>
          <CardDescription>{tA("participantsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MonitoringMetric
              label={tA("statParticipants")}
              value={tA("peopleCount", { count: participants.length })}
            />
            <MonitoringMetric
              label={tA("statAverageRate")}
              value={formatPercentage(summary.averageCompletion)}
              tone="emerald"
            />
            <MonitoringMetric
              label={tA("statCompleted")}
              value={tA("peopleCount", { count: summary.completedCount })}
              subLabel={tA("statNotStarted", {
                count: summary.notStartedCount,
              })}
            />
            <MonitoringMetric
              label={tA("statInProgress")}
              value={tA("peopleCount", { count: summary.inProgressCount })}
            />
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {participants.map((participant) => (
              <ParticipantProgressRow
                key={participant.userId}
                participant={participant}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </AdminFrame>
  );
}

// The root layout's chrome (skip link, footer, env banner) is not part of the
// framed screen, and the frame itself never scrolls.
const EMBED_CSS = `a[href="#main-content"], #main-content ~ * { display: none !important; }
html, body { overflow: hidden; }`;

export function DemoPlayer({
  scene,
  locale,
}: {
  scene: DemoScene;
  locale: Locale;
}) {
  useEffect(() => {
    if (window.parent === window) return;
    // The message carries nothing private, and the embedding origin varies
    // (production, previews, localhost), so any parent may receive it.
    window.parent.postMessage({ ...READY_MESSAGE, scene }, "*");
  }, [scene]);

  return (
    <div className="pointer-events-none select-none" aria-hidden="true">
      <style>{EMBED_CSS}</style>
      {scene === "participant" && <ParticipantScene locale={locale} />}
      {scene === "issues" && <IssuesScene locale={locale} />}
      {scene === "participants" && <ParticipantsScene locale={locale} />}
    </div>
  );
}
