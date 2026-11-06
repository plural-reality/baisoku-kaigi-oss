import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";

// WorkOS asks a person who belongs to two or more organizations which one to enter, at every
// sign-in. The app never reads the one they pick (the session's org_id), so the question is pure
// friction. After a sign-in this browser remembers who signed in; the next sign-in names one of
// their organizations up front, which skips the question. Their memberships are looked up at that
// moment, because naming an organization they have since left stops the sign-in on WorkOS's page
// (invalid_authorization_state) without coming back here. Signing out forgets them, so the next
// person on a shared browser is not sent in with someone else's organization.

export const SIGN_IN_HINT_COOKIE = "pr_signin_user";

const WORKOS_USER_ID = /^user_[0-9A-Za-z]+$/;
const MAX_AGE = 400 * 24 * 60 * 60; // the longest a browser keeps a cookie

type Membership = Readonly<{
  organizationId: string;
  status: string;
  createdAt: string;
}>;

/** The organization to name at sign-in: none for one or no organization (WorkOS does not ask), else the oldest. */
export const organizationToName = (
  memberships: readonly Membership[],
): string | undefined => {
  const active = memberships
    .filter((membership) => membership.status === "active")
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return active.length >= 2 ? active[0].organizationId : undefined;
};

/** For getSignInUrl: the organization to enter, from who signed in last here. Never fails the sign-in. */
export const signInOrganization = async (): Promise<string | undefined> => {
  const userId = (await cookies()).get(SIGN_IN_HINT_COOKIE)?.value;
  if (!userId || !WORKOS_USER_ID.test(userId)) return undefined;
  return getWorkOS()
    .userManagement.listOrganizationMemberships({
      userId,
      statuses: ["active"],
    })
    .then((page) => organizationToName(page.data))
    .catch(() => undefined);
};

export const rememberSignIn = async (workosUserId: string): Promise<void> => {
  (await cookies()).set(SIGN_IN_HINT_COOKIE, workosUserId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
};

export const forgetSignIn = async (): Promise<void> => {
  (await cookies()).delete(SIGN_IN_HINT_COOKIE);
};
