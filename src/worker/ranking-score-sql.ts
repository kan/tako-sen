import {
  NO_HINT_BONUS,
  NO_MISTAKE_BONUS,
  SPEED_POINTS,
} from "../core/ranking-score";

/**
 * Keep D1 rankings aligned with the client-side score formula. The columns
 * are integers, so the division truncates like Math.floor in rankingScore.
 */
export function rankingScoreSql(alias: "a" | "c"): string {
  return `(${SPEED_POINTS} / MAX(1, ${alias}.elapsed_seconds) + CASE WHEN ${alias}.mistakes = 0 THEN ${NO_MISTAKE_BONUS} ELSE 0 END + CASE WHEN ${alias}.hints_used = 0 THEN ${NO_HINT_BONUS} ELSE 0 END)`;
}
