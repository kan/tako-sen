import {
  BOARD_SIZE,
  allCells,
  cellCoord,
  cellIndex,
  isAdjacent,
  regionCells,
  type PlayerState,
  type Puzzle,
} from "./model";

export function exclusionsFromPiece(index: number): number[] {
  const { row, col } = cellCoord(index);
  const result = new Set<number>();

  for (let c = 0; c < BOARD_SIZE; c += 1) result.add(cellIndex(row, c));
  for (let r = 0; r < BOARD_SIZE; r += 1) result.add(cellIndex(r, col));

  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
        result.add(cellIndex(nr, nc));
      }
    }
  }

  result.delete(index);
  return [...result];
}

export function regionLineExclusions(
  puzzle: Pick<Puzzle, "regions">,
  state: PlayerState,
  regionId: number,
): number[] {
  const candidates = regionCells(puzzle, regionId).filter(
    (index) => isCandidateAvailable(puzzle, state, index),
  );
  if (candidates.length === 0) return [];

  const rows = new Set(candidates.map((index) => cellCoord(index).row));
  const columns = new Set(candidates.map((index) => cellCoord(index).col));
  const exclusions = new Set<number>();

  if (rows.size === 1) {
    const row = [...rows][0];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const index = cellIndex(row, col);
      if (puzzle.regions[index] !== regionId) exclusions.add(index);
    }
  }

  if (columns.size === 1) {
    const col = [...columns][0];
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      const index = cellIndex(row, col);
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

export function candidateCells(state: PlayerState): number[] {
  return allCells().filter((index) => !isBlocked(state, index));
}

function isCandidateAvailable(
  puzzle: Pick<Puzzle, "regions">,
  state: PlayerState,
  index: number,
): boolean {
  if (isBlocked(state, index)) return false;
  const { row, col } = cellCoord(index);
  const regionId = puzzle.regions[index];

  for (const piece of state.pieces) {
    const pieceCoord = cellCoord(piece);
    if (pieceCoord.row === row) return false;
    if (pieceCoord.col === col) return false;
    if (puzzle.regions[piece] === regionId) return false;
    if (isAdjacent(piece, index)) return false;
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
