-- The super first-score primary key starts with account_id, so a ranking read
-- by puzzle scanned every profile. Indexes only; no scores or rights change.
CREATE INDEX super_first_scores_puzzle
  ON super_first_scores (puzzle_id, account_id, play_id);

-- Candidate reads exclude boards the account has already completed.
CREATE INDEX super_attempts_completed_puzzle
  ON super_attempts (account_id, puzzle_id)
  WHERE completed_at IS NOT NULL;
