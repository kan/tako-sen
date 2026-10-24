import {
  currentRankingWeek,
  type WeeklyMetric,
  type WeeklyRanking,
} from "../core/weekly-ranking";
import type { PuzzleDifficulty } from "../core/model";
import { GENERATOR_VERSIONS } from "../core/generator";

// Every ordinary generator version counts; daily and super boards do not.
// The names are constants of this codebase, so they are inlined.
export const ORDINARY_VERSIONS = GENERATOR_VERSIONS.map((v) => `'${v}'`).join(
  ", ",
);

// Search only this week's eligible ordinary clears via the covering index.
// Replays count once per account/puzzle/week, using the earliest completed
// trial rather than cherry-picking a faster replay for the average.
export function weeklyRankingSql(metric: WeeklyMetric): string {
  const ordering = metric === "clears" ? "clears DESC" : "average_seconds ASC";
  return `WITH trials AS (
    SELECT c.account_id, c.difficulty, c.elapsed_seconds,
      ROW_NUMBER() OVER (PARTITION BY c.account_id, c.puzzle_id
        ORDER BY c.completed_at, c.play_id) AS attempt
    FROM completed_plays c
    WHERE c.ranking_eligible = 1
      AND c.completed_at >= ?2 AND c.completed_at < ?3 AND c.completed_at <= ?4
      AND c.generator_version IN (${ORDINARY_VERSIONS})
  ), totals AS (
    SELECT account_id, COUNT(*) AS clears, AVG(elapsed_seconds) AS average_seconds
    FROM trials WHERE attempt = 1 AND difficulty = ?1 GROUP BY account_id
    ${metric === "time" ? "HAVING COUNT(*) >= 5" : ""}
  )
  SELECT p.display_name, t.clears, t.average_seconds,
    RANK() OVER (ORDER BY ${ordering}) AS rank
  FROM totals t JOIN leaderboard_profiles p ON p.account_id = t.account_id
  WHERE p.consent_version = 1
  ORDER BY rank, p.display_name LIMIT 100`;
}

export async function listWeeklyRanking(
  db: D1Database,
  difficulty: PuzzleDifficulty,
  metric: WeeklyMetric,
  now = Date.now(),
): Promise<WeeklyRanking> {
  const week = currentRankingWeek(now);
  const result = await db
    .prepare(weeklyRankingSql(metric))
    .bind(difficulty, week.start, week.end, now)
    .all<{
      rank: number;
      display_name: string;
      clears: number;
      average_seconds: number;
    }>();
  return {
    ...week,
    entries: result.results.map((row) => ({
      rank: row.rank,
      displayName: row.display_name,
      clears: row.clears,
      averageSeconds: row.average_seconds,
    })),
  };
}
