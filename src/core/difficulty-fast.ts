import { createInitialPlayerState, type Puzzle } from "./model";
import type { TechniqueId } from "./logical";
import type { LogicalSolveStep } from "./difficulty";
import { exclusionsFromPiece } from "./shortcuts";
import { hasContradiction } from "./solver";

// This file finds the same steps as the move finders in logical.ts, which the
// hints use, without building move objects. The two must change together:
// tests/solver-analysis-equivalence.test.ts compares them step by step, and a
// difference here changes which boards every generator version produces.

/** Cell lists that depend only on the board size. */
interface Grid {
  readonly rowOf: Int8Array;
  readonly colOf: Int8Array;
  readonly rowCells: readonly (readonly number[])[];
  readonly colCells: readonly (readonly number[])[];
  /** Each cell with the up to eight cells around it. */
  readonly around: readonly (readonly number[])[];
}

const grids = new Map<number, Grid>();

function gridOf(size: number): Grid {
  const cached = grids.get(size);
  if (cached) return cached;
  const cells = size * size;
  const rowOf = new Int8Array(cells);
  const colOf = new Int8Array(cells);
  const rowCells: number[][] = Array.from({ length: size }, () => []);
  const colCells: number[][] = Array.from({ length: size }, () => []);
  const around: number[][] = [];
  for (let cell = 0; cell < cells; cell += 1) {
    const row = Math.floor(cell / size);
    const col = cell % size;
    rowOf[cell] = row;
    colOf[cell] = col;
    rowCells[row].push(cell);
    colCells[col].push(cell);
    const near: number[] = [];
    for (let r = Math.max(0, row - 1); r <= Math.min(size - 1, row + 1); r += 1)
      for (
        let c = Math.max(0, col - 1);
        c <= Math.min(size - 1, col + 1);
        c += 1
      )
        near.push(r * size + c);
    around.push(near);
  }
  const grid = { rowOf, colOf, rowCells, colCells, around };
  grids.set(size, grid);
  return grid;
}

/** Whether the fast solver can read this board: region ids 0..size-1 only. */
export function hasPlainRegions(
  puzzle: Pick<Puzzle, "size" | "regions">,
): boolean {
  return (
    puzzle.regions.length === puzzle.size * puzzle.size &&
    puzzle.regions.every(
      (id) => Number.isInteger(id) && id >= 0 && id < puzzle.size,
    )
  );
}

/** The board and the marks made so far. Arrays are indexed by cell or unit. */
interface Position extends Grid {
  readonly size: number;
  readonly regions: readonly number[];
  readonly regionCells: readonly (readonly number[])[];
  readonly pieces: number[];
  readonly isPiece: Uint8Array;
  readonly excluded: Uint8Array;
  /** Cells that may still take a piece, refreshed before every step. */
  readonly legal: Uint8Array;
  readonly regionHasPiece: Uint8Array;
}

interface Found {
  readonly technique: TechniqueId;
  readonly excludeCells: readonly number[];
  readonly placeCell?: number;
}

const isOpen = (position: Position, cell: number) =>
  !position.excluded[cell] && !position.isPiece[cell];

/**
 * The steps analyzePuzzleDifficultyByMoves takes from the puzzle's givens.
 * Each step needs only the easiest move, so the techniques are tried in
 * priority order and the first that applies is taken. Within a technique the
 * move with the lowest first focus cell wins, and among equals the one the
 * move finders list first.
 */
export function solveStepsFast(puzzle: Puzzle): {
  readonly steps: LogicalSolveStep[];
  readonly solved: boolean;
} {
  const size = puzzle.size;
  const cells = size * size;
  const regionCells: number[][] = Array.from({ length: size }, () => []);
  puzzle.regions.forEach((id, cell) => regionCells[id].push(cell));
  const position: Position = {
    ...gridOf(size),
    size,
    regions: puzzle.regions,
    regionCells,
    pieces: [],
    isPiece: new Uint8Array(cells),
    excluded: new Uint8Array(cells),
    legal: new Uint8Array(cells),
    regionHasPiece: new Uint8Array(size),
  };
  const { pieces, isPiece, excluded } = position;
  for (const piece of puzzle.givens ?? []) {
    if (isPiece[piece]) continue;
    isPiece[piece] = 1;
    pieces.push(piece);
  }
  const isSolution = new Uint8Array(cells);
  for (const cell of puzzle.solution) isSolution[cell] = 1;
  const isComplete = () => puzzle.solution.every((cell) => isPiece[cell]);
  // While the stored solution fits the board and no mark contradicts it, it
  // proves that the marks are consistent, and no search is needed.
  const solutionFits =
    isPlacement(position, puzzle.solution) &&
    pieces.every((piece) => isSolution[piece]);
  const contradicts = () =>
    !(solutionFits && puzzle.solution.every((cell) => !excluded[cell])) &&
    hasContradiction(puzzle, {
      ...createInitialPlayerState(0, pieces),
      excluded: new Set(
        Array.from(excluded.keys()).filter((cell) => excluded[cell]),
      ),
    });

  const exclusionsOf: (readonly number[] | undefined)[] = [];
  const steps: LogicalSolveStep[] = [];
  for (let stepIndex = 0; stepIndex < cells * 3; stepIndex += 1) {
    if (isComplete() || contradicts()) break;
    refreshLegal(position);
    const found =
      missingExclusion(position, (piece) => {
        exclusionsOf[piece] ??= exclusionsFromPiece(piece, puzzle);
        return exclusionsOf[piece];
      }) ??
      singleCandidate(position) ??
      regionOrLineMove(position) ??
      multiRegionLine(position) ??
      regionDepletion(position);
    if (!found) break;

    // Every technique returns open cells only, each once.
    for (const cell of found.excludeCells) excluded[cell] = 1;
    const placed =
      found.placeCell !== undefined && !!isSolution[found.placeCell];
    if (placed) {
      isPiece[found.placeCell!] = 1;
      pieces.push(found.placeCell!);
    }
    if (found.excludeCells.length === 0 && !placed) break;
    steps.push({
      technique: found.technique,
      excludeCount: found.excludeCells.length,
      placed,
    });
  }
  return { steps, solved: isComplete() };
}

