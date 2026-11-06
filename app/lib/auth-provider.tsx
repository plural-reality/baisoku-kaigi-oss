"use client";

import { createContext, type ReactNode, useContext } from "react";

type WorkOSUser = Readonly<{
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}>;

type AuthContextValue = Readonly<{
  user: WorkOSUser | null;
}>;

const AuthContext = createContext<AuthContextValue>({ user: null });

/**
 * Client-side auth context provider.
 * User data is injected from server component (layout.tsx) via withAuth().
 */
export const AuthProvider = ({
  user,
  children,
}: Readonly<{ user: WorkOSUser | null; children: ReactNode }>) => (
  <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>
);

/**
 * Get the WorkOS-authenticated user (or null for anonymous visitors).
 */
export const useWorkOSUser = (): WorkOSUser | null =>
  useContext(AuthContext).user;
