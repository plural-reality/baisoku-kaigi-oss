"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getPublicEnv } from "./public-env";

let browserClient: SupabaseClient<Database> | null = null;

/**
 * Data client — connects to cartographer-agents Supabase (sessions, responses, etc.)
 * Auth is handled by WorkOS (cookie-based), not by this client.
 * Uses runtime-injected env via window.__ENV (not build-time baked process.env).
 */
export const getSupabaseBrowserClient = (): SupabaseClient<Database> => {
  if (browserClient) return browserClient;

  const env = getPublicEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }

  if (!supabaseAnonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
  }

  browserClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return browserClient;
};

/**
 * @deprecated Use WorkOS AuthKit instead. Kept for migration period only.
 * TODO: Remove after migration complete (target: 2026-06-01)
 */
export const getAuthBrowserClient = (): never => {
  throw new Error(
    "getAuthBrowserClient is deprecated. Auth is now handled by WorkOS AuthKit.",
  );
};
