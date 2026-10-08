import { describe, expect, it } from "vitest";
import { chooseNextPuzzle } from "../src/core/next-puzzle";

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
