import { describe, expect, it } from "vitest";
import { compareRankingScores, rankingScore } from "../src/core/ranking-score";
import { rankingScoreSql } from "../src/worker/ranking-score-sql";

describe("ranking score", () => {
  it("adds truncated speed points and bonuses for no mistakes and no hints", () => {
    expect(
      rankingScore({ elapsedSeconds: 40, mistakes: 0, hintsUsed: 0 }),
    ).toBe(2000);
    expect(
      rankingScore({ elapsedSeconds: 22, mistakes: 0, hintsUsed: 0 }),
    ).toBe(3227);
    expect(
      rankingScore({ elapsedSeconds: 40, mistakes: 1, hintsUsed: 0 }),
    ).toBe(1700);
    expect(
      rankingScore({ elapsedSeconds: 40, mistakes: 0, hintsUsed: 2 }),
    ).toBe(1800);
    expect(
      rankingScore({ elapsedSeconds: 40, mistakes: 3, hintsUsed: 1 }),
    ).toBe(1500);
  });

  it("stays positive for long plays and treats a 0-second clear as 1 second", () => {
    expect(
      rankingScore({ elapsedSeconds: 20_000, mistakes: 2, hintsUsed: 2 }),
    ).toBe(3);
    expect(rankingScore({ elapsedSeconds: 0, mistakes: 0, hintsUsed: 0 })).toBe(
      60_500,
    );
  });

  it("ranks by score, then real time, mistakes, and hints", () => {
    const fastWithMistake = { elapsedSeconds: 20, mistakes: 1, hintsUsed: 0 };
    const slowerClean = { elapsedSeconds: 60, mistakes: 0, hintsUsed: 0 };
    expect(compareRankingScores(fastWithMistake, slowerClean)).toBeLessThan(0);
    const moreMistakes = { ...fastWithMistake, mistakes: 3 };
    expect(compareRankingScores(fastWithMistake, moreMistakes)).toBeLessThan(0);
    // Both truncate to 8 speed points, so real time breaks the tie.
    const sameScoreFaster = {
      elapsedSeconds: 7_000,
      mistakes: 0,
      hintsUsed: 0,
    };
    const sameScoreSlower = {
      elapsedSeconds: 7_001,
      mistakes: 0,
      hintsUsed: 0,
    };
    expect(rankingScore(sameScoreFaster)).toBe(rankingScore(sameScoreSlower));
    expect(compareRankingScores(sameScoreFaster, sameScoreSlower)).toBeLessThan(
      0,
    );
    expect(compareRankingScores(slowerClean, { ...slowerClean })).toBe(0);
  });

  it("uses the same constants in D1 ranking expressions", () => {
    expect(rankingScoreSql("c")).toBe(
      "(60000 / MAX(1, c.elapsed_seconds) + CASE WHEN c.mistakes = 0 THEN 300 ELSE 0 END + CASE WHEN c.hints_used = 0 THEN 200 ELSE 0 END)",
    );
  });
});
