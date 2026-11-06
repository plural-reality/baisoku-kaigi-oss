// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock next/link
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

// Mock HeaderLocaleMenu (it needs the app router; covered by its own test)
vi.mock("@/components/HeaderLocaleMenu", () => ({
  HeaderLocaleMenu: () => <div data-testid="locale-menu">Language</div>,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

// Mock signOutAction
vi.mock("@/lib/actions/sign-out", () => ({
  signOutAction: vi.fn(),
}));

// Mock auth provider — default: no user (anonymous)
const mockUseWorkOSUser = vi.fn().mockReturnValue(null);
vi.mock("@/lib/auth-provider", () => ({
  useWorkOSUser: () => mockUseWorkOSUser(),
}));

import { AppHeader } from "../AppHeader";

describe("AppHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkOSUser.mockReturnValue(null);
  });

  it("renders the app title with link to home", () => {
    render(<AppHeader />);
    const link = screen.getByText("倍速会議").closest("a");
    expect(link).toHaveAttribute("href", "/");
  });

  it("shows login link when user is not authenticated", () => {
    render(<AppHeader />);
    expect(screen.getByText("ログイン")).toBeInTheDocument();
    const loginLink = screen.getByText("ログイン").closest("a");
    expect(loginLink).toHaveAttribute("href", "/login");
    expect(loginLink).toHaveTextContent(/^ログイン$/);
  });

  it("shows user avatar when authenticated", () => {
    mockUseWorkOSUser.mockReturnValue({ email: "test@example.com" });
    render(<AppHeader />);
    expect(screen.getByLabelText("ユーザーメニュー")).toBeInTheDocument();
    expect(screen.getByText("T")).toBeInTheDocument(); // first letter of email
  });

  it("opens user menu on avatar click", async () => {
    const user = userEvent.setup();
    mockUseWorkOSUser.mockReturnValue({ email: "test@example.com" });
    render(<AppHeader />);

    await user.click(screen.getByLabelText("ユーザーメニュー"));
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(screen.getByText("ログアウト")).toBeInTheDocument();
  });

  it("closes user menu on outside click", async () => {
    const user = userEvent.setup();
    mockUseWorkOSUser.mockReturnValue({ email: "test@example.com" });
    render(<AppHeader />);

    await user.click(screen.getByLabelText("ユーザーメニュー"));
    expect(screen.getByText("ログアウト")).toBeInTheDocument();

    // Click outside
    await user.click(document.body);
    expect(screen.queryByText("ログアウト")).not.toBeInTheDocument();
  });

  it("renders centerContent when provided", () => {
    render(<AppHeader centerContent={<span>Center</span>} />);
    expect(screen.getByText("Center")).toBeInTheDocument();
  });

  it("renders belowContent when provided", () => {
    render(<AppHeader belowContent={<div>Below</div>} />);
    expect(screen.getByText("Below")).toBeInTheDocument();
  });

  it("applies sticky class when sticky prop is true", () => {
    const { container } = render(<AppHeader sticky />);
    const header = container.querySelector("header");
    expect(header?.className).toContain("sticky");
  });

  it("ヘッダーの補助は言語のメニュー1つ（歯車の設定メニューは無い）", () => {
    render(<AppHeader />);
    expect(screen.getAllByTestId("locale-menu")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "設定" })).toBeNull();
  });

  it("ワードマークは文字（600・18px・字間 -0.01em）で、斜体や大文字化をしない", () => {
    render(<AppHeader />);
    const className =
      screen.getByText("倍速会議").closest("a")?.className ?? "";
    expect(className).toContain("font-semibold");
    expect(className).toContain("text-lg");
    expect(className).toContain("tracking-[-0.01em]");
    for (const forbidden of ["italic", "uppercase", "skew", "font-bold"]) {
      expect(className).not.toContain(forbidden);
    }
  });

  it("高さは 56px（sm 以上 64px）で下罫線を持つ", () => {
    const { container } = render(<AppHeader />);
    const header = container.querySelector("header");
    expect(header?.className).toContain("border-b");
    expect(header?.firstElementChild?.className).toContain("h-14");
    expect(header?.firstElementChild?.className).toContain("sm:h-16");
  });

  it("右側は［言語］［ログイン］の順", () => {
    render(<AppHeader />);
    const menu = screen.getByTestId("locale-menu");
    const login = screen.getByText("ログイン");
    expect(
      menu.compareDocumentPosition(login) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("ログイン中も言語のメニューはアバターの前に並ぶ（アカウントのメニューの中ではない）", async () => {
    const user = userEvent.setup();
    mockUseWorkOSUser.mockReturnValue({ email: "test@example.com" });
    render(<AppHeader />);
    const menu = screen.getByTestId("locale-menu");
    const avatar = screen.getByLabelText("ユーザーメニュー");
    expect(
      menu.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(avatar);
    expect(screen.getAllByTestId("locale-menu")).toHaveLength(1);
  });
});
