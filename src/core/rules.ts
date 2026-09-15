import {
  BOARD_SIZE,
  CELL_COUNT,
  REGION_COUNT,
  type PlayerState,
  type Puzzle,
  cellCoord,
  cellIndex,
  isAdjacent,
} from "./model";

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validatePuzzleShape(
  puzzle: Pick<Puzzle, "regions" | "solution">,
): ValidationResult {
  const errors: string[] = [];

  if (puzzle.regions.length !== CELL_COUNT) {
    errors.push("Region grid must contain exactly 64 cells.");
  }

  if (puzzle.solution.length !== REGION_COUNT) {
    errors.push("Solution must contain exactly 8 cells.");
  }

  const seenRegions = new Set(puzzle.regions);
  if (
    seenRegions.size !== REGION_COUNT ||
    [...seenRegions].some((id) => id < 0 || id >= REGION_COUNT)
  ) {
    errors.push("Puzzle must contain region ids 0 through 7.");
  }

  for (const regionId of seenRegions) {
    if (!isRegionConnected(puzzle.regions, regionId)) {
      errors.push(`Region ${regionId} is not connected.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateSolution(
  puzzle: Pick<Puzzle, "regions" | "solution">,
): ValidationResult {
  const shape = validatePuzzleShape(puzzle);
  const errors = [...shape.errors];
  const rows = new Set<number>();
  const columns = new Set<number>();
  const regions = new Set<number>();
  const pieces = [...puzzle.solution];

  for (const index of pieces) {
    if (index < 0 || index >= CELL_COUNT) {
      errors.push(`Solution contains invalid cell: ${index}.`);
      continue;
    }
    const { row, col } = cellCoord(index);
    rows.add(row);
    columns.add(col);
    regions.add(puzzle.regions[index]);
  }

  if (new Set(pieces).size !== REGION_COUNT)
    errors.push("Solution cells must be unique.");
  if (rows.size !== REGION_COUNT)
    errors.push("Each row must contain exactly one piece.");
  if (columns.size !== REGION_COUNT)
    errors.push("Each column must contain exactly one piece.");
  if (regions.size !== REGION_COUNT)
    errors.push("Each region must contain exactly one piece.");

  for (let a = 0; a < pieces.length; a += 1) {
    for (let b = a + 1; b < pieces.length; b += 1) {
      if (isAdjacent(pieces[a], pieces[b])) {
        errors.push("Pieces must not touch, including diagonally.");
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function isCorrectPiece(
  puzzle: Pick<Puzzle, "solution">,
  index: number,
): boolean {
  return puzzle.solution.includes(index);
}

export function isComplete(
  puzzle: Pick<Puzzle, "solution">,
  state: PlayerState,
): boolean {
  return puzzle.solution.every((index) => state.pieces.has(index));
}

function isRegionConnected(
  regions: readonly number[],
  regionId: number,
): boolean {
  const first = regions.findIndex((id) => id === regionId);
  if (first === -1) return false;

  const targetCount = regions.filter((id) => id === regionId).length;
  const visited = new Set<number>([first]);
  const queue = [first];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const { row, col } = cellCoord(current);
    const neighbors = [
      row > 0 ? cellIndex(row - 1, col) : undefined,
      row < BOARD_SIZE - 1 ? cellIndex(row + 1, col) : undefined,
      col > 0 ? cellIndex(row, col - 1) : undefined,
      col < BOARD_SIZE - 1 ? cellIndex(row, col + 1) : undefined,
    ];
    for (const next of neighbors) {
      if (next === undefined || visited.has(next) || regions[next] !== regionId)
        continue;
      visited.add(next);
      queue.push(next);
    }
  }

  return visited.size === targetCount;
}
