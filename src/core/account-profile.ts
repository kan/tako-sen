import type { KeyValueStorage } from "./storage";

export const RANKING_CONSENT_VERSION = 1;

export interface AccountProfile {
  readonly displayName: string;
  readonly consentVersion: number;
}

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const emojiPattern =
  /^(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?)*)$/u;

export function gameNameParts(
  name: string,
): readonly { text: string; emoji: boolean }[] {
  return [...segmenter.segment(name)].map(({ segment }) => ({
    text: segment,
    emoji: emojiPattern.test(segment),
  }));
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
      validateGameName(value.displayName) === value.displayName
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

/** Names are plain text, never authentication identifiers or HTML. */
export function validateGameName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.normalize("NFC").trim();
  if (name.length > 256) return undefined;
  const parts = gameNameParts(name);
  if (
    parts.length < 2 ||
    parts.length > 20 ||
    !parts.every(
      (part) =>
        part.emoji ||
        (/^[\p{L}\p{N}\p{M} _-]+$/u.test(part.text) &&
          !/[\uFE0E\uFE0F]/u.test(part.text)),
    )
  )
    return undefined;
  return name;
}
