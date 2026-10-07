import type { PuzzleDifficulty } from "../core/model";
import type { RankedPuzzleCandidate } from "../core/next-puzzle";

/** Return popular public boards that this account has not completed. */
export async function listRankedPuzzleCandidates(
  db: D1Database,
  accountId: string,
  difficulty: PuzzleDifficulty,
): Promise<RankedPuzzleCandidate[]> {
  const result = await db
    .prepare(
      `SELECT f.puzzle_id AS puzzleId, MIN(c.seed_code) AS seedCode,
              COUNT(*) AS players
       FROM first_ranked_plays f
       JOIN completed_plays c
         ON c.account_id = f.account_id AND c.play_id = f.play_id
       JOIN leaderboard_profiles p ON p.account_id = f.account_id
       WHERE c.is_public = 1 AND p.consent_version = 1
         AND c.difficulty = ?
         AND NOT EXISTS (
           SELECT 1 FROM completed_plays own
           WHERE own.account_id = ? AND own.puzzle_id = f.puzzle_id
         )
       GROUP BY f.puzzle_id
       ORDER BY players DESC, RANDOM()
       LIMIT 30`,
    )
    .bind(difficulty, accountId)
    .all<{ puzzleId: string; seedCode: string; players: number }>();
  return result.results;
}
