import { describe, expect, it } from "vitest";
import {
  chooseNextPuzzle,
  resolveDifficultySelection,
} from "../src/core/next-puzzle";

describe("random difficulty selection", () => {
  it("assigns equal thirds to easy, normal and hard", () => {
    const counts = { easy: 0, normal: 0, hard: 0 };
    for (let index = 0; index < 300; index++) {
      counts[resolveDifficultySelection("random", () => (index + 0.5) / 300)]++;
    }
    expect(counts).toEqual({ easy: 100, normal: 100, hard: 100 });
    expect(resolveDifficultySelection("random", () => 0)).toBe("easy");
    expect(resolveDifficultySelection("random", () => 1 / 3)).toBe("normal");
    expect(resolveDifficultySelection("random", () => 2 / 3)).toBe("hard");
    expect(resolveDifficultySelection("random", () => 0.999999)).toBe("hard");
  });
  it("keeps explicit selections without drawing randomness", () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      expect(
        resolveDifficultySelection(difficulty, () => {
          throw new Error("unexpected draw");
        }),
      ).toBe(difficulty);
    }
  });
});

const candidates = [
  { puzzleId: "a", seedCode: "A", players: 1 },
  { puzzleId: "b", seedCode: "B", players: 3 },
  { puzzleId: "c", seedCode: "C", players: 3 },
];

describe("next normal puzzle selection", () => {
  it("prioritizes the most populated unseen board and randomizes ties", () => {
    expect(chooseNextPuzzle(candidates, new Set(), () => 0.5)?.puzzleId).toBe(
      "c",
    );
    expect(
      chooseNextPuzzle(candidates, new Set(["c"]), () => 0.5)?.puzzleId,
    ).toBe("b");
    expect(
      chooseNextPuzzle(candidates, new Set(["b", "c"]), () => 0.5)?.puzzleId,
    ).toBe("a");
  });

  it("always selects an available candidate regardless of the random value", () => {
    for (const randomValue of [0, 0.1, 0.19, 0.2, 0.5, 0.999]) {
      expect(
        chooseNextPuzzle(candidates, new Set(), () => randomValue)?.players,
      ).toBe(3);
    }
  });

  it("falls back to generation when no candidate remains", () => {
    expect(chooseNextPuzzle([], new Set(), () => 0)).toBeUndefined();
    expect(
      chooseNextPuzzle(candidates, new Set(["a", "b", "c"]), () => 0.5),
    ).toBeUndefined();
  });
});
