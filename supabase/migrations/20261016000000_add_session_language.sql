-- Language the session is conducted in (ADR 2026-10-16): AI-generated
-- statements, plans, analyses and reports follow it. Independent of each
-- viewer's UI locale. Existing sessions are Japanese.
alter table public.sessions
  add column if not exists language text not null default 'ja';

alter table public.sessions
  drop constraint if exists sessions_language_check;
alter table public.sessions
  add constraint sessions_language_check check (language in ('ja', 'en'));
