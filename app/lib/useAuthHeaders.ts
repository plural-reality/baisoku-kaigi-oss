"use client";

import { useCallback } from "react";
import { useWorkOSUser } from "./auth-provider";
import { getParticipantBearer } from "./participant-identity";

/**
 * Get auth headers for API requests.
 *
 * With WorkOS: cookies carry auth automatically — returns empty headers.
 * Anonymous participants: send the signed participant token as Bearer (audit
 * H1/M2), falling back to the raw legacy UUID until enforcement is switched on.
 */
export const useAuthHeaders = () => {
  const workosUser = useWorkOSUser();

  const getAuthHeaders = useCallback(async (): Promise<
    Record<string, string>
  > => {
    // WorkOS cookies are sent automatically by the browser
    if (workosUser) return {};

    const bearer = getParticipantBearer();
    return bearer ? { Authorization: `Bearer ${bearer}` } : {};
  }, [workosUser]);

  return { getAuthHeaders } as const;
};
