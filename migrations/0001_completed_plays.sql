CREATE TABLE completed_plays (
  account_id TEXT NOT NULL,
  play_id TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  seed_code TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'normal', 'hard')),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  completed_at INTEGER NOT NULL CHECK (completed_at >= started_at),
  elapsed_seconds INTEGER NOT NULL CHECK (elapsed_seconds >= 0),
  mistakes INTEGER NOT NULL CHECK (mistakes >= 0),
  hints_used INTEGER NOT NULL CHECK (hints_used >= 0),
  PRIMARY KEY (account_id, play_id)
);

CREATE INDEX completed_plays_account_completed
  ON completed_plays (account_id, completed_at DESC);
