import {
  allCells,
  cellCoord,
  cellIndex,
  isAdjacent,
  regionCells,
  type PlayerState,
  type Puzzle,
} from "./model";

export function exclusionsFromPiece(
  index: number,
  puzzle: Pick<Puzzle, "size" | "regions">,
): number[] {
  const { row, col } = cellCoord(index, puzzle.size);
  const result = new Set<number>();

  for (let c = 0; c < puzzle.size; c += 1)
    result.add(cellIndex(row, c, puzzle.size));
  for (let r = 0; r < puzzle.size; r += 1)
    result.add(cellIndex(r, col, puzzle.size));

  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < puzzle.size && nc >= 0 && nc < puzzle.size) {
        result.add(cellIndex(nr, nc, puzzle.size));
      }
    }
  }

  for (const regionCell of regionCells(puzzle, puzzle.regions[index])) {
    result.add(regionCell);
  }

  result.delete(index);
  return [...result];
}

export function shortcutExclusionsForCell(
  puzzle: Pick<Puzzle, "size" | "regions">,
  state: Pick<PlayerState, "pieces">,
  index: number,
): number[] {
  if (!state.pieces.has(index)) return [];
  return exclusionsFromPiece(index, puzzle);
}

export function regionLineExclusions(
  puzzle: Pick<Puzzle, "size" | "regions">,
  state: PlayerState,
  regionId: number,
): number[] {
  const candidates = regionCells(puzzle, regionId).filter((index) =>
    isCandidateAvailable(puzzle, state, index),
  );
  if (candidates.length === 0) return [];

  const rows = new Set(
    candidates.map((index) => cellCoord(index, puzzle.size).row),
  );
  const columns = new Set(
    candidates.map((index) => cellCoord(index, puzzle.size).col),
  );
  const exclusions = new Set<number>();

  if (rows.size === 1) {
    const row = [...rows][0];
    for (let col = 0; col < puzzle.size; col += 1) {
      const index = cellIndex(row, col, puzzle.size);
      if (puzzle.regions[index] !== regionId) exclusions.add(index);
    }
  }

  if (columns.size === 1) {
    const col = [...columns][0];
    for (let row = 0; row < puzzle.size; row += 1) {
      const index = cellIndex(row, col, puzzle.size);
      if (puzzle.regions[index] !== regionId) exclusions.add(index);
    }
  }

  return [...exclusions].filter(
    (index) =>
      !state.excluded.has(index) &&
      !state.pieces.has(index) &&
      !state.fixedErrors.has(index),
  );
}

export function candidateCells(state: PlayerState, size = 8): number[] {
  return allCells(size).filter((index) => !isBlocked(state, index));
}

function isCandidateAvailable(
  puzzle: Pick<Puzzle, "size" | "regions">,
  state: PlayerState,
  index: number,
): boolean {
  if (isBlocked(state, index)) return false;
  const { row, col } = cellCoord(index, puzzle.size);
  const regionId = puzzle.regions[index];

  for (const piece of state.pieces) {
    const pieceCoord = cellCoord(piece, puzzle.size);
    if (pieceCoord.row === row) return false;
    if (pieceCoord.col === col) return false;
    if (puzzle.regions[piece] === regionId) return false;
    if (isAdjacent(piece, index, puzzle.size)) return false;
  }

  return true;
}

function isBlocked(state: PlayerState, index: number): boolean {
  return (
    state.excluded.has(index) ||
    state.pieces.has(index) ||
    state.fixedErrors.has(index)
  );
}
