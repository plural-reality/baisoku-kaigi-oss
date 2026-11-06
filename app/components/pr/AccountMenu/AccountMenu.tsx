"use client";

import type { ElementType } from "react";
import { Menu, type MenuFormAction, type MenuItem } from "../Menu/Menu";
import "./AccountMenu.css";

export type AccountMenuPage = {
  href: string;
  /** 設定画面のタブと同じ名前 */
  label: string;
};

export type AccountMenuProps = {
  /** ログインしているアカウント。メニューの先頭に出し、アバターの頭文字にも使う */
  email: string;
  /** ボタンと一覧の名前（アカウントのメニュー）。必須 */
  label: string;
  /** 設定の各頁。設定画面のタブと同じ一覧を同じ順で渡す。設定画面の無い製品は省く */
  pages?: readonly AccountMenuPage[];
  /** ダークモードのスイッチ。checked はいま暗い画面か（押すまでは OS の設定に従った結果） */
  darkMode?: { label: string; checked: boolean; onChange: (dark: boolean) => void };
  /** ログアウト。Server Action（フォームで送る）か、押したときの処理 */
  signOut: { label: string; action: MenuFormAction } | { label: string; onSelect: () => void };
  /** 設定の頁へのリンクを描く部品（Next.js の Link など）。省くと <a> */
  linkComponent?: ElementType;
  /** 製品の E2E 用 */
  testIds?: { trigger?: string; darkMode?: string; signOut?: string };
};

const LogOut = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

const SEPARATOR: MenuItem = { type: "separator" };

/**
 * ヘッダーの右端のアバターから開く、アカウントのメニュー。
 * 上から、メールアドレス → 設定の各頁 → ダークモード → ログアウト。まとまりの間は 1px の罫線で区切り、
 * ログアウトは最後に離して --danger で示す（セッションを終える唯一の操作のため）。
 */
export const AccountMenu = ({ email, label, pages = [], darkMode, signOut, linkComponent, testIds }: AccountMenuProps) => {
  const groups: MenuItem[][] = [
    pages.map((p) => ({ type: "link" as const, label: p.label, href: p.href })),
    darkMode ? [{ type: "switch" as const, label: darkMode.label, checked: darkMode.checked, onChange: darkMode.onChange, testId: testIds?.darkMode }] : [],
    [
      "action" in signOut
        ? { type: "submit" as const, label: signOut.label, action: signOut.action, icon: <LogOut />, tone: "danger" as const, testId: testIds?.signOut }
        : { type: "item" as const, label: signOut.label, onSelect: signOut.onSelect, icon: <LogOut />, tone: "danger" as const, testId: testIds?.signOut },
    ],
  ].filter((g) => g.length > 0);
  return (
    <Menu
      label={label}
      heading={email}
      align="end"
      linkComponent={linkComponent}
      items={groups.flatMap((g, i) => (i === 0 ? g : [SEPARATOR, ...g]))}
      renderTrigger={(trigger) => (
        <button {...trigger} type="button" className="pr-avatar" aria-label={label} title={email} data-testid={testIds?.trigger}>
          {email.charAt(0).toUpperCase()}
        </button>
      )}
    />
  );
};
