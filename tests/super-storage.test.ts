import { describe, expect, it } from "vitest";
import { generateSuperPuzzle, encodeSuperSeed } from "../src/core/super-puzzle";
import {
  loadSuperGame,
  saveSuperGame,
  type SuperSession,
} from "../src/core/super-storage";
import { SuperOutbox, type SuperQueueStorage } from "../src/core/super-outbox";
import { createInitialPlayerState } from "../src/core/model";
import { loadGame } from "../src/core/storage";
const puzzle = generateSuperPuzzle("super-regression:0");
const session: SuperSession = {
  puzzleId: `p1:${"a".repeat(64)}`,
  seedCode: encodeSuperSeed(puzzle.seed),
  cycle: 0,
  entry: "earned",
  claimed: false,
};
function store() {
  const values = new Map<string, string>();
  const storage: SuperQueueStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    keys: () => [...values.keys()],
  };
  return { values, storage };
}
const event = (cycle = 0) => ({
  kind: "event" as const,
  body: { playId: crypto.randomUUID(), cycle, seedCode: "TAKO:g2:easy:test" },
});
describe("super account-local game storage", () => {
  it("round-trips READY and claimed progress while isolating accounts and normal saves", () => {
    const { storage } = store();
    const playId = crypto.randomUUID();
    const state = createInitialPlayerState(0, puzzle.givens);
    const timer = { waitingToStart: true, elapsedMs: 0, hasStarted: false };
    expect(
      saveSuperGame("a", session, puzzle, state, playId, timer, storage),
    ).toBe(true);
    expect(loadSuperGame("a", storage)).toMatchObject({
      session,
      game: { puzzle, playId, state, timer },
    });
    expect(loadSuperGame("b", storage)).toBeUndefined();
    expect(loadGame(storage)).toBeUndefined();
    const claimed = { ...session, claimed: true };
    const elapsed = { waitingToStart: true, elapsedMs: 5000, hasStarted: true };
    expect(
      saveSuperGame("a", claimed, puzzle, state, playId, elapsed, storage),
    ).toBe(true);
    expect(loadSuperGame("a", storage)?.game.timer.elapsedMs).toBe(5000);
  });
  it("rejects corrupted saves and reports quota or silent write failures", () => {
    const { storage, values } = store();
    const key = "tako-sen.super-game.v1:a";
    values.set(key, "{bad");
    expect(loadSuperGame("a", storage)).toBeUndefined();
    expect(values.get(`${key}.corrupt`)).toBe("{bad");
    const args = [
      "a",
      session,
      puzzle,
      createInitialPlayerState(0, puzzle.givens),
      crypto.randomUUID(),
      { waitingToStart: true },
    ] as const;
    expect(
      saveSuperGame(...args, {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).toBe(false);
    expect(
      saveSuperGame(...args, { getItem: () => null, setItem: () => {} }),
    ).toBe(false);
  });
});
describe("super per-trial outbox", () => {
  it("remembers deferred offers across reload and acknowledgements without affecting another cycle", async () => {
    const { storage } = store();
    const queue = new SuperOutbox(storage);
    expect(queue.capture("a", { kind: "defer", body: { cycle: 2 } })).toBe(
      true,
    );
    expect(new SuperOutbox(storage).isDeferred("a", 2)).toBe(true);
    expect(queue.isDeferred("b", 2)).toBe(false);
    expect(queue.isDeferred("a", 3)).toBe(false);
    await queue.flush(
      "a",
      () => true,
      async () => {},
    );
    expect(new SuperOutbox(storage).isDeferred("a", 2)).toBe(true);
  });
  it("retains failed sends, sends only the current account, and deduplicates capture after reload", async () => {
    const { storage } = store();
    const queue = new SuperOutbox(storage);
    const a = event(),
      b = event();
    expect(queue.capture("a", a)).toBe(true);
    expect(queue.capture("b", b)).toBe(true);
    await expect(
      queue.flush(
        "a",
        () => true,
        async () => {
          throw new Error("offline");
        },
      ),
    ).rejects.toThrow("offline");
    const sent: unknown[] = [];
    expect(
      await new SuperOutbox(storage).flush(
        "a",
        () => true,
        async (item) => {
          sent.push(item);
        },
      ),
    ).toBe(1);
    expect(sent).toEqual([a]);
    expect(queue.capture("a", { ...a, body: { ...a.body, cycle: 1 } })).toBe(
      true,
    );
    expect(
      await queue.flush(
        "a",
        () => true,
        async () => {
          throw new Error("must not resend acknowledged event");
        },
      ),
    ).toBe(0);
    expect(
      await queue.flush(
        "b",
        () => true,
        async (item) => {
          sent.push(item);
        },
      ),
    ).toBe(1);
    expect(sent).toEqual([a, b]);
  });
  it("does not lose distinct events written by another tab and stops on an account switch", async () => {
    const { storage } = store();
    const tab1 = new SuperOutbox(storage),
      tab2 = new SuperOutbox(storage);
    const a = event(),
      b = event();
    tab1.capture("a", a);
    tab2.capture("a", b);
    let current = true;
    const seen: unknown[] = [];
    expect(
      await tab1.flush(
        "a",
        () => current,
        async (item) => {
          seen.push(item);
          current = false;
        },
      ),
    ).toBe(1);
    expect(
      await tab2.flush(
        "a",
        () => true,
        async (item) => {
          seen.push(item);
        },
      ),
    ).toBe(1);
    expect(seen).toEqual([a, b]);
  });
  it("keeps completion tombstones as local exclusions and quarantines corrupt records", async () => {
    const { storage, values } = store();
    const queue = new SuperOutbox(storage);
    const completion = {
      kind: "complete" as const,
      body: {
        playId: crypto.randomUUID(),
        puzzleId: session.puzzleId,
        pieces: puzzle.solution,
        elapsedSeconds: 5,
        hintsUsed: 0,
        mistakes: 0,
        maxHintStage: 0 as const,
      },
    };
    expect(queue.capture("a", completion)).toBe(true);
    expect(queue.completedIds("a")).toEqual(new Set([session.puzzleId]));
    await queue.flush(
      "a",
      () => true,
      async () => {},
    );
    expect(new SuperOutbox(storage).completedIds("a")).toEqual(
      new Set([session.puzzleId]),
    );
    expect(queue.completedIds("b").size).toBe(0);
    const broken = event();
    queue.capture("a", broken);
    const key = [...values.keys()].find((k) => k.endsWith(broken.body.playId))!;
    values.set(key, "{broken");
    expect(queue.capture("a", broken)).toBe(false);
    expect(
      await queue.flush(
        "a",
        () => true,
        async () => {
          throw new Error("must not upload corrupt records");
        },
      ),
    ).toBe(0);
    const size = values.size;
    await queue.flush(
      "a",
      () => true,
      async () => {},
    );
    expect(values.size).toBe(size);
    expect(values.get(`${key}.corrupt`)).toBe("{broken");
  });
  it("never captures daily/super credit or invalid completion data", () => {
    const queue = new SuperOutbox(store().storage);
    expect(
      queue.capture("a", {
        ...event(),
        body: { ...event().body, seedCode: session.seedCode },
      }),
    ).toBe(false);
    expect(queue.capture("a", { kind: "defer", body: { cycle: -1 } })).toBe(
      false,
    );
    expect(
      queue.capture("a", {
        kind: "complete",
        body: {
          playId: crypto.randomUUID(),
          puzzleId: session.puzzleId,
          pieces: Array(10).fill(0),
          elapsedSeconds: 1,
          hintsUsed: 0,
          mistakes: 0,
          maxHintStage: 0,
        },
      }),
    ).toBe(false);
  });
});
