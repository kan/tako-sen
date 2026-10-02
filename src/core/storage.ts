import {
  createInitialPlayerState,
  type PlayerState,
  type Puzzle,
} from "./model";
import type { ResultHistory } from "./results";
import type { SavedPlayTimer } from "./play-timer";
import { BOARD_SIZE, DAILY_BOARD_SIZE } from "./model";
import { validateSolution } from "./rules";
import {
  maximumHintStage,
  validHintProgress,
  type HintStage,
} from "./hint-progress";

const SAVE_KEY = "tako-sen.current-game.v2";
const RESULTS_KEY = "tako-sen.results.v2";
const LEGACY_SAVE_KEY = "tako-sen.current-game.v1";
const LEGACY_RESULTS_KEY = "tako-sen.results.v1";
const DAILY_SAVE_PREFIX = "tako-sen.daily-game.v1";

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
    readonly maxHintStage?: HintStage | null;
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
      maxHintStage: maximumHintStage(state),
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
  let key = SAVE_KEY;
  try {
    raw = storage.getItem(SAVE_KEY);
    if (raw === null) {
      key = LEGACY_SAVE_KEY;
      raw = storage.getItem(key);
    }
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
    backupCorruptValue(storage, key, raw);
    return undefined;
  }
  const loaded = {
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
      maxHintStage: maximumHintStage(saved.state),
    },
  };
  if (key === LEGACY_SAVE_KEY)
    saveGame(loaded.puzzle, loaded.state, storage, loaded.playId, loaded.timer);
  return loaded;
}

function dailyStorage(
  accountId: string,
  date: string,
  storage: KeyValueStorage,
): KeyValueStorage {
  const key = `${DAILY_SAVE_PREFIX}:${accountId}:${date}`;
  return {
    getItem(requestedKey) {
      return requestedKey === SAVE_KEY ? storage.getItem(key) : null;
    },
    setItem(requestedKey, value) {
      if (requestedKey === SAVE_KEY) storage.setItem(key, value);
    },
  };
}

export function saveDailyGame(
  accountId: string,
  date: string,
  puzzle: Puzzle,
  state: PlayerState,
  playId: string,
  timer: SavedPlayTimer,
  storage: KeyValueStorage = localStorage,
): void {
  saveGame(
    puzzle,
    state,
    dailyStorage(accountId, date, storage),
    playId,
    timer,
  );
}

export function loadDailyGame(
  accountId: string,
  date: string,
  storage: KeyValueStorage = localStorage,
): ReturnType<typeof loadGame> {
  return loadGame(dailyStorage(accountId, date, storage));
}

export function loadResultHistory(
  storage: KeyValueStorage = localStorage,
  createId: () => string = () => crypto.randomUUID(),
): ResultHistory {
  let raw: string | null;
  let key = RESULTS_KEY;
  try {
    raw = storage.getItem(RESULTS_KEY);
    if (raw === null) {
      key = LEGACY_RESULTS_KEY;
      raw = storage.getItem(key);
    }
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isResultHistory(parsed)) {
        const history: ResultHistory = {
          ...parsed,
          version: 2,
          plays: parsed.plays.map((play) => ({
            ...play,
            maxHintStage: maximumHintStage(play),
          })),
        };
        if (key === LEGACY_RESULTS_KEY) saveResultHistory(history, storage);
        return history;
      }
    } catch {
      // Broken local data must not prevent offline play.
    }
    backupCorruptValue(storage, key, raw);
  }
  const history: ResultHistory = { version: 2, userId: createId(), plays: [] };
  saveResultHistory(history, storage);
  return history;
}

export function saveResultHistory(
  history: ResultHistory,
  storage: KeyValueStorage = localStorage,
): void {
  try {
    storage.setItem(
      RESULTS_KEY,
      JSON.stringify({
        ...history,
        version: 2,
        plays: history.plays.map((play) => ({
          ...play,
          maxHintStage: maximumHintStage(play),
        })),
      }),
    );
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

function isCellArray(value: unknown, size = BOARD_SIZE): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (cell) => Number.isInteger(cell) && cell >= 0 && cell < size * size,
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
  const size = puzzle.size;
  if (size !== BOARD_SIZE && size !== DAILY_BOARD_SIZE) return false;
  if (
    !Array.isArray(puzzle.regions) ||
    puzzle.regions.length !== size * size ||
    !puzzle.regions.every(
      (id) => Number.isInteger(id) && id >= 0 && id < size,
    ) ||
    !isCellArray(puzzle.solution, size) ||
    (puzzle.givens !== undefined && !isCellArray(puzzle.givens, size)) ||
    typeof puzzle.seed !== "string" ||
    (puzzle.difficulty !== undefined &&
      puzzle.difficulty !== "easy" &&
      puzzle.difficulty !== "normal" &&
      puzzle.difficulty !== "hard") ||
    (puzzle.generatorVersion !== undefined &&
      typeof puzzle.generatorVersion !== "string") ||
    !isCellArray(state.excluded, size) ||
    !isCellArray(state.pieces, size) ||
    !isCellArray(state.fixedErrors, size) ||
    !isNonnegativeInteger(state.mistakes) ||
    !isNonnegativeInteger(state.hintsUsed) ||
    !validHintProgress(state.maxHintStage, Number(state.hintsUsed)) ||
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

export function isResultHistory(value: unknown): value is ResultHistory {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
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
    if (!validHintProgress(play.maxHintStage, Number(play.hintsUsed ?? 0)))
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
