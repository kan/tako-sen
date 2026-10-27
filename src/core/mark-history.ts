import type { PlayerState } from "./model";
import { addExcludedMarks, removeExcludedMarks } from "./player";
import { playerMarksChanged } from "./results";

/**
 * undo / redo の 1 手。×の付け外しと、リセットで消したタコだけを記録する。
 * タコの配置・固定エラー・ミス・ヒント・計時は記録せず、戻さない。
 */
export interface MarkHistoryEntry {
  /** この手で付けた×。 */
  readonly added: readonly number[];
  /** この手で外した×。 */
  readonly removed: readonly number[];
  /** この手で消した正解のタコ（リセットのみ）。 */
  readonly piecesRemoved: readonly number[];
}

export interface MarkHistory {
  readonly undo: readonly MarkHistoryEntry[];
  readonly redo: readonly MarkHistoryEntry[];
  /**
   * 最後の手を記録中の操作の番号。同じ番号の続く変化はその手へまとめる。
   * 画面を開いている間だけの値なので保存しない。
   */
  readonly openGroup?: number;
}

/** 戻せる手数の上限。超えた分は古い手から捨てる。 */
export const MARK_HISTORY_LIMIT = 200;

const EMPTY_MARK_HISTORY: MarkHistory = { undo: [], redo: [] };

function historyOf(state: PlayerState): MarkHistory {
  return state.history ?? EMPTY_MARK_HISTORY;
}

function diffEntry(
  previous: PlayerState,
  next: PlayerState,
): MarkHistoryEntry | undefined {
  const added = [...next.excluded].filter((i) => !previous.excluded.has(i));
  const removed = [...previous.excluded].filter((i) => !next.excluded.has(i));
  const piecesRemoved = [...previous.pieces].filter((i) => !next.pieces.has(i));
  if (added.length + removed.length + piecesRemoved.length === 0)
    return undefined;
  return { added, removed, piecesRemoved };
}

/** 2 つの手を 1 手にまとめる。打ち消し合って何も残らなければ undefined。 */
function mergeEntries(
  first: MarkHistoryEntry,
  second: MarkHistoryEntry,
): MarkHistoryEntry | undefined {
  const added = new Set(first.added);
  const removed = new Set(first.removed);
  for (const cell of second.added) {
    if (!removed.delete(cell)) added.add(cell);
  }
  for (const cell of second.removed) {
    if (!added.delete(cell)) removed.add(cell);
  }
  const piecesRemoved = new Set([
    ...first.piecesRemoved,
    ...second.piecesRemoved,
  ]);
  if (added.size + removed.size + piecesRemoved.size === 0) return undefined;
  return {
    added: [...added],
    removed: [...removed],
    piecesRemoved: [...piecesRemoved],
  };
}

/**
 * プレイヤーの操作で previous から next へ変わったことを next の履歴に記録する。
 * group が直前の手と同じなら、その手へまとめる（1 回のドラッグ、ダブルタップ）。
 * 盤面が変われば redo は捨てる（タコの配置のように記録しない変化でも捨てる）。
 */
export function recordMarkChange(
  previous: PlayerState,
  next: PlayerState,
  group?: number,
): PlayerState {
  if (!playerMarksChanged(previous, next)) return next;
  const history = historyOf(previous);
  const entry = diffEntry(previous, next);
  if (!entry) return { ...next, history: { ...history, redo: [] } };
  const last = history.undo.at(-1);
  const merging =
    group !== undefined && history.openGroup === group && last !== undefined;
  const top = merging ? mergeEntries(last, entry) : entry;
  const base = merging ? history.undo.slice(0, -1) : history.undo;
  return {
    ...next,
    history: {
      undo: (top ? [...base, top] : base).slice(-MARK_HISTORY_LIMIT),
      redo: [],
      // 打ち消し合って手が消えたら、次の変化は新しい手として積む。
      openGroup: top ? group : undefined,
    },
  };
}

export function canUndoMarks(state: PlayerState): boolean {
  return historyOf(state).undo.length > 0;
}

export function canRedoMarks(state: PlayerState): boolean {
  return historyOf(state).redo.length > 0;
}

function applyEntry(
  state: PlayerState,
  entry: MarkHistoryEntry,
  undoing: boolean,
  size: number,
): PlayerState {
  const pieces = new Set(state.pieces);
  // リセットで消したタコは正解なので、戻しても成績に影響しない。
  for (const cell of entry.piecesRemoved) {
    if (!undoing) pieces.delete(cell);
    else if (!state.fixedErrors.has(cell)) pieces.add(cell);
  }
  // 戻したタコのマスの×は外す（タコのマスは removeExcludedMarks の対象外）。
  const excluded = new Set(
    [...state.excluded].filter((cell) => !pieces.has(cell)),
  );
  let next: PlayerState = { ...state, pieces, excluded };
  next = removeExcludedMarks(next, undoing ? entry.added : entry.removed, size);
  return addExcludedMarks(next, undoing ? entry.removed : entry.added, size);
}

/**
 * undo なら直前の 1 手を戻し、redo なら戻した 1 手をやり直す。
 * その後に置いたタコや固定エラーのせいで盤面が変わらない手は飛ばし、
 * 盤面が変わる手まで進める。対象の手がなければ同じ state を返す。
 */
export function stepMarkHistory(
  state: PlayerState,
  direction: "undo" | "redo",
  size: number,
): PlayerState {
  const history = historyOf(state);
  const undoing = direction === "undo";
  const from = [...(undoing ? history.undo : history.redo)];
  const to = [...(undoing ? history.redo : history.undo)];
  let next = state;
  while (next === state || !playerMarksChanged(state, next)) {
    const entry = from.pop();
    if (!entry) break;
    to.push(entry);
    next = applyEntry(state, entry, undoing, size);
  }
  if (to.length === (undoing ? history.redo : history.undo).length)
    return state;
  return {
    ...next,
    history: undoing ? { undo: from, redo: to } : { undo: to, redo: from },
  };
}