/** One piece per row, column and region, none touching another. */
function isPlacement(
  position: Position,
  placement: readonly number[],
): boolean {
  const { size, rowOf, colOf, regions } = position;
  if (placement.length !== size) return false;
  const rows = new Set(placement.map((cell) => rowOf[cell]));
  const cols = new Set(placement.map((cell) => colOf[cell]));
  const ids = new Set(placement.map((cell) => regions[cell]));
  if (rows.size !== size || cols.size !== size || ids.size !== size)
    return false;
  // With one piece per row, only pieces in neighbouring rows can touch.
  const colByRow = new Int8Array(size);
  for (const cell of placement) colByRow[rowOf[cell]] = colOf[cell];
  for (let row = 1; row < size; row += 1)
    if (Math.abs(colByRow[row] - colByRow[row - 1]) <= 1) return false;
  return true;
}

function refreshLegal(position: Position): void {
  const { regions, rowOf, colOf, legal, regionHasPiece, around } = position;
  const rowHas = new Uint8Array(position.size);
  const colHas = new Uint8Array(position.size);
  const touched = new Uint8Array(legal.length);
  regionHasPiece.fill(0);
  for (const piece of position.pieces) {
    rowHas[rowOf[piece]] = 1;
    colHas[colOf[piece]] = 1;
    regionHasPiece[regions[piece]] = 1;
    for (const cell of around[piece]) touched[cell] = 1;
  }
  for (let cell = 0; cell < legal.length; cell += 1) {
    legal[cell] =
      isOpen(position, cell) &&
      !rowHas[rowOf[cell]] &&
      !colHas[colOf[cell]] &&
      !regionHasPiece[regions[cell]] &&
      !touched[cell]
        ? 1
        : 0;
  }
}

/** Priority 0: the lowest piece whose exclusions are not all marked. */
function missingExclusion(
  position: Position,
  exclusionsOf: (piece: number) => readonly number[],
): Found | undefined {
  let lowest = -1;
  let open: readonly number[] = [];
  for (const piece of position.pieces) {
    if (lowest !== -1 && piece >= lowest) continue;
    const cells = exclusionsOf(piece).filter((cell) => isOpen(position, cell));
    if (cells.length === 0) continue;
    lowest = piece;
    open = cells;
  }
  return lowest === -1
    ? undefined
    : { technique: "missing-exclusion", excludeCells: open };
}

/** Priority 1: the lowest cell that is the only candidate of its unit. */
function singleCandidate(position: Position): Found | undefined {
  const { legal } = position;
  let lowest = -1;
  // A unit that already has a piece has no legal cell left.
  for (const units of [
    position.rowCells,
    position.colCells,
    position.regionCells,
  ]) {
    for (const unit of units) {
      let count = 0;
      let last = -1;
      for (const cell of unit) {
        if (!legal[cell]) continue;
        count += 1;
        last = cell;
      }
      if (count === 1 && (lowest === -1 || last < lowest)) lowest = last;
    }
  }
  return lowest === -1
    ? undefined
    : { technique: "single-candidate", excludeCells: [], placeCell: lowest };
}

/**
 * Priority 2: region-line, then line-region by row, then by column. A later
 * move replaces an earlier one only with a strictly lower first focus cell.
 */
