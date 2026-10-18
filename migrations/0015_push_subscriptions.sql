-- Web Push subscriptions for the daily challenge (kan/tako-sen#10), one per
-- device: a device that switches its ID moves its subscription along.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  key_p256dh TEXT NOT NULL,
  key_auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_account ON push_subscriptions (account_id);
