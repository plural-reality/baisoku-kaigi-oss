"use server";
import { signOut } from "@workos-inc/authkit-nextjs";
import { headers } from "next/headers";
import { forgetSignIn } from "@/lib/server/sign-in-hint";

export const signOutAction = async () => {
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  // 共用の端末で、次の人が前の人の組織を渡されてログインが止まらないように。
  await forgetSignIn();
  return signOut({ returnTo: `${protocol}://${host}` });
};
