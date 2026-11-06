// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const setLocaleAction = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/actions/set-locale", () => ({
  setLocaleAction: (locale: string) => setLocaleAction(locale),
}));

import { HeaderLocaleMenu } from "../HeaderLocaleMenu";

const openMenu = async () => {
  const user = userEvent.setup();
  render(<HeaderLocaleMenu />);
  await user.click(screen.getByRole("button", { name: "言語" }));
  return user;
};

describe("HeaderLocaleMenu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("地球儀のボタンを押すと、言語だけのメニューが開く", async () => {
    const user = userEvent.setup();
    render(<HeaderLocaleMenu />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "言語" }));
    const items = screen
      .getAllByRole("menuitemradio")
      .map((i) => i.textContent);
    expect(items).toEqual(["日本語", "English"]);
    expect(screen.queryByText("ダーク")).not.toBeInTheDocument();
  });

  it("今の言語に印が付き、開くとそこへフォーカスが移る", async () => {
    await openMenu();
    expect(screen.getByTestId("locale-ja")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("locale-ja")).toHaveFocus();
    expect(screen.getByTestId("locale-en")).toHaveAttribute("lang", "en");
  });

  it("言語を選ぶと cookie を保存して画面を更新する", async () => {
    const user = await openMenu();
    await user.click(screen.getByTestId("locale-en"));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(setLocaleAction).toHaveBeenCalledWith("en");
  });

  it("今の言語を選び直しても何もしない", async () => {
    const user = await openMenu();
    await user.click(screen.getByTestId("locale-ja"));
    expect(setLocaleAction).not.toHaveBeenCalled();
  });

  it("Esc で閉じ、フォーカスがアイコンに戻る", async () => {
    const user = await openMenu();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "言語" })).toHaveFocus();
  });

  it("矢印キーで項目を移動できる", async () => {
    const user = await openMenu();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId("locale-en")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId("locale-ja")).toHaveFocus();
  });

  it("外側を押すと閉じる", async () => {
    const user = await openMenu();
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
