-- WorkOS project migration (2026-10): 倍速会議 moves from the old WorkOS project
-- ("旧 多元現実", staging environment) to the shared 多元現実 project. User IDs in
-- this DB are toStableUUID(<WorkOS user id>), and WorkOS user ids differ between
-- projects, so a host who signs in to the new project gets a new UUID.
--
-- This table holds the old project's users that own data here, keyed by email.
-- On the first sign-in to the new project with the same verified email, the
-- callback re-keys the legacy UUID's data to the new UUID and stamps claimed_at,
-- so each legacy identity is claimed at most once.
-- Rows are loaded once from the old project's user list (not from this repo).
--
-- The participant child FKs get ON UPDATE CASCADE here (same DDL as
-- 20260531000002, which production never received), so re-keying the parent
-- participants row carries responses / reports / reflections along atomically.

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

CREATE TABLE IF NOT EXISTS workos_legacy_identities (
  email TEXT PRIMARY KEY CHECK (email = lower(email)),
  legacy_user_id UUID NOT NULL UNIQUE,
  claimed_by UUID,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Emails are personal data: only the server (service_role) may read or write.
ALTER TABLE workos_legacy_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE workos_legacy_identities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE workos_legacy_identities TO service_role;

-- Claim + re-key in one transaction: lock the unclaimed row for this email,
-- move its data to new_id, and stamp the claim. Returns the legacy UUID that was
-- merged, or NULL when there is nothing to claim. Does not call migrate_user_id,
-- whose signature differs between environments (uuid vs text). If new_id already
-- joined a session the legacy identity also joined, the participants PK aborts
-- the whole claim (nothing changes; the caller logs it).
CREATE OR REPLACE FUNCTION claim_workos_legacy_identity(p_email TEXT, p_new_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_legacy UUID;
BEGIN
  SELECT legacy_user_id INTO v_legacy
  FROM workos_legacy_identities
  WHERE email = lower(p_email) AND claimed_at IS NULL
  FOR UPDATE;

  IF v_legacy IS NULL OR v_legacy = p_new_id::uuid THEN
    RETURN NULL;
  END IF;

  UPDATE participants SET user_id = p_new_id::uuid WHERE user_id = v_legacy;
  UPDATE sessions SET host_user_id = p_new_id::uuid WHERE host_user_id = v_legacy;

  UPDATE workos_legacy_identities
  SET claimed_by = p_new_id::uuid, claimed_at = now()
  WHERE email = lower(p_email);

  RETURN v_legacy;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_workos_legacy_identity(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_workos_legacy_identity(text, text) TO service_role;
