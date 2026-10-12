import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  DAILY_V2_START_DATE,
  generateDailyPuzzle,
  dailyDate,
  dailyVersion,
  isDailyDate,
  isDailyVersion,
} from "../src/core/daily-puzzle";
import {
  DAILY_V2_SPEC,
  openingPlacements,
  shapeViolations,
} from "../src/core/generator-g3";
import { puzzleId } from "../src/core/puzzle-identity";
import { restoreSharedPuzzleSnapshot } from "../src/core/shared-puzzle";
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
  it.each([
    [
      "2026-10-02",
      "36acebbc445b8ad04c12bc7bb6c74a7cd1e5bde064df5ea4fdc213b0bb0c3a8a",
    ],
    [
      "2026-10-03",
      "13ae02083ea374cf47a1b64d7c62dd5efb1bc04f3bda998526eb03805821d81e",
    ],
    [
      "2026-10-09",
      "904a4a64a956b4b51cd404b7218a717e1762aa2ee77d60a8ce9bd4fcdee30b29",
    ],
  ])("preserves the frozen daily-v1 board for %s", (date, expected) => {
    // Hashes were verified against the pre-super implementation, not just a
    // second call to the new shared constructor.
    const hash = createHash("sha256")
      .update(JSON.stringify(generateDailyPuzzle(date)))
      .digest("hex");
    expect(hash).toBe(expected);
  });

  it.each([
    [
      "2026-10-16",
      "a001a0ddeaa6bbe5172fdecf71c94cbd67556343cda61767fe20dcb9a632185e",
    ],
    [
      "2026-10-17",
      "2c478c96fa4a38a544c2c66b9465da9616a044a0b9dac8dc94f5499440e8a1b7",
    ],
    [
      "2026-10-18",
      "af9525fda8affcec8ede547e94f05fea4eb9aa14e1f558bcc667e7e7a3da8c4f",
    ],
  ])("preserves the frozen daily-v2 board for %s", (date, expected) => {
    const hash = createHash("sha256")
      .update(JSON.stringify(generateDailyPuzzle(date, "daily-v2")))
      .digest("hex");
    expect(hash).toBe(expected);
  });

  it("switches to daily-v2 on its start date and keeps both versions", () => {
    const dayBefore = new Date(Date.parse(DAILY_V2_START_DATE) - 86400000)
      .toISOString()
      .slice(0, 10);
    expect(dailyVersion(dayBefore)).toBe("daily-v1");
    expect(dailyVersion(DAILY_V2_START_DATE)).toBe("daily-v2");
    expect(generateDailyPuzzle(dayBefore).generatorVersion).toBe("daily-v1");
    expect(generateDailyPuzzle(DAILY_V2_START_DATE).generatorVersion).toBe(
      "daily-v2",
    );
    expect(isDailyVersion("daily-v1")).toBe(true);
    expect(isDailyVersion("daily-v2")).toBe(true);
    expect(isDailyVersion("daily-v3")).toBe(false);
    expect(isDailyVersion("super-v2")).toBe(false);
    expect(() => generateDailyPuzzle("2026-10-16", "super-v2")).toThrow();
  });

  it.each(["2026-10-16", "2026-11-01", "2027-02-28"])(
    "builds daily-v2 for %s without givens or regions under three cells",
    async (date) => {
      const puzzle = generateDailyPuzzle(date, "daily-v2");
      expect(puzzle.size).toBe(10);
      expect(puzzle.seed).toBe(date);
      expect(puzzle.generatorVersion).toBe("daily-v2");
      expect(puzzle.givens).toEqual([]);
      const analysis = analyzePuzzleDifficulty(puzzle);
      expect(validateSolution(puzzle).valid).toBe(true);
      expect(solvePuzzle(puzzle, { maxSolutions: 2 }).status).toBe("unique");
      expect(analysis).toMatchObject({ solved: true, rating: "hard" });
      expect(shapeViolations(puzzle, DAILY_V2_SPEC.shape)).toBe(0);
      expect(openingPlacements(analysis)).toBe(0);
      expect(
        analysis.techniqueCounts["region-depletion"],
      ).toBeGreaterThanOrEqual(2);
      expect(generateDailyPuzzle(date, "daily-v2")).toEqual(puzzle);
      const snapshot = {
        id: await puzzleId(puzzle),
        size: puzzle.size,
        regions: puzzle.regions,
        givens: puzzle.givens,
        seed: puzzle.seed,
        difficulty: puzzle.difficulty,
        generatorVersion: puzzle.generatorVersion,
      };
      expect(await restoreSharedPuzzleSnapshot(snapshot)).toEqual(puzzle);
      // The ID covers the version: the same cells are not a daily-v1 board.
      await expect(
        restoreSharedPuzzleSnapshot({
          ...snapshot,
          generatorVersion: "daily-v1",
        }),
      ).rejects.toThrow();
    },
  );

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
