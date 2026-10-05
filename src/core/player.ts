import { type PlayerState, type Puzzle, assertCellIndex } from "./model";
import { isCorrectPiece } from "./rules";
import { maximumHintStage, type HintStage } from "./hint-progress";
import { exclusionsFromPiece } from "./shortcuts";

export function toggleExcluded(
  state: PlayerState,
  index: number,
  size = 8,
): PlayerState {
  assertCellIndex(index, size);
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
  puzzle: Pick<Puzzle, "size" | "solution">,
  state: PlayerState,
  index: number,
): PlayerState {
  assertCellIndex(index, puzzle.size);
  if (
    state.pieces.has(index) ||
    state.fixedErrors.has(index) ||
    state.excluded.has(index)
  )
    return state;

  if (isCorrectPiece(puzzle, index)) {
    const pieces = new Set(state.pieces);
    pieces.add(index);
    return { ...state, pieces };
  }

  const fixedErrors = new Set(state.fixedErrors);
  fixedErrors.add(index);
  return { ...state, fixedErrors, mistakes: state.mistakes + 1 };
}

export function addExcludedMarks(
  state: PlayerState,
  indexes: Iterable<number>,
  size = 8,
): PlayerState {
  const excluded = new Set(state.excluded);
  for (const index of indexes) {
    assertCellIndex(index, size);
    if (!state.pieces.has(index) && !state.fixedErrors.has(index))
      excluded.add(index);
  }
  return { ...state, excluded };
}

export function removeExcludedMarks(
  state: PlayerState,
  indexes: Iterable<number>,
  size = 8,
): PlayerState {
  const excluded = new Set(state.excluded);
  for (const index of indexes) {
    assertCellIndex(index, size);
    if (!state.pieces.has(index) && !state.fixedErrors.has(index))
      excluded.delete(index);
  }
  return { ...state, excluded };
}

export function placePieceWithAutoExclusions(
  puzzle: Pick<Puzzle, "size" | "solution" | "regions">,
  state: PlayerState,
  index: number,
  autoExclusionsEnabled: boolean,
): PlayerState {
  const next = placePiece(puzzle, state, index);
  // Only a newly confirmed correct piece triggers the optional shortcut.
  if (!autoExclusionsEnabled || next === state || !next.pieces.has(index))
    return next;
  return addExcludedMarks(
    next,
    exclusionsFromPiece(index, puzzle),
    puzzle.size,
  );
}

export function countHintUsed(state: PlayerState): PlayerState {
  return {
    ...state,
    hintsUsed: state.hintsUsed + 1,
    maxHintStage: state.hintsUsed === 0 ? 1 : maximumHintStage(state),
  };
}

export function recordHintStage(
  state: PlayerState,
  stage: number,
): PlayerState {
  if (
    !Number.isInteger(stage) ||
    stage < 1 ||
    stage > 4 ||
    state.hintsUsed === 0
  )
    throw new Error("Invalid hint stage.");
  // 新たな開示で最大値を下げず、旧記録の不明は維持する。
  const previous = maximumHintStage(state);
  return {
    ...state,
    maxHintStage:
      previous === null ? null : (Math.max(previous, stage) as HintStage),
  };
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
    maxHintStage: 0,
    startedAt: now,
  };
}
