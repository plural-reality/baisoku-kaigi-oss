// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// 製品のヘッダーが付くことだけを確認する（ヘッダー自体は AppHeader.test.tsx）
vi.mock("@/components/AppHeader", () => ({
  AppHeader: () => <header data-testid="app-header">倍速会議</header>,
}));

import NotFound, { generateMetadata } from "../not-found";

describe("404 ページ", () => {
  it("題・本文・戻るボタンを日本語で出し、製品のヘッダーを付ける", async () => {
    render(await NotFound());
    expect(screen.getByTestId("app-header")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "ページが見つかりません" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "お探しのページは存在しないか、移動した可能性があります。",
      ),
    ).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "トップへ戻る" });
    expect(back).toHaveAttribute("href", "/");
  });

  it("title は `ページが見つかりません | 倍速会議`", async () => {
    expect((await generateMetadata()).title).toBe(
      "ページが見つかりません | 倍速会議",
    );
  });
});
