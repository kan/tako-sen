import type { DifficultySelection } from "./next-puzzle";
import {
  AUTO_EXCLUSIONS_KEY,
  DIFFICULTY_SELECTION_KEY,
  HAPTICS_ENABLED_KEY,
  SOUND_ENABLED_KEY,
  saveAutoExclusionsEnabled,
  saveDifficultySelection,
  saveHapticsEnabled,
  saveSoundEnabled,
} from "./settings";
import { TUTORIAL_KEY, rememberTutorial } from "./tutorial";
import type { KeyValueStorage } from "./storage";

/**
 * What the old URL (tako-sen.kan-fushihara.workers.dev, the legacy-clerk
 * branch) hands to the new one when it sends a player over: a migration token
 * for the player's old records, and the settings kept on that origin. It goes
 * in the URL fragment, which never reaches a server, a log or a referrer
 * (docs/NEXT_PHASE.md「既存の記録の移行」, docs/DATA_CONTRACT.md):
 *
 *   #migration=<token>&auto=1&difficulty=hard&sound=1&haptics=0&tutorial=seen
 *
 * Every part is optional; one that does not parse is ignored.
 */
export interface Handoff {
  /** 32 random bytes in base64url (kan/game src/migration.ts). */
  readonly migrationToken?: string;
  readonly settings: HandoffSettings;
}

export interface HandoffSettings {
  readonly autoExclusions?: boolean;
  readonly difficulty?: DifficultySelection;
  readonly sound?: boolean;
  readonly haptics?: boolean;
  readonly tutorialSeen?: boolean;
}

const MIGRATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DIFFICULTIES: readonly string[] = ["easy", "normal", "hard", "random"];

function flag(value: string | null): boolean | undefined {
  return value === "1" ? true : value === "0" ? false : undefined;
}

const HANDOFF_KEYS = [
  "migration",
  "auto",
  "difficulty",
  "sound",
  "haptics",
  "tutorial",
];

/**
 * The handoff in a URL fragment ("#..."), or undefined if the fragment is not
 * one. A fragment naming any handoff part is one, even if nothing in it
 * parses, so the caller still clears a damaged token from the address.
 */
export function parseHandoff(fragment: string): Handoff | undefined {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  if (!HANDOFF_KEYS.some((key) => params.has(key))) return undefined;
  const token = params.get("migration");
  const difficulty = params.get("difficulty");
  return {
    migrationToken:
      token !== null && MIGRATION_TOKEN.test(token) ? token : undefined,
    settings: {
      autoExclusions: flag(params.get("auto")),
      difficulty:
        difficulty !== null && DIFFICULTIES.includes(difficulty)
          ? (difficulty as DifficultySelection)
          : undefined,
      sound: flag(params.get("sound")),
      haptics: flag(params.get("haptics")),
      tutorialSeen: params.get("tutorial") === "seen" ? true : undefined,
    },
  };
}

/**
 * Stores the handed-over settings with the usual save functions, each only
 * where this device has none yet: a setting already chosen on the new URL
 * wins. A setting that cannot be kept is simply not handed over.
 */
export function applyHandoffSettings(
  storage: KeyValueStorage,
  settings: HandoffSettings,
): void {
  const unset = (key: string) => {
    try {
      return storage.getItem(key) === null;
    } catch {
      return false;
    }
  };
  const { autoExclusions, difficulty, sound, haptics, tutorialSeen } = settings;
  if (autoExclusions !== undefined && unset(AUTO_EXCLUSIONS_KEY))
    saveAutoExclusionsEnabled(storage, autoExclusions);
  if (difficulty !== undefined && unset(DIFFICULTY_SELECTION_KEY))
    saveDifficultySelection(storage, difficulty);
  if (sound !== undefined && unset(SOUND_ENABLED_KEY))
    saveSoundEnabled(storage, sound);
  if (haptics !== undefined && unset(HAPTICS_ENABLED_KEY))
    saveHapticsEnabled(storage, haptics);
  if (tutorialSeen && unset(TUTORIAL_KEY)) rememberTutorial(storage);
}
