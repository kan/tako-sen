import { describe, expect, it } from "vitest";
import {
  BOARD_SIZE,
  cellIndex,
  createInitialPlayerState,
  isAdjacent,
  type Puzzle,
} from "../src/core/model";
import { generatePuzzle } from "../src/core/generator";
import {
  addExcludedMarks,
  placePiece,
  resetPlayerProgress,
  toggleExcluded,
} from "../src/core/player";
import { validatePuzzleShape, validateSolution } from "../src/core/rules";
import { solvePuzzle } from "../src/core/solver";
import {
  exclusionsFromPiece,
  regionLineExclusions,
  shortcutExclusionsForCell,
} from "../src/core/shortcuts";
import { findLogicalMoves } from "../src/core/logical";
import { canShowHint } from "../src/ui/hint";
import { pointerReleaseAction } from "../src/ui/pointer";
import { encodePuzzleSeed, parsePuzzleSeedCode } from "../src/core/puzzle-code";

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

  it("resets board marks, pieces, mistakes, and hint count for the same puzzle", () => {
    const state = resetPlayerProgress(
      {
        ...createInitialPlayerState(100),
        excluded: new Set([cellIndex(0, 0)]),
        pieces: new Set([cellIndex(1, 2)]),
        fixedErrors: new Set([cellIndex(3, 4)]),
        mistakes: 2,
        hintsUsed: 3,
      },
      200,
    );

    expect(state.excluded.size).toBe(0);
    expect(state.pieces.size).toBe(0);
    expect(state.fixedErrors.size).toBe(0);
    expect(state.mistakes).toBe(0);
    expect(state.hintsUsed).toBe(0);
    expect(state.startedAt).toBe(200);
  });
});

describe("shortcuts", () => {
  it("creates row, column, neighbor, and Region exclusions from a placed piece", () => {
    const puzzle: Puzzle = {
      size: BOARD_SIZE,
      regions: Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) =>
        index === cellIndex(6, 6) ? 1 : 0,
      ),
      solution: [],
      seed: "shortcut-region",
    };
    const exclusions = exclusionsFromPiece(cellIndex(3, 3), puzzle);
    expect(exclusions).toContain(cellIndex(3, 0));
    expect(exclusions).toContain(cellIndex(0, 3));
    expect(exclusions).toContain(cellIndex(2, 2));
    expect(exclusions).toContain(cellIndex(6, 0));
    expect(exclusions).not.toContain(cellIndex(6, 6));
    expect(exclusions).not.toContain(cellIndex(3, 3));
  });

  it("does not create double-click shortcut exclusions for a cell without a placed piece", () => {
    const puzzle = generatePuzzle({ seed: "shortcut-unplaced" });
    const state = createInitialPlayerState(0);

    expect(shortcutExclusionsForCell(puzzle, state, cellIndex(3, 3))).toEqual(
      [],
    );
  });

  it("creates double-click shortcut exclusions only from a placed piece", () => {
    const puzzle = generatePuzzle({ seed: "shortcut-placed" });
    const piece = puzzle.solution[0];
    const state = { ...createInitialPlayerState(0), pieces: new Set([piece]) };

    expect(shortcutExclusionsForCell(puzzle, state, piece)).toEqual(
      expect.arrayContaining(exclusionsFromPiece(piece, puzzle)),
    );
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

  it("reports missing exclusions from a confirmed piece before a single-candidate placement", () => {
    const puzzle: Puzzle = {
      size: BOARD_SIZE,
      regions: Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) =>
        Math.floor(index / BOARD_SIZE),
      ),
      solution: [
        cellIndex(0, 0),
        cellIndex(1, 2),
        cellIndex(2, 4),
        cellIndex(3, 6),
        cellIndex(4, 1),
        cellIndex(5, 3),
        cellIndex(6, 5),
        cellIndex(7, 7),
      ],
      seed: "missing-exclusion-before-single",
    };
    const state = addExcludedMarks(
      {
        ...createInitialPlayerState(0),
        pieces: new Set([cellIndex(0, 0)]),
      },
      [
        cellIndex(1, 3),
        cellIndex(1, 4),
        cellIndex(1, 5),
        cellIndex(1, 6),
        cellIndex(1, 7),
      ],
    );

    const moves = findLogicalMoves(puzzle, state);
    const missingIndex = moves.findIndex(
      (move) => move.technique === "missing-exclusion",
    );
    const singleIndex = moves.findIndex(
      (move) => move.technique === "single-candidate",
    );

    expect(missingIndex).toBeGreaterThanOrEqual(0);
    expect(singleIndex).toBeGreaterThanOrEqual(0);
    expect(missingIndex).toBeLessThan(singleIndex);
    expect(moves[missingIndex]?.excludeCells).toContain(cellIndex(1, 1));
  });

  it("suggests multi-region line exclusions when several Regions are confined to the same lines", () => {
    const puzzle: Puzzle = {
      size: BOARD_SIZE,
      regions: [
        0, 0, 1, 1, 1, 1, 2, 2, 3, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 2, 2, 5, 2,
        3, 4, 4, 4, 4, 4, 5, 2, 4, 4, 6, 5, 5, 5, 5, 5, 4, 6, 6, 5, 7, 5, 5, 7,
        6, 6, 6, 7, 7, 7, 7, 7, 6, 6, 6, 6, 7, 7, 7, 7,
      ],
      solution: [
        cellIndex(0, 1),
        cellIndex(1, 4),
        cellIndex(2, 2),
        cellIndex(3, 7),
        cellIndex(4, 5),
        cellIndex(5, 0),
        cellIndex(6, 6),
        cellIndex(7, 3),
      ],
      seed: "multi-region-line",
    };
    const state = addExcludedMarks(createInitialPlayerState(0), [
      cellIndex(0, 2),
      cellIndex(1, 0),
      cellIndex(3, 1),
    ]);

    const moves = findLogicalMoves(puzzle, state);
    const move = moves.find(
      (candidate) =>
        candidate.technique === "multi-region-line" &&
        candidate.regionIds?.join(",") === "0,1" &&
        candidate.rows?.join(",") === "0,1",
    );

    expect(move?.excludeCells).toEqual(
      expect.arrayContaining([
        cellIndex(0, 6),
        cellIndex(0, 7),
        cellIndex(1, 5),
        cellIndex(1, 6),
        cellIndex(1, 7),
      ]),
    );
  });

  it("suggests excluding a cell when placing there would leave another Region without candidates", () => {
    const rowRegionsPuzzle: Puzzle = {
      size: BOARD_SIZE,
      regions: Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) =>
        Math.floor(index / BOARD_SIZE),
      ),
      solution: [
        cellIndex(0, 1),
        cellIndex(1, 3),
        cellIndex(2, 5),
        cellIndex(3, 7),
        cellIndex(4, 0),
        cellIndex(5, 2),
        cellIndex(6, 4),
        cellIndex(7, 6),
      ],
      seed: "row-regions",
    };
    const state = addExcludedMarks(
      createInitialPlayerState(0),
      Array.from({ length: 6 }, (_, offset) => cellIndex(0, offset + 2)),
    );

    const moves = findLogicalMoves(rowRegionsPuzzle, state);
    const move = moves.find(
      (candidate) =>
        candidate.technique === "region-depletion" &&
        candidate.excludeCells.includes(cellIndex(1, 0)),
    );

    expect(move).toMatchObject({
      affectedRegionId: 0,
      excludeCells: [cellIndex(1, 0)],
    });
    expect(move?.focusCells).toEqual(
      expect.arrayContaining([
        cellIndex(1, 0),
        cellIndex(0, 0),
        cellIndex(0, 1),
      ]),
    );
  });
});

