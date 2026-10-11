import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SUPER_GENERATOR_VERSION,
  generateSuperPuzzle,
  encodeSuperSeed,
  isSuperPuzzleOf,
  parseSuperSeed,
  parseSuperSeedCode,
} from "../src/core/super-puzzle";
import {
  openingPlacements,
  shapeViolations,
  SUPER_V2_SPEC,
} from "../src/core/generator-g3";
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

// 超級の盤面も問題ID・共有・ランキングの同一性の元になるので、版ごとに固定する。
// キーは「版 seed」、値は盤面のJSONのSHA-256。
const frozenBoards: Record<string, string> = {
  "super-v1 super-regression:0":
    "2a0b2ebb31ca7094aaaa326d4733581fae0e41fc65c009aab5d42ee279a71b2d",
  "super-v1 super-regression:1":
    "2783b14cbd974d43314791bc79cb8d21aa5a92fb2314c2ab6f2f530c42767d53",
  "super-v1 超級🐙":
    "86f8e3ea6a37e88208bbe39d60b3937b97c2b9bd998647669ebc577bf4da72ed",
  "super-v2 super-regression:0":
    "a85e321ab48a9caf4372e20ce6fdd007756eff48c7de5cf0cc576730f7f005d7",
  "super-v2 super-regression:1":
    "82219f0608b1b90bdb7f609ce242e46d46a890133d38ecf2c13b8a4bf19f5dd3",
  "super-v2 超級🐙":
    "3919d0f15d2745bd3b7d364fe8af7e6047201d481e0b5863ea55cc33b85fbea2",
};

describe("super challenge puzzle", () => {
  it("round-trips encoded seeds independently of ordinary and daily codes", () => {
    const seed = "超級🐙 / : + %";
    expect(parseSuperSeed(encodeSuperSeed(seed))).toBe(seed);
    expect(parsePuzzleSeedCode(encodeSuperSeed(seed))).toBeUndefined();
    for (const code of [
      "TAKO:g2:hard:seed",
      "TAKO:daily-v1:hard:2026-10-09",
      "TAKO:super-v1:easy:seed",
      "TAKO:super-v3:hard:seed",
      "TAKO:super-v2:normal:seed",
      "TAKO:super-v1:hard:%",
      "TAKO:super-v1:hard:",
      `TAKO:super-v1:hard:${"a".repeat(129)}`,
    ])
      expect(parseSuperSeed(code)).toBeUndefined();
    expect(() => generateSuperPuzzle("")).toThrow();
    expect(() => generateSuperPuzzle("seed", "super-v3")).toThrow();
    expect(() => encodeSuperSeed("a".repeat(129))).toThrow();
    expect(() => encodeSuperSeed("seed", "g3")).toThrow();
  });
  it("issues new codes in the current version and still reads the earlier one", () => {
    expect(encodeSuperSeed("seed")).toBe("TAKO:super-v2:hard:seed");
    expect(parseSuperSeedCode("TAKO:super-v1:hard:seed")).toEqual({
      version: "super-v1",
      seed: "seed",
    });
    expect(parseSuperSeedCode(encodeSuperSeed("seed"))).toEqual({
      version: SUPER_GENERATOR_VERSION,
      seed: "seed",
    });
    const puzzle = { seed: "seed", generatorVersion: "super-v2" };
    expect(isSuperPuzzleOf(puzzle, "TAKO:super-v2:hard:seed")).toBe(true);
    expect(isSuperPuzzleOf(puzzle, "TAKO:super-v1:hard:seed")).toBe(false);
    expect(isSuperPuzzleOf(puzzle, "TAKO:super-v2:hard:other")).toBe(false);
    expect(isSuperPuzzleOf(puzzle, "TAKO:g3:hard:seed")).toBe(false);
  });
  it.each(Object.entries(frozenBoards))(
    "generates a reproducible, unique, logically hard 10×10 board for %s",
    async (key, hash) => {
      const [version, seed] = key.split(/ (.*)/);
      const puzzle = generateSuperPuzzle(seed, version);
      expect(
        createHash("sha256").update(JSON.stringify(puzzle)).digest("hex"),
      ).toBe(hash);
      expect(puzzle.generatorVersion).toBe(version);
      expect(puzzle.size).toBe(10);
      expect(new Set(puzzle.regions).size).toBe(10);
      expect(puzzle.solution).toHaveLength(10);
      expect(validateSolution(puzzle).valid).toBe(true);
      expect(solvePuzzle(puzzle, { maxSolutions: 2 }).status).toBe("unique");
      expect(analyzePuzzleDifficulty(puzzle)).toMatchObject({
        solved: true,
        rating: "hard",
      });
      const code = parseSuperSeedCode(encodeSuperSeed(seed, version))!;
      expect(generateSuperPuzzle(code.seed, code.version)).toEqual(puzzle);
      expect(await puzzleId(puzzle)).toMatch(/^p1:[a-f0-9]{64}$/);
    },
    30000,
  );
  it("builds super-v2 boards without givens or regions under three cells", () => {
    const spec = SUPER_V2_SPEC;
    for (let index = 0; index < 12; index += 1) {
      const puzzle = generateSuperPuzzle(`super-audit:${index}`);
      const analysis = analyzePuzzleDifficulty(puzzle);
      expect(puzzle.generatorVersion).toBe("super-v2");
      expect(puzzle.givens ?? []).toEqual([]);
      expect(solvePuzzle(puzzle, { maxSolutions: 2 }).status).toBe("unique");
      expect(analysis).toMatchObject({ solved: true, rating: "hard" });
      expect(shapeViolations(puzzle, spec.shape)).toBe(0);
      expect(openingPlacements(analysis)).toBe(0);
      expect(
        analysis.techniqueCounts["region-depletion"],
      ).toBeGreaterThanOrEqual(2);
    }
  }, 30000);
  it("gives the same seed different boards in the two versions", async () => {
    expect(await puzzleId(generateSuperPuzzle("seed", "super-v1"))).not.toBe(
      await puzzleId(generateSuperPuzzle("seed", "super-v2")),
    );
  }, 30000);
  it("keeps daily identity separate even for the same seed", async () => {
    const superPuzzle = generateSuperPuzzle("2026-10-09");
    const daily = generateDailyPuzzle("2026-10-09");
    expect(superPuzzle.generatorVersion).not.toBe(daily.generatorVersion);
    expect(await puzzleId(superPuzzle)).not.toBe(await puzzleId(daily));
  }, 30000);
});
