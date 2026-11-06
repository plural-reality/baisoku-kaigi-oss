import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { collectPublicEnv } from "./public-env";

const globalForSupabase = globalThis as unknown as {
  supabase: SupabaseClient<Database> | undefined;
};

function createSupabaseClient(): SupabaseClient<Database> {
  // Use collectPublicEnv() for dynamic property access — process.env.NEXT_PUBLIC_*
  // is inlined by Next.js at build time, which bakes in Nix build placeholders.
  const publicEnv = collectPublicEnv();
  const supabaseUrl = publicEnv.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAnonKey = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }

  const supabaseKey = supabaseServiceRoleKey ?? supabaseAnonKey;

  if (!supabaseKey) {
    throw new Error(
      "Supabase key is not set. Provide SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return createClient<Database>(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export const supabase = globalForSupabase.supabase ?? createSupabaseClient();

// PostgREST caps a single SELECT at db-max-rows (1000 on Supabase). Page through
// with .range() so large sessions (>1000 rows, e.g. 200+ participants × N
// statements) aren't silently truncated. buildPage applies .range(from, to).
export async function selectAllRange<T, E = unknown>(
  buildPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: E | null }>,
  pageSize = 1000,
): Promise<{ data: T[]; error: E | null }> {
  const page = async (
    from: number,
    acc: T[],
  ): Promise<{ data: T[]; error: E | null }> => {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) return { data: acc, error };
    const batch = data ?? [];
    const next = acc.concat(batch);
    return batch.length < pageSize
      ? { data: next, error: null }
      : page(from + pageSize, next);
  };
  return page(0, []);
}

if (process.env.NODE_ENV !== "production") {
  globalForSupabase.supabase = supabase;
}
