import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("../home-client-page", () => ({ default: () => null }));

import Home from "../page";

beforeEach(() => {
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("トップ（/）", () => {
  it("未ログインなら LP（/lp）へ送る", async () => {
    vi.mocked(withAuth).mockResolvedValue({ user: null } as never);
    await expect(Home()).rejects.toThrow("redirect:/lp");
  });

  it("ログイン済みなら一覧を出す", async () => {
    vi.mocked(withAuth).mockResolvedValue({ user: { id: "u" } } as never);
    await expect(Home()).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("WorkOS 未設定のローカル開発ではそのまま通す", async () => {
    vi.stubEnv("WORKOS_CLIENT_ID", "");
    await expect(Home()).resolves.toBeTruthy();
    expect(withAuth).not.toHaveBeenCalled();
  });
});
