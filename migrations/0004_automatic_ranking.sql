ALTER TABLE leaderboard_profiles ADD COLUMN consent_version INTEGER;
ALTER TABLE leaderboard_profiles ADD COLUMN consented_at INTEGER;
ALTER TABLE completed_plays ADD COLUMN ranking_eligible INTEGER NOT NULL DEFAULT 0;

-- Existing history is never republished under the new consent model.
UPDATE completed_plays SET is_public = 0;
DELETE FROM publication_limits;

CREATE TABLE first_ranked_plays (
  account_id TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  play_id TEXT NOT NULL,
  PRIMARY KEY (account_id, puzzle_id),
  FOREIGN KEY (account_id, play_id) REFERENCES completed_plays(account_id, play_id)
    ON DELETE CASCADE
);

-- Runs in the same transaction as the history insertion, including concurrent uploads.
CREATE TRIGGER publish_first_clear AFTER INSERT ON completed_plays
WHEN NEW.ranking_eligible = 1
BEGIN
  INSERT INTO publication_limits (account_id, window_start, attempts)
    VALUES (NEW.account_id, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 1)
    ON CONFLICT(account_id) DO UPDATE SET
      window_start = IIF(excluded.window_start >= window_start + 60000,
        excluded.window_start, window_start),
      attempts = IIF(excluded.window_start >= window_start + 60000,
        1, attempts + 1);
  SELECT RAISE(ABORT, 'play_rate_limited') FROM publication_limits
    WHERE account_id = NEW.account_id AND attempts > 10;
  INSERT INTO first_ranked_plays (account_id, puzzle_id, play_id)
    VALUES (NEW.account_id, NEW.puzzle_id, NEW.play_id)
    ON CONFLICT(account_id, puzzle_id) DO NOTHING;
  UPDATE completed_plays SET is_public = 1
    WHERE account_id = NEW.account_id AND play_id = NEW.play_id
      AND EXISTS (SELECT 1 FROM first_ranked_plays
        WHERE account_id = NEW.account_id AND puzzle_id = NEW.puzzle_id
          AND play_id = NEW.play_id);
END;
