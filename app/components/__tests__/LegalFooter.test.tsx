// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { LegalFooter } from "../legal/LegalFooter";

describe("LegalFooter（会社の帯）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-04-01T00:00:00+09:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("会社マークと合同会社多元現実を会社サイトへのリンクとして出す", () => {
    const { container } = render(<LegalFooter />);
    const company = screen.getByRole("link", { name: "合同会社多元現実" });
    expect(company).toHaveAttribute("href", "https://www.plural-reality.com/");
    expect(company).toHaveAttribute("target", "_blank");
    expect(company).toHaveAttribute("rel", "noopener noreferrer");
    expect(company.querySelector("svg")).not.toBeNull();
    expect(container.textContent).not.toContain("合同会社 多元現実");
  });

  it("製品リンクは倍速会議と倍速アンケートで、閲覧中の倍速会議は太字にするだけ", () => {
    render(<LegalFooter />);
    const products = screen.getByRole("navigation", { name: "製品" });
    const kaigi = within(products).getByRole("link", { name: "倍速会議" });
    const survey = within(products).getByRole("link", {
      name: "倍速アンケート",
    });
    expect(kaigi).toHaveAttribute(
      "href",
      "https://baisoku-kaigi.plural-reality.com/lp",
    );
    expect(survey).toHaveAttribute(
      "href",
      "https://baisoku-survey.plural-reality.com/lp",
    );
    expect(kaigi.className).toContain("font-semibold");
    expect(survey.className).not.toContain("font-semibold");
    expect(products.textContent).not.toContain("閲覧中");
    expect(screen.queryByText("倍速会議について")).not.toBeInTheDocument();
  });

  it("法務リンクは利用規約・プライバシーポリシー（自前）・特定商取引法に基づく表記（HP）の順", () => {
    render(<LegalFooter />);
    const legal = screen.getByRole("navigation", { name: "法務" });
    const links = within(legal).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "利用規約",
      "プライバシーポリシー",
      "特定商取引法に基づく表記",
    ]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/terms",
      "/privacy-policy",
      "https://www.plural-reality.com/tokushoho",
    ]);
  });

  it("© の年は表示時の西暦", () => {
    render(<LegalFooter />);
    expect(screen.getByText("© 2031 Plural Reality LLC")).toBeInTheDocument();
  });
});
