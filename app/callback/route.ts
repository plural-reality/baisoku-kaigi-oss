import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { claimLegacyIdentity } from "@/lib/server/legacy-identity";
import { rememberSignIn } from "@/lib/server/sign-in-hint";

const isWorkOSConfigured = Boolean(process.env.WORKOS_CLIENT_ID);
const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ?? "";
const baseURL = redirectUri.replace(/\/callback$/, "") || undefined;

export const GET = isWorkOSConfigured
  ? handleAuth({
      baseURL,
      // 旧 WorkOS プロジェクトのアカウントのデータを引き継ぐ。失敗してもログインは続ける。
      // staging は本番と DB を共有するので、引き継ぎは本番（WORKOS_LEGACY_CLAIM=true）だけ。
      // 次のログインで組織を選ばせないよう、ログインした人をこの端末に覚える。
      onSuccess: async ({ user }) => {
        await rememberSignIn(user.id);
        await (process.env.WORKOS_LEGACY_CLAIM === "true"
          ? claimLegacyIdentity(user)
          : Promise.resolve(null)
        )
          .then((legacyId) => {
            if (legacyId) {
              console.log(
                `[callback] Claimed legacy identity ${legacyId.slice(0, 8)}...`,
              );
            }
          })
          .catch((err) => {
            console.error("[callback] Legacy identity claim failed:", err);
          });
      },
    })
  : () =>
      NextResponse.redirect(
        new URL("/", redirectUri || "http://localhost:3000"),
      );
