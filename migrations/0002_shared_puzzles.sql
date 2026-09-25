CREATE TABLE shared_puzzles (
  puzzle_id TEXT PRIMARY KEY,
  size INTEGER NOT NULL CHECK (size = 8),
  regions_json TEXT NOT NULL,
  givens_json TEXT NOT NULL,
  seed TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'normal', 'hard')),
  generator_version TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