function regionOrLineMove(position: Position): Found | undefined {
  const { regions, regionCells, rowOf, colOf, rowCells, colCells, legal } =
    position;
  let lowestFocus = Infinity;
  let found: Found | undefined;
  regionCells.forEach((cells, id) => {
    const candidates = cells.filter((cell) => legal[cell]);
    if (candidates.length === 0 || candidates[0] >= lowestFocus) return;
    const first = candidates[0];
    const open: number[] = [];
    for (const [lineOf, lineCells] of [
      [rowOf, rowCells],
      [colOf, colCells],
    ] as const) {
      if (candidates.some((cell) => lineOf[cell] !== lineOf[first])) continue;
      for (const cell of lineCells[lineOf[first]])
        if (regions[cell] !== id && isOpen(position, cell)) open.push(cell);
    }
    if (open.length === 0) return;
    lowestFocus = first;
    found = { technique: "region-line", excludeCells: open };
  });
  for (const [lineOf, lineCells] of [
    [rowOf, rowCells],
    [colOf, colCells],
  ] as const) {
    lineCells.forEach((cells, line) => {
      const candidates = cells.filter((cell) => legal[cell]);
      if (candidates.length <= 1 || candidates[0] >= lowestFocus) return;
      const id = regions[candidates[0]];
      if (candidates.some((cell) => regions[cell] !== id)) return;
      const open = regionCells[id].filter(
        (cell) => lineOf[cell] !== line && isOpen(position, cell),
      );
      if (open.length === 0) return;
      lowestFocus = candidates[0];
      found = { technique: "line-region", excludeCells: open };
    });
  }
  return found;
}

function popcount(value: number): number {
  let count = 0;
  for (let rest = value; rest; rest &= rest - 1) count += 1;
  return count;
}

/**
 * Priority 3: a group of regions confined to as many rows, or columns, as it
 * has regions. Groups are visited in the order combinations() yields them in
 * logical.ts: by size, then lexicographically.
 */
function multiRegionLine(position: Position): Found | undefined {
  const { size, regions, rowOf, colOf, rowCells, colCells, legal } = position;
  const ids: number[] = [];
  const rowMasks: number[] = [];
  const colMasks: number[] = [];
  const firstCells: number[] = [];
  position.regionCells.forEach((cells, id) => {
    if (position.regionHasPiece[id]) return;
    let rowMask = 0;
    let colMask = 0;
    let first = -1;
    for (const cell of cells) {
      if (!legal[cell]) continue;
      rowMask |= 1 << rowOf[cell];
      colMask |= 1 << colOf[cell];
      if (first === -1) first = cell;
    }
    if (first === -1) return;
    ids.push(id);
    rowMasks.push(rowMask);
    colMasks.push(colMask);
    firstCells.push(first);
  });

  let lowestFocus = Infinity;
  let open: number[] = [];
  const group: number[] = [];
  const visit = (start: number, want: number): void => {
    if (group.length < want) {
      for (let k = start; k <= ids.length - (want - group.length); k += 1) {
        // A group's first focus cell is its first region's first candidate.
        if (group.length === 0 && firstCells[k] >= lowestFocus) continue;
        group.push(k);
        visit(k + 1, want);
        group.pop();
      }
      return;
    }
    const focus = firstCells[group[0]];
    if (focus >= lowestFocus) return;
    let rowMask = 0;
    let colMask = 0;
    let groupMask = 0;
    for (const k of group) {
      rowMask |= rowMasks[k];
      colMask |= colMasks[k];
      groupMask |= 1 << ids[k];
    }
    for (const [mask, lineCells] of [
      [rowMask, rowCells],
      [colMask, colCells],
    ] as const) {
      if (popcount(mask) !== want) continue;
      const outside: number[] = [];
      for (let line = 0; line < size; line += 1) {
        if (!(mask & (1 << line))) continue;
        for (const cell of lineCells[line])
          if (!(groupMask & (1 << regions[cell])) && isOpen(position, cell))
            outside.push(cell);
      }
      if (outside.length === 0) continue;
      lowestFocus = focus;
      open = outside;
      return;
    }
  };
  for (let want = 2; want < ids.length; want += 1) visit(0, want);
  return lowestFocus === Infinity
    ? undefined
    : { technique: "multi-region-line", excludeCells: open };
}

/**
 * Priority 4: the lowest candidate cell that, with a piece on it, would leave
 * another region without candidates.
 */
function regionDepletion(position: Position): Found | undefined {
  const { regions, rowOf, colOf, legal } = position;
  const candidatesOf = position.regionCells.map((cells) =>
    cells.filter((cell) => legal[cell]),
  );
  for (let assumed = 0; assumed < legal.length; assumed += 1) {
    if (!legal[assumed]) continue;
    const row = rowOf[assumed];
    const col = colOf[assumed];
    const depletes = candidatesOf.some(
      (candidates, id) =>
        id !== regions[assumed] &&
        candidates.length > 0 &&
        candidates.every(
          (cell) =>
            rowOf[cell] === row ||
            colOf[cell] === col ||
            (Math.abs(rowOf[cell] - row) <= 1 &&
              Math.abs(colOf[cell] - col) <= 1),
        ),
    );
    if (depletes)
      return { technique: "region-depletion", excludeCells: [assumed] };
  }
  return undefined;
}
