import { describe, expect, it } from "vitest";
import type { CompletedPlayUpload } from "../src/core/online-history";
import { analyzeOnlineHistory } from "../src/core/online-stats";

const base: CompletedPlayUpload = {
  playId: "550e8400-e29b-41d4-a716-446655440000",
  puzzleId: `p1:${"a".repeat(64)}`,
  seedCode: "TAKO:g1:easy:one",
  generatorVersion: "g1",
  difficulty: "easy",
  startedAt: 1,
  completedAt: 100,
  elapsedSeconds: 90,
  mistakes: 0,
  hintsUsed: 0,
};

describe("online history analytics", () => {
  it("groups bests by puzzle ID and breaks time ties by hints and mistakes", () => {
    const plays: CompletedPlayUpload[] = [
      base,
      {
        ...base,
        playId: "550e8400-e29b-41d4-a716-446655440001",
        seedCode: "TAKO:g1:easy:another-seed",
        completedAt: 200,
        hintsUsed: 1,
      },
      {
        ...base,
        playId: "550e8400-e29b-41d4-a716-446655440002",
        seedCode: "TAKO:g1:normal:two",
        puzzleId: `p1:${"b".repeat(64)}`,
        difficulty: "normal",
        completedAt: 300,
        elapsedSeconds: 120,
      },
    ];
    const originalOrder = [...plays];
    const view = analyzeOnlineHistory(plays);
    expect(view.count).toBe(3);
    expect(view.puzzleBests).toHaveLength(2);
    expect(
      view.puzzleBests.find((entry) => entry.puzzleId === base.puzzleId),
    ).toMatchObject({
      attempts: 2,
      best: { playId: base.playId },
    });
    expect(view.byDifficulty).toMatchObject([
      { difficulty: "easy", clears: 2, averageSeconds: 90, bestSeconds: 90 },
      {
        difficulty: "normal",
        clears: 1,
        averageSeconds: 120,
        bestSeconds: 120,
      },
      { difficulty: "hard", clears: 0 },
    ]);
    expect(view.recentTrend.map((play) => play.completedAt)).toEqual([
      100, 200, 300,
    ]);
    expect(plays).toEqual(originalOrder);
  });

  it("filters by time, difficulty, seed, and puzzle ID", () => {
    const plays: CompletedPlayUpload[] = [
      base,
      {
        ...base,
        playId: "550e8400-e29b-41d4-a716-446655440003",
        puzzleId: `p1:${"c".repeat(64)}`,
        seedCode: "TAKO:g1:hard:recent",
        difficulty: "hard",
        completedAt: 500,
      },
    ];
    expect(analyzeOnlineHistory(plays, { since: 300 }).count).toBe(1);
    expect(analyzeOnlineHistory(plays, { difficulty: "hard" }).count).toBe(1);
    expect(analyzeOnlineHistory(plays, { query: " RECENT " }).count).toBe(1);
    expect(analyzeOnlineHistory(plays, { query: "p1:cccc" }).count).toBe(1);
    expect(analyzeOnlineHistory(plays, { since: 501 }).count).toBe(0);
  });
});
