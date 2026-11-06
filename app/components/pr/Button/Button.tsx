import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** 種類。primary は1画面に1つまで */
  variant?: ButtonVariant;
  /** 大きさ。lg は Web の CTA、sm は表の中など横幅に制約がある場所 */
  size?: ButtonSize;
  /** 文言の前に置くアイコン（lucide を想定） */
  icon?: ReactNode;
  /** 処理中。押せなくなり、文言の前に進行中の印が付く */
  loading?: boolean;
  /** 親の横幅いっぱいに広げる */
  fullWidth?: boolean;
  /** ボタンの文言。動詞を含める（ガイド参照） */
  children: ReactNode;
};

/** 操作を実行する、または画面を移るためのボタン */
export const Button = ({
  variant = "secondary",
  size = "md",
  icon,
  loading = false,
  fullWidth = false,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) => (
  <button
    {...rest}
    type={type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={["pr-button", `pr-button--${variant}`, `pr-button--${size}`, fullWidth && "pr-button--full", className]
      .filter(Boolean)
      .join(" ")}
  >
    {loading ? <span className="pr-button__spinner" aria-hidden="true" /> : icon ? <span className="pr-button__icon" aria-hidden="true">{icon}</span> : null}
    <span className="pr-button__label">{children}</span>
  </button>
);
