-- 解除した実績（docs/NEXT_PHASE.md「実績の導入計画」）。判定は記録から毎回数え直すので、
-- 進み具合は持たず、解除したことと日時だけを残す。行の追加だけなので、新しい Worker より
-- 先に適用しても、今の Worker はそのまま動く。退会では history.ts の ACCOUNT_TABLES が消す。
CREATE TABLE achievements (
  account_id TEXT NOT NULL,
  achievement_type TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL CHECK (unlocked_at >= 0),
  PRIMARY KEY (account_id, achievement_type)
);
