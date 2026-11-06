-- =============================================================================
-- Migration: Enable RLS on all tables (Defense-in-depth)
-- =============================================================================
--
-- Strategy:
--   - service_role key is used by the Next.js API layer → automatically bypasses RLS
--   - RLS with NO permissive policies → anon/authenticated roles get zero access
--   - If the anon key leaks, attackers cannot read/write any data
--   - Application behavior is unchanged (all queries go through service_role)
--
-- IMPORTANT: TRUNCATE bypasses RLS in PostgreSQL.
--   We REVOKE TRUNCATE from anon/authenticated to close this gap.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enable Row Level Security on all user-facing tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.individual_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.situation_analysis_reports ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Revoke dangerous privileges from anon and authenticated
--    TRUNCATE bypasses RLS — must be revoked explicitly.
--    TRIGGER and REFERENCES are unnecessary for API consumers.
-- ---------------------------------------------------------------------------

REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.sessions FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.statements FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.participants FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.responses FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.participant_reflections FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.individual_reports FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.session_reports FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.event_threads FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.agent_instances FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.events FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.situation_analysis_reports FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Restrict default privileges for future tables
--    Replace the overly permissive ALTER DEFAULT PRIVILEGES from remote_schema.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;

-- ---------------------------------------------------------------------------
-- No policies are created intentionally.
-- With RLS enabled and no policies:
--   - anon role:          DENIED (all operations)
--   - authenticated role: DENIED (all operations)
--   - service_role:       ALLOWED (bypasses RLS)
--
-- When migrating to anon key in the future, add policies like:
--   CREATE POLICY "host_read_own_sessions" ON sessions
--     FOR SELECT USING (host_user_id = auth.uid());
-- ---------------------------------------------------------------------------
