// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ViralCTA } from "../ViralCTA";

describe("ViralCTA", () => {
  it("renders the CTA heading", () => {
    render(<ViralCTA />);
    expect(
      screen.getByText("あなたのチームでも試してみませんか？"),
    ).toBeInTheDocument();
  });

  it("renders the CTA description", () => {
    render(<ViralCTA />);
    expect(screen.getByText(/倍速会議を使えば/)).toBeInTheDocument();
  });

  it("renders external link with correct URL", () => {
    render(<ViralCTA />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "https://baisoku-kaigi.plural-reality.com/lp",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the action button", () => {
    render(<ViralCTA />);
    expect(screen.getByText("倍速会議について詳しく見る")).toBeInTheDocument();
  });
});
