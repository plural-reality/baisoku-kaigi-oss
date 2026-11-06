import type { Metadata } from "next";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { AppHeader } from "@/components/AppHeader";
import { buildMetadata, pageTitle } from "@/lib/metadata";

// 404（errors / quick_fixes 9、IMPLEMENTATION.md §6）。製品のヘッダーと、
// root layout の会社の帯（LegalFooter）に挟まれる。
// ただし未知の Server Action（Next-Action 付きの urlencoded POST）への 404 では、
// Next は root layout を外してこのページだけを描く。そのとき AppHeader の
// useTranslations が provider を見つけられず 500 になるので、ここでも provider を置く。
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([
    getTranslations("notFound"),
    getLocale(),
  ]);
  return buildMetadata({ title: pageTitle(t("title"), locale), locale });
}

export default async function NotFound() {
  const [t, locale, messages] = await Promise.all([
    getTranslations("notFound"),
    getLocale(),
    getMessages(),
  ]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="min-h-[60svh] bg-background">
        <AppHeader />
        <section className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-20 text-center sm:px-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm leading-7 text-muted-foreground">{t("body")}</p>
          <Link
            href="/"
            className="mt-2 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("back")}
          </Link>
        </section>
      </div>
    </NextIntlClientProvider>
  );
}
