import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { CompletedPlayUpload } from "../src/core/online-history";
import {
  deleteAccountHistory,
  listCompletedPlays,
  saveCompletedPlay,
} from "../src/worker/history";
import { listLeaderboard, setPublication } from "../src/worker/leaderboard";
import worker from "../src/worker/index";

const auth = vi.hoisted(() => ({ account: null as string | null }));
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    authenticateRequest: async () => ({
      isAuthenticated: auth.account !== null,
      toAuth: () => ({ userId: auth.account }),
    }),
  }),
}));

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
const puzzleId = `p1:${"a".repeat(64)}`;
function play(
  overrides: Partial<CompletedPlayUpload> = {},
): CompletedPlayUpload {
  return {
    playId: crypto.randomUUID(),
    puzzleId,
    seedCode: "TAKO:g1:easy:ranking",
    generatorVersion: "g1",
    difficulty: "easy",
    startedAt: 1000,
    completedAt: 101000,
    elapsedSeconds: 100,
    mistakes: 0,
    hintsUsed: 0,
    ...overrides,
  };
}
beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: "./tests/wrangler.jsonc",
    persist: false,
    remoteBindings: false,
  });
  for (const file of [
    "0001_completed_plays.sql",
    "0002_shared_puzzles.sql",
    "0003_public_leaderboards.sql",
  ]) {
    if (file === "0003_public_leaderboards.sql") {
      await saveCompletedPlay(platform.env.DB, "pre-migration", play());
    }
    const sql = readFileSync(
      new URL(`../migrations/${file}`, import.meta.url),
      "utf8",
    );
    for (const statement of sql.split(";").map((s) => s.trim())) {
      if (statement) await platform.env.DB.prepare(statement).run();
    }
  }
});
afterAll(async () => {
  await platform?.dispose();
});

