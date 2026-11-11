/** Speed points are this divided by the clear seconds: 60 s earns 1,000. */
export const SPEED_POINTS = 60_000;
export const NO_MISTAKE_BONUS = 300;
export const NO_HINT_BONUS = 200;

export interface RankingScoreInput {
  readonly elapsedSeconds: number;
  readonly mistakes: number;
  readonly hintsUsed: number;
}

/**
 * Points are only added, and speed points never reach 0, so even a long play
 * keeps its ordering. Integer division keeps the result equal to the D1 query.
 */
export function rankingScore(result: RankingScoreInput): number {
  return (
    Math.floor(SPEED_POINTS / Math.max(1, result.elapsedSeconds)) +
    (result.mistakes === 0 ? NO_MISTAKE_BONUS : 0) +
    (result.hintsUsed === 0 ? NO_HINT_BONUS : 0)
  );
}

export function compareRankingScores(
  a: RankingScoreInput,
  b: RankingScoreInput,
): number {
  return (
    rankingScore(b) - rankingScore(a) ||
    a.elapsedSeconds - b.elapsedSeconds ||
    a.mistakes - b.mistakes ||
    a.hintsUsed - b.hintsUsed
  );
}
