import {
  BOARD_SIZE,
  CELL_COUNT,
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
  puzzle: Pick<Puzzle, "regions" | "givens">,
  options: {
    readonly state?: PlayerState;
    readonly maxSolutions?: number;
  } = {},
): SolveResult {
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
    const { row, col } = cellCoord(piece);
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
      if (piece !== other && isAdjacent(piece, other))
        return { status: "none", solutions: [] };
    }
    rowFixed.set(row, piece);
    fixedColumns.add(col);
    fixedRegions.add(region);
  }

  const candidatesByRow = Array.from({ length: BOARD_SIZE }, (_, row) => {
    const fixed = rowFixed.get(row);
    if (fixed !== undefined) return [fixed];
    const candidates: number[] = [];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const index = cellIndex(row, col);
      if (!blocked.has(index)) candidates.push(index);
    }
    return candidates;
  });

  const solutions: number[][] = [];
  const chosen: number[] = [];
  search(0, new Set(), new Set(), chosen);

  return {
    status:
      solutions.length === 0
        ? "none"
        : solutions.length === 1
          ? "unique"
          : "multiple",
    solutions,
  };

  function search(
    row: number,
    columns: Set<number>,
    regions: Set<number>,
    partial: number[],
  ): void {
    if (solutions.length >= maxSolutions) return;
    if (row === BOARD_SIZE) {
      solutions.push([...partial].sort((a, b) => a - b));
      return;
    }

    for (const index of candidatesByRow[row]) {
      const { col } = cellCoord(index);
      const region = puzzle.regions[index];
      if (
        index < 0 ||
        index >= CELL_COUNT ||
        columns.has(col) ||
        regions.has(region)
      )
        continue;
      if (partial.some((piece) => isAdjacent(piece, index))) continue;

      columns.add(col);
      regions.add(region);
      partial.push(index);
      search(row + 1, columns, regions, partial);
      partial.pop();
      regions.delete(region);
      columns.delete(col);
    }
  }
}

export function hasContradiction(
  puzzle: Pick<Puzzle, "regions">,
  state: PlayerState,
): boolean {
  return solvePuzzle(puzzle, { state, maxSolutions: 1 }).status === "none";
}
