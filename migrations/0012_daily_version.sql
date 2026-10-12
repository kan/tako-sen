ALTER TABLE daily_puzzles
  ADD COLUMN generator_version TEXT NOT NULL DEFAULT 'daily-v1';
