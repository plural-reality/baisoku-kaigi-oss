import type { User } from "@workos-inc/node";
import { supabase } from "@/lib/supabase";
import { toStableUUID } from "@/lib/workos-uuid";

/**
 * 旧 WorkOS プロジェクトのユーザーを、同じ確認済みメールで新プロジェクトに
 * ログインしたときに引き継ぐ。旧 UUID のデータを新 UUID に付け替える（1回だけ）。
 * 失敗してもログインは止めない（呼び出し側で握る）。
 */
export const claimLegacyIdentity = async (
  user: Pick<User, "id" | "email" | "emailVerified">,
): Promise<string | null> => {
  if (!user.emailVerified || !user.email) return null;

  const { data, error } = await (supabase.rpc as CallableFunction)(
    "claim_workos_legacy_identity",
    { p_email: user.email.toLowerCase(), p_new_id: toStableUUID(user.id) },
  );
  if (error) throw error;
  return (data as string | null) ?? null;
};
