import { type PlayerState, type Puzzle, assertCellIndex } from "./model";
import { isCorrectPiece } from "./rules";

export function toggleExcluded(state: PlayerState, index: number): PlayerState {
  assertCellIndex(index);
  if (state.pieces.has(index) || state.fixedErrors.has(index)) return state;

  const excluded = new Set(state.excluded);
  if (excluded.has(index)) {
    excluded.delete(index);
  } else {
    excluded.add(index);
  }

  return { ...state, excluded };
}

export function placePiece(
  puzzle: Pick<Puzzle, "solution">,
  state: PlayerState,
  index: number,
): PlayerState {
  assertCellIndex(index);
  if (state.pieces.has(index) || state.fixedErrors.has(index)) return state;

  const excluded = new Set(state.excluded);
  excluded.delete(index);

  if (isCorrectPiece(puzzle, index)) {
    const pieces = new Set(state.pieces);
    pieces.add(index);
    return { ...state, excluded, pieces };
  }

  const fixedErrors = new Set(state.fixedErrors);
  fixedErrors.add(index);
  return { ...state, excluded, fixedErrors, mistakes: state.mistakes + 1 };
}

export function addExcludedMarks(
  state: PlayerState,
  indexes: Iterable<number>,
): PlayerState {
  const excluded = new Set(state.excluded);
  for (const index of indexes) {
    assertCellIndex(index);
    if (!state.pieces.has(index) && !state.fixedErrors.has(index))
      excluded.add(index);
  }
  return { ...state, excluded };
}

export function countHintUsed(state: PlayerState): PlayerState {
  return { ...state, hintsUsed: state.hintsUsed + 1 };
}

export function resetPlayerProgress(
  state: PlayerState,
  now = Date.now(),
  pieces: Iterable<number> = [],
): PlayerState {
  return {
    ...state,
    excluded: new Set(),
    pieces: new Set(pieces),
    fixedErrors: new Set(),
    mistakes: 0,
    hintsUsed: 0,
    startedAt: now,
  };
}
