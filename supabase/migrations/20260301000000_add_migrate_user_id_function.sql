-- Migration function to update user IDs from legacy UUID to Supabase auth.uid
-- Called from /api/auth/migrate endpoint

CREATE OR REPLACE FUNCTION migrate_user_id(old_id TEXT, new_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update participants
  UPDATE participants
    SET user_id = new_id
    WHERE user_id = old_id;

  -- Update responses
  UPDATE responses
    SET participant_user_id = new_id
    WHERE participant_user_id = old_id;

  -- Update sessions (host)
  UPDATE sessions
    SET host_user_id = new_id
    WHERE host_user_id = old_id;

  -- Update individual_reports
  UPDATE individual_reports
    SET user_id = new_id
    WHERE user_id = old_id;

  -- Update participant_reflections
  UPDATE participant_reflections
    SET user_id = new_id
    WHERE user_id = old_id;
END;
$$;
