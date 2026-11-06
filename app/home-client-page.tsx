"use client";

import axios from "axios";
import {
  Calendar,
  FileText,
  Loader2,
  Plus,
  SquareArrowOutUpRight,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LegalLinksCallout } from "@/components/legal/LegalLinksCallout";
import { Button, buttonVariants } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { createAuthorizationHeader } from "@/lib/auth-header";
import { sanitizeErrorForLog } from "@/lib/sanitize-error";
import { useUserId } from "@/lib/useUserId";

type Session = {
  id: string;
  title: string;
  context: string;
  goal: string;
  hostUserId?: string;
  adminAccessToken?: string;
  createdAt: string;
  isPublic: boolean;
  _count: {
    participants: number;
    statements: number;
  };
  isHost: boolean;
  isParticipant: boolean;
};

export default function HomeClientPage() {
  const { userId, accessToken, isLoading: userLoading } = useUserId();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const t = useTranslations("dashboard");
  const [error, setError] = useState<"loadFailed" | null>(null);
  const hasVisibleSessions = sessions.some((s) => s.isHost || s.isParticipant);

  useEffect(() => {
    if (!userId || userLoading) return;

    const controller = new AbortController();

    const fetchSessions = async () => {
      try {
        setLoading(true);
        const response = await axios.get("/api/sessions", {
          headers: createAuthorizationHeader(accessToken),
          signal: controller.signal,
        });
        setSessions(response.data.sessions ?? []);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Failed to fetch sessions:", sanitizeErrorForLog(err));
        setError("loadFailed");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchSessions();

    return () => controller.abort();
  }, [userId, accessToken, userLoading]);
  if (userLoading || loading) {
    return (
      <div className="min-h-svh flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background">
      <AppHeader />
      <div className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        <WorkspaceHeader />

        {error && (
          <Card className="mb-6 border-destructive">
            <CardContent className="pt-6">
              <p className="text-sm text-destructive">{t(error)}</p>
            </CardContent>
          </Card>
        )}

        {hasVisibleSessions ? (
          <SessionSections sessions={sessions} />
        ) : (
          <Card className="min-h-[420px]">
            <CardContent className="flex min-h-[420px] items-center justify-center">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileText />
                  </EmptyMedia>
                  <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
                  <EmptyDescription>{t("emptyBody")}</EmptyDescription>
                </EmptyHeader>
                <Link href="/sessions/new" className={buttonVariants()}>
                  <Plus className="h-4 w-4" />
                  {t("create")}
                </Link>
                <a
                  href="https://scrapbox.io/baisoku-kaigi/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("docs")}
                  <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                </a>
              </Empty>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function WorkspaceHeader() {
  const t = useTranslations("dashboard");
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-border/70 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <LegalLinksCallout className="pt-1" />
      </div>
      <Link href="/sessions/new" className="w-full sm:w-auto">
        <Button className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          {t("create")}
        </Button>
      </Link>
    </div>
  );
}

type SessionSectionsProps = {
  sessions: Session[];
};

function SessionSections({ sessions }: SessionSectionsProps) {
  const router = useRouter();
  const t = useTranslations("dashboard");
  const locale = useLocale();
  // i18n-allow: markers in session text written in Japanese; not displayed
  const stripSupplementalInfo = (text: string) => {
    if (!text) return "";
    const lines = text.split(/\r?\n/);
    const cutoffIndex = lines.findIndex(
      (line) =>
        line.includes("背景情報") ||
        line.includes("補足情報") ||
        line.startsWith("--- "),
    );
    const keptLines = cutoffIndex === -1 ? lines : lines.slice(0, cutoffIndex);
    return keptLines.join("\n").trim();
  };
  const getContextPreview = (text: string) => {
    const stripped = stripSupplementalInfo(text);
    if (!stripped) return "";
    const maxLength = 240;
    if (stripped.length <= maxLength) return stripped;
    return `${stripped.slice(0, maxLength)}…`;
  };
  const sessionCategories = useMemo(() => {
    const adminSessions = sessions.filter((session) => session.isHost);
    const participatingSessions = sessions.filter(
      (session) => !session.isHost && session.isParticipant,
    );

    return [
      {
        title: t("hosting"),
        sessions: adminSessions,
      },
      {
        title: t("participating"),
        sessions: participatingSessions,
      },
    ].filter((category) => category.sessions.length > 0);
  }, [sessions, t]);

  return (
    <div className="space-y-8">
      {sessionCategories.map((category) => (
        <div key={category.title} className="space-y-3">
          <h3 className="text-sm font-semibold tracking-wide text-muted-foreground">
            {category.title}
          </h3>
          <div className="space-y-3">
            {category.sessions.map((session) => (
              <Card
                key={session.id}
                className="hover:shadow-md transition-shadow"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <CardTitle className="text-lg font-semibold">
                      {session.title}
                    </CardTitle>
                  </div>
                  <CardDescription className="space-y-2 text-base leading-6">
                    {session.goal && (
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-muted-foreground">
                          {t("purposeLabel")}
                        </p>
                        <p className="whitespace-pre-line">{session.goal}</p>
                      </div>
                    )}
                    {session.context && (
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-muted-foreground">
                          {t("background")}
                        </p>
                        <p className="whitespace-pre-line">
                          {getContextPreview(session.context)}
                        </p>
                      </div>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Users className="h-4 w-4" />
                        <span>
                          {t("participants", {
                            count: session._count.participants,
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-4 w-4" />
                        <span>
                          {t("statements", {
                            count: session._count.statements,
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-4 w-4" />
                        <span>
                          {t("created", {
                            date: new Date(
                              session.createdAt,
                            ).toLocaleDateString(locale),
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      {session.isHost && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 min-w-[72px]"
                          onClick={(event) => {
                            event.stopPropagation();
                            router.push(
                              `/sessions/${session.id}/${session.adminAccessToken}`,
                            );
                          }}
                        >
                          {t("manage")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className="h-8 min-w-[72px]"
                        onClick={(event) => {
                          event.stopPropagation();
                          window.open(
                            `/sessions/${session.id}`,
                            "_blank",
                            "noopener,noreferrer",
                          );
                        }}
                      >
                        {t("join")}
                        <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
