import {
  AUTO_EXCLUSIONS_KEY,
  DIFFICULTY_SELECTION_KEY,
  HAPTICS_ENABLED_KEY,
  SOUND_ENABLED_KEY,
  isDifficultySelection,
} from "./settings";
import type { KeyValueStorage } from "./storage";
import { TUTORIAL_KEY } from "./tutorial";

/**
 * The address that takes a player from the old URL to kan-game.app. It keeps
 * the path and query, so a shared link or a seed URL opens the same puzzle
 * there, and carries in the fragment what the new URL takes over (main's
 * src/core/handoff.ts reads it):
 *
 *   #migration=<token>&auto=1&difficulty=hard&sound=1&haptics=0&tutorial=seen
 *
 * The fragment never reaches a server, a log or a referrer. Only settings the
 * player has chosen on this device are passed, so the new URL's defaults
 * apply to the rest.
 */
export function handoffUrl(
  target: string,
  location: { readonly pathname: string; readonly search: string },
  storage: KeyValueStorage,
  migrationToken?: string,
): string {
  const params = new URLSearchParams();
  if (migrationToken) params.set("migration", migrationToken);
  const read = (key: string) => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  const flag = (name: string, key: string) => {
    const value = read(key);
    if (value === "1" || value === "0") params.set(name, value);
  };
  flag("auto", AUTO_EXCLUSIONS_KEY);
  const difficulty = read(DIFFICULTY_SELECTION_KEY);
  if (isDifficultySelection(difficulty)) params.set("difficulty", difficulty);
  flag("sound", SOUND_ENABLED_KEY);
  flag("haptics", HAPTICS_ENABLED_KEY);
  if (read(TUTORIAL_KEY) === "seen") params.set("tutorial", "seen");
  const fragment = params.toString();
  return `${target}${location.pathname}${location.search}${fragment ? `#${fragment}` : ""}`;
}
