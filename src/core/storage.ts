import {
  createInitialPlayerState,
  type PlayerState,
  type Puzzle,
} from "./model";
import type { ResultHistory } from "./results";

const SAVE_KEY = "tako-sen.current-game.v1";
const RESULTS_KEY = "tako-sen.results.v1";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SavedGame {
  readonly playId?: string;
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
): void {
  const saved: SavedGame = {
    playId,
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
  storage.setItem(SAVE_KEY, JSON.stringify(saved));
}

export function loadGame(
  storage: KeyValueStorage = localStorage,
): { puzzle: Puzzle; state: PlayerState; playId?: string } | undefined {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return undefined;
  const saved = JSON.parse(raw) as SavedGame;
  return {
    playId: saved.playId,
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
  const raw = storage.getItem(RESULTS_KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "version" in parsed &&
        parsed.version === 1 &&
        "userId" in parsed &&
        typeof parsed.userId === "string" &&
        "plays" in parsed &&
        Array.isArray(parsed.plays)
      )
        return parsed as unknown as ResultHistory;
    } catch {
      // Broken local data must not prevent offline play.
    }
  }
  const history: ResultHistory = { version: 1, userId: createId(), plays: [] };
  saveResultHistory(history, storage);
  return history;
}

export function saveResultHistory(
  history: ResultHistory,
  storage: KeyValueStorage = localStorage,
): void {
  storage.setItem(RESULTS_KEY, JSON.stringify(history));
}