describe("generator", () => {
  it("is deterministic for the same seed", () => {
    const a = generatePuzzle({ seed: "same-seed" });
    const b = generatePuzzle({ seed: "same-seed" });
    expect(a.regions).toEqual(b.regions);
    expect(a.solution).toEqual(b.solution);
  });

  it("restores the same puzzle from a displayed seed code", () => {
    const original = generatePuzzle({
      seed: "restore-seed",
      difficulty: "normal",
    });
    const parsed = parsePuzzleSeedCode(encodePuzzleSeed(original));

    expect(parsed).toEqual({
      version: "g1",
      difficulty: "normal",
      seed: "restore-seed",
    });

    const restored = generatePuzzle({
      seed: parsed?.seed,
      difficulty: parsed?.difficulty,
    });
    expect(restored.regions).toEqual(original.regions);
    expect(restored.solution).toEqual(original.solution);
    expect(solvePuzzle(restored, { maxSolutions: 2 }).status).toBe("unique");
  });

  it("uses difficulty as part of deterministic puzzle generation", () => {
    const easy = generatePuzzle({
      seed: "difficulty-seed",
      difficulty: "easy",
    });
    const hard = generatePuzzle({
      seed: "difficulty-seed",
      difficulty: "hard",
    });
    expect(easy.difficulty).toBe("easy");
    expect(hard.difficulty).toBe("hard");
    expect(easy.regions).not.toEqual(hard.regions);
  });
});

describe("pointer interaction", () => {
  it("places a piece when released after the long press duration even if the timer callback has not marked it ready yet", () => {
    expect(
      pointerReleaseAction({
        elapsedMs: 520,
        longPressMs: 520,
        dragging: false,
        longPressReady: false,
        longPressCanceled: false,
      }),
    ).toBe("place-piece");
  });

  it("suppresses the follow-up click when a ready long press was canceled by leaving the cell", () => {
    expect(
      pointerReleaseAction({
        elapsedMs: 700,
        longPressMs: 520,
        dragging: false,
        longPressReady: true,
        longPressCanceled: true,
      }),
    ).toBe("suppress-click");
  });

  it("keeps a short press as a normal tap", () => {
    expect(
      pointerReleaseAction({
        elapsedMs: 120,
        longPressMs: 520,
        dragging: false,
        longPressReady: false,
        longPressCanceled: false,
      }),
    ).toBe("tap");
  });
});

describe("hint UI", () => {
  it("does not show hints after the puzzle is complete", () => {
    expect(canShowHint(true)).toBe(false);
    expect(canShowHint(false)).toBe(true);
  });
});
