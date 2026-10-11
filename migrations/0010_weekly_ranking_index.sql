-- Bound weekly reads by completion time, without scanning
-- unrelated historical plays. No history or publication flags are changed.
CREATE INDEX completed_plays_weekly_eligible
  ON completed_plays (completed_at, account_id, puzzle_id, play_id, difficulty,
    elapsed_seconds, generator_version)
  WHERE ranking_eligible = 1;
