import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { buildMetadata, pageTitle, truncateForMeta } from "@/lib/metadata";
import { sessionFacilitatorGoal } from "@/lib/session-context";

import SessionReportPrintPage from "./client-page";

async function fetchReportMeta(
  sessionId: string,
  accessToken: string,
  reportId: string,
) {
  const [{ requireSessionAdminToken }, { getSessionReportById }] =
    await Promise.all([
      import("@/lib/server/session-access"),
      import("@/lib/server/session-reports"),
    ]);

  const session = await requireSessionAdminToken(sessionId, accessToken).catch(
    () => null,
  );
  const report = await getSessionReportById(reportId).catch(() => null);

  if (!session || !report || report.sessionId !== sessionId) {
    return null;
  }

  return { session, report };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{
    sessionId: string;
    accessToken: string;
    reportId: string;
  }>;
}): Promise<Metadata> {
  const { sessionId, accessToken, reportId } = await params;
  const meta = await fetchReportMeta(sessionId, accessToken, reportId);
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "sessionMeta" });

  if (!meta) {
    return buildMetadata({
      title: pageTitle(t("reportNotFoundTitle"), locale),
      description: t("reportNotFoundDescription"),
      url: `/sessions/${sessionId}/${accessToken}/reports/${reportId}/print`,
      locale,
    });
  }

  const versionLabel = `v${String(meta.report.version ?? 0).padStart(2, "0")}`;
  const goal = sessionFacilitatorGoal(meta.session).trim();
  const description = goal
    ? t("reportWithGoal", {
        title: meta.session.title,
        version: versionLabel,
        goal: truncateForMeta(goal),
      })
    : t("reportDefault", {
        title: meta.session.title,
        version: versionLabel,
      });

  return buildMetadata({
    title: pageTitle(
      t("reportTitle", { title: meta.session.title, version: versionLabel }),
      locale,
    ),
    description,
    url: `/sessions/${sessionId}/${accessToken}/reports/${reportId}/print`,
    locale,
  });
}

export default async function Page({
  params,
}: {
  params: Promise<{ sessionId: string; accessToken: string; reportId: string }>;
}) {
  const { sessionId, accessToken, reportId } = await params;
  return (
    <SessionReportPrintPage
      sessionId={sessionId}
      accessToken={accessToken}
      reportId={reportId}
    />
  );
}
