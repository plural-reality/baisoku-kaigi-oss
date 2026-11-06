-- Follow-up to 20260531000000 (audit M1/M5). A review surfaced two defects that
-- still kept migrate_user_id from executing, plus an RPC-exposure gap:
--
-- 1. The function declared TEXT params but every target column is uuid, so the
--    comparisons/assignments would fail at runtime — cast to uuid.
-- 2. The child FKs (responses / individual_reports / participant_reflections →
--    participants(user_id, session_id)) had ON DELETE CASCADE but no ON UPDATE
--    CASCADE, so rewriting the parent participant key first orphaned child rows
--    (immediate FK violation). Add ON UPDATE CASCADE so a participant re-key
--    propagates atomically; the function then only rewrites the parent keys.
-- 3. migrate_user_id is SECURITY DEFINER yet was EXECUTE-able by PUBLIC, so it was
--    callable directly via PostgREST RPC, bypassing the route's M1 ownership
--    check. Lock it to service_role. Shipped together: making the function work
--    without this lockdown would expose the bypass.

-- (2) Re-add the participant child FKs with ON UPDATE CASCADE. Re-added NOT VALID
-- to keep apply instant/safe on existing data; cascade is a trigger and fires on
-- updates regardless of validation state.
ALTER TABLE responses DROP CONSTRAINT IF EXISTS responses_participant_fk;
ALTER TABLE responses ADD CONSTRAINT responses_participant_fk
  FOREIGN KEY (participant_user_id, session_id)
  REFERENCES participants(user_id, session_id)
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE individual_reports DROP CONSTRAINT IF EXISTS individual_reports_participant_fk;
ALTER TABLE individual_reports ADD CONSTRAINT individual_reports_participant_fk
  FOREIGN KEY (participant_user_id, session_id)
  REFERENCES participants(user_id, session_id)
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE participant_reflections DROP CONSTRAINT IF EXISTS participant_reflections_participant_fk;
ALTER TABLE participant_reflections ADD CONSTRAINT participant_reflections_participant_fk
  FOREIGN KEY (participant_user_id, session_id)
  REFERENCES participants(user_id, session_id)
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

-- (1) Rewrite the function: cast text → uuid, and rely on ON UPDATE CASCADE for
-- children, so only the two parent-key columns are rewritten here.
CREATE OR REPLACE FUNCTION migrate_user_id(old_id TEXT, new_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Edge case (pre-existing, intentionally not auto-merged here): if new_id is
  -- already a participant in a session old_id also participates in, this UPDATE
  -- hits the participants (user_id, session_id) PK and the whole function aborts
  -- atomically — the migration is declined, no partial/corrupt state. Cross-identity
  -- data-merge for that case is a separate, deliberate operation.
  --
  -- participants(user_id, session_id) is the parent of responses /
  -- individual_reports / participant_reflections (ON UPDATE CASCADE), so this
  -- single update propagates the re-key to all child rows atomically.
  UPDATE participants SET user_id = new_id::uuid WHERE user_id = old_id::uuid;
  -- sessions.host_user_id has no FK; rewrite it directly.
  UPDATE sessions SET host_user_id = new_id::uuid WHERE host_user_id = old_id::uuid;
END;
$$;

-- (3) Lock down: only the server (service_role) may call it; the migrate route's
-- M1 ownership proof remains the authorization boundary. Supabase grants
-- anon/authenticated EXECUTE on public functions via default privileges, which
-- REVOKE ... FROM PUBLIC does NOT remove — revoke them explicitly.
REVOKE EXECUTE ON FUNCTION migrate_user_id(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION migrate_user_id(text, text) TO service_role;
