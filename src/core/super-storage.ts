import type { Puzzle, PlayerState } from "./model";
import type { SavedPlayTimer } from "./play-timer";
import type { SuperEntry } from "./super-progress";
import { parseSuperSeed } from "./super-puzzle";
import { loadGame, saveGame, type KeyValueStorage } from "./storage";

export interface SuperSession {
  readonly puzzleId: string;
  readonly seedCode: string;
  readonly entry: SuperEntry;
  readonly cycle: number;
  readonly claimed: boolean;
}
export interface SavedSuperGame {
  readonly session: SuperSession;
  readonly game: NonNullable<ReturnType<typeof loadGame>>;
}
const keyFor = (accountId: string) =>
  `tako-sen.super-game.v1:${encodeURIComponent(accountId)}`;
const gameKey = "tako-sen.current-game.v2";

/** One account's active super trial is isolated from normal and daily saves.
 * Unlike ordinary offline saving, a new super start requires durable storage. */
export function saveSuperGame(
  accountId: string,
  session: SuperSession,
  puzzle: Puzzle,
  state: PlayerState,
  playId: string,
  timer: SavedPlayTimer,
  storage: KeyValueStorage,
): boolean {
  try {
    let raw = "";
    saveGame(
      puzzle,
      state,
      {
        getItem: () => null,
        setItem: (_key, value) => {
          raw = value;
        },
      },
      playId,
      timer,
    );
    const serialized = JSON.stringify({
      version: 1,
      session,
      game: JSON.parse(raw),
    });
    storage.setItem(keyFor(accountId), serialized);
    return storage.getItem(keyFor(accountId)) === serialized;
  } catch {
    return false;
  }
}

export function loadSuperGame(
  accountId: string,
  storage: KeyValueStorage,
): SavedSuperGame | undefined {
  let raw: string | null = null;
  try {
    raw = storage.getItem(keyFor(accountId));
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    const session = value?.session;
    if (
      value?.version !== 1 ||
      !session ||
      typeof session.puzzleId !== "string" ||
      !/^p1:[a-f0-9]{64}$/.test(session.puzzleId) ||
      typeof session.seedCode !== "string" ||
      parseSuperSeed(session.seedCode) === undefined ||
      (session.entry !== "earned" && session.entry !== "shared") ||
      !Number.isSafeInteger(session.cycle) ||
      session.cycle < 0 ||
      typeof session.claimed !== "boolean"
    )
      throw new Error("Invalid super save.");
    const game = loadGame({
      getItem: (key) => (key === gameKey ? JSON.stringify(value.game) : null),
      setItem: () => {},
    });
    if (
      !game ||
      game.puzzle.generatorVersion !== "super-v1" ||
      game.puzzle.size !== 10 ||
      game.puzzle.seed !== parseSuperSeed(session.seedCode) ||
      !game.playId ||
      !/^[0-9a-f-]{36}$/i.test(game.playId) ||
      (game.timer.hasStarted && !session.claimed)
    )
      throw new Error("Invalid super save.");
    return { session, game };
  } catch {
    if (raw) {
      try {
        storage.setItem(`${keyFor(accountId)}.corrupt`, raw);
      } catch {
        /* best effort */
      }
    }
    return undefined;
  }
}
