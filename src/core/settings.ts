import type { KeyValueStorage } from "./storage";

const AUTO_EXCLUSIONS_KEY = "tako-sen:auto-exclusions-enabled";

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
