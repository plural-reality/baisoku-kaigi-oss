import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

import HomeClientPage from "./home-client-page";

export const dynamic = "force-dynamic";

// 主催者の一覧はログイン必須。未ログインの訪問者には LP（/lp。nginx が Vercel の LP へ中継する）を見せる。
// 倍速アンケートと同じ切り方（2026-10-24）。WorkOS 未設定のローカル開発ではそのまま通す。
export default async function Home() {
  if (process.env.WORKOS_CLIENT_ID) {
    const { user } = await withAuth();
    if (!user) redirect("/lp");
  }
  return <HomeClientPage />;
}
