// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/chunk-reload", () => ({ reloadIfChunkError: () => false }));

import GlobalError from "../global-error";

describe("全体エラー", () => {
  const error = Object.assign(new Error("secret stack detail"), {
    stack: "Error: secret stack detail\n    at somewhere (file.ts:1:1)",
  });
  const renderIn = (language: string) => {
    Object.defineProperty(window.navigator, "language", {
      value: language,
      configurable: true,
    });
    return renderToStaticMarkup(
      <GlobalError error={error} reset={() => undefined} />,
    );
  };
  const html = renderIn("ja-JP");

  it("英語のブラウザでは英語の文言にする", () => {
    const english = renderIn("en-AU");
    expect(english).toContain('lang="en"');
    expect(english).toContain("Something went wrong");
    expect(english).toContain("Try again");
    expect(english).not.toContain("secret stack detail");
  });

  it("題・本文・ボタンの文言", () => {
    expect(html).toContain("画面を表示できませんでした");
    expect(html).toContain(
      "一時的な問題が起きました。もう一度表示してください。それでも表示できない場合は、時間をおいて開き直してください。",
    );
    expect(html).toContain("もう一度表示する");
    expect(html).toContain("倍速会議");
  });

  it("白地で、ボタンは製品の墨", () => {
    expect(html).toContain("background:#ffffff");
    expect(html).toContain("background:#111111");
  });

  it("エラー本文やスタックトレースは画面に出さない", () => {
    expect(html).not.toContain("secret stack detail");
    expect(html).not.toContain("somewhere");
    expect(html).not.toContain("申し訳ございません");
  });
});