describe("opt-in public leaderboard", () => {
  it("does not publish pre-existing history when the migration is applied", async () => {
    const db = platform.env.DB;
    const records = await listCompletedPlays(db, "pre-migration");
    expect(records).toHaveLength(1);
    expect(records[0].isPublic).toBe(false);
    expect(await listLeaderboard(db, puzzleId)).toEqual([]);
    await deleteAccountHistory(db, "pre-migration");
  });
  it("keeps uploads private and only publishes the owner's saved score", async () => {
    const db = platform.env.DB;
    const record = play();
    await saveCompletedPlay(db, "owner", record);
    expect(await listCompletedPlays(db, "owner")).toEqual([
      { ...record, isPublic: false },
    ]);
    expect(await listLeaderboard(db, puzzleId)).toEqual([]);
    expect(await setPublication(db, "stranger", record.playId, true, 0)).toBe(
      "not_found",
    );
    expect(await setPublication(db, "owner", record.playId, true, 0)).toBe(
      "ok",
    );
    expect(await setPublication(db, "owner", record.playId, true, 0)).toBe(
      "ok",
    );
    expect(await saveCompletedPlay(db, "owner", record)).toBe("duplicate");
    expect((await listCompletedPlays(db, "owner"))[0].isPublic).toBe(true);
    expect(await setPublication(db, "stranger", record.playId, false, 0)).toBe(
      "not_found",
    );
    const entries = await listLeaderboard(db, puzzleId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      rank: 1,
      displayName: expect.stringMatching(/^タコ-[a-f0-9]{16}$/),
      elapsedSeconds: 100,
      hintsUsed: 0,
      mistakes: 0,
    });
    await deleteAccountHistory(db, "owner");
  });

  it("selects each participant's public best, ties by all score fields, and separates puzzles", async () => {
    const db = platform.env.DB;
    const records = [
      ["best-a", play({ elapsedSeconds: 50 })],
      ["best-a", play({ elapsedSeconds: 70 })],
      ["best-a", play({ elapsedSeconds: 1 })],
      ["best-b", play({ elapsedSeconds: 50 })],
      ["best-c", play({ elapsedSeconds: 50, hintsUsed: 1 })],
      ["best-d", play({ elapsedSeconds: 50, hintsUsed: 1, mistakes: 1 })],
      ["best-e", play({ puzzleId: `p1:${"b".repeat(64)}` })],
    ] as const;
    for (const [index, [owner, record]] of records.entries()) {
      await saveCompletedPlay(db, owner, record);
      if (index !== 2) await setPublication(db, owner, record.playId, true, 0);
    }
    const entries = await listLeaderboard(db, puzzleId);
    expect(entries.map((e) => e.rank)).toEqual([1, 1, 3, 4]);
    expect(entries.map((e) => e.hintsUsed)).toEqual([0, 0, 1, 1]);
    expect(entries.map((e) => e.mistakes)).toEqual([0, 0, 0, 1]);
    await setPublication(db, "best-a", records[0][1].playId, false, 0);
    expect(
      (await listLeaderboard(db, puzzleId)).map((e) => e.elapsedSeconds),
    ).toEqual([50, 50, 50, 70]);
    for (const owner of new Set(records.map(([owner]) => owner)))
      await deleteAccountHistory(db, owner);
  });

  it("limits concurrent publication attempts but never blocks withdrawal, and resets the window", async () => {
    const db = platform.env.DB;
    const records = Array.from({ length: 12 }, () => play());
    for (const record of records)
      await saveCompletedPlay(db, "limited", record);
    const outcomes = await Promise.all(
      records.map((r) => setPublication(db, "limited", r.playId, true, 1000)),
    );
    expect(outcomes.filter((r) => r === "ok")).toHaveLength(10);
    expect(outcomes.filter((r) => r === "rate_limited")).toHaveLength(2);
    const published = records[outcomes.indexOf("ok")];
    const blocked = records[outcomes.indexOf("rate_limited")];
    expect(
      await setPublication(db, "limited", published.playId, true, 1000),
    ).toBe("ok");
    expect(
      await setPublication(db, "limited", published.playId, false, 1000),
    ).toBe("ok");
    expect(
      await setPublication(db, "limited", published.playId, false, 1000),
    ).toBe("ok");
    expect(
      await setPublication(db, "limited", blocked.playId, true, 60999),
    ).toBe("rate_limited");
    expect(
      await setPublication(db, "limited", blocked.playId, true, 61000),
    ).toBe("ok");
    await deleteAccountHistory(db, "limited");
    for (const table of [
      "completed_plays",
      "leaderboard_profiles",
      "publication_limits",
    ]) {
      expect(
        await db
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`)
          .bind("limited")
          .first("n"),
      ).toBe(0);
    }
  });

  it("requires authentication and ownership for mutation; public responses expose only score and alias", async () => {
    const db = platform.env.DB;
    const record = play();
    await saveCompletedPlay(db, "http-owner", record);
    const env = { DB: db, ALLOWED_ORIGINS: "https://example.com" } as Env;
    const call = (
      path: string,
      method = "GET",
      origin = "https://example.com",
    ) =>
      worker.fetch(
        new Request(`https://example.com/api/${path}`, {
          method,
          headers: { Origin: origin },
        }) as Parameters<typeof worker.fetch>[0],
        env,
      );
    const path = `plays/${record.playId}/publication`;
    auth.account = null;
    expect((await call(path, "PUT")).status).toBe(401);
    expect((await call(path, "DELETE")).status).toBe(401);
    auth.account = "another";
    expect((await call(path, "PUT")).status).toBe(404);
    auth.account = "http-owner";
    expect((await call(path, "PUT", "https://evil.example")).status).toBe(403);
    expect((await call(path, "POST")).status).toBe(405);
    expect((await call(path, "PUT")).status).toBe(200);
    auth.account = null;
    const response = await call(`leaderboards/${encodeURIComponent(puzzleId)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body: { entries: object[] } = await response.json();
    expect(Object.keys(body.entries[0]).sort()).toEqual([
      "displayName",
      "elapsedSeconds",
      "hintsUsed",
      "mistakes",
      "rank",
    ]);
    expect((await call("leaderboards/invalid")).status).toBe(400);
    expect((await call("leaderboards/%ZZ")).status).toBe(400);
    expect(
      (await call(`leaderboards/${encodeURIComponent(puzzleId)}`, "POST"))
        .status,
    ).toBe(405);
    auth.account = "http-owner";
    expect((await call(path, "DELETE")).status).toBe(200);
    expect(await listLeaderboard(db, puzzleId)).toEqual([]);
    expect(await listCompletedPlays(db, "http-owner")).toHaveLength(1);
    await db
      .prepare(
        "UPDATE publication_limits SET attempts = 10, window_start = ? WHERE account_id = ?",
      )
      .bind(Date.now(), "http-owner")
      .run();
    const limited = await call(path, "PUT");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect((await call(path, "DELETE")).status).toBe(200);
    await deleteAccountHistory(db, "http-owner");
    auth.account = null;
  });

  it("withdraws all owned publications, including records outside the 500-item history, without deleting history", async () => {
    const db = platform.env.DB;
    const oldest = play({ completedAt: 1000 });
    await saveCompletedPlay(db, "old-owner", oldest);
    await setPublication(db, "old-owner", oldest.playId, true, 0);
    await saveCompletedPlay(db, "other-owner", oldest);
    await setPublication(db, "other-owner", oldest.playId, true, 0);
    await db
      .prepare(
        `WITH RECURSIVE numbers(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 500
    ) INSERT INTO completed_plays
      SELECT account_id, 'old-test-' || n, puzzle_id, seed_code, generator_version,
        difficulty, started_at, 2000 + n, elapsed_seconds, mistakes, hints_used, 0
      FROM completed_plays CROSS JOIN numbers WHERE account_id = ? AND play_id = ?`,
      )
      .bind("old-owner", oldest.playId)
      .run();
    expect(
      (await listCompletedPlays(db, "old-owner")).some(
        (p) => p.playId === oldest.playId,
      ),
    ).toBe(false);
    auth.account = "old-owner";
    const response = await worker.fetch(
      new Request("https://example.com/api/publications", {
        method: "DELETE",
      }) as Parameters<typeof worker.fetch>[0],
      { DB: db, ALLOWED_ORIGINS: "https://example.com" } as Env,
    );
    expect(response.status).toBe(200);
    expect(await listLeaderboard(db, puzzleId)).toHaveLength(1);
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM completed_plays WHERE account_id = ?",
        )
        .bind("old-owner")
        .first("n"),
    ).toBe(501);
    await deleteAccountHistory(db, "old-owner");
    await deleteAccountHistory(db, "other-owner");
    auth.account = null;
  });
});
