"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { reloadIfChunkError } from "@/lib/chunk-reload";

// 全体エラー（errors、IMPLEMENTATION.md §6）。root layout ごと置き換わるため、
// globals.css もフォントも届かない。白地・製品名・製品の青のボタンを inline style で組む。
// スタックトレースやエラー本文は画面に出さない（Sentry にだけ送る）。
// No i18n provider here (this replaces the root layout), so pick the copy from
// the explicit locale cookie, else the browser language.
const COPY = {
  ja: {
    product: "倍速会議",
    title: "画面を表示できませんでした",
    body: "一時的な問題が起きました。もう一度表示してください。それでも表示できない場合は、時間をおいて開き直してください。",
    retry: "もう一度表示する",
  },
  en: {
    product: "Baisoku Kaigi",
    title: "Something went wrong",
    body: "A temporary problem occurred. Please try again. If it still doesn't load, wait a moment and reopen the page.",
    retry: "Try again",
  },
} as const;

const detectLocale = (): keyof typeof COPY => {
  if (typeof document === "undefined") return "ja";
  const cookie = document.cookie.match(/(?:^|; )NEXT_LOCALE=(ja|en)/)?.[1];
  if (cookie === "ja" || cookie === "en") return cookie;
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
};

const fontFamily =
  '"Geist Variable", "Noto Sans JP Variable", "Hiragino Kaku Gothic ProN", "Hiragino Sans", system-ui, sans-serif';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = detectLocale();
  const copy = COPY[locale];
  useEffect(() => {
    // A stale-bundle ChunkLoadError reaches this boundary at render time (never the
    // window listeners). Reload to recover; such errors are ignored in Sentry anyway.
    reloadIfChunkError(error) || Sentry.captureException(error);
  }, [error]);

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          background: "#ffffff",
          color: "#111111",
          fontFamily,
        }}
      >
        <main
          style={{
            minHeight: "100svh",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            {copy.product}
          </p>
          <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600 }}>
            {copy.title}
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: "480px",
              fontSize: "14px",
              lineHeight: 1.8,
              color: "#525252",
            }}
          >
            {copy.body}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: "8px",
              height: "40px",
              padding: "0 24px",
              border: "none",
              borderRadius: "8px",
              background: "#111111",
              color: "#ffffff",
              fontFamily: "inherit",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {copy.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
