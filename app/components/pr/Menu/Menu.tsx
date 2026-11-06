"use client";

import { useEffect, useId, useRef, useState, type ElementType, type KeyboardEvent, type ReactNode } from "react";
import { IconButton } from "../IconButton/IconButton";
import { Button } from "../Button/Button";
import "./Menu.css";

/** フォームの action。製品では Server Action（関数）、それ以外は URL */
export type MenuFormAction = string | ((formData: FormData) => void | Promise<void>);

export type MenuItem =
  | { type?: "item"; label: string; onSelect: () => void; disabled?: boolean; icon?: ReactNode; tone?: "danger"; testId?: string }
  /** 別の画面へ移る項目（設定の各頁など） */
  | { type: "link"; label: string; href: string; icon?: ReactNode; testId?: string }
  /** いくつかから1つを選ぶ項目（言語）。選ぶと閉じる */
  | { type: "radio"; label: string; checked: boolean; onSelect: () => void; disabled?: boolean; lang?: string; testId?: string }
  /** 押した時点で効く切り替え（ダークモード）。押しても閉じない */
  | { type: "switch"; label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; testId?: string }
  /** フォームを送る項目（ログアウト）。Server Action をそのまま渡せる */
  | { type: "submit"; label: string; action: MenuFormAction; icon?: ReactNode; tone?: "danger"; testId?: string }
  | { type: "separator" };

/** 開くボタンに渡す属性。renderTrigger で自前のボタン（アバター）を作るときに使う */
export type MenuTriggerProps = {
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
};

export type MenuProps = {
  /** 開くボタンの名前（ユーザーメニュー、その他の操作）。必須 */
  label: string;
  /** ボタンに出す文言。省略するとアイコンだけのボタンになる */
  children?: ReactNode;
  /** アイコンだけのボタンにするとき（children を省く）のアイコン */
  icon?: ReactNode;
  /** アイコンだけのボタンの大きさ。sm=32px、md=40px（既定） */
  iconSize?: "sm" | "md";
  /** ボタンを自分で描くとき（アバターなど）。渡した属性をボタンに付ける */
  renderTrigger?: (props: MenuTriggerProps) => ReactNode;
  /** メニューの先頭に出す見出し（メールアドレスなど）。選べない */
  heading?: string;
  items: readonly MenuItem[];
  /** 一覧をボタンのどちらの端に揃えるか。画面の右端に置くボタン（ヘッダー）は end */
  align?: "start" | "end";
  /** 処理中（言語を切り替えている間など）。一覧を薄くする */
  pending?: boolean;
  /** link の項目を描く部品（Next.js の Link など）。省くと <a> */
  linkComponent?: ElementType;
  /** 開くボタンの data-testid（製品の E2E 用） */
  triggerTestId?: string;
};

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);

/**
 * ボタンから開く、操作の一覧。項目は動詞で書く。5〜7項目を超えるときは別の画面に分ける。
 * Enter / Space / ↓ で開き、↑↓ で移動、Esc で閉じてボタンに戻る。
 * 破壊的な操作は一覧の末尾に置き、押すと確認の Dialog を出す。
 */
