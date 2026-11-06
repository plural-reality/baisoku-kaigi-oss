"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { AccountMenu } from "@/components/pr/AccountMenu/AccountMenu";
import { signOutAction } from "@/lib/actions/sign-out";

// ヘッダーの右端のアカウントのメニュー（P30・P32）。上から、メールアドレス → ダークモード → ログアウト。
// 倍速会議には設定画面が無いので、設定の頁は並べない。ダークモードは next-themes の resolvedTheme
// （押すまでは OS に従う `system`）を映し、押すとその側を記憶する。
export function HeaderAccountMenu({ email }: Readonly<{ email: string }>) {
  const t = useTranslations("header");
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <AccountMenu
      email={email}
      label={t("userMenu")}
      darkMode={{
        label: t("darkMode"),
        checked: mounted && resolvedTheme === "dark",
        onChange: (dark) => setTheme(dark ? "dark" : "light"),
      }}
      signOut={{ label: t("logout"), action: signOutAction }}
      testIds={{ trigger: "header-account-button", darkMode: "theme-switch" }}
    />
  );
}
