// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/sign-out", () => ({ signOutAction: vi.fn() }));

const theme = { resolvedTheme: "light", setTheme: vi.fn() };
vi.mock("next-themes", () => ({ useTheme: () => theme }));

import { HeaderAccountMenu } from "../HeaderAccountMenu";

const openMenu = async () => {
  const user = userEvent.setup();
  render(<HeaderAccountMenu email="test@example.com" />);
  await user.click(screen.getByRole("button", { name: "ユーザーメニュー" }));
  return user;
};

describe("HeaderAccountMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    theme.resolvedTheme = "light";
  });

  it("アバターはメールアドレスの頭文字", () => {
    render(<HeaderAccountMenu email="test@example.com" />);
    expect(
      screen.getByRole("button", { name: "ユーザーメニュー" }),
    ).toHaveTextContent("T");
  });

  it("上から、メールアドレス → ダークモード → ログアウトの順に並ぶ", async () => {
    await openMenu();
    const menu = screen.getByRole("menu");
    expect(menu.textContent).toBe("test@example.comダークモードログアウト");
    expect(screen.getAllByRole("menuitem").at(-1)).toHaveTextContent(
      "ログアウト",
    );
    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  });

  it("ダークモードはスイッチで、今の画面が暗いかを映す", async () => {
    theme.resolvedTheme = "dark";
    await openMenu();
    await waitFor(() =>
      expect(screen.getByTestId("theme-switch")).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(screen.getByTestId("theme-switch")).toHaveAttribute(
      "role",
      "menuitemcheckbox",
    );
  });

  it("スイッチを押すとその側を記憶し、メニューは開いたまま", async () => {
    const user = await openMenu();
    await user.click(screen.getByTestId("theme-switch"));
    expect(theme.setTheme).toHaveBeenCalledWith("dark");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("ログアウトはフォームで送り、危険の色で示す", async () => {
    await openMenu();
    const logout = screen.getByRole("menuitem", { name: "ログアウト" });
    expect(logout).toHaveAttribute("type", "submit");
    expect(logout.closest("form")).not.toBeNull();
    expect(logout.className).toContain("pr-menu__item--danger");
  });
});
