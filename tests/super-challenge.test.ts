import { describe, expect, it } from "vitest";
import {
  generateSuperPuzzle,
  encodeSuperSeed,
  parseSuperSeed,
} from "../src/core/super-puzzle";
import { generateDailyPuzzle } from "../src/core/daily-puzzle";
import { parsePuzzleSeedCode } from "../src/core/puzzle-code";
import { puzzleId } from "../src/core/puzzle-identity";
import { validateSolution } from "../src/core/rules";
import { solvePuzzle } from "../src/core/solver";
import { analyzePuzzleDifficulty } from "../src/core/difficulty";
import {
  initialSuperProgress,
  recordSuperPlay,
  hasSuperRight,
  remainingSuperPlays,
  deferSuperOffer,
  consumeSuperRight,
  parseSuperProgress,
} from "../src/core/super-progress";

describe("super challenge progress", () => {
  const earned = () => {
    let state = initialSuperProgress();
    for (let i = 0; i < 10; i += 1) state = recordSuperPlay(state, 0, false);
    return state;
  };
  it("starts at zero, grants exactly one right on the tenth new trial", () => {
    let state = initialSuperProgress();
    expect(remainingSuperPlays(state)).toBe(10);
    for (let i = 1; i <= 9; i += 1) {
      state = recordSuperPlay(state, 0, false);
      expect(hasSuperRight(state)).toBe(false);
      expect(state.offerPending).toBe(false);
      expect(remainingSuperPlays(state)).toBe(10 - i);
    }
    state = recordSuperPlay(state, 0, false);
    expect(state).toEqual({ cycle: 0, count: 10, offerPending: true });
    expect(hasSuperRight(state)).toBe(true);
  });
  it("never adds duplicate events, and retains one deferred right without stacking", () => {
    const empty = initialSuperProgress();
    expect(recordSuperPlay(empty, 0, true)).toBe(empty);
    const held = deferSuperOffer(earned());
    expect(held.offerPending).toBe(false);
    expect(hasSuperRight(held)).toBe(true);
    for (let i = 0; i < 25; i += 1)
      expect(recordSuperPlay(held, 0, false)).toBe(held);
    expect(parseSuperProgress(JSON.parse(JSON.stringify(held)))).toEqual(held);
  });
  it("resets only on earned start and rejects stale start or delayed old trials", () => {
    expect(
      consumeSuperRight(initialSuperProgress(), 0, "earned"),
    ).toBeUndefined();
    const next = consumeSuperRight(earned(), 0, "earned")!;
    expect(next).toEqual({ cycle: 1, count: 0, offerPending: false });
    expect(recordSuperPlay(next, 0, false)).toBe(next);
    expect(recordSuperPlay(next, 2, false)).toBe(next);
    expect(consumeSuperRight(next, 0, "earned")).toBeUndefined();
    expect(recordSuperPlay(next, 1, false).count).toBe(1);
  });
  it("does not consume or reset progress for shared entry", () => {
    for (const state of [
      initialSuperProgress(),
      earned(),
      deferSuperOffer(earned()),
    ])
      expect(consumeSuperRight(state, state.cycle, "shared")).toBe(state);
  });
  it.each([
    null,
    {},
    { cycle: -1, count: 0, offerPending: false },
    { cycle: 0, count: 11, offerPending: false },
    { cycle: 0, count: 1.5, offerPending: false },
    { cycle: 0, count: 9, offerPending: true },
    { cycle: "0", count: 10, offerPending: true },
    { cycle: Number.MAX_SAFE_INTEGER + 1, count: 0, offerPending: false },
  ])("rejects corrupt persisted progress %j", (value) => {
    expect(parseSuperProgress(value)).toBeUndefined();
  });
});

describe("super challenge puzzle", () => {
  it("round-trips encoded seeds independently of ordinary and daily codes", () => {
    const seed = "超級🐙 / : + %";
    expect(parseSuperSeed(encodeSuperSeed(seed))).toBe(seed);
    expect(parsePuzzleSeedCode(encodeSuperSeed(seed))).toBeUndefined();
    for (const code of [
      "TAKO:g2:hard:seed",
      "TAKO:daily-v1:hard:2026-10-09",
      "TAKO:super-v1:easy:seed",
      "TAKO:super-v2:hard:seed",
      "TAKO:super-v1:hard:%",
      "TAKO:super-v1:hard:",
      `TAKO:super-v1:hard:${"a".repeat(129)}`,
    ])
      expect(parseSuperSeed(code)).toBeUndefined();
    expect(() => generateSuperPuzzle("")).toThrow();
    expect(() => encodeSuperSeed("a".repeat(129))).toThrow();
  });
  it.each(["super-regression:0", "super-regression:1", "超級🐙"])(
    "generates reproducible, unique, logically hard 10×10 boards for %s",
    async (seed) => {
      const puzzle = generateSuperPuzzle(seed);
      expect(puzzle.generatorVersion).toBe("super-v1");
      expect(puzzle.size).toBe(10);
      expect(new Set(puzzle.regions).size).toBe(10);
      expect(puzzle.solution).toHaveLength(10);
      expect(validateSolution(puzzle).valid).toBe(true);
      expect(solvePuzzle(puzzle, { maxSolutions: 2 }).status).toBe("unique");
      expect(analyzePuzzleDifficulty(puzzle)).toMatchObject({
        solved: true,
        rating: "hard",
      });
      expect(
        generateSuperPuzzle(parseSuperSeed(encodeSuperSeed(seed))!),
      ).toEqual(puzzle);
      expect(await puzzleId(puzzle)).toMatch(/^p1:[a-f0-9]{64}$/);
    },
    30000,
  );
  it("keeps daily identity separate even for the same seed", async () => {
    const superPuzzle = generateSuperPuzzle("2026-10-09");
    const daily = generateDailyPuzzle("2026-10-09");
    expect(superPuzzle.generatorVersion).not.toBe(daily.generatorVersion);
    expect(await puzzleId(superPuzzle)).not.toBe(await puzzleId(daily));
  }, 30000);
});
