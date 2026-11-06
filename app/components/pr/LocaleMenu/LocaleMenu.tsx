"use client";

import { Menu } from "../Menu/Menu";

export type LocaleOption = {
  /** 言語のコード（ja・en）。項目の lang にも使う */
  value: string;
  /** その言語自身の書き方（日本語・English）。国旗は使わない */
  label: string;
};

export type LocaleMenuProps = {
  /** ボタンと一覧の名前（言語・Language）。必須 */
  label: string;
  options: readonly LocaleOption[];
  /** いまの言語 */
  value: string;
  /** 別の言語を選んだとき（今の言語を選び直したときは呼ばない） */
  onChange: (value: string) => void;
  /** 切り替えている間 */
  pending?: boolean;
  /** ボタンの大きさ。sm=32px、md=40px（既定） */
  size?: "sm" | "md";
  /** 製品の E2E 用。ボタンは testId、項目は `${itemTestIdPrefix}${value}` */
  testId?: string;
  itemTestIdPrefix?: string;
};

const Globe = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);

/**
 * ヘッダーの補助に置く、言語だけのメニュー。地球儀のアイコンで開き、言語のほかは何も入れない。
 * 言語を選ぶと閉じる。ライトとダークの切り替えは AccountMenu に置く。
 */
export const LocaleMenu = ({ label, options, value, onChange, pending, size = "md", testId, itemTestIdPrefix }: LocaleMenuProps) => (
  <Menu
    label={label}
    icon={<Globe />}
    iconSize={size}
    align="end"
    pending={pending}
    triggerTestId={testId}
    items={options.map((o) => ({
      type: "radio" as const,
      label: o.label,
      lang: o.value,
      checked: o.value === value,
      disabled: pending,
      testId: itemTestIdPrefix === undefined ? undefined : `${itemTestIdPrefix}${o.value}`,
      onSelect: () => { if (o.value !== value) onChange(o.value); },
    }))}
  />
);
