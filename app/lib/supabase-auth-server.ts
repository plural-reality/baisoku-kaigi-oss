import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { collectPublicEnv } from "./public-env";

let _authSupabase: SupabaseClient | null = null;

/**
 * @deprecated Use WorkOS AuthKit instead. This client is kept only for
 * legacy Supabase JWT verification during the migration period.
 * TODO: Remove after migration complete (target: 2026-06-01)
 *
 * Server-side Auth client — connects to Sonar Supabase (shared IdP)
 * Used exclusively for JWT verification in API routes.
 * Lazily initialized to avoid build-time errors when env vars are missing.
 */
export function getAuthSupabase(): SupabaseClient {
  if (_authSupabase) return _authSupabase;

  // Use collectPublicEnv() for dynamic property access — process.env.NEXT_PUBLIC_*
  // is inlined by Next.js at build time, which bakes in Nix build placeholders.
  const publicEnv = collectPublicEnv();
  const authUrl = publicEnv.NEXT_PUBLIC_AUTH_SUPABASE_URL;
  const authServiceKey = process.env.AUTH_SUPABASE_SERVICE_ROLE_KEY;
  const authAnonKey = publicEnv.NEXT_PUBLIC_AUTH_SUPABASE_ANON_KEY;

  if (!authUrl) {
    throw new Error("NEXT_PUBLIC_AUTH_SUPABASE_URL is not set");
  }

  const key = authServiceKey ?? authAnonKey;

  if (!key) {
    throw new Error(
      "Auth Supabase key is not set. Provide AUTH_SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_AUTH_SUPABASE_ANON_KEY.",
    );
  }

  _authSupabase = createClient(authUrl, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _authSupabase;
}
