import type { KeyValueStorage } from "./storage";
import type { DifficultySelection } from "./next-puzzle";

const AUTO_EXCLUSIONS_KEY = "tako-sen:auto-exclusions-enabled";
const DIFFICULTY_SELECTION_KEY = "tako-sen:difficulty-selection";

export function loadDifficultySelection(
  storage: KeyValueStorage,
  fallback: DifficultySelection = "easy",
): DifficultySelection {
  try {
    const value = storage.getItem(DIFFICULTY_SELECTION_KEY);
    if (
      value === "easy" ||
      value === "normal" ||
      value === "hard" ||
      value === "random"
    )
      return value;
  } catch {
    // Reading settings must not prevent restoring a playable board.
  }
  return fallback;
}

export function saveDifficultySelection(
  storage: KeyValueStorage,
  selection: DifficultySelection,
): boolean {
  try {
    storage.setItem(DIFFICULTY_SELECTION_KEY, selection);
    return true;
  } catch {
    return false;
  }
}

export function loadAutoExclusionsEnabled(storage: KeyValueStorage): boolean {
  try {
    return storage.getItem(AUTO_EXCLUSIONS_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAutoExclusionsEnabled(
  storage: KeyValueStorage,
  enabled: boolean,
): boolean {
  try {
    storage.setItem(AUTO_EXCLUSIONS_KEY, enabled ? "1" : "0");
    return true;
  } catch {
    // Keep the in-memory preference usable even when persistence is unavailable.
    return false;
  }
}
