export const SCORE_BASE = 10_000;
export const MISTAKE_PENALTY = 180;
export const HINT_PENALTY = 30;

export interface RankingScoreInput {
  readonly elapsedSeconds: number;
  readonly mistakes: number;
  readonly hintsUsed: number;
}

/** Scores are not clamped: even a long play must retain its ordering. */
export function rankingScore(result: RankingScoreInput): number {
  return (
    SCORE_BASE -
    result.elapsedSeconds -
    MISTAKE_PENALTY * result.mistakes -
    HINT_PENALTY * result.hintsUsed
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
