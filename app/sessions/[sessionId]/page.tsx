import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { toContentLanguage } from "@/lib/content-language";
import { buildMetadata, pageTitle, truncateForMeta } from "@/lib/metadata";
import { sessionParticipantContextFields } from "@/lib/session-context";

import SessionPage from "./client-page";

async function getSessionMeta(sessionId: string) {
  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase
    .from("sessions")
    .select(
      "title, goal, context, facilitator_goal, facilitator_context, language",
    )
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}): Promise<Metadata> {
  const { sessionId } = await params;
  const session = await getSessionMeta(sessionId);

  if (!session) {
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "sessionMeta" });
    return buildMetadata({
      title: pageTitle(t("notFoundTitle"), locale),
      description: t("notFoundDescription"),
      url: `/sessions/${sessionId}`,
      locale,
    });
  }

  // Link previews (Slack, email…) follow the session's own language, since
  // crawlers send no useful Accept-Language and the invitees share it.
  const locale = toContentLanguage(session.language);
  const t = await getTranslations({ locale, namespace: "sessionMeta" });

  const participantContextFields = sessionParticipantContextFields(session);
  const goal = participantContextFields.goal.trim();
  const context = participantContextFields.context.trim();
  const description = goal
    ? t("participantWithGoal", {
        title: session.title,
        goal: truncateForMeta(goal),
      })
    : context
      ? t("participantWithContext", {
          title: session.title,
          context: truncateForMeta(context),
        })
      : t("participantDefault", { title: session.title });

  return buildMetadata({
    title: pageTitle(session.title, locale),
    description,
    url: `/sessions/${sessionId}`,
    locale,
  });
}

export default async function Page({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionPage sessionId={sessionId} />;
}
