import { describe, expect, it } from "vitest";
import {
  BOARD_SIZE,
  cellIndex,
  createInitialPlayerState,
  isAdjacent,
} from "../src/core/model";
import { generatePuzzle } from "../src/core/generator";
import {
  addExcludedMarks,
  placePiece,
  toggleExcluded,
} from "../src/core/player";
import { validatePuzzleShape, validateSolution } from "../src/core/rules";
import { solvePuzzle } from "../src/core/solver";
import {
  exclusionsFromPiece,
  regionLineExclusions,
} from "../src/core/shortcuts";
import { findLogicalMoves } from "../src/core/logical";

describe("core rules", () => {
  it("validates generated puzzle shape and solution", () => {
    const puzzle = generatePuzzle({ seed: "rules" });
    expect(validatePuzzleShape(puzzle).valid).toBe(true);
    expect(validateSolution(puzzle).valid).toBe(true);
  });

  it("detects adjacency by Chebyshev distance 1 only", () => {
    expect(isAdjacent(cellIndex(0, 0), cellIndex(1, 1))).toBe(true);
    expect(isAdjacent(cellIndex(0, 0), cellIndex(2, 2))).toBe(false);
  });
});

describe("complete solver", () => {
  it("confirms generated puzzles have a unique solution", () => {
    const puzzle = generatePuzzle({ seed: "unique" });
    const result = solvePuzzle(puzzle);
    expect(result.status).toBe("unique");
    expect(result.solutions[0]).toEqual(
      [...puzzle.solution].sort((a, b) => a - b),
    );
  });

  it("detects contradiction from an excluded solution cell when every solution is blocked", () => {
    const puzzle = generatePuzzle({ seed: "contradiction" });
    const state = addExcludedMarks(
      createInitialPlayerState(0),
      puzzle.solution,
    );
    expect(solvePuzzle(puzzle, { state }).status).toBe("none");
  });

  it("accepts a correct confirmed piece as a constraint instead of treating it as contradiction", () => {
    const puzzle = generatePuzzle({ seed: "confirmed-piece" });
    const state = placePiece(
      puzzle,
      createInitialPlayerState(0),
      puzzle.solution[0],
    );
    const result = solvePuzzle(puzzle, { state });
    expect(result.status).toBe("unique");
    expect(result.solutions[0]).toContain(puzzle.solution[0]);
  });
});

describe("player operations", () => {
  it("toggles excluded marks without checking correctness", () => {
    const state = toggleExcluded(createInitialPlayerState(0), cellIndex(0, 0));
    expect(state.excluded.has(cellIndex(0, 0))).toBe(true);
  });

  it("turns an incorrect piece placement into a fixed error", () => {
    const puzzle = generatePuzzle({ seed: "mistake" });
    const wrong = Array.from(
      { length: BOARD_SIZE * BOARD_SIZE },
      (_, index) => index,
    ).find((index) => !puzzle.solution.includes(index));
    expect(wrong).toBeDefined();
    const state = placePiece(puzzle, createInitialPlayerState(0), wrong ?? 0);
    expect(state.fixedErrors.has(wrong ?? 0)).toBe(true);
    expect(state.mistakes).toBe(1);
  });
});

describe("shortcuts", () => {
  it("creates row, column, and neighbor exclusions from a placed piece", () => {
    const exclusions = exclusionsFromPiece(cellIndex(3, 3));
    expect(exclusions).toContain(cellIndex(3, 0));
    expect(exclusions).toContain(cellIndex(0, 3));
    expect(exclusions).toContain(cellIndex(2, 2));
    expect(exclusions).not.toContain(cellIndex(3, 3));
  });

  it("performs region-line exclusions for a pointed region", () => {
    const puzzle = generatePuzzle({ seed: "region-line" });
    const regionId = puzzle.regions[puzzle.solution[0]];
    const regionCells = puzzle.regions.flatMap((id, index) =>
      id === regionId ? [index] : [],
    );
    const solutionRow = Math.floor(puzzle.solution[0] / BOARD_SIZE);
    const state = addExcludedMarks(
      createInitialPlayerState(0),
      regionCells.filter(
        (index) => Math.floor(index / BOARD_SIZE) !== solutionRow,
      ),
    );
    const exclusions = regionLineExclusions(puzzle, state, regionId);
    expect(
      exclusions.every(
        (index) =>
          Math.floor(index / BOARD_SIZE) === solutionRow &&
          puzzle.regions[index] !== regionId,
      ),
    ).toBe(true);
  });

  it("does not return already excluded cells from region-line exclusions", () => {
    const puzzle = generatePuzzle({ seed: "region-line-marked" });
    const regionId = puzzle.regions[puzzle.solution[0]];
    const regionCells = puzzle.regions.flatMap((id, index) =>
      id === regionId ? [index] : [],
    );
    const solutionRow = Math.floor(puzzle.solution[0] / BOARD_SIZE);
    const baseState = addExcludedMarks(
      createInitialPlayerState(0),
      regionCells.filter(
        (index) => Math.floor(index / BOARD_SIZE) !== solutionRow,
      ),
    );
    const firstExclusions = regionLineExclusions(puzzle, baseState, regionId);
    expect(firstExclusions.length).toBeGreaterThan(0);

    const markedState = addExcludedMarks(baseState, firstExclusions);
    expect(regionLineExclusions(puzzle, markedState, regionId)).toEqual([]);
  });
});

describe("logical hints", () => {
  it("does not suggest another piece in a row that already has a confirmed piece, even when fixed errors leave one open cell", () => {
    const puzzle = generatePuzzle({ seed: "hint-fixed-error" });
    const confirmedPiece = puzzle.solution[0];
    const row = Math.floor(confirmedPiece / BOARD_SIZE);
    const openWrongCell = Array.from({ length: BOARD_SIZE }, (_, col) =>
      cellIndex(row, col),
    ).find((index) => index !== confirmedPiece);
    expect(openWrongCell).toBeDefined();

    const fixedErrors = new Set(
      Array.from({ length: BOARD_SIZE }, (_, col) =>
        cellIndex(row, col),
      ).filter((index) => index !== confirmedPiece && index !== openWrongCell),
    );
    const state = {
      ...createInitialPlayerState(0),
      pieces: new Set([confirmedPiece]),
      fixedErrors,
    };

    const moves = findLogicalMoves(puzzle, state);
    expect(
      moves.some(
        (move) =>
          move.placeCell !== undefined &&
          Math.floor(move.placeCell / BOARD_SIZE) === row,
      ),
    ).toBe(false);
  });

  it("reports contradiction before suggesting normal logical moves", () => {
    const puzzle = generatePuzzle({ seed: "hint-contradiction" });
    const state = addExcludedMarks(createInitialPlayerState(0), [
      puzzle.solution[0],
    ]);
    const moves = findLogicalMoves(puzzle, state);
    expect(moves[0]?.technique).toBe("contradiction");
  });
});

describe("generator", () => {
  it("is deterministic for the same seed", () => {
    const a = generatePuzzle({ seed: "same-seed" });
    const b = generatePuzzle({ seed: "same-seed" });
    expect(a.regions).toEqual(b.regions);
    expect(a.solution).toEqual(b.solution);
  });
});
