import {
  type PlayerState,
  type Puzzle,
  createInitialPlayerState,
} from "./model";
import { addExcludedMarks, placePiece } from "./player";
import { isComplete } from "./rules";
import { findLogicalMoves, type TechniqueId } from "./logical";

export type DifficultyRating = "easy" | "normal" | "hard" | "unsupported";

export interface LogicalSolveStep {
  readonly technique: TechniqueId;
  readonly excludeCount: number;
  readonly placed: boolean;
}

export interface PuzzleDifficultyAnalysis {
  readonly rating: DifficultyRating;
  readonly solved: boolean;
  readonly stalled: boolean;
  readonly stepCount: number;
  readonly placementCount: number;
  readonly exclusionCount: number;
  readonly usedTechniques: readonly TechniqueId[];
  readonly techniqueCounts: Readonly<Record<TechniqueId, number>>;
  readonly steps: readonly LogicalSolveStep[];
}

const TECHNIQUES: readonly TechniqueId[] = [
  "contradiction",
  "single-candidate",
  "region-line",
  "multi-region-line",
  "region-depletion",
  "missing-exclusion",
];

export function analyzePuzzleDifficulty(
  puzzle: Puzzle,
  initialState: PlayerState = createInitialPlayerState(0),
): PuzzleDifficultyAnalysis {
  let state = initialState;
  const steps: LogicalSolveStep[] = [];
  const maxSteps = puzzle.regions.length * 3;

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    if (isComplete(puzzle, state)) break;
    const move = findLogicalMoves(puzzle, state)[0];
    if (!move || move.technique === "contradiction") break;

    const beforeExcluded = state.excluded.size;
    const beforePieces = state.pieces.size;
    if (move.excludeCells.length > 0) {
      state = addExcludedMarks(state, move.excludeCells);
    }
    if (move.placeCell !== undefined) {
      state = placePiece(puzzle, state, move.placeCell);
    }

    const excludeCount = state.excluded.size - beforeExcluded;
    const placed = state.pieces.size > beforePieces;
    if (excludeCount === 0 && !placed) break;

    steps.push({
      technique: move.technique,
      excludeCount,
      placed,
    });
  }

  const solved = isComplete(puzzle, state);
  const techniqueCounts = createTechniqueCounts(steps);
  const usedTechniques = TECHNIQUES.filter(
    (technique) => techniqueCounts[technique] > 0,
  );
  const exclusionCount = steps.reduce(
    (sum, step) => sum + step.excludeCount,
    0,
  );
  const placementCount = steps.filter((step) => step.placed).length;

  return {
    rating: classifyDifficulty(solved, usedTechniques),
    solved,
    stalled: !solved,
    stepCount: steps.length,
    placementCount,
    exclusionCount,
    usedTechniques,
    techniqueCounts,
    steps,
  };
}

function createTechniqueCounts(
  steps: readonly LogicalSolveStep[],
): Record<TechniqueId, number> {
  const counts = Object.fromEntries(
    TECHNIQUES.map((technique) => [technique, 0]),
  ) as Record<TechniqueId, number>;
  for (const step of steps) {
    counts[step.technique] += 1;
  }
  return counts;
}

function classifyDifficulty(
  solved: boolean,
  usedTechniques: readonly TechniqueId[],
): DifficultyRating {
  if (!solved) return "unsupported";
  if (usedTechniques.includes("region-depletion")) return "hard";
  if (usedTechniques.includes("multi-region-line")) return "normal";
  return "easy";
}
