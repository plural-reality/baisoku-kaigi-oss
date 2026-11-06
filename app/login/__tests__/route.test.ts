import { getSignInUrl, withAuth } from "@workos-inc/authkit-nextjs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInOrganization } from "@/lib/server/sign-in-hint";

vi.mock("@workos-inc/authkit-nextjs", () => ({
  getSignInUrl: vi.fn(),
  withAuth: vi.fn(),
}));

vi.mock("@/lib/server/sign-in-hint", () => ({
  signInOrganization: vi.fn(),
}));

const SIGN_IN = "https://auth.example/sign-in";

const loginRequest = (query = "") =>
  new NextRequest(`http://internal:3000/login${query}`);

// redirect URI と WORKOS_CLIENT_ID は import 時に読むので、env を立ててから読み込む
const loadGet = async () => (await import("../route")).GET;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
  vi.stubEnv(
    "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
    "https://app.example.com/callback",
  );
  vi.mocked(getSignInUrl).mockResolvedValue(SIGN_IN);
  vi.mocked(withAuth).mockResolvedValue({ user: null } as never);
  vi.mocked(signInOrganization).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /login", () => {
  it("未ログインなら戻り先を付けて WorkOS へ送る", async () => {
    const GET = await loadGet();
    const res = await GET(loginRequest("?returnTo=%2Fsessions%2Fnew"));
    expect(res.headers.get("location")).toBe(SIGN_IN);
    expect(getSignInUrl).toHaveBeenCalledWith({
      returnTo: "/sessions/new",
      organizationId: undefined,
    });
  });

  it("前回の人が2つ以上の組織に入っていれば、1つを渡して選択画面を飛ばす", async () => {
    vi.mocked(signInOrganization).mockResolvedValue("org_a");
    const GET = await loadGet();
    await GET(loginRequest());
    expect(getSignInUrl).toHaveBeenCalledWith({ organizationId: "org_a" });
  });

  it("外部への戻り先は捨てる", async () => {
    const GET = await loadGet();
    await GET(loginRequest("?returnTo=%2F%2Fevil.example"));
    expect(getSignInUrl).toHaveBeenCalledWith({ organizationId: undefined });
  });

  it("ログイン済みなら公開 URL の戻り先へ", async () => {
    vi.mocked(withAuth).mockResolvedValue({ user: { id: "u" } } as never);
    const GET = await loadGet();
    const res = await GET(loginRequest("?returnTo=%2Fsessions%2Fnew"));
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/sessions/new",
    );
    expect(getSignInUrl).not.toHaveBeenCalled();
  });

  it("WorkOS 未設定ならトップへ", async () => {
    vi.stubEnv("WORKOS_CLIENT_ID", "");
    const GET = await loadGet();
    const res = await GET(loginRequest());
    expect(res.headers.get("location")).toBe("https://app.example.com/");
  });
});
