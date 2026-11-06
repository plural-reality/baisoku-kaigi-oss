import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import {
  formatLegalLastUpdated,
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR_NAME,
  LEGAL_OPERATOR_NAME_EN,
} from "@/lib/legal";

type TocItem = Readonly<{
  id: string;
  label: string;
}>;

type SummaryItem = Readonly<{
  label: string;
  value: string;
}>;

type MetaItem = Readonly<{
  label: string;
  value: string;
  href?: string;
}>;

type LegalDocumentLayoutProps = Readonly<{
  eyebrow: string;
  document: "terms" | "privacy";
  subtitle?: string;
  description: string;
  summary: SummaryItem[];
  toc: TocItem[];
  children: ReactNode;
}>;

export function LegalDocumentLayout({
  document,
  subtitle,
  description,
  summary,
  toc,
  children,
}: LegalDocumentLayoutProps) {
  const t = useTranslations("legal");
  const locale = useLocale();
  // The frame is in the viewer's language; the document itself stays Japanese (lang="ja").
  const meta: readonly MetaItem[] = [
    {
      label: t("operatorLabel"),
      value: locale === "ja" ? LEGAL_OPERATOR_NAME : LEGAL_OPERATOR_NAME_EN,
    },
    {
      label: t("contactLabel"),
      value: LEGAL_CONTACT_EMAIL,
      href: `mailto:${LEGAL_CONTACT_EMAIL}`,
    },
    { label: t("lastUpdatedLabel"), value: formatLegalLastUpdated(locale) },
  ];
  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader />

      <div className="mx-auto box-content flex max-w-[1200px] justify-between px-2.5 py-5">
        <aside
          className="hidden flex-[0_0_22.9%] lg:block"
          style={{ maxWidth: 240 }}
        >
          <div className="sticky top-[calc(6rem+var(--safe-top))]">
            <nav aria-label={t("tocLabel")}>
              <ul lang="ja" className="space-y-[15px]">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="block text-[14px] leading-[18px] text-muted-foreground no-underline transition-colors hover:text-foreground"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <dl className="mt-8 space-y-3 border-t border-border pt-5">
              {meta.map((item) => (
                <div key={item.label}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd className="mt-0.5 text-[12px] text-muted-foreground">
                    {item.href ? (
                      <a
                        href={item.href}
                        className="text-foreground underline underline-offset-4 hover:text-primary"
                      >
                        {item.value}
                      </a>
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>

        <main className="min-w-0 flex-1 rounded-[3px] border border-border bg-card px-5 text-card-foreground lg:ml-5">
          <h1 className="mt-10 text-center text-[36px] leading-[44px] font-normal text-foreground">
            {t(document)}
          </h1>

          {subtitle ? (
            <p
              lang="ja"
              className="mx-auto mt-2 max-w-3xl text-center text-[16px] leading-[24px] text-muted-foreground"
            >
              {subtitle}
            </p>
          ) : null}

          <p
            lang="ja"
            className="mx-auto mt-[15px] mb-[30px] max-w-3xl text-center text-[12px] leading-[18px] text-muted-foreground"
          >
            {description}
          </p>

          {locale !== "ja" ? (
            <p className="mx-5 mb-6 rounded-sm border border-amber-300 bg-amber-50 p-[15px] text-[13px] leading-[20px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200 sm:mx-10">
              {t("japaneseOnly", { email: LEGAL_CONTACT_EMAIL })}
            </p>
          ) : null}

          {summary.length > 0 ? (
            <div className="mx-5 mb-6 rounded-sm bg-muted p-[15px] sm:mx-10">
              <h3 className="text-[12px] font-bold leading-[18px] text-foreground">
                {t("summaryTitle")}
              </h3>
              <ul lang="ja" className="mt-3 space-y-3">
                {summary.map((item) => (
                  <li key={item.label}>
                    <p className="text-[14px] leading-[18px] font-semibold text-foreground">
                      {item.label}
                    </p>
                    <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                      {item.value}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <nav
            className="mx-5 mb-6 rounded-sm border border-border p-4 sm:mx-10 lg:hidden"
            aria-label={t("tocLabel")}
          >
            <p className="mb-2 text-[12px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("toc")}
            </p>
            <ul lang="ja" className="space-y-2">
              {toc.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="text-[14px] leading-[18px] text-muted-foreground no-underline hover:text-foreground"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mx-5 mb-6 sm:mx-10 lg:hidden">
            <dl className="space-y-2">
              {meta.map((item) => (
                <div key={item.label} className="flex gap-2 text-[12px]">
                  <dt className="font-semibold text-muted-foreground">
                    {item.label}:
                  </dt>
                  <dd className="text-muted-foreground">
                    {item.href ? (
                      <a
                        href={item.href}
                        className="text-foreground underline underline-offset-4 hover:text-primary"
                      >
                        {item.value}
                      </a>
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div lang="ja">{children}</div>
        </main>
      </div>
    </div>
  );
}

type LegalSectionProps = Readonly<{
  id: string;
  index: number;
  title: string;
  children: ReactNode;
}>;

export function LegalSection({
  id,
  index,
  title,
  children,
}: LegalSectionProps) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border pb-[15px]">
      <div className="space-y-0">
        <div className="flex items-center gap-3 pt-[15px] pb-[15px]">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-[12px] font-semibold text-foreground">
            {index}
          </span>
          <h2 className="text-[18px] leading-[22px] font-normal text-foreground">
            {title}
          </h2>
        </div>
        <div className="mx-5 pb-[15px] text-[13px] leading-[18px] text-foreground sm:mx-10">
          <div className="space-y-[15px]">{children}</div>
        </div>
      </div>
    </section>
  );
}
