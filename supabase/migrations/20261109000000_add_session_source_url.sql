-- Where a session's material came from (e.g. the Decidim discussion it was
-- imported from). Null for sessions written by hand.
alter table public.sessions
  add column if not exists source_url text;

alter table public.sessions
  drop constraint if exists sessions_source_url_check;
alter table public.sessions
  add constraint sessions_source_url_check
  check (source_url is null or source_url like 'https://%');
