import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

/**
 * 主催者向けのページ（一覧・作成）はログイン必須。未ログインなら /login へ送り、
 * ログイン後に元のページへ戻す。参加者のページ（/sessions/[id]）は使わない。
 * WorkOS 未設定のローカル開発ではそのまま通す。
 */
export const requireHostLogin = async (returnTo: string): Promise<void> => {
  if (!process.env.WORKOS_CLIENT_ID) return;
  const { user } = await withAuth();
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
};

export const pathWithSearch = (
  pathname: string,
  searchParams: Record<string, string | string[] | undefined>,
): string => {
  const query = new URLSearchParams(
    Object.entries(searchParams).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(
        (v): [string, string] => [key, v],
      ),
    ),
  ).toString();
  return query ? `${pathname}?${query}` : pathname;
};
