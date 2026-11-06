// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { EnvBanner, shouldShowEnvBanner } from "../EnvBanner";

describe("shouldShowEnvBanner", () => {
  it.each(["staging", "preview", "Staging "])("%s では出す", (env) => {
    expect(shouldShowEnvBanner(env)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "  ",
    "production",
    "Production",
    "development",
    "ci",
  ])("%s では出さない", (env) => {
    expect(shouldShowEnvBanner(env)).toBe(false);
  });
});

describe("EnvBanner", () => {
  it("本番以外では STAGING: {環境名} の帯を下端に固定して出す", () => {
    render(<EnvBanner environment="staging" />);
    const banner = screen.getByText("STAGING: staging");
    expect(banner.className).toContain("fixed");
    expect(banner.className).toContain("bottom-0");
    expect(banner.className).toContain("bg-amber-500");
    expect(banner.className).toContain("text-black");
    expect(banner.className).toContain("text-xs");
    expect(banner.className).toContain("font-semibold");
  });

  it("本番では何も出さない", () => {
    const { container } = render(<EnvBanner environment="production" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("未設定では何も出さない", () => {
    const { container } = render(<EnvBanner environment={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
