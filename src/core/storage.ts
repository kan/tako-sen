import {
  createInitialPlayerState,
  type PlayerState,
  type Puzzle,
} from "./model";
import type { ResultHistory } from "./results";
import type { SavedPlayTimer } from "./play-timer";
import { BOARD_SIZE, CELL_COUNT } from "./model";
import { validateSolution } from "./rules";

const SAVE_KEY = "tako-sen.current-game.v1";
const RESULTS_KEY = "tako-sen.results.v1";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SavedGame {
  readonly playId?: string;
  readonly waitingToStart?: boolean;
  readonly elapsedMs?: number;
  readonly hasStarted?: boolean;
  readonly puzzle: Puzzle;
  readonly state: {
    readonly excluded: readonly number[];
    readonly pieces: readonly number[];
    readonly fixedErrors: readonly number[];
    readonly mistakes: number;
    readonly hintsUsed: number;
    readonly startedAt: number;
  };
}

export function saveGame(
  puzzle: Puzzle,
  state: PlayerState,
  storage: KeyValueStorage = localStorage,
  playId?: string,
  timer?: SavedPlayTimer,
): void {
  const saved: SavedGame = {
    playId,
    waitingToStart: timer?.waitingToStart,
    elapsedMs: timer?.elapsedMs,
    hasStarted: timer?.hasStarted,
    puzzle,
    state: {
      excluded: [...state.excluded],
      pieces: [...state.pieces],
      fixedErrors: [...state.fixedErrors],
      mistakes: state.mistakes,
      hintsUsed: state.hintsUsed,
      startedAt: state.startedAt,
    },
  };
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(saved));
  } catch {
    // Storage may be unavailable or full; play must remain possible.
  }
}

export function loadGame(storage: KeyValueStorage = localStorage):
  | {
      puzzle: Puzzle;
      state: PlayerState;
      playId?: string;
      timer: SavedPlayTimer;
    }
  | undefined {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  let saved: SavedGame;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isSavedGame(parsed)) throw new Error("Invalid saved game");
    saved = parsed;
  } catch {
    backupCorruptValue(storage, SAVE_KEY, raw);
    return undefined;
  }
  return {
    playId: saved.playId,
    timer: {
      waitingToStart: saved.waitingToStart ?? false,
      elapsedMs: saved.elapsedMs,
      hasStarted: saved.hasStarted,
    },
    puzzle: saved.puzzle,
    state: {
      ...createInitialPlayerState(saved.state.startedAt),
      excluded: new Set(saved.state.excluded),
      pieces: new Set([...(saved.puzzle.givens ?? []), ...saved.state.pieces]),
      fixedErrors: new Set(saved.state.fixedErrors),
      mistakes: saved.state.mistakes,
      hintsUsed: saved.state.hintsUsed,
    },
  };
}

export function loadResultHistory(
  storage: KeyValueStorage = localStorage,
  createId: () => string = () => crypto.randomUUID(),
): ResultHistory {
  let raw: string | null;
  try {
    raw = storage.getItem(RESULTS_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isResultHistory(parsed)) return parsed;
    } catch {
      // Broken local data must not prevent offline play.
    }
    backupCorruptValue(storage, RESULTS_KEY, raw);
  }
  const history: ResultHistory = { version: 1, userId: createId(), plays: [] };
  saveResultHistory(history, storage);
  return history;
}

export function saveResultHistory(
  history: ResultHistory,
  storage: KeyValueStorage = localStorage,
): void {
  try {
    storage.setItem(RESULTS_KEY, JSON.stringify(history));
  } catch {
    // Storage may be unavailable or full; play must remain possible.
  }
}

function backupCorruptValue(
  storage: KeyValueStorage,
  key: string,
  raw: string,
): void {
  try {
    storage.setItem(`${key}.corrupt`, raw);
  } catch {
    // Best effort only; an unavailable store cannot hold a backup.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCellArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (cell) => Number.isInteger(cell) && cell >= 0 && cell < CELL_COUNT,
    )
  );
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return isNonnegativeNumber(value) && Number.isInteger(value);
}

function isSavedGame(value: unknown): value is SavedGame {
  if (!isRecord(value) || !isRecord(value.puzzle) || !isRecord(value.state))
    return false;
  const puzzle = value.puzzle;
  const state = value.state;
  if (
    puzzle.size !== BOARD_SIZE ||
    !Array.isArray(puzzle.regions) ||
    puzzle.regions.length !== CELL_COUNT ||
    !puzzle.regions.every(
      (id) => Number.isInteger(id) && id >= 0 && id < BOARD_SIZE,
    ) ||
    !isCellArray(puzzle.solution) ||
    (puzzle.givens !== undefined && !isCellArray(puzzle.givens)) ||
    typeof puzzle.seed !== "string" ||
    (puzzle.difficulty !== undefined &&
      puzzle.difficulty !== "easy" &&
      puzzle.difficulty !== "normal" &&
      puzzle.difficulty !== "hard") ||
    (puzzle.generatorVersion !== undefined &&
      typeof puzzle.generatorVersion !== "string") ||
    !isCellArray(state.excluded) ||
    !isCellArray(state.pieces) ||
    !isCellArray(state.fixedErrors) ||
    !isNonnegativeInteger(state.mistakes) ||
    !isNonnegativeInteger(state.hintsUsed) ||
    !isNonnegativeNumber(state.startedAt) ||
    (value.playId !== undefined && typeof value.playId !== "string") ||
    (value.waitingToStart !== undefined &&
      typeof value.waitingToStart !== "boolean") ||
    (value.hasStarted !== undefined && typeof value.hasStarted !== "boolean") ||
    (value.elapsedMs !== undefined && !isNonnegativeNumber(value.elapsedMs))
  )
    return false;
  return validateSolution(puzzle as unknown as Puzzle).valid;
}

function isResultHistory(value: unknown): value is ResultHistory {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.userId !== "string" ||
    value.userId.length === 0 ||
    !Array.isArray(value.plays)
  )
    return false;
  const ids = new Set<string>();
  for (const play of value.plays) {
    if (
      !isRecord(play) ||
      typeof play.id !== "string" ||
      play.id.length === 0 ||
      ids.has(play.id) ||
      play.userId !== value.userId ||
      typeof play.seedCode !== "string" ||
      play.seedCode.length === 0 ||
      typeof play.generatorVersion !== "string" ||
      (play.difficulty !== "easy" &&
        play.difficulty !== "normal" &&
        play.difficulty !== "hard") ||
      !isNonnegativeNumber(play.startedAt) ||
      (play.status !== "in-progress" && play.status !== "completed")
    )
      return false;
    if (
      play.status === "completed" &&
      (!isNonnegativeNumber(play.completedAt) ||
        !isNonnegativeInteger(play.elapsedSeconds) ||
        !isNonnegativeInteger(play.mistakes) ||
        !isNonnegativeInteger(play.hintsUsed))
    )
      return false;
    ids.add(play.id);
  }
  return true;
}
