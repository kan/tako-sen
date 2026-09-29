import { generatePuzzleWithAnalysis as generateG1 } from "./generator-g1";
import type { GenerateOptions, GeneratedPuzzle } from "./generator-g1";
import { createSeededRandom, shuffled } from "./random";
import { validatePuzzleShape } from "./rules";
import { solvePuzzle } from "./solver";
import { analyzePuzzleDifficulty } from "./difficulty";
import { BOARD_SIZE, cellCoord, cellIndex, type Puzzle } from "./model";

function neighbors(cell: number): number[] {
  const { row, col } = cellCoord(cell);
  return [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
  ]
    .filter(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE)
    .map(([r, c]) => cellIndex(r, c));
}

export function generateG2(options: GenerateOptions = {}): GeneratedPuzzle {
  const seed = options.seed ?? String(Date.now());
  const difficulty = options.difficulty ?? "easy";
  const attempts = options.maxAttempts ?? 80;
  if (!Number.isSafeInteger(attempts) || attempts < 0) {
    throw new Error("maxAttempts must be a nonnegative safe integer.");
  }
  if (difficulty === "easy" || attempts === 0) {
    const generated = generateG1(options);
    return {
      ...generated,
      puzzle: { ...generated.puzzle, generatorVersion: "g2" },
    };
  }
  const random = createSeededRandom(`g2:${difficulty}:${seed}`);
  // 正解を固定したまま境界を移し、連結性・唯一解を保って形状と解法を探索する。
  const initial = generateG1({
    seed: `g2:${seed}`,
    difficulty: "easy",
    maxAttempts: attempts,
  });
  let current: Puzzle = {
    ...initial.puzzle,
    seed,
    difficulty,
    generatorVersion: "g2",
    givens: [],
  };
  let best: GeneratedPuzzle = {
    puzzle: { ...current, givens: initial.puzzle.givens },
    analysis: initial.analysis,
  };
  const initialAnalysis = analyzePuzzleDifficulty(current);
  if (initialAnalysis.solved)
    best = { puzzle: current, analysis: initialAnalysis };
  if (best.analysis.rating === difficulty) return best;
  // 1attemptにつき最大16回の境界変更を提案する。時間ではなく回数で打ち切り、
  // ブラウザとサーバーの実行速度が違っても同じ盤面を再現する。
  const steps = attempts * 16;
  const rank = { easy: 0, normal: 1, hard: 2, unsupported: 3 };
  for (let step = 0; step < steps; step++) {
    const moves = shuffled(
      current.regions.flatMap((region, cell) => {
        if (current.solution.includes(cell)) return [];
        return [...new Set(neighbors(cell).map((n) => current.regions[n]))]
          .filter((destination) => destination !== region)
          .map((destination) => ({ cell, destination }));
      }),
      random,
    );
    const move = moves[0];
    if (!move) break;
    const regions = [...current.regions];
    regions[move.cell] = move.destination;
    const candidate = { ...current, regions };
    if (!validatePuzzleShape(candidate).valid) continue;
    if (solvePuzzle(candidate, { maxSolutions: 2 }).status !== "unique")
      continue;
    const analysis = analyzePuzzleDifficulty(candidate);
    if (!analysis.solved) continue;
    current = candidate;
    if (
      Math.abs(rank[analysis.rating] - rank[difficulty]) <
      Math.abs(rank[best.analysis.rating] - rank[difficulty])
    ) {
      best = { puzzle: candidate, analysis };
    }
    if (analysis.rating === difficulty) {
      return { puzzle: candidate, analysis };
    }
  }
  return best;
}
