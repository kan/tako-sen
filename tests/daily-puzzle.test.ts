import { describe, expect, it } from "vitest";
import {
  generateDailyPuzzle,
  dailyDate,
  isDailyDate,
} from "../src/core/daily-puzzle";
import { validateSolution } from "../src/core/rules";
import { solvePuzzle } from "../src/core/solver";
import { analyzePuzzleDifficulty } from "../src/core/difficulty";
import { createInitialPlayerState } from "../src/core/model";
import { loadDailyGame, loadGame, saveDailyGame } from "../src/core/storage";
import { toggleExcluded } from "../src/core/player";
import {
  assignRegionColorIndexes,
  REGION_PALETTE,
} from "../src/ui/region-visuals";

describe("daily challenge puzzle", () => {
  it("uses Japan midnight as its date boundary", () => {
    expect(dailyDate(Date.parse("2026-10-01T14:59:59Z"))).toBe("2026-10-01");
    expect(dailyDate(Date.parse("2026-10-01T15:00:00Z"))).toBe("2026-10-02");
    expect(isDailyDate("2026-02-29")).toBe(false);
  });

  it.each(["2026-10-02", "2026-10-03", "2026-10-04"])(
    "builds a deterministic, unique, logically hard 10×10 puzzle for %s",
    (date) => {
      const puzzle = generateDailyPuzzle(date);
      expect(puzzle.size).toBe(10);
      expect(puzzle.solution).toHaveLength(10);
      expect(validateSolution(puzzle).valid).toBe(true);
      expect(solvePuzzle(puzzle, { maxSolutions: 2 }).status).toBe("unique");
      expect(analyzePuzzleDifficulty(puzzle).rating).toBe("hard");
      const colors = assignRegionColorIndexes(puzzle);
      expect(new Set(colors).size).toBe(10);
      expect(colors.map((index) => REGION_PALETTE[index].background)).toEqual(
        expect.arrayContaining(["#f1f2ee", "#565d67"]),
      );
      expect(
        toggleExcluded(
          createInitialPlayerState(),
          99,
          puzzle.size,
        ).excluded.has(99),
      ).toBe(true);
      expect(generateDailyPuzzle(date)).toEqual(puzzle);
    },
  );

  it("keeps 10×10 progress isolated by account and date from normal games", () => {
    const puzzle = generateDailyPuzzle("2026-10-02");
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    saveDailyGame(
      "account-a",
      "2026-10-02",
      puzzle,
      createInitialPlayerState(100, puzzle.givens),
      "daily-play",
      { waitingToStart: true, elapsedMs: 0, hasStarted: false },
      storage,
    );
    expect(loadDailyGame("account-a", "2026-10-02", storage)?.puzzle).toEqual(
      puzzle,
    );
    expect(loadDailyGame("account-b", "2026-10-02", storage)).toBeUndefined();
    expect(loadDailyGame("account-a", "2026-10-03", storage)).toBeUndefined();
    expect(loadGame(storage)).toBeUndefined();
  });

  it("keeps a week of dates playable without changing the 8×8 generator", () => {
    for (const day of [5, 6, 7, 8, 9, 10, 11]) {
      const puzzle = generateDailyPuzzle(
        `2026-10-${String(day).padStart(2, "0")}`,
      );
      expect(validateSolution(puzzle).valid).toBe(true);
      expect(analyzePuzzleDifficulty(puzzle).rating).toBe("hard");
    }
  });
});