export const Menu = ({ label, children, icon, iconSize = "md", renderTrigger, heading, items, align = "start", pending, linkComponent, triggerTestId }: MenuProps) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const refs = useRef<HTMLElement[]>([]);
  const enabled = () => refs.current.filter((el) => el && !(el as HTMLButtonElement).disabled);
  const focusAt = (n: number) => { const list = enabled(); list[(n + list.length) % list.length]?.focus(); };
  const close = (back: boolean) => { setOpen(false); if (back) root.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus(); };

  useEffect(() => {
    if (!open) return;
    // 選んでいる項目（radio）があればそこへ、無ければ最初の項目へ
    const checked = enabled().findIndex((el) => el.getAttribute("role") === "menuitemradio" && el.getAttribute("aria-checked") === "true");
    focusAt(Math.max(checked, 0));
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); }
  };
  const onPanelKey = (e: KeyboardEvent) => {
    const at = enabled().indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusAt(at + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusAt(at - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    else if (e.key === "End") { e.preventDefault(); focusAt(-1); }
    else if (e.key === "Tab") close(false);
  };

  const trigger: MenuTriggerProps = {
    "aria-haspopup": "menu", "aria-expanded": open, "aria-controls": open ? id : undefined,
    onClick: () => setOpen((v) => !v), onKeyDown: onTriggerKey,
  };
  const Link = linkComponent ?? "a";
  refs.current = [];
  const register = (el: HTMLElement | null) => { if (el) refs.current.push(el); };
  const itemClass = (tone?: "danger") => ["pr-menu__item", tone === "danger" && "pr-menu__item--danger"].filter(Boolean).join(" ");
  const iconOf = (node?: ReactNode) => (node ? <span className="pr-menu__icon" aria-hidden="true">{node}</span> : null);

  const renderItem = (item: MenuItem, i: number) => {
    switch (item.type) {
      case "separator":
        return <div key={i} role="separator" className="pr-menu__sep" />;
      case "link":
        return (
          <Link key={i} ref={register} href={item.href} role="menuitem" tabIndex={-1} className={itemClass()} data-testid={item.testId} onClick={() => setOpen(false)}>
            {iconOf(item.icon)}<span className="pr-menu__label">{item.label}</span>
          </Link>
        );
      case "radio":
        return (
          <button key={i} ref={register} type="button" role="menuitemradio" aria-checked={item.checked} lang={item.lang} tabIndex={-1} disabled={item.disabled}
            className={itemClass()} data-testid={item.testId} onClick={() => { close(true); item.onSelect(); }}>
            <span className="pr-menu__label">{item.label}</span>
            {item.checked ? <span className="pr-menu__check"><Check /></span> : null}
          </button>
        );
      case "switch":
        return (
          <button key={i} ref={register} type="button" role="menuitemcheckbox" aria-checked={item.checked} tabIndex={-1} disabled={item.disabled}
            className={itemClass()} data-testid={item.testId} onClick={() => item.onChange(!item.checked)}>
            <span className="pr-menu__label">{item.label}</span>
            <span className="pr-menu__switch" data-checked={item.checked || undefined} aria-hidden="true" />
          </button>
        );
      case "submit":
        return (
          // React 18 の型では form の action は文字列だけ。製品（React 19）では Server Action をそのまま渡せる
          <form key={i} action={item.action as string} className="pr-menu__form">
            <button ref={register} type="submit" role="menuitem" tabIndex={-1} className={itemClass(item.tone)} data-testid={item.testId}>
              {iconOf(item.icon)}<span className="pr-menu__label">{item.label}</span>
            </button>
          </form>
        );
      default:
        return (
          <button key={i} ref={register} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
            className={itemClass(item.tone)} data-testid={item.testId} onClick={() => { close(true); item.onSelect(); }}>
            {iconOf(item.icon)}<span className="pr-menu__label">{item.label}</span>
          </button>
        );
    }
  };

  return (
    <div className="pr-menu" ref={root}>
      {renderTrigger
        ? renderTrigger(trigger)
        : children === undefined
          ? <IconButton {...trigger} label={label} icon={icon} size={iconSize} data-testid={triggerTestId} />
          : <Button {...trigger} variant="ghost" aria-label={label} data-testid={triggerTestId}>{children}</Button>}
      {open ? (
        <div id={id} role="menu" aria-label={label} aria-busy={pending || undefined}
          className={["pr-menu__panel", align === "end" && "pr-menu__panel--end", pending && "pr-menu__panel--pending"].filter(Boolean).join(" ")}
          onKeyDown={onPanelKey}>
          {heading ? <div role="none" className="pr-menu__heading">{heading}</div> : null}
          {heading ? <div role="separator" className="pr-menu__sep" /> : null}
          {items.map(renderItem)}
        </div>
      ) : null}
    </div>
  );
};
