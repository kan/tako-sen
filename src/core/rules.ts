import {
  BOARD_SIZE,
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
  puzzle: Pick<Puzzle, "size" | "regions" | "solution" | "givens">,
): ValidationResult {
  const errors: string[] = [];
  const size = puzzle.size;

  if (size !== BOARD_SIZE && size !== 10)
    return { valid: false, errors: ["Unsupported board size."] };

  if (puzzle.regions.length !== size * size) {
    errors.push(`Region grid must contain exactly ${size * size} cells.`);
  }

  if (puzzle.solution.length !== size) {
    errors.push(`Solution must contain exactly ${size} cells.`);
  }

  for (const given of puzzle.givens ?? []) {
    if (!puzzle.solution.includes(given)) {
      errors.push(`Given cell must be part of the solution: ${given}.`);
    }
  }

  const seenRegions = new Set(puzzle.regions);
  if (
    seenRegions.size !== size ||
    [...seenRegions].some((id) => !Number.isInteger(id) || id < 0 || id >= size)
  ) {
    errors.push(`Puzzle must contain region ids 0 through ${size - 1}.`);
  }

  for (const regionId of seenRegions) {
    if (!isRegionConnected(puzzle.regions, regionId, size)) {
      errors.push(`Region ${regionId} is not connected.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateSolution(
  puzzle: Pick<Puzzle, "size" | "regions" | "solution">,
): ValidationResult {
  const shape = validatePuzzleShape(puzzle);
  const errors = [...shape.errors];
  const rows = new Set<number>();
  const columns = new Set<number>();
  const regions = new Set<number>();
  const pieces = [...puzzle.solution];

  for (const index of pieces) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= puzzle.size * puzzle.size
    ) {
      errors.push(`Solution contains invalid cell: ${index}.`);
      continue;
    }
    const { row, col } = cellCoord(index, puzzle.size);
    rows.add(row);
    columns.add(col);
    regions.add(puzzle.regions[index]);
  }

  if (new Set(pieces).size !== puzzle.size)
    errors.push("Solution cells must be unique.");
  if (rows.size !== puzzle.size)
    errors.push("Each row must contain exactly one piece.");
  if (columns.size !== puzzle.size)
    errors.push("Each column must contain exactly one piece.");
  if (regions.size !== puzzle.size)
    errors.push("Each region must contain exactly one piece.");

  for (let a = 0; a < pieces.length; a += 1) {
    for (let b = a + 1; b < pieces.length; b += 1) {
      if (isAdjacent(pieces[a], pieces[b], puzzle.size)) {
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
  size: number,
): boolean {
  const first = regions.findIndex((id) => id === regionId);
  if (first === -1) return false;

  const targetCount = regions.filter((id) => id === regionId).length;
  const visited = new Set<number>([first]);
  const queue = [first];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const { row, col } = cellCoord(current, size);
    const neighbors = [
      row > 0 ? cellIndex(row - 1, col, size) : undefined,
      row < size - 1 ? cellIndex(row + 1, col, size) : undefined,
      col > 0 ? cellIndex(row, col - 1, size) : undefined,
      col < size - 1 ? cellIndex(row, col + 1, size) : undefined,
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
