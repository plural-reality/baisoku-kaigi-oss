import { Loader2 } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { buildMetadata, pageTitle } from "@/lib/metadata";
import {
  pathWithSearch,
  requireHostLogin,
} from "@/lib/server/require-host-login";

import NewSessionClientPage from "./client-page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "sessionMeta" });
  return buildMetadata({
    title: pageTitle(t("newTitle"), locale),
    description: t("newDescription"),
    url: "/sessions/new",
    locale,
  });
}

type NewSessionPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default async function NewSessionPage({
  searchParams,
}: NewSessionPageProps) {
  await requireHostLogin(pathWithSearch("/sessions/new", await searchParams));

  return (
    <Suspense
      fallback={
        <div className="min-h-svh flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NewSessionClientPage />
    </Suspense>
  );
}
