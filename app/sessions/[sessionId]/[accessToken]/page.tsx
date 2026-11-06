import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { buildMetadata, pageTitle, truncateForMeta } from "@/lib/metadata";
import { sessionFacilitatorGoal } from "@/lib/session-context";

import AdminPage from "./client-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sessionId: string; accessToken: string }>;
}): Promise<Metadata> {
  const { sessionId, accessToken } = await params;
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "sessionMeta" });

  const { requireSessionAdminToken } = await import(
    "@/lib/server/session-access"
  );
  const session = await requireSessionAdminToken(sessionId, accessToken).catch(
    () => null,
  );

  if (!session) {
    return buildMetadata({
      title: pageTitle(t("notFoundTitle"), locale),
      description: t("notFoundDescription"),
      url: `/sessions/${sessionId}/${accessToken}`,
      locale,
    });
  }

  const goal = sessionFacilitatorGoal(session).trim();
  const description = goal
    ? t("adminWithGoal", { title: session.title, goal: truncateForMeta(goal) })
    : t("adminDefault", { title: session.title });

  return buildMetadata({
    title: pageTitle(t("adminTitle", { title: session.title }), locale),
    description,
    url: `/sessions/${sessionId}/${accessToken}`,
    locale,
  });
}

export default async function Page({
  params,
}: {
  params: Promise<{ sessionId: string; accessToken: string }>;
}) {
  const { sessionId, accessToken } = await params;
  return <AdminPage sessionId={sessionId} accessToken={accessToken} />;
}
