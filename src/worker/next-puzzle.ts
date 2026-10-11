import type { PuzzleDifficulty } from "../core/model";
import type { RankedPuzzleCandidate } from "../core/next-puzzle";
import { GENERATOR_VERSION } from "../core/generator";
import { seedCodePrefix } from "../core/puzzle-code";

// publish_first_clear sets is_public only on the registered first clear. Reading
// that flag avoids rejoining first_ranked_plays for every result. Consent still
// needs a live check. Probe the (account_id, puzzle_id) index instead of loading
// the account's entire history, including boards outside this difficulty.
// Only boards of the current generator are offered: boards of older versions
// keep their rankings but would otherwise crowd out every new board. The
// version is read from the seed code because that column is in the index;
// createCompletedPlayUpload rejects a result whose seed code names another
// version than its generator_version, so the two always agree.
export const RANKED_PUZZLE_CANDIDATES_SQL = `SELECT c.puzzle_id AS puzzleId, MIN(c.seed_code) AS seedCode,
              COUNT(*) AS players
       FROM completed_plays c
       WHERE c.is_public = 1
         AND c.difficulty = ?
         AND c.seed_code LIKE ?
         AND c.account_id IN (
           SELECT account_id FROM leaderboard_profiles WHERE consent_version = 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM completed_plays own
           WHERE own.account_id = ? AND own.puzzle_id = c.puzzle_id
         )
       GROUP BY c.puzzle_id
       ORDER BY players DESC, RANDOM()
       LIMIT 30`;

export const CURRENT_SEED_CODES = `${seedCodePrefix(GENERATOR_VERSION)}%`;

/** Return popular public boards that this account has not completed. */
export async function listRankedPuzzleCandidates(
  db: D1Database,
  accountId: string,
  difficulty: PuzzleDifficulty,
): Promise<RankedPuzzleCandidate[]> {
  const result = await db
    .prepare(RANKED_PUZZLE_CANDIDATES_SQL)
    .bind(difficulty, CURRENT_SEED_CODES, accountId)
    .all<{ puzzleId: string; seedCode: string; players: number }>();
  return result.results;
}
