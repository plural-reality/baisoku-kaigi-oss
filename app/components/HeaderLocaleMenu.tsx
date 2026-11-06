"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { LocaleMenu } from "@/components/pr/LocaleMenu/LocaleMenu";
import { localeLabels, locales } from "@/i18n/locales";
import { setLocaleAction } from "@/lib/actions/set-locale";

const OPTIONS = locales.map((value) => ({ value, label: localeLabels[value] }));

// ヘッダーの補助に置く言語のメニュー（地球儀のアイコン、P31）。言語のほかは何も入れない。
// 選ぶと NEXT_LOCALE cookie に保存し、サーバーの描画をやり直す。
export function HeaderLocaleMenu() {
  const t = useTranslations("header");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <LocaleMenu
      label={t("language")}
      options={OPTIONS}
      value={locale}
      pending={isPending}
      testId="header-locale-button"
      itemTestIdPrefix="locale-"
      onChange={(next) =>
        startTransition(async () => {
          await setLocaleAction(next);
          router.refresh();
        })
      }
    />
  );
}
