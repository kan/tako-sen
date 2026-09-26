import type { LeaderboardEntry } from "../core/leaderboard";

export type PublicationOutcome = "ok" | "not_found" | "rate_limited";

export async function setPublication(
  db: D1Database,
  accountId: string,
  playId: string,
  publish: boolean,
  now: number,
): Promise<PublicationOutcome> {
  if (!publish) {
    // Withdrawal is never rate limited. Keep the private record intact.
    const result = await db
      .prepare(
        "UPDATE completed_plays SET is_public = 0 WHERE account_id = ? AND play_id = ?",
      )
      .bind(accountId, playId)
      .run();
    return result.meta.changes ? "ok" : "not_found";
  }
  const own = await db
    .prepare(
      "SELECT is_public FROM completed_plays WHERE account_id = ? AND play_id = ?",
    )
    .bind(accountId, playId)
    .first<{ is_public: number }>();
  if (!own) return "not_found";
  if (own.is_public === 1) return "ok";

  // Atomic fixed-window quota: at most 10 publication attempts per minute.
  const quota = await db
    .prepare(
      `INSERT INTO publication_limits (account_id, window_start, attempts)
       SELECT account_id, ?, 1 FROM completed_plays WHERE account_id = ? AND play_id = ?
       ON CONFLICT(account_id) DO UPDATE SET
         window_start = CASE WHEN excluded.window_start >= window_start + 60000
                             THEN excluded.window_start ELSE window_start END,
         attempts = CASE WHEN excluded.window_start >= window_start + 60000
                         THEN 1 ELSE attempts + 1 END
       WHERE excluded.window_start >= window_start + 60000 OR attempts < 10`,
    )
    .bind(now, accountId, playId)
    .run();
  if (!quota.meta.changes) return "rate_limited";

  // Only create a profile while the owned play still exists (deletion can race).
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO leaderboard_profiles (account_id, display_name)
         SELECT account_id, ? FROM completed_plays WHERE account_id = ? AND play_id = ?
         ON CONFLICT(account_id) DO NOTHING`,
      )
      .bind(
        `タコ-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
        accountId,
        playId,
      ),
    db
      .prepare(
        "UPDATE completed_plays SET is_public = 1 WHERE account_id = ? AND play_id = ?",
      )
      .bind(accountId, playId),
  ]);
  return results[1].meta.changes ? "ok" : "not_found";
}

export async function listLeaderboard(
  db: D1Database,
  puzzleId: string,
): Promise<LeaderboardEntry[]> {
  const result = await db
    .prepare(
      `WITH candidates AS (
         SELECT account_id, elapsed_seconds, hints_used, mistakes,
           ROW_NUMBER() OVER (
             PARTITION BY account_id
             ORDER BY elapsed_seconds, hints_used, mistakes, completed_at, play_id
           ) AS personal_order
         FROM completed_plays WHERE puzzle_id = ? AND is_public = 1
       ), ranked AS (
         SELECT p.display_name, c.elapsed_seconds, c.hints_used, c.mistakes,
           RANK() OVER (ORDER BY elapsed_seconds, hints_used, mistakes) AS rank
         FROM candidates c JOIN leaderboard_profiles p ON p.account_id = c.account_id
         WHERE personal_order = 1
       )
       SELECT rank, display_name, elapsed_seconds, hints_used, mistakes
       FROM ranked ORDER BY rank, display_name LIMIT 100`,
    )
    .bind(puzzleId)
    .all<{
      rank: number;
      display_name: string;
      elapsed_seconds: number;
      hints_used: number;
      mistakes: number;
    }>();
  return result.results.map((row) => ({
    rank: row.rank,
    displayName: row.display_name,
    elapsedSeconds: row.elapsed_seconds,
    hintsUsed: row.hints_used,
    mistakes: row.mistakes,
  }));
}
