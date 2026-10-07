import { describe, expect, it } from "vitest";
import { compareRankingScores, rankingScore } from "../src/core/ranking-score";
import { rankingScoreSql } from "../src/worker/ranking-score-sql";

describe("ranking score", () => {
  it("penalizes mistakes more than hints without clamping slow plays", () => {
    expect(
      rankingScore({ elapsedSeconds: 120, mistakes: 1, hintsUsed: 2 }),
    ).toBe(9640);
    expect(
      rankingScore({ elapsedSeconds: 20_000, mistakes: 0, hintsUsed: 0 }),
    ).toBe(-10_000);
  });

  it("ranks by score, then real time, mistakes, and hints", () => {
    const fastWithMistake = {
      elapsedSeconds: 20,
      mistakes: 1,
      hintsUsed: 0,
    };
    const slowerClean = {
      elapsedSeconds: 180,
      mistakes: 0,
      hintsUsed: 0,
    };
    expect(compareRankingScores(slowerClean, fastWithMistake)).toBeLessThan(0);
    const sameScoreFaster = {
      elapsedSeconds: 90,
      mistakes: 0,
      hintsUsed: 3,
    };
    expect(compareRankingScores(sameScoreFaster, slowerClean)).toBeLessThan(0);
    expect(compareRankingScores(slowerClean, { ...slowerClean })).toBe(0);
  });

  it("uses the same constants in D1 ranking expressions", () => {
    expect(rankingScoreSql("c")).toBe(
      "10000 - c.elapsed_seconds - 180 * c.mistakes - 30 * c.hints_used",
    );
  });
});
