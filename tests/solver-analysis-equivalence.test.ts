import { describe, expect, it } from "vitest";
import { findEasiestMove } from "../src/core/difficulty";
import { generatePuzzle } from "../src/core/generator";
import { findLogicalMoves, type LogicalMove } from "../src/core/logical";
import {
  createInitialPlayerState,
  isAdjacent,
  type PlayerState,
  type Puzzle,
} from "../src/core/model";
import { addExcludedMarks, placePiece } from "../src/core/player";
import { createSeededRandom } from "../src/core/random";
import { solvePuzzle } from "../src/core/solver";
import { generateSuperPuzzle } from "../src/core/super-puzzle";

// 生成される盤面は問題IDの元になるため、高速化後も探索結果を変えない。
// 以下の参照実装は高速化前の定義をそのまま残したもの。

const priority: Record<string, number> = {
  contradiction: 99,
  "missing-exclusion": 0,
  "single-candidate": 1,
  "region-line": 2,
  "line-region": 2,
  "multi-region-line": 3,
  "region-depletion": 4,
};

function referenceEasiestMove(
  puzzle: Puzzle,
  state: PlayerState,
): LogicalMove | undefined {
  const move = [...findLogicalMoves(puzzle, state)].sort(
    (a, b) =>
      priority[a.technique] - priority[b.technique] ||
      a.focusCells[0] - b.focusCells[0],
  )[0];
  return move?.technique === "contradiction" ? undefined : move;
}

function referenceSolutions(
  puzzle: Pick<Puzzle, "size" | "regions">,
  blocked: ReadonlySet<number>,
  maxSolutions: number,
): number[][] {
  const { size, regions } = puzzle;
  const solutions: number[][] = [];
  const visit = (row: number, partial: number[]): void => {
    if (solutions.length >= maxSolutions) return;
    if (row === size) {
      solutions.push([...partial]);
      return;
    }
    for (let col = 0; col < size; col += 1) {
      const index = row * size + col;
      if (
        blocked.has(index) ||
        partial.some(
          (piece) =>
            piece % size === col ||
            regions[piece] === regions[index] ||
            isAdjacent(piece, index, size),
        )
      )
        continue;
      visit(row + 1, [...partial, index]);
    }
  };
  visit(0, []);
  return solutions;
}

const puzzles: Puzzle[] = [
  ...(["easy", "normal", "hard"] as const).flatMap((difficulty) =>
    Array.from({ length: 4 }, (_, i) =>
      generatePuzzle({ seed: `equivalence:${i}`, difficulty }),
    ),
  ),
  generateSuperPuzzle("equivalence"),
];

describe("solver and analysis equivalence", () => {
  it("picks the same easiest move as sorting every logical move", () => {
    for (const puzzle of puzzles) {
      let state = createInitialPlayerState(0, puzzle.givens ?? []);
      for (let step = 0; step < puzzle.regions.length * 3; step += 1) {
        const expected = referenceEasiestMove(puzzle, state);
        expect(findEasiestMove(puzzle, state)).toEqual(expected);
        if (!expected) break;
        state = addExcludedMarks(state, expected.excludeCells, puzzle.size);
        if (expected.placeCell !== undefined)
          state = placePiece(puzzle, state, expected.placeCell);
      }
    }
  });

  it("ends the analysis on a contradiction instead of suggesting a move", () => {
    const puzzle = puzzles[0];
    const state = addExcludedMarks(
      createInitialPlayerState(0),
      [puzzle.solution[0]],
      puzzle.size,
    );
    expect(findEasiestMove(puzzle, state)).toBeUndefined();
  });

  it("finds the same solutions in the same order as the reference search", () => {
    const random = createSeededRandom("solver-equivalence");
    for (const puzzle of puzzles) {
      for (let round = 0; round < 12; round += 1) {
        // 解が0個、1個、複数になる盤面を混ぜるため、Regionと×を崩す。
        const regions = puzzle.regions.map((region) =>
          random.next() < 0.15
            ? Math.floor(random.next() * puzzle.size)
            : region,
        );
        const blocked = new Set(
          regions.flatMap((_, index) => (random.next() < 0.1 ? [index] : [])),
        );
        const state = { ...createInitialPlayerState(0), excluded: blocked };
        for (const maxSolutions of [1, 2, 5]) {
          const expected = referenceSolutions(
            { size: puzzle.size, regions },
            blocked,
            maxSolutions,
          );
          const solved = solvePuzzle(
            { size: puzzle.size, regions },
            { state, maxSolutions },
          );
          expect(solved.solutions).toEqual(expected);
          expect(solved.status).toBe(
            expected.length === 0
              ? "none"
              : expected.length === 1
                ? "unique"
                : "multiple",
          );
        }
      }
    }
  });
});
