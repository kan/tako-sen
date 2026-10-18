-- Each Clerk account's migration token for kan-game.app (the release plan's
-- 「既存の記録の移行」 in main's docs/NEXT_PHASE.md). main's
-- scripts/migrate-legacy.ts writes the rows; a signed-in player gets theirs
-- from GET /api/migration-handoff while the site shows the move notice.
CREATE TABLE migration_handoffs (
  clerk_user_id TEXT PRIMARY KEY,
  token TEXT NOT NULL
);

-- One row, written after the last token: until it is there, a player whose
-- token is missing is told to wait rather than that they have no records.
CREATE TABLE migration_handoffs_loaded (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  loaded_at INTEGER NOT NULL
);
