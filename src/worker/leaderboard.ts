import type { LeaderboardEntry } from "../core/leaderboard";
import type { HintStage } from "../core/hint-progress";
import { rankingScoreSql } from "./ranking-score-sql";

export async function listLeaderboard(
  db: D1Database,
  puzzleId: string,
): Promise<LeaderboardEntry[]> {
  const result = await db
    .prepare(
      `SELECT p.display_name, c.elapsed_seconds, c.hints_used, c.mistakes, c.max_hint_stage,
       RANK() OVER (ORDER BY ${rankingScoreSql("c")} DESC, c.elapsed_seconds, c.mistakes, c.hints_used) AS rank
     FROM first_ranked_plays f
     JOIN completed_plays c ON c.account_id = f.account_id AND c.play_id = f.play_id
     JOIN leaderboard_profiles p ON p.account_id = f.account_id
     WHERE f.puzzle_id = ? AND p.consent_version = 1 AND c.is_public = 1
     ORDER BY rank, p.display_name LIMIT 100`,
    )
    .bind(puzzleId)
    .all<{
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
