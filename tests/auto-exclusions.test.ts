import { describe, expect, it } from "vitest";
import { createInitialPlayerState, type Puzzle } from "../src/core/model";
import { placePiece, placePieceWithAutoExclusions } from "../src/core/player";
import { exclusionsFromPiece } from "../src/core/shortcuts";
import {
  loadAutoExclusionsEnabled,
  saveAutoExclusionsEnabled,
} from "../src/core/settings";

describe("automatic exclusions", () => {
  for (const size of [8, 10] as const) {
    const puzzle: Puzzle = {
      size,
      seed: "auto-exclusions",
      regions: Array.from({ length: size * size }, (_, i) =>
        Math.floor(i / size),
      ),
      solution: Array.from(
        { length: size },
        (_, row) =>
          row * size + (row < size / 2 ? row * 2 + 1 : (row - size / 2) * 2),
      ),
    };
    it(`uses the existing shortcut for a new correct piece on ${size}x${size}`, () => {
      const state = createInitialPlayerState(0);
      const next = placePieceWithAutoExclusions(puzzle, state, 1, true);
      expect(next.pieces).toEqual(new Set([1]));
      expect(next.excluded).toEqual(new Set(exclusionsFromPiece(1, puzzle)));
      expect(state.pieces.size).toBe(0);
      expect(state.excluded.size).toBe(0);
      expect(placePieceWithAutoExclusions(puzzle, next, 1, true)).toBe(next);
    });
    it(`does not change disabled or incorrect placement behavior on ${size}x${size}`, () => {
      const state = createInitialPlayerState(0);
      expect(placePieceWithAutoExclusions(puzzle, state, 1, false)).toEqual(
        placePiece(puzzle, state, 1),
      );
      const wrong = placePieceWithAutoExclusions(puzzle, state, 0, true);
      expect(wrong.mistakes).toBe(1);
      expect(wrong.excluded.size).toBe(0);
      expect(placePieceWithAutoExclusions(puzzle, wrong, 0, true)).toBe(wrong);
    });
    it(`preserves fixed errors and existing marks on ${size}x${size}`, () => {
      const state = {
        ...createInitialPlayerState(0),
        fixedErrors: new Set([0]),
        excluded: new Set([size * size - 1]),
      };
      const next = placePieceWithAutoExclusions(puzzle, state, 1, true);
      expect(next.fixedErrors).toEqual(new Set([0]));
      expect(next.excluded.has(0)).toBe(false);
      expect(next.excluded.has(size * size - 1)).toBe(true);
    });
  }
});

describe("automatic exclusion preference", () => {
  it("defaults to off and persists both values independently of game data", () => {
    const data = new Map<string, string>([["game", "unchanged"]]);
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    expect(loadAutoExclusionsEnabled(storage)).toBe(false);
    expect(saveAutoExclusionsEnabled(storage, true)).toBe(true);
    expect(loadAutoExclusionsEnabled(storage)).toBe(true);
    expect(saveAutoExclusionsEnabled(storage, false)).toBe(true);
    expect(loadAutoExclusionsEnabled(storage)).toBe(false);
    expect(data.get("game")).toBe("unchanged");
  });
  it("handles unavailable storage safely", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadAutoExclusionsEnabled(storage)).toBe(false);
    expect(saveAutoExclusionsEnabled(storage, true)).toBe(false);
  });
});
