-- Record which model / prompt version / OpenRouter generation produced each
-- stored LLM output, so outputs can be compared across prompt or model changes
-- and traced back in the OpenRouter dashboard (app/lib/llm-models.ts holds
-- PROMPT_VERSIONS). Additive and nullable: no backfill, old rows stay null.
-- Idempotent so it can be applied to the shared staging/prod DB by hand.

alter table public.individual_reports
  add column if not exists model text null,
  add column if not exists prompt_version text null,
  add column if not exists generation_id text null;

alter table public.session_reports
  add column if not exists prompt_version text null,
  add column if not exists generation_id text null;

alter table public.llm_cache
  add column if not exists model text null,
  add column if not exists prompt_version text null;
