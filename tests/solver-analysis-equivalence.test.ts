import { describe, expect, it } from "vitest";
import {
  analyzePuzzleDifficulty,
  analyzePuzzleDifficultyByMoves,
  findEasiestMove,
} from "../src/core/difficulty";
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
  fixed: readonly number[] = [],
): number[][] {
  const { size, regions } = puzzle;
  const solutions: number[][] = [];
  // 固定したタコ同士が両立しなければ解はない。
  const conflict = (a: number, b: number) =>
    Math.floor(a / size) === Math.floor(b / size) ||
    a % size === b % size ||
    regions[a] === regions[b] ||
    isAdjacent(a, b, size);
  if (
    fixed.some(
      (piece, i) =>
        blocked.has(piece) ||
        fixed.some((other, j) => i !== j && conflict(piece, other)),
    )
  )
    return [];
  const visit = (row: number, partial: number[]): void => {
    if (solutions.length >= maxSolutions) return;
    if (row === size) {
      solutions.push([...partial]);
      return;
    }
    const fixedHere = fixed.find((piece) => Math.floor(piece / size) === row);
    for (let col = 0; col < size; col += 1) {
      const index = row * size + col;
      if (fixedHere !== undefined && index !== fixedHere) continue;
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

// 版を明示して固定する。既定の版に追随させると、版を上げた時に比較の対象が
// 黙って入れ替わる。g2は1マスRegionを、超級は事前設置と10×10を含む。
const puzzles: Puzzle[] = [
  ...(["g2", "g3", "g4"] as const).flatMap((version) =>
    (["easy", "normal", "hard"] as const).flatMap((difficulty) =>
      Array.from({ length: 3 }, (_, i) =>
        generatePuzzle({ version, seed: `equivalence:${i}`, difficulty }),
      ),
    ),
  ),
  generatePuzzle({
    version: "g2",
    seed: "curated",
    difficulty: "easy",
    maxAttempts: 0,
  }),
  ...["super-v1", "super-v2"].flatMap((version) =>
    ["equivalence", "equivalence:1", "equivalence:2"].map((seed) =>
      generateSuperPuzzle(seed, version),
    ),
  ),
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

  it("analyses every board exactly as the move-based analysis does", () => {
    const random = createSeededRandom("analysis-equivalence");
    let compared = 0;
    let unsolved = 0;
    for (const puzzle of puzzles) {
      const variants: Puzzle[] = [puzzle, { ...puzzle, givens: [] }];
      // 生成器が探索中に解析する盤面を模して、境界のマスを隣のRegionへ移す。
      // 解が複数や0個になる盤面、定石で解けない盤面も含める。
      let regions = [...puzzle.regions];
      for (let step = 0; step < 24; step += 1) {
        const cell = Math.floor(random.next() * regions.length);
        const col = cell % puzzle.size;
        const neighbors = [
          cell - puzzle.size,
          cell + puzzle.size,
          col > 0 ? cell - 1 : -1,
          col < puzzle.size - 1 ? cell + 1 : -1,
        ].filter((index) => index >= 0 && index < regions.length);
        const neighbor =
          neighbors[Math.floor(random.next() * neighbors.length)];
        // 正解のマスを移した盤面は、保存された正解が盤面に合わなくなる。その
        // 場合の矛盾判定も比べるため、数回に1回だけ移す。
        if (puzzle.solution.includes(cell) && step % 6 !== 0) continue;
        regions = [...regions];
        regions[cell] = regions[neighbor];
        variants.push({ ...puzzle, regions, givens: [] });
        // 正解に含まれないマスを事前設置にした盤面。
        variants.push({ ...puzzle, regions, givens: [cell] });
        variants.push({
          ...puzzle,
          regions,
          givens: puzzle.solution.filter(() => random.next() < 0.3),
        });
      }
      for (const variant of variants) {
        const expected = analyzePuzzleDifficultyByMoves(variant);
        expect(analyzePuzzleDifficulty(variant)).toEqual(expected);
        compared += 1;
        if (!expected.solved) unsolved += 1;
      }
    }
    // 比較が一方の種類の盤面に偏っていないことを確かめる。
    expect(compared).toBeGreaterThan(300);
    expect(unsolved).toBeGreaterThan(20);
    expect(compared - unsolved).toBeGreaterThan(20);
  });

  it("uses the move-based analysis for a given state or unusual region ids", () => {
    const puzzle = puzzles[0];
    const state = addExcludedMarks(
      createInitialPlayerState(0, puzzle.givens ?? []),
      [puzzle.solution[0]],
      puzzle.size,
    );
    expect(analyzePuzzleDifficulty(puzzle, state)).toEqual(
      analyzePuzzleDifficultyByMoves(puzzle, state),
    );
    expect(analyzePuzzleDifficulty(puzzle, state).solved).toBe(false);
    const renamed = {
      ...puzzle,
      regions: puzzle.regions.map((id) => (id === 0 ? 99 : id)),
    };
    expect(analyzePuzzleDifficulty(renamed)).toEqual(
      analyzePuzzleDifficultyByMoves(renamed),
    );
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
        // 固定したタコ: なし、正解の一部、両立しないこともある任意のマス。
        const givens = [
          [],
          puzzle.solution.filter(() => random.next() < 0.3),
          [
            puzzle.solution[round % puzzle.size],
            Math.floor(random.next() * regions.length),
          ],
        ][round % 3];
        for (const maxSolutions of [1, 2, 5]) {
          const expected = referenceSolutions(
            { size: puzzle.size, regions },
            blocked,
            maxSolutions,
            [...new Set(givens)],
          );
          const solved = solvePuzzle(
            { size: puzzle.size, regions, givens },
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
