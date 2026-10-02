import type { HintStage } from "./hint-progress";

export const BOARD_SIZE = 8;
export const DAILY_BOARD_SIZE = 10;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
export const REGION_COUNT = BOARD_SIZE;

export type RegionId = number;
export type PuzzleDifficulty = "easy" | "normal" | "hard";

export interface CellCoord {
  readonly row: number;
  readonly col: number;
}

export interface Puzzle {
  readonly size: 8 | 10;
  readonly regions: readonly RegionId[];
  readonly solution: readonly number[];
  readonly givens?: readonly number[];
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
  readonly maxHintStage?: HintStage | null;
  readonly startedAt: number;
}

export type CellViewState = "empty" | "excluded" | "piece" | "fixed-error";

export function cellIndex(row: number, col: number, size = BOARD_SIZE): number {
  return row * size + col;
}

export function cellCoord(index: number, size = BOARD_SIZE): CellCoord {
  return { row: Math.floor(index / size), col: index % size };
}

export function assertCellIndex(index: number, size = BOARD_SIZE): void {
  if (!Number.isInteger(index) || index < 0 || index >= size * size) {
    throw new Error(`Invalid cell index: ${index}`);
  }
}

export function createInitialPlayerState(
  now = Date.now(),
  pieces: Iterable<number> = [],
): PlayerState {
  return {
    excluded: new Set(),
    pieces: new Set(pieces),
    fixedErrors: new Set(),
    mistakes: 0,
    hintsUsed: 0,
    maxHintStage: 0,
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

export function isAdjacent(a: number, b: number, size = BOARD_SIZE): boolean {
  const ac = cellCoord(a, size);
  const bc = cellCoord(b, size);
  return Math.max(Math.abs(ac.row - bc.row), Math.abs(ac.col - bc.col)) === 1;
}

export function sameRow(a: number, b: number, size = BOARD_SIZE): boolean {
  return cellCoord(a, size).row === cellCoord(b, size).row;
}

export function sameColumn(a: number, b: number, size = BOARD_SIZE): boolean {
  return cellCoord(a, size).col === cellCoord(b, size).col;
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

export function allCells(size = BOARD_SIZE): number[] {
  return Array.from({ length: size * size }, (_, index) => index);
}
