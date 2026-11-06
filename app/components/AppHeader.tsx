"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { HeaderAccountMenu } from "@/components/HeaderAccountMenu";
import { HeaderLocaleMenu } from "@/components/HeaderLocaleMenu";
import { useWorkOSUser } from "@/lib/auth-provider";
import { SITE_NAME_BY_LOCALE } from "@/lib/metadata";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  sticky?: boolean;
  centerContent?: ReactNode;
  belowContent?: ReactNode;
  // The marketing-site demo (/embed/demo): the same header without the
  // account entry, and no prefetch of pages a framed demo never opens.
  embedded?: boolean;
}

// ヘッダー（IMPLEMENTATION.md §3）。高さ 56px（sm 以上 64px）、下罫線 1px、左右 16 / 24px。
// 左: 製品名のワードマーク（文字。600・18px・字間 -0.01em）。
// 右: ［言語（地球儀）］［アカウント（ログイン or アバター）］の順（P31）。ナビ項目は置かない。
export function AppHeader({
  sticky = false,
  centerContent,
  belowContent,
  embedded = false,
}: AppHeaderProps) {
  const user = useWorkOSUser();
  const t = useTranslations("header");
  const locale = useLocale();

  return (
    <div className="flex flex-col print:hidden">
      <header
        className={cn(
          "w-full border-b border-border bg-background",
          sticky && "sticky top-[var(--safe-top)] z-50",
        )}
      >
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:h-16 sm:px-6">
          <Link
            href="/"
            prefetch={embedded ? false : undefined}
            className="text-lg font-semibold tracking-[-0.01em] text-foreground transition-colors hover:text-foreground/80"
          >
            {SITE_NAME_BY_LOCALE(locale)}
          </Link>
          <div className="flex flex-1 items-center gap-4">
            {centerContent && (
              <div className="flex flex-1 items-center gap-2 whitespace-nowrap">
                {centerContent}
              </div>
            )}
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <HeaderLocaleMenu />
              {embedded ? null : user ? (
                <HeaderAccountMenu email={user.email ?? ""} />
              ) : (
                <Link
                  href="/login"
                  className="inline-flex items-center whitespace-nowrap text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t("login")}
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>
      {belowContent}
    </div>
  );
}
