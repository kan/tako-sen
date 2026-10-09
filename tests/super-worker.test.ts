import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { migrateTestDatabase } from "./migrations";
import { registerAccountProfile } from "../src/worker/profile";
import { deleteAccountHistory } from "../src/worker/history";
import { encodeSuperSeed, generateSuperPuzzle } from "../src/core/super-puzzle";
import {
  restoreSharedPuzzleSnapshot,
  type SharedPuzzleSnapshot,
} from "../src/core/shared-puzzle";
import {
  getSuperProgress,
  recordSuperEvent,
  deferSuperProgress,
  prepareSuperPuzzle,
  startSuperAttempt,
  completeSuperAttempt,
  listSuperCandidates,
  listSuperRanking,
  listSuperHistory,
  parseSuperEvent,
  parseSuperStart,
  parseSuperCompletion,
  type SuperCompletion,
} from "../src/worker/super";
import worker from "../src/worker/index";

const auth = vi.hoisted(() => ({ account: null as string | null }));
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    authenticateRequest: async () => ({
      isAuthenticated: !!auth.account,
      toAuth: () => ({ userId: auth.account }),
    }),
    users: { deleteUser: async () => undefined },
  }),
}));
let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let snapshot: SharedPuzzleSnapshot;
const now = 1_800_000_000_000;
const seedCode = encodeSuperSeed("super-regression:0");
const event = (cycle = 0) => ({
  playId: crypto.randomUUID(),
  cycle,
  seedCode: "TAKO:g2:easy:credit",
});
beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: "./tests/wrangler.jsonc",
    persist: false,
    remoteBindings: false,
  });
  await migrateTestDatabase(platform.env.DB);
  await registerAccountProfile(platform.env.DB, "creator", "超級作成者");
  snapshot = await prepareSuperPuzzle(
    platform.env.DB,
    "creator",
    seedCode,
    now,
  );
});
afterAll(async () => {
  await platform?.dispose();
});
async function account(id: string) {
  await registerAccountProfile(platform.env.DB, id, `超級-${id}`);
  return getSuperProgress(platform.env.DB, id);
}
async function earn(id: string, cycle = 0) {
  for (let i = 0; i < 10; i += 1)
    await recordSuperEvent(platform.env.DB, id, event(cycle), now);
}
function completion(playId: string): SuperCompletion {
  return {
    playId,
    puzzleId: snapshot.id,
    pieces: generateSuperPuzzle("super-regression:0").solution,
    elapsedSeconds: 90,
    mistakes: 0,
    hintsUsed: 0,
    maxHintStage: 0,
  };
}

