-- Make admin report generation race-free (audit 2026-10-20).
--
-- 1. Rows orphaned by a process restart mid-generation stay "pending" /
--    "generating" forever and lock the admin UI. The app now expires them on
--    read (app/lib/server/session-reports.ts, 15 minutes); expire the existing
--    ones here so step 3 can be created (several sessions hold more than one).
update public.session_reports
set status = 'failed',
    error_message = 'レポートの生成が中断されました（サーバーの再起動など）。もう一度お試しください。',
    updated_at = now()
where status in ('pending', 'generating')
  and updated_at < now() - interval '15 minutes';

-- 2. version was computed as max+1 without a constraint, so two concurrent
--    POSTs could both create "v3".
create unique index if not exists session_reports_session_version_key
  on public.session_reports using btree (session_id, version);

-- 3. At most one report in flight per session: a concurrent POST gets a unique
--    violation and is handed the existing in-flight report instead of starting
--    a second LLM call.
create unique index if not exists session_reports_one_in_flight_idx
  on public.session_reports using btree (session_id)
  where status in ('pending', 'generating');
