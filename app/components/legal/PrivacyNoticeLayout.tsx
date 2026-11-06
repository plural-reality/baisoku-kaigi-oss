import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import {
  formatLegalLastUpdated,
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR_NAME,
  LEGAL_OPERATOR_NAME_EN,
} from "@/lib/legal";

/* ────────────────────────────────────────────
 * Civichat / Juro open-source privacy notice
 * design system — ported to shadcn semantic tokens.
 *
 * All surfaces / text / affordances use the app design
 * tokens (background / card / muted / foreground / border /
 * primary) so light & dark stay consistent with the rest of
 * the app. The expand affordance uses `primary`; collapse
 * uses neutral `muted-foreground`.
 * ──────────────────────────────────────────── */

type TocItem = Readonly<{
  id: string;
  label: string;
}>;

type HighlightItem = Readonly<{
  label: string;
  value: string;
}>;

type MetaItem = Readonly<{
  label: string;
  value: string;
  href?: string;
}>;

type PrivacyNoticeLayoutProps = Readonly<{
  eyebrow: string;
  document: "terms" | "privacy";
  subtitle?: string;
  description: string;
  highlights: readonly HighlightItem[];
  toc: readonly TocItem[];
  children: ReactNode;
}>;

export const PrivacyNoticeLayout = ({
  document,
  subtitle,
  description,
  highlights,
  toc,
  children,
}: PrivacyNoticeLayoutProps) => {
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
        {/* ── Sidebar ── */}
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

        {/* ── Main column ── */}
        <main className="min-w-0 flex-1 rounded-[3px] border border-border bg-card px-5 text-card-foreground lg:ml-5">
          {/* Title */}
          <h1 className="mt-10 text-center text-[36px] leading-[44px] font-normal text-foreground">
            {t(document)}
          </h1>

          {/* Subtitle */}
          {subtitle ? (
            <p
              lang="ja"
              className="mx-auto mt-2 max-w-3xl text-center text-[16px] leading-[24px] text-muted-foreground"
            >
              {subtitle}
            </p>
          ) : null}

          {/* Description */}
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

          {/* Highlights box */}
          {highlights.length > 0 && (
            <div className="mx-5 mb-6 rounded-sm bg-muted p-[15px] sm:mx-10">
              <h3 className="text-[12px] font-bold leading-[18px] text-foreground">
                {t("summaryTitle")}
              </h3>
              <ul lang="ja" className="mt-3 space-y-3">
                {highlights.map((item) => (
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
          )}

          {/* Mobile-only ToC */}
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

          {/* Mobile-only meta */}
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

          {/* Sections */}
          <div lang="ja">{children}</div>
        </main>
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────
 * Section
 * ──────────────────────────────────────────── */

type PrivacyNoticeSectionProps = Readonly<{
  id: string;
  index: number;
  title: string;
  summary: string;
  icon: ReactNode;
  highlights?: readonly string[];
  children: ReactNode;
}>;

export const PrivacyNoticeSection = ({
  id,
  index: _index,
  title,
  summary,
  icon,
  highlights,
  children,
}: PrivacyNoticeSectionProps) => {
  const t = useTranslations("legal");
  return (
    <section id={id} className="scroll-mt-24 border-t border-border pb-[15px]">
      {/* Section heading — icon + title */}
      <h2 className="flex items-center gap-2.5 pt-[15px] pb-[15px] text-[18px] leading-[22px] font-normal text-foreground">
        <span className="inline-flex h-[29px] w-[25px] shrink-0 items-center justify-center stroke-foreground text-foreground">
          {icon}
        </span>
        {title}
      </h2>

      {/* Summary — always visible */}
      <div className="mx-5 pb-[15px] text-[13px] leading-[18px] text-foreground sm:mx-10">
        <p>{summary}</p>
      </div>

      {/* Highlight bullets */}
      {highlights && highlights.length > 0 ? (
        <div className="mx-5 mb-[15px] rounded-sm bg-muted p-[15px] sm:mx-10">
          <ul className="space-y-1.5">
            {highlights.map((item) => (
              <li
                key={item}
                className="text-[13px] leading-[18px] text-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Expandable detail — pure-CSS <details> */}
      <details className="group">
        <summary className="mx-5 cursor-pointer list-none text-[12px] leading-[18px] font-semibold sm:mx-10 [&::-webkit-details-marker]:hidden">
          <span className="inline text-primary group-open:hidden hover:text-primary/80">
            <i className="not-italic underline">{t("readMore")}</i>{" "}
            <span aria-hidden="true">&gt;</span>
          </span>
          <span className="hidden text-muted-foreground group-open:inline hover:text-foreground">
            <i className="not-italic underline">{t("close")}</i>{" "}
            <span aria-hidden="true">&times;</span>
          </span>
        </summary>

        <div className="mx-5 mt-[15px] mb-[15px] border-l border-border pl-5 text-[13px] leading-[18px] text-foreground sm:mx-10 sm:pl-10">
          <div className="space-y-[15px]">{children}</div>
        </div>
      </details>
    </section>
  );
};

/* ────────────────────────────────────────────
 * Disclosure (nested expand inside a section)
 * ──────────────────────────────────────────── */

type PrivacyNoticeDisclosureProps = Readonly<{
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}>;

export const PrivacyNoticeDisclosure = ({
  title,
  defaultOpen = false,
  children,
}: PrivacyNoticeDisclosureProps) => (
  <details open={defaultOpen} className="group/disc rounded-sm bg-muted/50">
    <summary className="flex cursor-pointer list-none items-center justify-between px-[15px] py-[10px] text-[13px] leading-[18px] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
      <span>{title}</span>
      <span className="text-primary group-open/disc:hidden" aria-hidden="true">
        +
      </span>
      <span
        className="hidden text-muted-foreground group-open/disc:inline"
        aria-hidden="true"
      >
        &times;
      </span>
    </summary>
    <div className="border-t border-border px-[15px] py-[10px] text-[13px] leading-[18px] text-foreground">
      <div className="space-y-[15px]">{children}</div>
    </div>
  </details>
);
