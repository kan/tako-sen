import {
  cellCoord,
  cellIndex,
  isAdjacent,
  type PlayerState,
  type Puzzle,
} from "./model";

export type SolveStatus = "none" | "unique" | "multiple";

export interface SolveResult {
  readonly status: SolveStatus;
  readonly solutions: readonly (readonly number[])[];
}

export function solvePuzzle(
  puzzle: Pick<Puzzle, "size" | "regions" | "givens">,
  options: {
    readonly state?: PlayerState;
    readonly maxSolutions?: number;
  } = {},
): SolveResult {
  const size = puzzle.size;
  const maxSolutions = options.maxSolutions ?? 2;
  const blocked = new Set<number>(options.state?.excluded ?? []);
  for (const index of options.state?.fixedErrors ?? []) blocked.add(index);
  const fixedPieces = [
    ...new Set([...(puzzle.givens ?? []), ...(options.state?.pieces ?? [])]),
  ];
  const rowFixed = new Map<number, number>();
  const fixedColumns = new Set<number>();
  const fixedRegions = new Set<number>();

  for (const piece of fixedPieces) {
    if (!Number.isInteger(piece) || piece < 0 || piece >= size * size)
      return { status: "none", solutions: [] };
    const { row, col } = cellCoord(piece, size);
    const region = puzzle.regions[piece];
    if (
      blocked.has(piece) ||
      rowFixed.has(row) ||
      fixedColumns.has(col) ||
      fixedRegions.has(region)
    ) {
      return { status: "none", solutions: [] };
    }
    for (const other of fixedPieces) {
      if (piece !== other && isAdjacent(piece, other, size))
        return { status: "none", solutions: [] };
    }
    rowFixed.set(row, piece);
    fixedColumns.add(col);
    fixedRegions.add(region);
  }

  const candidatesByRow = Array.from({ length: size }, (_, row) => {
    const fixed = rowFixed.get(row);
    if (fixed !== undefined) return [fixed];
    const candidates: number[] = [];
    for (let col = 0; col < size; col += 1) {
      const index = cellIndex(row, col, size);
      if (!blocked.has(index)) candidates.push(index);
    }
    return candidates;
  });

  // The search runs thousands of times per generated puzzle, so it works on
  // flat arrays. Region ids are mapped to slots because unvalidated input may
  // carry arbitrary ids.
  const regionSlots = new Map<number | undefined, number>();
  const regionSlotByCell = Array.from({ length: size * size }, (_, index) => {
    const region: number | undefined = puzzle.regions[index];
    let slot = regionSlots.get(region);
    if (slot === undefined) {
      slot = regionSlots.size;
      regionSlots.set(region, slot);
    }
    return slot;
  });
  const columnUsed = new Uint8Array(size);
  const regionUsed = new Uint8Array(regionSlots.size);
  // Fixed pieces claim their column and region before the search starts, so a
  // branch that collides with a fixed piece in a later row ends at once
  // instead of when the search reaches that row. The order in which solutions
  // are found does not change.
  for (const piece of fixedPieces) {
    columnUsed[piece % size] = 1;
    regionUsed[regionSlotByCell[piece]] = 1;
  }
  const solutions: number[][] = [];
  const chosen: number[] = [];
  search(0);

  return {
    status:
      solutions.length === 0
        ? "none"
        : solutions.length === 1
          ? "unique"
          : "multiple",
    solutions,
  };

  function search(row: number): void {
    if (solutions.length >= maxSolutions) return;
    if (row === size) {
      solutions.push([...chosen].sort((a, b) => a - b));
      return;
    }

    // Rows are filled in order with one piece each, so only the piece in the
    // previous row can touch a cell of this row.
    const previousCol = row === 0 ? -2 : chosen[row - 1] % size;
    if (rowFixed.has(row)) {
      const index = candidatesByRow[row][0];
      const col = index % size;
      if (col - previousCol <= 1 && previousCol - col <= 1) return;
      chosen.push(index);
      search(row + 1);
      chosen.pop();
      return;
    }
    const candidates = candidatesByRow[row];
    for (let i = 0; i < candidates.length; i += 1) {
      const index = candidates[i];
      const col = index % size;
      const regionSlot = regionSlotByCell[index];
      if (columnUsed[col] || regionUsed[regionSlot]) continue;
      if (col - previousCol <= 1 && previousCol - col <= 1) continue;

      columnUsed[col] = 1;
      regionUsed[regionSlot] = 1;
      chosen.push(index);
      search(row + 1);
      chosen.pop();
      regionUsed[regionSlot] = 0;
      columnUsed[col] = 0;
    }
  }
}

export function hasContradiction(
  puzzle: Pick<Puzzle, "size" | "regions">,
  state: PlayerState,
): boolean {
  return solvePuzzle(puzzle, { state, maxSolutions: 1 }).status === "none";
}
