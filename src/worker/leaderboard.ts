import type { LeaderboardEntry } from "../core/leaderboard";
import type { HintStage } from "../core/hint-progress";
import { rankingScoreSql } from "./ranking-score-sql";

// The publication trigger already marks only first clears as public; do not
// repeat its first_ranked_plays lookup on the read path.
export const LEADERBOARD_SQL = `SELECT p.display_name, c.elapsed_seconds, c.hints_used, c.mistakes, c.max_hint_stage,
       RANK() OVER (ORDER BY ${rankingScoreSql("c")} DESC, c.elapsed_seconds, c.mistakes, c.hints_used) AS rank
     FROM completed_plays c
     JOIN leaderboard_profiles p ON p.account_id = c.account_id
     WHERE c.puzzle_id = ? AND p.consent_version = 1 AND c.is_public = 1
     ORDER BY rank, p.display_name LIMIT 100`;

export async function listLeaderboard(
  db: D1Database,
  puzzleId: string,
): Promise<LeaderboardEntry[]> {
  const result = await db.prepare(LEADERBOARD_SQL).bind(puzzleId).all<{
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
  }));
}
