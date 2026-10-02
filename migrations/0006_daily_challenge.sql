CREATE TABLE daily_puzzles (
  challenge_date TEXT PRIMARY KEY,
  puzzle_id TEXT NOT NULL,
  regions_json TEXT NOT NULL,
  givens_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE daily_attempts (
  account_id TEXT NOT NULL,
  challenge_date TEXT NOT NULL,
  play_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  elapsed_seconds INTEGER,
  mistakes INTEGER,
  hints_used INTEGER,
  max_hint_stage INTEGER,
  PRIMARY KEY (account_id, challenge_date),
  UNIQUE (account_id, play_id),
  FOREIGN KEY (challenge_date) REFERENCES daily_puzzles(challenge_date)
);

CREATE INDEX daily_attempts_ranking
  ON daily_attempts (challenge_date, completed_at);