describe("super challenge server", () => {
  it("rolls back both right consumption and trial insertion when durable start fails", async () => {
    const db = platform.env.DB;
    await account("rollback");
    await earn("rollback");
    const id = crypto.randomUUID();
    await db
      .prepare(
        `CREATE TRIGGER super_test_failure AFTER INSERT ON super_attempts
      WHEN NEW.account_id = 'rollback' BEGIN SELECT RAISE(ABORT, 'simulated_save_failure'); END`,
      )
      .run();
    try {
      await expect(
        startSuperAttempt(
          db,
          "rollback",
          { playId: id, puzzleId: snapshot.id, entry: "earned", cycle: 0 },
          now,
        ),
      ).rejects.toThrow("simulated_save_failure");
      expect(await getSuperProgress(db, "rollback")).toEqual({
        cycle: 0,
        count: 10,
        offerPending: true,
      });
      expect(
        await db
          .prepare(
            "SELECT 1 FROM super_attempts WHERE account_id = ? AND play_id = ?",
          )
          .bind("rollback", id)
          .first(),
      ).toBeNull();
    } finally {
      await db.prepare("DROP TRIGGER super_test_failure").run();
    }
  });
  it("requires consent, records exactly ten unique events, persists ignored and deferred events", async () => {
    const db = platform.env.DB;
    await expect(getSuperProgress(db, "unknown")).rejects.toMatchObject({
      status: 403,
    });
    expect(await account("credit")).toEqual({
      cycle: 0,
      count: 0,
      offerPending: false,
    });
    const first = event();
    await recordSuperEvent(db, "credit", first, now);
    expect((await recordSuperEvent(db, "credit", first, now)).count).toBe(1);
    await expect(
      recordSuperEvent(db, "credit", { ...first, cycle: 1 }, now),
    ).rejects.toMatchObject({ status: 409 });
    for (let i = 0; i < 8; i += 1)
      await recordSuperEvent(db, "credit", event(), now);
    expect((await getSuperProgress(db, "credit")).count).toBe(9);
    await recordSuperEvent(db, "credit", event(), now);
    expect(await getSuperProgress(db, "credit")).toEqual({
      cycle: 0,
      count: 10,
      offerPending: true,
    });
    const heldEvent = event();
    await recordSuperEvent(db, "credit", heldEvent, now);
    expect(await deferSuperProgress(db, "credit", 0)).toEqual({
      cycle: 0,
      count: 10,
      offerPending: false,
    });
    await startSuperAttempt(
      db,
      "credit",
      {
        playId: crypto.randomUUID(),
        puzzleId: snapshot.id,
        entry: "earned",
        cycle: 0,
      },
      now,
    );
    expect((await recordSuperEvent(db, "credit", heldEvent, now)).count).toBe(
      0,
    );
    expect((await recordSuperEvent(db, "credit", event(0), now)).count).toBe(0);
    expect((await recordSuperEvent(db, "credit", event(1), now)).count).toBe(1);
    await account("isolated");
    expect((await getSuperProgress(db, "isolated")).count).toBe(0);
  });
  it("atomically consumes once across concurrent tabs, permits identical retries and shared starts", async () => {
    const db = platform.env.DB;
    await account("race");
    await expect(
      startSuperAttempt(
        db,
        "race",
        {
          playId: crypto.randomUUID(),
          puzzleId: snapshot.id,
          entry: "earned",
          cycle: 0,
        },
        now,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await earn("race");
    const a = {
      playId: crypto.randomUUID(),
      puzzleId: snapshot.id,
      entry: "earned" as const,
      cycle: 0,
    };
    const b = { ...a, playId: crypto.randomUUID() };
    const result = await Promise.allSettled([
      startSuperAttempt(db, "race", a, now),
      startSuperAttempt(db, "race", b, now),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = result[0].status === "fulfilled" ? a : b;
    expect(await startSuperAttempt(db, "race", winner, now)).toBe("duplicate");
    await expect(
      startSuperAttempt(db, "race", { ...winner, entry: "shared" }, now),
    ).rejects.toMatchObject({ status: 409 });
    expect(await getSuperProgress(db, "race")).toEqual({
      cycle: 1,
      count: 0,
      offerPending: false,
    });
    await startSuperAttempt(
      db,
      "race",
      { ...a, playId: crypto.randomUUID(), entry: "shared", cycle: 1 },
      now,
    );
    expect((await getSuperProgress(db, "race")).cycle).toBe(1);
    await account("sharedheld");
    await earn("sharedheld");
    await startSuperAttempt(
      db,
      "sharedheld",
      { ...a, playId: crypto.randomUUID(), entry: "shared" },
      now,
    );
    expect((await getSuperProgress(db, "sharedheld")).count).toBe(10);
  });
  it("does not reveal solutions, validates completion and publishes only the first registered score", async () => {
    const db = platform.env.DB;
    expect(snapshot).not.toHaveProperty("solution");
    expect(await restoreSharedPuzzleSnapshot(snapshot)).toMatchObject({
      size: 10,
    });
    await account("scorea");
    const id = crypto.randomUUID();
    await startSuperAttempt(
      db,
      "scorea",
      { playId: id, puzzleId: snapshot.id, entry: "shared", cycle: 0 },
      now,
    );
    const done = completion(id);
    await expect(
      completeSuperAttempt(
        db,
        "scorea",
        { ...done, pieces: Array(10).fill(0) },
        now,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      completeSuperAttempt(db, "scoreb", done, now),
    ).rejects.toMatchObject({ status: 409 });
    expect(await completeSuperAttempt(db, "scorea", done, now)).toBe(
      "completed",
    );
    expect(await completeSuperAttempt(db, "scorea", done, now)).toBe(
      "duplicate",
    );
    await expect(
      completeSuperAttempt(db, "scorea", { ...done, elapsedSeconds: 1 }, now),
    ).rejects.toMatchObject({ status: 409 });
    const retry = crypto.randomUUID();
    await startSuperAttempt(
      db,
      "scorea",
      { playId: retry, puzzleId: snapshot.id, entry: "shared", cycle: 0 },
      now,
    );
    await completeSuperAttempt(
      db,
      "scorea",
      { ...done, playId: retry, elapsedSeconds: 1 },
      now + 1,
    );
    expect(await listSuperRanking(db, "scorea", snapshot.id)).toMatchObject([
      { elapsedSeconds: 90, isSelf: true },
    ]);
    expect(await listSuperHistory(db, "scorea")).toHaveLength(2);
    await account("scoreb");
    const other = crypto.randomUUID();
    await startSuperAttempt(
      db,
      "scoreb",
      { playId: other, puzzleId: snapshot.id, entry: "shared", cycle: 0 },
      now,
    );
    await completeSuperAttempt(
      db,
      "scoreb",
      { ...done, playId: other },
      now + 2,
    );
    expect(
      (await listSuperRanking(db, "scorea", snapshot.id)).map((r) => r.rank),
    ).toEqual([1, 1]);
    const candidates = await listSuperCandidates(db, "creator");
    expect(candidates.find((r) => r.puzzleId === snapshot.id)?.players).toBe(2);
    expect(await listSuperCandidates(db, "scorea")).not.toContainEqual(
      expect.objectContaining({ puzzleId: snapshot.id }),
    );
    await deleteAccountHistory(db, "scorea");
    expect(await listSuperHistory(db, "scorea")).toHaveLength(0);
    expect(await listSuperRanking(db, "creator", snapshot.id)).toHaveLength(1);
    expect(
      (await listSuperCandidates(db, "creator")).find(
        (r) => r.puzzleId === snapshot.id,
      )?.players,
    ).toBe(1);
    await expect(getSuperProgress(db, "scorea")).rejects.toMatchObject({
      status: 403,
    });
  });
  it("limits new shared starts without blocking same-ID retries", async () => {
    const db = platform.env.DB;
    await account("limited");
    const first = {
      playId: crypto.randomUUID(),
      puzzleId: snapshot.id,
      entry: "shared" as const,
      cycle: 0,
    };
    await startSuperAttempt(db, "limited", first, now);
    for (let i = 0; i < 9; i += 1)
      await startSuperAttempt(
        db,
        "limited",
        { ...first, playId: crypto.randomUUID() },
        now,
      );
    expect(await startSuperAttempt(db, "limited", first, now)).toBe(
      "duplicate",
    );
    await expect(
      startSuperAttempt(
        db,
        "limited",
        { ...first, playId: crypto.randomUUID() },
        now,
      ),
    ).rejects.toThrow("super_rate_limited");
    expect(
      await startSuperAttempt(
        db,
        "limited",
        { ...first, playId: crypto.randomUUID() },
        now + 60001,
      ),
    ).toBe("started");
  });

  it("limits new credit events but accepts identical retries and leaves progress unchanged on rejection", async () => {
    const db = platform.env.DB;
    await account("eventlimit");
    const first = event();
    await recordSuperEvent(db, "eventlimit", first, now);
    for (let i = 1; i < 30; i += 1)
      await recordSuperEvent(db, "eventlimit", event(), now);
    expect((await recordSuperEvent(db, "eventlimit", first, now)).count).toBe(
      10,
    );
    await expect(
      recordSuperEvent(db, "eventlimit", event(), now),
    ).rejects.toMatchObject({ status: 429 });
    expect((await getSuperProgress(db, "eventlimit")).count).toBe(10);
    expect(
      (await recordSuperEvent(db, "eventlimit", event(), now + 60001)).count,
    ).toBe(10);
  });
  it("rejects invalid data and never admits daily/super trials as ordinary credit", () => {
    for (const seedCode of [
      encodeSuperSeed("seed"),
      "TAKO:daily-v1:hard:2026-10-09",
      "bad",
    ])
      expect(() => parseSuperEvent({ ...event(), seedCode })).toThrow();
    expect(() => parseSuperEvent({ ...event(), cycle: -1 })).toThrow();
    expect(() =>
      parseSuperStart({
        playId: "bad",
        puzzleId: snapshot.id,
        entry: "shared",
        cycle: 0,
      }),
    ).toThrow();
    expect(() => parseSuperCompletion({ pieces: [] })).toThrow();
  });

  it("rate-limits expensive new preparation while allowing cached retry", async () => {
    const db = platform.env.DB;
    await account("preparelimit");
    await db
      .prepare(
        "INSERT INTO super_prepare_limits(account_id, minute, requests) VALUES (?, ?, 10)",
      )
      .bind("preparelimit", Math.floor(now / 60000))
      .run();
    expect(await prepareSuperPuzzle(db, "preparelimit", seedCode, now)).toEqual(
      snapshot,
    );
    await expect(
      prepareSuperPuzzle(
        db,
        "preparelimit",
        encodeSuperSeed("new-limited-seed"),
        now,
      ),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      prepareSuperPuzzle(db, "no-profile", seedCode, now),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("protects API ownership, methods, Origin and body validation", async () => {
    const env = {
      DB: platform.env.DB,
      ALLOWED_ORIGINS: "https://example.test",
      CLERK_PUBLISHABLE_KEY: "test",
      CLERK_SECRET_KEY: "test",
    } as Env;
    const call = (path: string, init?: RequestInit) =>
      worker.fetch(
        new Request(`https://example.test${path}`, init) as Parameters<
          typeof worker.fetch
        >[0],
        env,
      );
    auth.account = null;
    expect((await call("/api/super/progress")).status).toBe(401);
    auth.account = "creator";
    expect(
      (
        await call("/api/super/progress", {
          headers: { Origin: "https://evil.test" },
        })
      ).status,
    ).toBe(403);
    expect((await call("/api/super/progress", { method: "POST" })).status).toBe(
      405,
    );
    expect((await call("/api/super/event", { method: "POST" })).status).toBe(
      415,
    );
    expect(
      (
        await call("/api/super/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(400);
    expect((await call("/api/super/ranking?puzzleId=bad")).status).toBe(400);
    expect((await call("/api/super/progress")).status).toBe(200);
    await account("apiisolated");
    const response = await call("/api/super/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event(), accountId: "apiisolated" }),
    });
    expect(response.status).toBe(200);
    expect((await getSuperProgress(platform.env.DB, "creator")).count).toBe(1);
    expect((await getSuperProgress(platform.env.DB, "apiisolated")).count).toBe(
      0,
    );
    auth.account = "unknown";
    expect((await call("/api/super/progress")).status).toBe(403);
  });
});
