-- IDs withdrawn from kan-game.app. Their cookies stay valid for up to 400 days,
-- so requests carrying them are refused (src/worker/auth.ts).
CREATE TABLE deleted_accounts (
  account_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
