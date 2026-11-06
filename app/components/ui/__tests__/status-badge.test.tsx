// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { StatusBadge } from "../status-badge";

describe("StatusBadge", () => {
  it("renders pending status with correct label", () => {
    render(<StatusBadge status="pending" />);
    expect(screen.getByText("待機中")).toBeInTheDocument();
  });

  it("renders generating status with correct label", () => {
    render(<StatusBadge status="generating" />);
    expect(screen.getByText("生成中")).toBeInTheDocument();
  });

  it("renders completed status with correct label", () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText("完了")).toBeInTheDocument();
  });

  it("renders failed status with correct label", () => {
    render(<StatusBadge status="failed" />);
    expect(screen.getByText("失敗")).toBeInTheDocument();
  });

  it("applies the semantic soft colors for each status", () => {
    const { container, rerender } = render(<StatusBadge status="pending" />);
    expect(container.firstChild).toHaveClass("bg-warning-soft", "text-warning");

    rerender(<StatusBadge status="completed" />);
    expect(container.firstChild).toHaveClass("bg-success-soft", "text-success");

    rerender(<StatusBadge status="failed" />);
    expect(container.firstChild).toHaveClass("bg-danger-soft", "text-danger");
  });

  it("passes custom className", () => {
    const { container } = render(
      <StatusBadge status="completed" className="custom-class" />,
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });
});
