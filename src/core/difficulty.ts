import {
  type PlayerState,
  type Puzzle,
  createInitialPlayerState,
} from "./model";
import { addExcludedMarks, placePiece } from "./player";
import { isComplete } from "./rules";
import {
  findLogicalMoves,
  type LogicalMove,
  type TechniqueId,
} from "./logical";

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

const TECHNIQUE_PRIORITY: Readonly<Record<TechniqueId, number>> = {
  contradiction: 99,
  "missing-exclusion": 0,
  "single-candidate": 1,
  "region-line": 2,
  "line-region": 2,
  "multi-region-line": 3,
  "region-depletion": 4,
};

const TECHNIQUES: readonly TechniqueId[] = [
  "contradiction",
  "single-candidate",
  "region-line",
  "line-region",
  "multi-region-line",
  "region-depletion",
  "missing-exclusion",
];

export function analyzePuzzleDifficulty(
  puzzle: Puzzle,
  initialState: PlayerState = createInitialPlayerState(0, puzzle.givens ?? []),
): PuzzleDifficultyAnalysis {
  let state = initialState;
  const steps: LogicalSolveStep[] = [];
  const maxSteps = puzzle.regions.length * 3;

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    if (isComplete(puzzle, state)) break;
    const move = easiestMove(findLogicalMoves(puzzle, state));
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
    rating: classifyDifficulty(solved, techniqueCounts),
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
  techniqueCounts: Readonly<Record<TechniqueId, number>>,
): DifficultyRating {
  if (!solved) return "unsupported";

  if (techniqueCounts["region-depletion"] > 0) return "hard";
  if (techniqueCounts["multi-region-line"] > 0) return "normal";
  return "easy";
}

function easiestMove(moves: readonly LogicalMove[]): LogicalMove | undefined {
  return [...moves].sort((a, b) => {
    const priorityDiff =
      TECHNIQUE_PRIORITY[a.technique] - TECHNIQUE_PRIORITY[b.technique];
    if (priorityDiff !== 0) return priorityDiff;
    return a.focusCells[0] - b.focusCells[0];
  })[0];
}
