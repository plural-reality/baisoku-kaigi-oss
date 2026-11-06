import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./IconButton.css";

export type IconButtonSize = "sm" | "md";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  /** 操作の名前（閉じる・表示する）。画面には出ないが、読み上げと Tooltip に使う。必須 */
  label: string;
  /** アイコン（lucide を想定）。装飾として扱い、読み上げない */
  icon: ReactNode;
  /** 大きさ。sm=32px（表の中・帯の中）、md=40px（既定） */
  size?: IconButtonSize;
  /** 押している状態を持つ切り替え（表示・非表示）のとき */
  pressed?: boolean;
};

/** アイコンだけで操作を示すボタン。名前（label）を必ず付ける */
export const IconButton = ({ label, icon, size = "md", pressed, type = "button", className, ...rest }: IconButtonProps) => (
  <button
    {...rest}
    type={type}
    aria-label={label}
    aria-pressed={pressed}
    className={["pr-iconbtn", `pr-iconbtn--${size}`, className].filter(Boolean).join(" ")}
  >
    <span className="pr-iconbtn__icon" aria-hidden="true">{icon}</span>
  </button>
);
