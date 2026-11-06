"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkOSUser } from "./auth-provider";
import {
  ensureParticipantIdentity,
  getParticipantBearer,
} from "./participant-identity";

const LEGACY_USER_ID_KEY = "cartographer_user_id";

/**
 * Migrate legacy localStorage UUID to WorkOS identity.
 * Called once when a WorkOS user is detected AND a legacy UUID exists.
 * On success, removes the legacy UUID from localStorage.
 */
const migrateLegacyUserId = (legacyId: string): Promise<boolean> => {
  // Prove ownership of the old identity (audit M1): send its own bearer (the
  // signed token, or the legacy UUID during Stage 1) so the server can verify
  // the caller actually holds oldUserId before merging its data into the account.
  const bearer = getParticipantBearer();
  return fetch("/api/auth/migrate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ oldUserId: legacyId }),
  })
    .then((res) => {
      if (res.ok) {
        localStorage.removeItem(LEGACY_USER_ID_KEY);
        console.log("[useUserId] Migration succeeded:", legacyId.slice(0, 8));
        return true;
      }
      console.warn("[useUserId] Migration failed:", res.status);
      return false;
    })
    .catch((err) => {
      console.warn("[useUserId] Migration error:", err);
      return false;
    });
};

/**
 * Get current user identity. Priority:
 * 1. WorkOS authenticated user (via AuthProvider context)
 * 2. Legacy localStorage UUID (for anonymous participants)
 *
 * Returns { userId, accessToken, isLoading }.
 * accessToken is null with WorkOS (cookie-based auth — headers not needed).
 *
 * When a WorkOS user logs in and a legacy UUID exists in localStorage,
 * automatically triggers migration of sessions from legacy → WorkOS identity.
 * isLoading remains true until migration completes to prevent stale queries.
 */
export const useUserId = () => {
  const workosUser = useWorkOSUser();
  const [legacyUserId, setLegacyUserId] = useState<string | null>(null);
  const [participantToken, setParticipantToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const migrationAttempted = useRef(false);

  useEffect(() => {
    // WorkOS user available — check for legacy UUID to migrate
    if (workosUser) {
      const legacyId = localStorage.getItem(LEGACY_USER_ID_KEY);
      const shouldMigrate = legacyId && !migrationAttempted.current;

      // If migration needed, keep isLoading=true until it completes
      if (shouldMigrate) {
        migrationAttempted.current = true;
        migrateLegacyUserId(legacyId).then(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }

      return;
    }

    // No WorkOS session — anonymous participant: exchange the legacy UUID for a
    // server-signed token (audit H1/M2). Falls back to the raw UUID when token
    // issuance is unavailable, which the server still accepts until enforcement.
    ensureParticipantIdentity().then(({ userId, token }) => {
      setLegacyUserId(userId);
      setParticipantToken(token);
      setIsLoading(false);
    });
  }, [workosUser]);

  // WorkOS user ID is used for display only on the client.
  // Server-side API routes convert it to UUID via toStableUUID() in auth.ts.
  const userId = workosUser?.id ?? legacyUserId;
  // With WorkOS, cookies carry auth automatically. For anonymous participants
  // the Bearer is the signed participant token (audit H1/M2), falling back to
  // the raw UUID when issuance was unavailable.
  const accessToken = workosUser ? null : (participantToken ?? legacyUserId);

  return { userId, accessToken, isLoading } as const;
};
