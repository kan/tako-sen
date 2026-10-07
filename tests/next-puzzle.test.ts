import { describe, expect, it } from "vitest";
import {
  chooseNextPuzzle,
  RANDOM_PUZZLE_CHANCE,
} from "../src/core/next-puzzle";

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

  it("sometimes chooses fresh generation and falls back when no candidate remains", () => {
    expect(RANDOM_PUZZLE_CHANCE).toBe(0.2);
    expect(chooseNextPuzzle(candidates, new Set(), () => 0.1)).toBeUndefined();
    expect(
      chooseNextPuzzle(candidates, new Set(["a", "b", "c"]), () => 0.5),
    ).toBeUndefined();
  });
});
