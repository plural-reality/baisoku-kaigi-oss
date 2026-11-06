-- Fix migrate_user_id (security audit M5): the original (20260301000000) updated
-- individual_reports and participant_reflections with `SET user_id`, but both
-- tables' actual column is `participant_user_id`. Postgres raised 42703
-- (undefined_column), rolling back the whole SECURITY DEFINER function, so every
-- call to /api/auth/migrate returned 500. (This accidentally masked the M1
-- account-takeover — fixed atomically alongside this migration in the route.)
--
-- Verified column names (app/lib/database.types.ts):
--   participants.user_id, responses.participant_user_id, sessions.host_user_id,
--   individual_reports.participant_user_id, participant_reflections.participant_user_id

CREATE OR REPLACE FUNCTION migrate_user_id(old_id TEXT, new_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE participants
    SET user_id = new_id
    WHERE user_id = old_id;

  UPDATE responses
    SET participant_user_id = new_id
    WHERE participant_user_id = old_id;

  UPDATE sessions
    SET host_user_id = new_id
    WHERE host_user_id = old_id;

  UPDATE individual_reports
    SET participant_user_id = new_id
    WHERE participant_user_id = old_id;

  UPDATE participant_reflections
    SET participant_user_id = new_id
    WHERE participant_user_id = old_id;
END;
$$;
