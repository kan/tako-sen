import {
  BOARD_SIZE,
  CELL_COUNT,
  REGION_COUNT,
  cellCoord,
  cellIndex,
  type PuzzleDifficulty,
  type Puzzle,
} from "./model";
import { createSeededRandom, shuffled, type RandomSource } from "./random";
import { validatePuzzleShape, validateSolution } from "./rules";
import { solvePuzzle } from "./solver";
import {
  analyzePuzzleDifficulty,
  type DifficultyRating,
  type PuzzleDifficultyAnalysis,
} from "./difficulty";

export interface GenerateOptions {
  readonly seed?: string;
  readonly difficulty?: PuzzleDifficulty;
  readonly maxAttempts?: number;
}

export interface GeneratedPuzzle {
  readonly puzzle: Puzzle;
  readonly analysis: PuzzleDifficultyAnalysis;
}

export const GENERATOR_VERSION = "g1";

export function generatePuzzleWithAnalysis(
  options: GenerateOptions = {},
): GeneratedPuzzle {
  const seed = options.seed ?? String(Date.now());
  const difficulty = options.difficulty ?? "easy";
  const maxAttempts = options.maxAttempts ?? 80;
  const targetRating = targetRatingForDifficulty(difficulty);
  let fallback: GeneratedPuzzle | undefined;

  for (const puzzle of generatePuzzleCandidates(
    seed,
    difficulty,
    maxAttempts,
  )) {
    const solved = solvePuzzle(puzzle, { maxSolutions: 2 });
    if (solved.status !== "unique") continue;

    const verifiedPuzzle = { ...puzzle, solution: solved.solutions[0] };
    if (
      !validatePuzzleShape(verifiedPuzzle).valid ||
      !validateSolution(verifiedPuzzle).valid
    ) {
      continue;
    }

    const generated = {
      puzzle: verifiedPuzzle,
      analysis: analyzePuzzleDifficulty(verifiedPuzzle),
    };
    if (!fallback || isBetterFallback(generated, fallback, targetRating)) {
      fallback = generated;
    }
    if (generated.analysis.rating === targetRating) return generated;
  }

  if (fallback) return fallback;

  throw new Error(`Failed to generate a unique puzzle for seed: ${seed}`);
}

export function generatePuzzle(options: GenerateOptions = {}): Puzzle {
  return generatePuzzleWithAnalysis(options).puzzle;
}

function* generatePuzzleCandidates(
  seed: string,
  difficulty: PuzzleDifficulty,
  maxAttempts: number,
): Generator<Puzzle> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const random = createSeededRandom(
      `${GENERATOR_VERSION}:${difficulty}:${seed}:${attempt}`,
    );
    const solution = generateSolution(random);
    if (difficulty === "easy") {
      const regionOrder = shuffled(
        Array.from({ length: REGION_COUNT }, (_, regionId) => regionId),
        random,
      );
      for (const singletonRegionIds of easySingletonRegionSets(regionOrder)) {
        const regions = growRegions(
          solution,
          random,
          new Set(singletonRegionIds),
        );
        const puzzle: Puzzle = {
          size: BOARD_SIZE,
          regions,
          solution,
          seed,
          difficulty,
          generatorVersion: GENERATOR_VERSION,
        };
        for (const givens of easyGivenSets(
          singletonRegionIds.map((regionId) => solution[regionId]),
        )) {
          yield { ...puzzle, givens };
        }
      }
    } else {
      yield {
        size: BOARD_SIZE,
        regions: growRegions(solution, random),
        solution,
        seed,
        difficulty,
        generatorVersion: GENERATOR_VERSION,
      };
    }
  }

  if (difficulty === "easy") {
    const curatedRandom = createSeededRandom(
      `${GENERATOR_VERSION}:${difficulty}:${seed}:curated-order`,
    );
    for (const transformId of shuffled(
      [0, 1, 2, 3, 4, 5, 6, 7],
      curatedRandom,
    )) {
      yield generateCuratedPuzzle(seed, difficulty, transformId);
    }
  } else {
    yield generateCuratedPuzzle(seed, difficulty);
  }
}

