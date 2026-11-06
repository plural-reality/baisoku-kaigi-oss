import { getSignInUrl, withAuth } from "@workos-inc/authkit-nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { signInOrganization } from "@/lib/server/sign-in-hint";

// ログインは WorkOS の画面だけで行う（パスキー・メールのコード・SSO）。この URL は戻り先を付けて
// WorkOS へ送るだけ。getSignInUrl は PKCE の cookie を書くので、画面の描画ではなく Route Handler で呼ぶ。
// 前回この端末でログインした人の組織を1つ渡し、WorkOS に組織を選ばせない（app/lib/server/sign-in-hint.ts）。
export const dynamic = "force-dynamic";

const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ?? "";

const normalizeReturnTo = (value: string | null): string | null =>
  value?.startsWith("/") && !value.startsWith("//") ? value : null;

// request.url はリバースプロキシの内側のアドレスなので、公開 URL は redirect URI から取る（callback と同じ）。
const siteOrigin = (request: NextRequest): string =>
  redirectUri.replace(/\/callback$/, "") || request.nextUrl.origin;

export const GET = async (request: NextRequest) => {
  const returnTo = normalizeReturnTo(
    request.nextUrl.searchParams.get("returnTo"),
  );
  const toSite = (path: string) =>
    NextResponse.redirect(new URL(path, siteOrigin(request)));

  // WorkOS 未設定のローカル開発ではログインが無いので、トップへ戻す
  if (!process.env.WORKOS_CLIENT_ID) return toSite("/");

  const { user } = await withAuth();
  return user
    ? toSite(returnTo ?? "/")
    : NextResponse.redirect(
        await getSignInUrl({
          ...(returnTo ? { returnTo } : {}),
          organizationId: await signInOrganization(),
        }),
      );
};
