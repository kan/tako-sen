-- Recommendations filter public clears by difficulty and exclude completed boards.
CREATE INDEX completed_plays_public_difficulty
  ON completed_plays (difficulty, account_id, play_id, puzzle_id, seed_code)
  WHERE is_public = 1;

CREATE INDEX completed_plays_account_puzzle
  ON completed_plays (account_id, puzzle_id);

-- The existing first-clear primary key starts with account_id, not puzzle_id.
CREATE INDEX first_ranked_plays_puzzle
  ON first_ranked_plays (puzzle_id, account_id, play_id);
