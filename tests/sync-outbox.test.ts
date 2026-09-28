import { describe, expect, it, vi } from "vitest";
import { SyncOutbox } from "../src/core/sync-outbox";
import {
  loadCachedProfile,
  saveCachedProfile,
  validateGameName,
  gameNameParts,
} from "../src/core/account-profile";
import type { PlayResult } from "../src/core/results";

function storage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
function play(id = crypto.randomUUID()): PlayResult {
  return {
    id,
    userId: "local-user",
    seedCode: "TAKO:g1:easy:sync",
    generatorVersion: "g1",
    difficulty: "easy",
    startedAt: 1000,
    completedAt: 61000,
    elapsedSeconds: 60,
    hintsUsed: 0,
    mistakes: 0,
    status: "completed",
  };
}

describe("game names", () => {
  it("caches consent per account for offline queueing without inferring it for other accounts", () => {
    const local = storage();
    const profile = { displayName: "端末タコ", consentVersion: 1 };
    saveCachedProfile("a", profile, local);
    expect(loadCachedProfile("a", local)).toEqual(profile);
    expect(loadCachedProfile("b", local)).toBeNull();
    saveCachedProfile("a", null, local);
    expect(loadCachedProfile("a", local)).toBeNull();
    local.setItem(
      "tako-sen.account-profile.v1:a",
      JSON.stringify({ displayName: "<script>", consentVersion: 1 }),
    );
    expect(loadCachedProfile("a", local)).toBeNull();
    local.setItem("tako-sen.account-profile.v1:a", "broken");
    expect(loadCachedProfile("a", local)).toBeNull();
    local.setItem("tako-sen.account-profile.v1:a", '{"consentVersion":1}');
    expect(loadCachedProfile("a", local)).toBeNull();
  });
  it("normalizes valid names and rejects private identifiers, markup, controls and unsupported lengths", () => {
    expect(validateGameName("  タコ-123  ")).toBe("タコ-123");
    expect(validateGameName("か\u3099タコ")).toBe("がタコ");
    for (const name of [
      null,
      {},
      "",
      "a",
      "a".repeat(21),
      "<script>",
      "user@example.com",
      "a\nb",
      "a\u202Eb",
    ])
      expect(validateGameName(name)).toBeUndefined();
  });
  it("accepts emoji sequences and counts visible characters rather than UTF-16 units", () => {
    for (const name of [
      "🐙タコ",
      "🐙🐙",
      "🇯🇵タコ",
      "👨‍👩‍👧‍👦タコ",
      "👍🏽タコ",
      "1️⃣タコ",
      "♥タコ",
    ])
      expect(validateGameName(name)).toBe(name);
    expect(validateGameName("🐙".repeat(20))).toBe("🐙".repeat(20));
    expect(validateGameName("🐙".repeat(21))).toBeUndefined();
    for (const invalid of [
      "タコ\u200D",
      "タコ\u202E",
      "タコ\uFE0F",
      "タコ\uFE0E",
      "タコ\n🐙",
    ])
      expect(validateGameName(invalid)).toBeUndefined();
    expect(gameNameParts("👨‍👩‍👧‍👦タコ🇯🇵")).toEqual([
      { text: "👨‍👩‍👧‍👦", emoji: true },
      { text: "タ", emoji: false },
      { text: "コ", emoji: false },
      { text: "🇯🇵", emoji: true },
    ]);
  });
});

describe("account-owned synchronization outbox", () => {
  it("does not import old history or logged-out clears at login", async () => {
    const old = play();
    const anonymous = play();
    const outbox = new SyncOutbox([old], storage());
    outbox.capture([old, anonymous], null);
    outbox.capture([old, anonymous], "account-a");
    const send = vi.fn();
    expect(await outbox.drain("account-a", () => true, send)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("captures only completion once, persists across reload, and retries failed requests without duplicates", async () => {
    const local = storage();
    const completed = play();
    const outbox = new SyncOutbox(
      [{ ...completed, status: "in-progress" }],
      local,
    );
    outbox.capture([completed], "account-a");
    outbox.capture([completed], "account-a");
    expect(outbox.count("account-a")).toBe(1);
    await expect(
      outbox.drain(
        "account-a",
        () => true,
        async () => {
          throw new Error("offline");
        },
      ),
    ).rejects.toThrow("offline");
    const restored = new SyncOutbox([completed], local);
    const send = vi.fn(async () => undefined);
    expect(await restored.drain("account-a", () => true, send)).toBe(1);
    expect(send).toHaveBeenCalledWith(completed);
    expect(restored.count("account-a")).toBe(0);
    expect(new SyncOutbox([completed], local).count("account-a")).toBe(0);
  });

  it("never sends account A's pending plays as account B, or reassigns them on account switching", async () => {
    const first = play();
    const second = play();
    const outbox = new SyncOutbox([], storage());
    outbox.capture([first], "account-a");
    outbox.capture([first, second], "account-b");
    const send = vi.fn(async () => undefined);
    await outbox.drain("account-b", () => true, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(second);
    expect(outbox.count("account-a")).toBe(1);
  });

  it("stops sending on logout and prevents concurrent drain loops", async () => {
    const outbox = new SyncOutbox([], storage());
    outbox.capture([play(), play()], "account-a");
    let current = true;
    let release!: () => void;
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const draining = outbox.drain("account-a", () => current, send);
    expect(await outbox.drain("account-a", () => current, send)).toBe(0);
    current = false;
    release();
    expect(await draining).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox.count("account-a")).toBe(1);
  });

  it("removes only deleted account queues and preserves other accounts", () => {
    const local = storage();
    const outbox = new SyncOutbox([], local);
    const first = play();
    outbox.capture([first], "a");
    outbox.capture([first, play()], "b");
    outbox.forget("a");
    const restored = new SyncOutbox([], local);
    expect(restored.count("a")).toBe(0);
    expect(restored.count("b")).toBe(1);
  });

  it("does not upload corrupt persisted data, and reports storage failures without blocking play", () => {
    const local = storage();
    local.setItem(
      "tako-sen.sync-outbox.v1",
      '{"version":1,"pending":[{"accountId":"a","play":{}}]}',
    );
    const outbox = new SyncOutbox([], local);
    expect(outbox.count("a")).toBe(0);
    expect(local.getItem("tako-sen.sync-outbox.v1.corrupt")).not.toBeNull();
    const blocked = new SyncOutbox([], {
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(() => blocked.capture([play()], "a")).not.toThrow();
    expect(blocked.count("a")).toBe(1);
    expect(blocked.persistenceFailed).toBe(true);
  });
});
