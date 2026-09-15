import {
  createInitialPlayerState,
  type PlayerState,
  type Puzzle,
} from "./model";

const SAVE_KEY = "tako-sen.current-game.v1";

interface SavedGame {
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
  storage: Storage = localStorage,
): void {
  const saved: SavedGame = {
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
  storage: Storage = localStorage,
): { puzzle: Puzzle; state: PlayerState } | undefined {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return undefined;
  const saved = JSON.parse(raw) as SavedGame;
  return {
    puzzle: saved.puzzle,
    state: {
      ...createInitialPlayerState(saved.state.startedAt),
      excluded: new Set(saved.state.excluded),
      pieces: new Set(saved.state.pieces),
      fixedErrors: new Set(saved.state.fixedErrors),
      mistakes: saved.state.mistakes,
      hintsUsed: saved.state.hintsUsed,
    },
  };
}