function easyGivenSets(preferredGivens: readonly number[]): number[][] {
  const sets: number[][] = [[]];
  for (const given of preferredGivens) {
    sets.push([given]);
  }
  return sets;
}

function easySingletonRegionSets(regionOrder: readonly number[]): number[][] {
  const sets: number[][] = regionOrder.map((regionId) => [regionId]);
  for (let first = 0; first < regionOrder.length; first += 1) {
    for (let second = first + 1; second < regionOrder.length; second += 1) {
      sets.push([regionOrder[first], regionOrder[second]]);
    }
  }
  return sets;
}

function targetRatingForDifficulty(
  difficulty: PuzzleDifficulty,
): DifficultyRating {
  switch (difficulty) {
    case "easy":
      return "easy";
    case "normal":
      return "normal";
    case "hard":
      return "hard";
  }
}

function isBetterFallback(
  candidate: GeneratedPuzzle,
  current: GeneratedPuzzle,
  target: DifficultyRating,
): boolean {
  const candidateDistance = ratingDistance(candidate.analysis.rating, target);
  const currentDistance = ratingDistance(current.analysis.rating, target);
  if (candidateDistance !== currentDistance) {
    return candidateDistance < currentDistance;
  }
  if (target === "hard") {
    return candidate.analysis.stepCount > current.analysis.stepCount;
  }
  return candidate.analysis.stepCount < current.analysis.stepCount;
}

function ratingDistance(
  rating: DifficultyRating,
  target: DifficultyRating,
): number {
  return Math.abs(ratingRank(rating) - ratingRank(target));
}

function ratingRank(rating: DifficultyRating): number {
  switch (rating) {
    case "easy":
      return 0;
    case "normal":
      return 1;
    case "hard":
      return 2;
    case "unsupported":
      return 3;
  }
}

const EASY_CURATED_REGIONS = [
  6, 6, 3, 3, 3, 3, 7, 7, 5, 6, 3, 3, 3, 7, 7, 7, 5, 5, 5, 4, 7, 7, 0, 7, 5, 4,
  4, 4, 4, 4, 0, 7, 4, 4, 2, 0, 0, 0, 0, 0, 4, 2, 2, 0, 1, 0, 0, 1, 2, 2, 2, 1,
  1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1,
] as const;

const EASY_CURATED_SOLUTION = [1, 12, 18, 31, 37, 40, 54, 59] as const;

const DEFAULT_CURATED_REGIONS = [
  7, 7, 7, 7, 4, 4, 4, 4, 7, 7, 7, 4, 4, 4, 4, 4, 6, 7, 7, 5, 4, 5, 5, 4, 6, 6,
  7, 5, 5, 5, 5, 5, 3, 6, 6, 6, 6, 6, 5, 2, 3, 3, 3, 6, 2, 2, 5, 2, 3, 1, 0, 0,
  0, 2, 2, 2, 1, 1, 0, 0, 0, 0, 2, 2,
] as const;

const DEFAULT_CURATED_SOLUTION = [3, 14, 16, 29, 39, 42, 52, 57] as const;

function generateCuratedPuzzle(
  seed: string,
  difficulty: PuzzleDifficulty,
  transformIdOverride?: number,
): Puzzle {
  const random = createSeededRandom(
    `${GENERATOR_VERSION}:${difficulty}:${seed}`,
  );
  const transformId = transformIdOverride ?? Math.floor(random.next() * 8);
  const regionPermutation = shuffled([0, 1, 2, 3, 4, 5, 6, 7], random);
  const regions = Array<number>(CELL_COUNT);
  const source =
    difficulty === "easy"
      ? {
          regions: EASY_CURATED_REGIONS,
          solution: EASY_CURATED_SOLUTION,
        }
      : {
          regions: DEFAULT_CURATED_REGIONS,
          solution: DEFAULT_CURATED_SOLUTION,
        };

  for (let index = 0; index < CELL_COUNT; index += 1) {
    regions[transformCell(index, transformId)] =
      regionPermutation[source.regions[index]];
  }

  return {
    size: BOARD_SIZE,
    regions,
    solution: source.solution
      .map((index) => transformCell(index, transformId))
      .sort((a, b) => a - b),
    givens:
      difficulty === "easy"
        ? [transformCell(EASY_CURATED_SOLUTION[5], transformId)]
        : undefined,
    seed,
    difficulty,
    generatorVersion: GENERATOR_VERSION,
  };
}

