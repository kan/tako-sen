import { describe, expect, it } from "vitest";
import { createInitialPlayerState, type PlayerState } from "../src/core/model";
import {
  MARK_HISTORY_LIMIT,
  canRedoMarks,
  canUndoMarks,
  recordMarkChange,
  stepMarkHistory,
} from "../src/core/mark-history";
import { parseMarkHistory } from "../src/core/storage";
import {
  addExcludedMarks,
  clearBoardMarks,
  removeExcludedMarks,
  toggleExcluded,
} from "../src/core/player";

const commit = (
  state: PlayerState,
  next: PlayerState,
  group?: number,
): PlayerState => recordMarkChange(state, next, group);

const undoMarks = (state: PlayerState) => stepMarkHistory(state, "undo", 8);
const redoMarks = (state: PlayerState) => stepMarkHistory(state, "redo", 8);

const marks = (state: PlayerState) => [...state.excluded].sort((a, b) => a - b);

describe("mark history", () => {
  it("undoes and redoes × changes one step at a time", () => {
    let state = createInitialPlayerState(0);
    state = commit(state, toggleExcluded(state, 1));
    state = commit(state, toggleExcluded(state, 2));
    expect(marks(state)).toEqual([1, 2]);

    state = undoMarks(state);
    expect(marks(state)).toEqual([1]);
    expect(canRedoMarks(state)).toBe(true);
    state = undoMarks(state);
    expect(marks(state)).toEqual([]);
    expect(canUndoMarks(state)).toBe(false);
    expect(undoMarks(state)).toBe(state);

    state = redoMarks(state);
    state = redoMarks(state);
    expect(marks(state)).toEqual([1, 2]);
    expect(redoMarks(state)).toBe(state);
  });

  it("merges changes from one press into a single step", () => {
    let state = createInitialPlayerState(0);
    state = commit(state, toggleExcluded(state, 9));
    for (const cell of [1, 2, 3])
      state = commit(state, addExcludedMarks(state, [cell]), 7);
    expect(state.history?.undo).toHaveLength(2);
    state = undoMarks(state);
    expect(marks(state)).toEqual([9]);
  });

  it("starts a new step when an operation cancels out its own changes", () => {
    let state = createInitialPlayerState(0);
    state = commit(state, toggleExcluded(state, 1), 1);
    // ダブルタップ: 1 回目で付けた×を 2 回目で外し、ショートカットの×を足す。
    state = commit(state, toggleExcluded(state, 5), 2);
    state = commit(state, toggleExcluded(state, 5), 2);
    expect(state.history?.undo).toHaveLength(1);
    state = commit(state, addExcludedMarks(state, [6]), 2);
    expect(state.history?.undo).toHaveLength(2);
    state = undoMarks(state);
    expect(marks(state)).toEqual([1]);
  });

  it("does not merge into a step after undo, even with the same group", () => {
    let state = createInitialPlayerState(0);
    state = commit(state, toggleExcluded(state, 1), 3);
    state = commit(state, toggleExcluded(state, 2), 4);
    state = undoMarks(state);
    state = commit(state, toggleExcluded(state, 7), 3);
    expect(state.history?.undo).toHaveLength(2);
  });

  it("drops redo after a new change, including a piece placement", () => {
    let state = createInitialPlayerState(0);
    state = commit(state, toggleExcluded(state, 1));
    state = undoMarks(state);
    expect(canRedoMarks(state)).toBe(true);
    state = commit(state, { ...state, pieces: new Set([4]) });
    expect(canRedoMarks(state)).toBe(false);
    expect(canUndoMarks(state)).toBe(false);
  });

  it("never touches pieces, fixed errors, mistakes, hints, or the start time", () => {
    let state: PlayerState = {
      ...createInitialPlayerState(50),
      fixedErrors: new Set([3]),
      mistakes: 1,
      hintsUsed: 2,
    };
    state = commit(state, addExcludedMarks(state, [1]));
    state = commit(state, {
      ...state,
      pieces: new Set([8]),
      fixedErrors: new Set([3, 4]),
      mistakes: 2,
    });
    state = undoMarks(state);
    expect(marks(state)).toEqual([]);
    expect([...state.pieces]).toEqual([8]);
    expect([...state.fixedErrors]).toEqual([3, 4]);
    expect(state.mistakes).toBe(2);
    expect(state.hintsUsed).toBe(2);
    expect(state.startedAt).toBe(50);
  });

  it("restores and re-clears pieces and × removed by a reset", () => {
    let state: PlayerState = {
      ...createInitialPlayerState(0, [0]),
      pieces: new Set([0, 10]),
    };
    state = commit(state, addExcludedMarks(state, [1, 2]));
    state = commit(state, clearBoardMarks(state, [0]));
    expect([...state.pieces]).toEqual([0]);
    expect(marks(state)).toEqual([]);

    // リセット後に、戻すタコのマスへ×を付けていても、タコを優先する。
    state = commit(state, addExcludedMarks(state, [10]));
    state = undoMarks(state);
    state = undoMarks(state);
    expect([...state.pieces].sort((a, b) => a - b)).toEqual([0, 10]);
    expect(marks(state)).toEqual([1, 2]);

    state = redoMarks(state);
    expect([...state.pieces]).toEqual([0]);
    expect(marks(state)).toEqual([]);
  });

  it("does not put a × back on a cell that now holds a piece or a fixed error", () => {
    let state = createInitialPlayerState(0);
    state = commit(state, addExcludedMarks(state, [1, 2]));
    state = commit(state, removeExcludedMarks(state, [1, 2]));
    state = commit(state, {
      ...state,
      pieces: new Set([1]),
      fixedErrors: new Set([2]),
      mistakes: 1,
    });
    // 戻しても盤面が変わらない手は、1 回の押下でまとめて飛ばす。
    state = undoMarks(state);
    expect(marks(state)).toEqual([]);
    expect(canUndoMarks(state)).toBe(false);
  });

  it("skips steps that no longer change the board and stops at one that does", () => {
    let state = createInitialPlayerState(0);
    state = commit(state, toggleExcluded(state, 9));
    state = commit(state, toggleExcluded(state, 5));
    state = commit(state, toggleExcluded(state, 5));
    state = commit(state, { ...state, pieces: new Set([5]) });
    state = undoMarks(state);
    expect(marks(state)).toEqual([]);
    expect(canUndoMarks(state)).toBe(false);
    expect(state.history?.redo).toHaveLength(3);
  });

  it("keeps at most the limit of steps", () => {
    let state = createInitialPlayerState(0);
    for (let cell = 0; cell < MARK_HISTORY_LIMIT + 5; cell++)
      state = commit(state, toggleExcluded(state, cell % 100, 10));
    expect(state.history?.undo).toHaveLength(MARK_HISTORY_LIMIT);
  });

  it("ignores a no-op change", () => {
    const state = createInitialPlayerState(0);
    expect(commit(state, state)).toBe(state);
  });

  it("accepts only well-formed saved history", () => {
    const puzzle = { size: 8 as const, solution: [3, 12] };
    const entry = { added: [1], removed: [], piecesRemoved: [12] };
    expect(parseMarkHistory({ undo: [entry], redo: [] }, puzzle)).toEqual({
      undo: [entry],
      redo: [],
    });
    expect(parseMarkHistory(undefined, puzzle)).toBeUndefined();
    expect(
      parseMarkHistory({ undo: [{ ...entry, added: [64] }], redo: [] }, puzzle),
    ).toBeUndefined();
    // 正解でないマスのタコを undo で置かせない。
    expect(
      parseMarkHistory(
        { undo: [{ ...entry, piecesRemoved: [4] }], redo: [] },
        puzzle,
      ),
    ).toBeUndefined();
    expect(parseMarkHistory({ undo: [entry] }, puzzle)).toBeUndefined();
    expect(
      parseMarkHistory(
        { undo: Array(MARK_HISTORY_LIMIT + 1).fill(entry), redo: [] },
        puzzle,
      ),
    ).toBeUndefined();
  });
});
