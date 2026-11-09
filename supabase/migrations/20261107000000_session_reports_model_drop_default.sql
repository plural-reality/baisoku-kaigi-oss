-- session_reports.model carried a stale default ('google/gemini-3-flash-preview',
-- a model the app no longer uses). The app always writes the model it actually
-- called (app/lib/llm-models.ts), so the default only masked a missing write.
-- Additive/idempotent: dropping a default never touches existing rows.
alter table public.session_reports alter column model drop default;
