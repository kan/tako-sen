-- An ID's clears are kept from before it has a name (the release plan's
-- 「記録の送信」). Only clears after consent are ranked, and a puzzle the ID
-- solved before consent is never ranked, since solving it once already helps.
DROP TRIGGER publish_first_clear;

-- Every upload counts toward the limit, ranked or not. The table keeps its
-- name from when only ranked clears were limited.
CREATE TRIGGER limit_play_uploads AFTER INSERT ON completed_plays
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
END;

-- Runs in the same transaction as the history insertion, including concurrent
-- uploads. Any earlier record of the puzzle, ranked or not, rules it out.
CREATE TRIGGER publish_first_clear AFTER INSERT ON completed_plays
WHEN NEW.ranking_eligible = 1
BEGIN
  INSERT INTO first_ranked_plays (account_id, puzzle_id, play_id)
    SELECT NEW.account_id, NEW.puzzle_id, NEW.play_id
    WHERE NOT EXISTS (
      SELECT 1 FROM completed_plays
      WHERE account_id = NEW.account_id AND puzzle_id = NEW.puzzle_id
        AND play_id <> NEW.play_id
    )
    ON CONFLICT(account_id, puzzle_id) DO NOTHING;
  UPDATE completed_plays SET is_public = 1
    WHERE account_id = NEW.account_id AND play_id = NEW.play_id
      AND EXISTS (SELECT 1 FROM first_ranked_plays
        WHERE account_id = NEW.account_id AND puzzle_id = NEW.puzzle_id
          AND play_id = NEW.play_id);
END;
