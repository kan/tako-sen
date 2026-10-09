CREATE TABLE super_progress (
  account_id TEXT PRIMARY KEY REFERENCES leaderboard_profiles(account_id) ON DELETE CASCADE,
  cycle INTEGER NOT NULL DEFAULT 0 CHECK (cycle >= 0),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count BETWEEN 0 AND 10),
  offer_pending INTEGER NOT NULL DEFAULT 0 CHECK (offer_pending IN (0, 1)),
  CHECK (offer_pending = 0 OR count = 10)
);

CREATE TABLE super_play_events (
  account_id TEXT NOT NULL REFERENCES super_progress(account_id) ON DELETE CASCADE,
  play_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  seed_code TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, play_id)
);
CREATE INDEX super_event_rate ON super_play_events(account_id, received_at);

-- Insertion and credit are one transaction. Even events ignored while a right
-- is held remain recorded, so replay cannot credit the following cycle.
CREATE TRIGGER super_credit AFTER INSERT ON super_play_events BEGIN
  UPDATE super_progress SET
    offer_pending = CASE WHEN count = 9 THEN 1 ELSE offer_pending END,
    count = count + 1
  WHERE account_id = NEW.account_id AND cycle = NEW.cycle AND count < 10;
END;

CREATE TABLE super_puzzles (
  puzzle_id TEXT PRIMARY KEY,
  seed_code TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE super_prepare_limits (
  account_id TEXT NOT NULL REFERENCES leaderboard_profiles(account_id) ON DELETE CASCADE,
  minute INTEGER NOT NULL,
  requests INTEGER NOT NULL,
  PRIMARY KEY(account_id, minute)
);

CREATE TABLE super_attempts (
  account_id TEXT NOT NULL REFERENCES super_progress(account_id) ON DELETE CASCADE,
  play_id TEXT NOT NULL,
  puzzle_id TEXT NOT NULL REFERENCES super_puzzles(puzzle_id),
  entry TEXT NOT NULL CHECK (entry IN ('earned', 'shared')),
  cycle INTEGER NOT NULL CHECK (cycle >= 0),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  elapsed_seconds INTEGER,
  mistakes INTEGER,
  hints_used INTEGER,
  max_hint_stage INTEGER,
  PRIMARY KEY (account_id, play_id)
);
CREATE UNIQUE INDEX super_one_consumption ON super_attempts(account_id, cycle) WHERE entry = 'earned';
CREATE INDEX super_start_rate ON super_attempts(account_id, started_at);
CREATE INDEX super_complete_rate ON super_attempts(account_id, completed_at);

CREATE TRIGGER super_start_guard BEFORE INSERT ON super_attempts BEGIN
  SELECT RAISE(ABORT, 'super_right_required')
  WHERE NEW.entry = 'earned' AND NOT EXISTS (
    SELECT 1 FROM super_progress WHERE account_id = NEW.account_id
      AND cycle = NEW.cycle AND count = 10 AND cycle < 9007199254740991
  );
  SELECT RAISE(ABORT, 'super_rate_limited') WHERE (
    SELECT COUNT(*) FROM super_attempts WHERE account_id = NEW.account_id
      AND started_at > NEW.started_at - 60000
  ) >= 10;
END;

CREATE TRIGGER super_consume AFTER INSERT ON super_attempts
WHEN NEW.entry = 'earned' BEGIN
  UPDATE super_progress SET cycle = cycle + 1, count = 0, offer_pending = 0
  WHERE account_id = NEW.account_id AND cycle = NEW.cycle AND count = 10;
END;

CREATE TABLE super_first_scores (
  account_id TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  play_id TEXT NOT NULL,
  PRIMARY KEY (account_id, puzzle_id),
  FOREIGN KEY (account_id, play_id) REFERENCES super_attempts(account_id, play_id) ON DELETE CASCADE
);

CREATE TRIGGER super_complete_guard BEFORE UPDATE OF completed_at ON super_attempts
WHEN OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL BEGIN
  SELECT RAISE(ABORT, 'super_rate_limited') WHERE (
    SELECT COUNT(*) FROM super_attempts WHERE account_id = NEW.account_id
      AND completed_at > NEW.completed_at - 60000
  ) >= 10;
END;

CREATE TRIGGER super_first_score AFTER UPDATE OF completed_at ON super_attempts
WHEN OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL BEGIN
  INSERT INTO super_first_scores(account_id, puzzle_id, play_id)
  VALUES (NEW.account_id, NEW.puzzle_id, NEW.play_id)
  ON CONFLICT(account_id, puzzle_id) DO NOTHING;
END;
