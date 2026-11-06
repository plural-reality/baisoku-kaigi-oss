-- Audit M4: concurrent /statements/generate calls did read-MAX-then-insert with
-- no uniqueness on (session_id, order_index), so two parallel appends could pick
-- the same order_index. Provide an atomic, per-session-serialized append RPC and
-- a UNIQUE safety net.
--
-- The Haskell M36 projection (backend/src/Effect/Projection.hs) inserts statements
-- only once, sequentially, at session creation (MAX+1 subquery), so it already
-- yields unique order_index per session and needs no change; it never overlaps
-- the runtime append path.

CREATE OR REPLACE FUNCTION append_session_statements(
  p_session_id uuid,
  p_texts text[]
)
RETURNS TABLE(id uuid, text text, order_index integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base integer;
BEGIN
  -- Serialize concurrent appends for this session (advisory lock released at
  -- transaction end) so order_index assignment is race-free under READ COMMITTED.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  SELECT COALESCE(MAX(s.order_index), 0) INTO base
    FROM statements s
    WHERE s.session_id = p_session_id;

  RETURN QUERY
  INSERT INTO statements (session_id, text, order_index)
  SELECT p_session_id, t.txt, base + t.ord::integer
    FROM unnest(p_texts) WITH ORDINALITY AS t(txt, ord)
  RETURNING statements.id, statements.text, statements.order_index;
END;
$$;

-- Lock down execution: PostgREST exposes public-schema functions as RPC, and this
-- one is SECURITY DEFINER (runs as owner, bypassing RLS) with no authorization of
-- its own. Left callable by anon/authenticated, any client knowing a session UUID
-- could append statements, bypassing the route-level requireSessionHost / admin
-- checks. Only the server (service_role) may call it; the routes remain the authz.
-- Supabase grants anon/authenticated EXECUTE on public functions via default
-- privileges, which REVOKE ... FROM PUBLIC does NOT remove — revoke them explicitly.
REVOKE EXECUTE ON FUNCTION append_session_statements(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION append_session_statements(uuid, text[]) TO service_role;

-- UNIQUE safety net. Guarded so this migration is safe to apply even if legacy
-- duplicate rows exist: renumbering them here would corrupt report "#n" statement
-- references, so when duplicates are present the index is skipped with a warning
-- and an operator dedupes deliberately. New appends go through the RPC above and
-- never create duplicates.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM statements
    GROUP BY session_id, order_index
    HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'statements has duplicate (session_id, order_index) rows; skipping UNIQUE index. Dedupe manually (preserving #n references), then create statements_session_order_uniq.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS statements_session_order_uniq
      ON statements (session_id, order_index);
  END IF;
END $$;
