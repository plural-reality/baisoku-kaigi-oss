-- llm_cache: memoize deterministic LLM calls (currently the PCA cluster labels)
-- by a hash of the prompt, so identical inputs reuse the stored output instead of
-- re-running the model (which takes ~tens of seconds). Server-only.
create table if not exists public.llm_cache (
  cache_key text primary key,
  response text not null,
  created_at timestamptz not null default now()
);

-- Server uses the service role (bypasses RLS). Enable RLS with no policies so
-- anon/auth clients have no access (defense in depth, matches other tables).
alter table public.llm_cache enable row level security;
