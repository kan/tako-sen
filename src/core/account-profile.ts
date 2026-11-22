/**
 * The player's name and consent to publish. The name is kan-game.app-wide, and
 * so are its rules (kan-game/name-rules), so a name taken in one game fits
 * another.
 */
import { normalizeName } from "kan-game/name-rules";
import type { KeyValueStorage } from "./storage";

export const RANKING_CONSENT_VERSION = 1;

export interface AccountProfile {
  readonly displayName: string;
  readonly consentVersion: number;
}

/** Cached consent only enables offline queueing, never server-side authorization. */
export function loadCachedProfile(
  accountId: string,
  storage: KeyValueStorage,
): AccountProfile | null {
  try {
    const raw = storage.getItem(`tako-sen.account-profile.v1:${accountId}`);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value &&
      value.consentVersion === RANKING_CONSENT_VERSION &&
      typeof value.displayName === "string" &&
      normalizeName(value.displayName) === value.displayName
      ? { displayName: value.displayName, consentVersion: value.consentVersion }
      : null;
  } catch {
    return null;
  }
}

export function saveCachedProfile(
  accountId: string,
  profile: AccountProfile | null,
  storage: KeyValueStorage,
): void {
  try {
    storage.setItem(
      `tako-sen.account-profile.v1:${accountId}`,
      JSON.stringify(profile),
    );
  } catch {
    /* Offline play must not depend on storage availability. */
  }
}