function transformCell(index: number, transformId: number): number {
  const { row, col } = cellCoord(index);
  const last = BOARD_SIZE - 1;
  switch (transformId) {
    case 0:
      return cellIndex(row, col);
    case 1:
      return cellIndex(col, last - row);
    case 2:
      return cellIndex(last - row, last - col);
    case 3:
      return cellIndex(last - col, row);
    case 4:
      return cellIndex(row, last - col);
    case 5:
      return cellIndex(last - row, col);
    case 6:
      return cellIndex(col, row);
    default:
      return cellIndex(last - col, last - row);
  }
}

function generateSolution(random: RandomSource): number[] {
  const rows = Array.from({ length: BOARD_SIZE }, (_, row) => row);
  const columns = Array.from({ length: BOARD_SIZE }, (_, col) => col);

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const remaining = shuffled(columns, random);
    const solution: number[] = [];

    if (placeRow(0)) return solution;

    function placeRow(rowIndex: number): boolean {
      if (rowIndex === rows.length) return true;
      for (const col of shuffled(remaining, random)) {
        const index = cellIndex(rowIndex, col);
        if (
          solution.some(
            (piece) =>
              Math.abs(cellCoord(piece).row - rowIndex) <= 1 &&
              Math.abs(cellCoord(piece).col - col) <= 1,
          )
        ) {
          continue;
        }
        solution.push(index);
        remaining.splice(remaining.indexOf(col), 1);
        if (placeRow(rowIndex + 1)) return true;
        remaining.push(col);
        solution.pop();
      }
      return false;
    }
  }

  throw new Error("Failed to generate a complete piece placement.");
}

function growRegions(
  solution: readonly number[],
  random: RandomSource,
  fixedSingletonRegions: ReadonlySet<number> = new Set(),
): number[] {
  const regions = Array<number>(CELL_COUNT).fill(-1);
  const frontiers = Array.from(
    { length: REGION_COUNT },
    () => new Set<number>(),
  );

  for (let regionId = 0; regionId < solution.length; regionId += 1) {
    const seed = solution[regionId];
    regions[seed] = regionId;
    if (!fixedSingletonRegions.has(regionId)) {
      addUnassignedNeighbors(seed, regions, frontiers[regionId]);
    }
  }

  let unassigned = regions.filter((id) => id === -1).length;
  while (unassigned > 0) {
    const regionOrder = shuffled(
      Array.from({ length: REGION_COUNT }, (_, regionId) => regionId).filter(
        (regionId) =>
          !fixedSingletonRegions.has(regionId) && frontiers[regionId].size > 0,
      ),
      random,
    );
    const regionId = regionOrder[0];
    if (regionId === undefined) break;

    const frontier = shuffled([...frontiers[regionId]], random);
    const next = frontier[0];
    frontiers[regionId].delete(next);
    if (regions[next] !== -1) continue;

    regions[next] = regionId;
    unassigned -= 1;
    addUnassignedNeighbors(next, regions, frontiers[regionId]);
  }

  return regions;
}

function addUnassignedNeighbors(
  index: number,
  regions: readonly number[],
  frontier: Set<number>,
): void {
  for (const neighbor of orthogonalNeighbors(index)) {
    if (regions[neighbor] === -1) frontier.add(neighbor);
  }
}

function orthogonalNeighbors(index: number): number[] {
  const { row, col } = cellCoord(index);
  const neighbors: number[] = [];
  if (row > 0) neighbors.push(cellIndex(row - 1, col));
  if (row < BOARD_SIZE - 1) neighbors.push(cellIndex(row + 1, col));
  if (col > 0) neighbors.push(cellIndex(row, col - 1));
  if (col < BOARD_SIZE - 1) neighbors.push(cellIndex(row, col + 1));
  return neighbors;
}
