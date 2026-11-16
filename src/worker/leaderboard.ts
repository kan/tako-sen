import { RANKING_CONSENT_VERSION } from "../core/account-profile";
import type { LeaderboardEntry } from "../core/leaderboard";
import type { HintStage } from "../core/hint-progress";
import { rankingScoreSql } from "./ranking-score-sql";

// The publication trigger already marks only first clears as public; do not
// repeat its first_ranked_plays lookup on the read path.
export const LEADERBOARD_SQL = `SELECT c.account_id, p.display_name, c.elapsed_seconds, c.hints_used, c.mistakes, c.max_hint_stage,
       RANK() OVER (ORDER BY ${rankingScoreSql("c")} DESC, c.elapsed_seconds, c.mistakes, c.hints_used) AS rank
     FROM completed_plays c
     JOIN leaderboard_profiles p ON p.account_id = c.account_id
     WHERE c.puzzle_id = ? AND p.consent_version = ${RANKING_CONSENT_VERSION} AND c.is_public = 1
     ORDER BY rank, p.display_name LIMIT 100`;

/**
 * A puzzle's public ranking. With the requester's ID, each row says whether it
 * is theirs (`isSelf`); the IDs themselves never leave the Worker.
 */
export async function listLeaderboard(
  db: D1Database,
  puzzleId: string,
  accountId?: string,
): Promise<LeaderboardEntry[]> {
  const result = await db.prepare(LEADERBOARD_SQL).bind(puzzleId).all<{
    account_id: string;
    rank: number;
    display_name: string;
    elapsed_seconds: number;
    hints_used: number;
    max_hint_stage: HintStage | null;
    mistakes: number;
  }>();
  return result.results.map((row) => ({
    rank: row.rank,
    displayName: row.display_name,
    elapsedSeconds: row.elapsed_seconds,
    hintsUsed: row.hints_used,
    maxHintStage: row.max_hint_stage,
    mistakes: row.mistakes,
    ...(accountId === undefined
      ? {}
      : { isSelf: row.account_id === accountId }),
  }));
}
