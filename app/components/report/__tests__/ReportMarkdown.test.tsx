// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ReportMarkdown } from "../ReportMarkdown";
import { StatementTagPopover } from "../StatementTagPopover";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(() => new Promise(() => undefined)),
  },
}));

vi.mock("@/lib/participant-identity", () => ({
  getParticipantBearer: () => "test-bearer",
}));

const reportProps = {
  sessionId: "session-1",
  accessToken: "access-token",
  reportId: "report-1",
  userId: "user-1",
} as const;

describe("ReportMarkdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders # statement markers as hoverable popover triggers", () => {
    render(
      <ReportMarkdown {...reportProps}>
        {"主要論点は #8 と #12 です。"}
      </ReportMarkdown>,
    );

    expect(screen.getByText("#8")).toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("does not emit duplicate React keys for paragraphs with multiple text children", () => {
    // "a **b** c" renders as children ["a ", <strong>b</strong>, " c"]; both
    // plain text nodes previously produced the same local key (`text-0-2`).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ReportMarkdown {...reportProps}>{"a **b** c"}</ReportMarkdown>);

    const hasDuplicateKeyError = errorSpy.mock.calls.some(
      (args) => typeof args[0] === "string" && args[0].includes("same key"),
    );
    expect(hasDuplicateKeyError).toBe(false);
    errorSpy.mockRestore();
  });

  it("uses theme tokens for the popover surface", () => {
    vi.useFakeTimers();
    render(<StatementTagPopover statementNumber={8} {...reportProps} />);

    fireEvent.mouseEnter(screen.getByRole("button"));
    act(() => {
      vi.advanceTimersByTime(151);
    });

    // The popover is portaled to <body>, so query the whole document.
    const surface = document.querySelector(
      '[data-testid="statement-tag-popover-surface"]',
    );
    expect(surface).toHaveClass("bg-popover", "text-popover-foreground");
    expect(surface).not.toHaveClass("bg-white");
  });
});
