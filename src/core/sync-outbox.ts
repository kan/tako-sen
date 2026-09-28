import type { PlayResult } from "./results";
import { isResultHistory, type KeyValueStorage } from "./storage";

const KEY = "tako-sen.sync-outbox.v1";
interface PendingPlay {
  readonly accountId: string;
  readonly play: PlayResult;
}

/** Only newly completed plays are captured; login never backfills local history. */
export class SyncOutbox {
  private readonly seen: Set<string>;
  private pending: PendingPlay[] = [];
  private running = false;
  persistenceFailed = false;

  constructor(
    plays: readonly PlayResult[],
    private readonly storage: KeyValueStorage,
  ) {
    this.seen = new Set(
      plays.filter((p) => p.status === "completed").map((p) => p.id),
    );
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("version" in parsed) ||
        parsed.version !== 1 ||
        !("pending" in parsed) ||
        !Array.isArray(parsed.pending) ||
        !parsed.pending.every(isPending)
      ) {
        throw new Error("Invalid outbox.");
      }
      this.pending = parsed.pending;
    } catch {
      // Corruption must not cause unsolicited uploads. Preserve the raw value for recovery.
      try {
        const raw = storage.getItem(KEY);
        if (raw) storage.setItem(`${KEY}.corrupt`, raw);
      } catch {
        /* storage unavailable */
      }
    }
  }

  capture(plays: readonly PlayResult[], accountId: string | null): void {
    for (const play of plays) {
      if (play.status !== "completed" || this.seen.has(play.id)) continue;
      this.seen.add(play.id);
      if (
        accountId &&
        !this.pending.some(
          (p) => p.accountId === accountId && p.play.id === play.id,
        )
      ) {
        this.pending.push({ accountId, play: { ...play } });
      }
    }
    this.persist();
  }

  count(accountId: string): number {
    return this.pending.filter((p) => p.accountId === accountId).length;
  }

  forget(accountId: string): void {
    this.pending = this.pending.filter((p) => p.accountId !== accountId);
    this.persist();
  }

  async drain(
    accountId: string,
    stillCurrent: () => boolean,
    send: (play: PlayResult) => Promise<void>,
  ): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      while (stillCurrent()) {
        const next = this.pending.find((p) => p.accountId === accountId);
        if (!next) break;
        await send(next.play);
        this.pending = this.pending.filter((p) => p !== next);
        this.persist();
        sent += 1;
      }
      return sent;
    } finally {
      this.running = false;
    }
  }

  private persist(): void {
    try {
      this.storage.setItem(
        KEY,
        JSON.stringify({ version: 1, pending: this.pending }),
      );
      this.persistenceFailed = false;
    } catch {
      this.persistenceFailed = true;
    }
  }
}

function isPending(value: unknown): value is PendingPlay {
  if (
    !value ||
    typeof value !== "object" ||
    !("accountId" in value) ||
    typeof value.accountId !== "string" ||
    !value.accountId ||
    !("play" in value)
  )
    return false;
  const play = value.play;
  return (
    !!play &&
    typeof play === "object" &&
    "userId" in play &&
    "status" in play &&
    play.status === "completed" &&
    isResultHistory({ version: 1, userId: play.userId, plays: [play] })
  );
}
