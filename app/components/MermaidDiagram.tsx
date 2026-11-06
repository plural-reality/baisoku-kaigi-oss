"use client";

import { useEffect, useId, useState } from "react";

import { normalizeMermaid } from "@/lib/mermaid-normalize";

// レポート本文の ```mermaid フェンスを図に描く client 専用コンポーネント。
// - mermaid はブラウザ DOM 依存なので dynamic import + useEffect でクライアント側のみロード(SSR回避)。
// - LLM が書きがちな「引用符が要るのに素のラベル」を normalizeMermaid で直してから描く。
// - securityLevel:'strict' + 事前 mermaid.parse で不正構文を弾き(=描画時リンター)、
//   失敗しても落とさず元コードを表示する(レポートは LLM 生成なので必ず graceful fallback)。
export const MermaidDiagram = ({ chart }: { chart: string }) => {
  const rawId = useId();
  const id = `mmd-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark =
          typeof document !== "undefined" &&
          document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
          fontFamily: "inherit",
        });
        const source = normalizeMermaid(chart);
        const valid = await mermaid.parse(source, { suppressErrors: true });
        if (!valid) {
          if (!cancelled) setFailed(true);
          return;
        }
        const { svg: out } = await mermaid.render(id, source);
        if (!cancelled) {
          setSvg(out);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (failed) {
    // 描画できないときは元の mermaid ソースをそのまま見せる(情報は失わない)。
    return (
      <pre className="overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <code>{chart}</code>
      </pre>
    );
  }
  if (svg == null) {
    return (
      <div
        className="my-4 h-28 animate-pulse rounded-md bg-muted/40"
        aria-hidden="true"
      />
    );
  }
  return (
    <div
      className="my-4 flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid.render output with securityLevel:'strict', pre-validated by mermaid.parse; source is report markdown already passing rehype-sanitize.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
