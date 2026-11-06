// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { SESSION_TEMPLATES } from "@/lib/templates";
import { TemplateSelector } from "../TemplateSelector";

describe("TemplateSelector", () => {
  const defaultProps = {
    onSelect: vi.fn(),
    onSkip: vi.fn(),
  };

  it("renders all session templates", () => {
    render(<TemplateSelector {...defaultProps} />);
    SESSION_TEMPLATES.map((template) =>
      expect(screen.getByText(template.title)).toBeInTheDocument(),
    );
  });

  it("renders template descriptions", () => {
    render(<TemplateSelector {...defaultProps} />);
    SESSION_TEMPLATES.map((template) =>
      expect(screen.getByText(template.description)).toBeInTheDocument(),
    );
  });

  it("calls onSelect when a template card is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TemplateSelector onSelect={onSelect} onSkip={vi.fn()} />);

    await user.click(screen.getByText(SESSION_TEMPLATES[0].title));
    expect(onSelect).toHaveBeenCalledWith(SESSION_TEMPLATES[0]);
  });

  it("calls onSkip when blank card is clicked", async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<TemplateSelector onSelect={vi.fn()} onSkip={onSkip} />);

    await user.click(screen.getByText("白紙から始める"));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("renders the description text", () => {
    render(<TemplateSelector {...defaultProps} />);
    expect(
      screen.getByText(
        "まっさらな状態から始めるか、よくあるユースケースのテンプレートを使うかを選べます。",
      ),
    ).toBeInTheDocument();
  });
});
