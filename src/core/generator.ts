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

export interface GenerateOptions {
  readonly seed?: string;
  readonly difficulty?: PuzzleDifficulty;
  readonly maxAttempts?: number;
}

export const GENERATOR_VERSION = "g1";

export function generatePuzzle(options: GenerateOptions = {}): Puzzle {
  const seed = options.seed ?? String(Date.now());
  const difficulty = options.difficulty ?? "easy";
  const maxAttempts = options.maxAttempts ?? 80;
  const curated = generateCuratedPuzzle(seed, difficulty);
  if (
    validatePuzzleShape(curated).valid &&
    validateSolution(curated).valid &&
    solvePuzzle(curated, { maxSolutions: 2 }).status === "unique"
  ) {
    return curated;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const random = createSeededRandom(
      `${GENERATOR_VERSION}:${difficulty}:${seed}:${attempt}`,
    );
    const solution = generateSolution(random);
    const regions = growRegions(solution, random);
    const puzzle: Puzzle = {
      size: BOARD_SIZE,
      regions,
      solution,
      seed,
      difficulty,
      generatorVersion: GENERATOR_VERSION,
    };

    if (!validatePuzzleShape(puzzle).valid || !validateSolution(puzzle).valid)
      continue;
    const solved = solvePuzzle(puzzle, { maxSolutions: 2 });
    if (solved.status === "unique") {
      return { ...puzzle, solution: solved.solutions[0] };
    }
  }

  throw new Error(`Failed to generate a unique puzzle for seed: ${seed}`);
}

const CURATED_REGIONS = [
  7, 7, 7, 7, 4, 4, 4, 4, 7, 7, 7, 4, 4, 4, 4, 4, 6, 7, 7, 5, 4, 5, 5, 4, 6, 6,
  7, 5, 5, 5, 5, 5, 3, 6, 6, 6, 6, 6, 5, 2, 3, 3, 3, 6, 2, 2, 5, 2, 3, 1, 0, 0,
  0, 2, 2, 2, 1, 1, 0, 0, 0, 0, 2, 2,
] as const;

const CURATED_SOLUTION = [3, 14, 16, 29, 39, 42, 52, 57] as const;

function generateCuratedPuzzle(
  seed: string,
  difficulty: PuzzleDifficulty,
): Puzzle {
  const random = createSeededRandom(
    `${GENERATOR_VERSION}:${difficulty}:${seed}`,
  );
  const transformId = Math.floor(random.next() * 8);
  const regionPermutation = shuffled([0, 1, 2, 3, 4, 5, 6, 7], random);
  const regions = Array<number>(CELL_COUNT);

  for (let index = 0; index < CELL_COUNT; index += 1) {
    regions[transformCell(index, transformId)] =
      regionPermutation[CURATED_REGIONS[index]];
  }

  return {
    size: BOARD_SIZE,
    regions,
    solution: CURATED_SOLUTION.map((index) =>
      transformCell(index, transformId),
    ).sort((a, b) => a - b),
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
): number[] {
  const regions = Array<number>(CELL_COUNT).fill(-1);
  const frontiers = Array.from(
    { length: REGION_COUNT },
    () => new Set<number>(),
  );

  for (let regionId = 0; regionId < solution.length; regionId += 1) {
    const seed = solution[regionId];
    regions[seed] = regionId;
    addUnassignedNeighbors(seed, regions, frontiers[regionId]);
  }

  let unassigned = regions.filter((id) => id === -1).length;
  while (unassigned > 0) {
    const regionOrder = shuffled(
      Array.from({ length: REGION_COUNT }, (_, regionId) => regionId).filter(
        (regionId) => frontiers[regionId].size > 0,
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
