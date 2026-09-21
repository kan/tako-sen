export const BOARD_SIZE = 8;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
export const REGION_COUNT = BOARD_SIZE;

export type RegionId = number;
export type PuzzleDifficulty = "easy" | "normal" | "hard";

export interface CellCoord {
  readonly row: number;
  readonly col: number;
}

export interface Puzzle {
  readonly size: typeof BOARD_SIZE;
  readonly regions: readonly RegionId[];
  readonly solution: readonly number[];
  readonly seed: string;
  readonly difficulty?: PuzzleDifficulty;
  readonly generatorVersion?: string;
}

export interface PlayerState {
  readonly excluded: ReadonlySet<number>;
  readonly pieces: ReadonlySet<number>;
  readonly fixedErrors: ReadonlySet<number>;
  readonly mistakes: number;
  readonly hintsUsed: number;
  readonly startedAt: number;
}

export type CellViewState = "empty" | "excluded" | "piece" | "fixed-error";

export function cellIndex(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

export function cellCoord(index: number): CellCoord {
  return { row: Math.floor(index / BOARD_SIZE), col: index % BOARD_SIZE };
}

export function assertCellIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) {
    throw new Error(`Invalid cell index: ${index}`);
  }
}

export function createInitialPlayerState(now = Date.now()): PlayerState {
  return {
    excluded: new Set(),
    pieces: new Set(),
    fixedErrors: new Set(),
    mistakes: 0,
    hintsUsed: 0,
    startedAt: now,
  };
}

export function getCellViewState(
  state: PlayerState,
  index: number,
): CellViewState {
  if (state.fixedErrors.has(index)) return "fixed-error";
  if (state.pieces.has(index)) return "piece";
  if (state.excluded.has(index)) return "excluded";
  return "empty";
}

export function isAdjacent(a: number, b: number): boolean {
  const ac = cellCoord(a);
  const bc = cellCoord(b);
  return Math.max(Math.abs(ac.row - bc.row), Math.abs(ac.col - bc.col)) === 1;
}

export function sameRow(a: number, b: number): boolean {
  return cellCoord(a).row === cellCoord(b).row;
}

export function sameColumn(a: number, b: number): boolean {
  return cellCoord(a).col === cellCoord(b).col;
}

export function regionCells(
  puzzle: Pick<Puzzle, "regions">,
  regionId: RegionId,
): number[] {
  const cells: number[] = [];
  for (let index = 0; index < puzzle.regions.length; index += 1) {
    if (puzzle.regions[index] === regionId) cells.push(index);
  }
  return cells;
}

export function allCells(): number[] {
  return Array.from({ length: CELL_COUNT }, (_, index) => index);
}
