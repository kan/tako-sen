-- Trial events keep the original account/cycle eligibility, but only verified
-- ordinary completions may unlock a right. Old clients cannot credit a tap.
DROP TRIGGER super_credit;
ALTER TABLE super_play_events ADD COLUMN credited INTEGER NOT NULL DEFAULT 0
  CHECK (credited IN (0, 1));

UPDATE super_play_events SET credited = 1
WHERE EXISTS (
  SELECT 1 FROM completed_plays c
  WHERE c.account_id = super_play_events.account_id
    AND c.play_id = super_play_events.play_id
    AND c.seed_code = super_play_events.seed_code AND c.ranking_eligible = 1
);

-- Retain already-earned rights. Recount only the current cycle's eligible
-- events, not the player's unrelated historical completions.
UPDATE super_progress SET count = (
  SELECT COUNT(*) FROM super_play_events e
  WHERE e.account_id = super_progress.account_id
    AND e.cycle = super_progress.cycle AND e.credited = 1
) WHERE count < 10;

CREATE TRIGGER super_credit AFTER UPDATE OF credited ON super_play_events
WHEN OLD.credited = 0 AND NEW.credited = 1 BEGIN
  UPDATE super_progress SET
    offer_pending = CASE WHEN count = 9 THEN 1 ELSE offer_pending END,
    count = count + 1
  WHERE account_id = NEW.account_id AND cycle = NEW.cycle AND count < 10;
END;

-- Accept either upload order, atomically and exactly once. Matching the seed
-- also prevents a completed play from crediting a different trial event.
CREATE TRIGGER super_event_completed AFTER INSERT ON super_play_events BEGIN
  UPDATE super_play_events SET credited = 1
  WHERE account_id = NEW.account_id AND play_id = NEW.play_id
    AND EXISTS (
      SELECT 1 FROM completed_plays c
      WHERE c.account_id = NEW.account_id AND c.play_id = NEW.play_id
        AND c.seed_code = NEW.seed_code AND c.ranking_eligible = 1
    );
END;

CREATE TRIGGER super_completion_credit AFTER INSERT ON completed_plays
WHEN NEW.ranking_eligible = 1 BEGIN
  UPDATE super_play_events SET credited = 1
  WHERE account_id = NEW.account_id AND play_id = NEW.play_id
    AND seed_code = NEW.seed_code AND credited = 0;
END;
