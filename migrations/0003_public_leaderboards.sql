ALTER TABLE completed_plays ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0
  CHECK (is_public IN (0, 1));

CREATE INDEX completed_plays_public_puzzle
  ON completed_plays (puzzle_id, elapsed_seconds, hints_used, mistakes)
  WHERE is_public = 1;

CREATE TABLE leaderboard_profiles (
  account_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL UNIQUE
);

CREATE TABLE publication_limits (
  account_id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
