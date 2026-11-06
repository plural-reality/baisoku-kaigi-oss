-- Ensure all existing sessions are private (is_public = false).
-- The column is retained for potential future use but the distinction is removed from UI.
UPDATE sessions SET is_public = false WHERE is_public = true;
