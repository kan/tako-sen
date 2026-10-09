import type { KeyValueStorage } from "./storage";
import { parsePuzzleSeedCode } from "./puzzle-code";
import { parseSuperSeed } from "./super-puzzle";
import { validHintProgress, type HintStage } from "./hint-progress";

export interface SuperPlayEvent {
  readonly playId: string;
  readonly cycle: number;
  readonly seedCode: string;
}
export interface SuperCompletion {
  readonly playId: string;
  readonly puzzleId: string;
  readonly pieces: readonly number[];
  readonly elapsedSeconds: number;
  readonly mistakes: number;
  readonly hintsUsed: number;
  readonly maxHintStage: HintStage | null;
}
export type SuperPending =
  | { readonly kind: "event"; readonly body: SuperPlayEvent }
  | { readonly kind: "complete"; readonly body: SuperCompletion }
  | { readonly kind: "defer"; readonly body: { readonly cycle: number } };
export interface SuperQueueStorage extends KeyValueStorage {
  keys(): readonly string[];
}
const prefix = "tako-sen.super-outbox.v1:";
function itemKey(accountId: string, item: SuperPending): string {
  const id = item.kind === "defer" ? String(item.body.cycle) : item.body.playId;
  return `${prefix}${encodeURIComponent(accountId)}:${item.kind}:${id}`;
}
function valid(item: SuperPending): boolean {
  const data = item?.body;
  if (!data || typeof data !== "object") return false;
  if (item.kind === "defer")
    return Number.isSafeInteger(item.body.cycle) && item.body.cycle >= 0;
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      item.body.playId,
    )
  )
    return false;
  if (item.kind === "event")
    return (
      Number.isSafeInteger(item.body.cycle) &&
      item.body.cycle >= 0 &&
      typeof item.body.seedCode === "string" &&
      item.body.seedCode.length <= 256 &&
      !!parsePuzzleSeedCode(item.body.seedCode)
    );
  if (item.kind !== "complete") return false;
  const completion = item.body;
  return (
    /^p1:[a-f0-9]{64}$/.test(completion.puzzleId) &&
    Array.isArray(completion.pieces) &&
    completion.pieces.length === 10 &&
    new Set(completion.pieces).size === 10 &&
    completion.pieces.every(
      (cell) => Number.isInteger(cell) && cell >= 0 && cell < 100,
    ) &&
    [
      completion.elapsedSeconds,
      completion.mistakes,
      completion.hintsUsed,
    ].every((n) => Number.isSafeInteger(n) && n >= 0) &&
    validHintProgress(completion.maxHintStage, completion.hintsUsed)
  );
}

/** A separate key per trial avoids read/modify/write loss between tabs.
 * Acknowledged records remain as tombstones to prevent recapture after reload.
 * Enumeration is explicit so the core never refers to browser globals. */
export class SuperOutbox {
  private running = false;
  constructor(private readonly storage: SuperQueueStorage) {}
  completedRecords(accountId: string): readonly {
    completion: SuperCompletion;
    capturedAt: number;
    seedCode: string;
  }[] {
    const records: {
      completion: SuperCompletion;
      capturedAt: number;
      seedCode: string;
    }[] = [];
    try {
      const accountPrefix = `${prefix}${encodeURIComponent(accountId)}:complete:`;
      for (const key of this.storage
        .keys()
        .filter(
          (key) => key.startsWith(accountPrefix) && !key.endsWith(".corrupt"),
        )) {
        try {
          const value = JSON.parse(this.storage.getItem(key) ?? "null");
          if (
            value?.version === 1 &&
            value.accountId === accountId &&
            typeof value.acknowledged === "boolean" &&
            value.item?.kind === "complete" &&
            valid(value.item) &&
            typeof value.seedCode === "string" &&
            parseSuperSeed(value.seedCode) !== undefined &&
            itemKey(accountId, value.item) === key
          )
            records.push({
              completion: value.item.body,
              seedCode: value.seedCode,
              capturedAt:
                Number.isSafeInteger(value.capturedAt) && value.capturedAt >= 0
                  ? value.capturedAt
                  : 0,
            });
        } catch {
          /* Invalid queue entries never become history. */
        }
      }
    } catch {
      /* Unavailable storage. */
    }
    return records;
  }
  isDeferred(accountId: string, cycle: number): boolean {
    try {
      const item: SuperPending = { kind: "defer", body: { cycle } };
      const value = JSON.parse(
        this.storage.getItem(itemKey(accountId, item)) ?? "null",
      );
      return (
        value?.version === 1 &&
        value.accountId === accountId &&
        value.item?.kind === "defer" &&
        valid(value.item) &&
        value.item.body.cycle === cycle
      );
    } catch {
      return false;
    }
  }
  completedIds(accountId: string): ReadonlySet<string> {
    const ids = new Set<string>();
    try {
      const accountPrefix = `${prefix}${encodeURIComponent(accountId)}:complete:`;
      for (const key of this.storage
        .keys()
        .filter(
          (key) => key.startsWith(accountPrefix) && !key.endsWith(".corrupt"),
        )) {
        try {
          const value = JSON.parse(this.storage.getItem(key) ?? "null");
          if (
            value?.accountId === accountId &&
            value.version === 1 &&
            value.item?.kind === "complete" &&
            valid(value.item) &&
            itemKey(accountId, value.item) === key
          )
            ids.add(value.item.body.puzzleId);
        } catch {
          /* corrupt queue records are never treated as results */
        }
      }
    } catch {
      /* unavailable storage */
    }
    return ids;
  }
  capture(accountId: string, item: SuperPending, seedCode?: string): boolean {
    if (!accountId || !valid(item)) return false;
    try {
      const key = itemKey(accountId, item);
      const existing = this.storage.getItem(key);
      if (existing !== null) {
        const parsed = JSON.parse(existing);
        const validExisting =
          parsed.version === 1 &&
          parsed.accountId === accountId &&
          valid(parsed.item) &&
          itemKey(accountId, parsed.item) === key &&
          typeof parsed.acknowledged === "boolean";
        if (!validExisting) return false;
        if (
          item.kind === "complete" &&
          seedCode &&
          parseSuperSeed(seedCode) !== undefined &&
          parsed.seedCode === undefined
        ) {
          const raw = JSON.stringify({ ...parsed, seedCode });
          this.storage.setItem(key, raw);
          return this.storage.getItem(key) === raw;
        }
        return true;
      }
      const raw = JSON.stringify({
        version: 1,
        accountId,
        item,
        capturedAt: Date.now(),
        ...(item.kind === "complete" &&
        seedCode &&
        parseSuperSeed(seedCode) !== undefined
          ? { seedCode }
          : {}),
        acknowledged: false,
      });
      this.storage.setItem(key, raw);
      return this.storage.getItem(key) === raw;
    } catch {
      return false;
    }
  }
  async flush(
    accountId: string,
    current: () => boolean,
    send: (item: SuperPending) => Promise<void>,
  ): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const accountPrefix = `${prefix}${encodeURIComponent(accountId)}:`;
      for (const key of this.storage
        .keys()
        .filter(
          (key) => key.startsWith(accountPrefix) && !key.endsWith(".corrupt"),
        )) {
        if (!current()) break;
        const raw = this.storage.getItem(key);
        if (!raw) continue;
        let value;
        try {
          value = JSON.parse(raw);
          if (
            value.version !== 1 ||
            value.accountId !== accountId ||
            typeof value.acknowledged !== "boolean" ||
            !valid(value.item) ||
            itemKey(accountId, value.item) !== key
          )
            throw new Error("Invalid super outbox.");
        } catch {
          try {
            this.storage.setItem(`${key}.corrupt`, raw);
          } catch {
            /* best effort */
          }
          continue;
        }
        if (value.acknowledged) continue;
        await send(value.item);
        this.storage.setItem(
          key,
          JSON.stringify({ ...value, acknowledged: true }),
        );
        sent += 1;
      }
      return sent;
    } finally {
      this.running = false;
    }
  }
}
