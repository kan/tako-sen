import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { generatePuzzle } from "../src/core/generator";
import { createCompletedPlayUpload } from "../src/core/online-history";
import {
  createSharedPuzzleSnapshot,
  restoreSharedPuzzleSnapshot,
} from "../src/core/shared-puzzle";
import { encodePuzzleSeed } from "../src/core/puzzle-code";
import {
  ACCOUNT_TABLES,
  deleteAccount,
  listCompletedPlays,
  saveCompletedPlay,
  sweepDeletedAccounts,
} from "../src/worker/history";
import worker, { CRONS } from "../src/worker/index";
import { getSharedPuzzle, saveSharedPuzzle } from "../src/worker/puzzles";
import { listLeaderboard } from "../src/worker/leaderboard";
import { registerAccountProfile } from "../src/worker/profile";
import { migrateTestDatabase } from "./migrations";

beforeAll(async () => {
  await migrateTestDatabase(env.DB);
});

describe("public puzzle snapshots", () => {
  it("saves a validated snapshot without a solution", async () => {
    const snapshot = await createSharedPuzzleSnapshot(
      "TAKO:g1:easy:d1-shared-puzzle",
    );
    const db = env.DB;
    expect(await saveSharedPuzzle(db, snapshot)).toBe("created");
    expect(await saveSharedPuzzle(db, snapshot)).toBe("existing");
    const stored = await getSharedPuzzle(db, snapshot.id);
    expect(stored).toEqual(snapshot);
    expect("solution" in (stored ?? {})).toBe(false);
    await expect(restoreSharedPuzzleSnapshot(stored)).resolves.toHaveProperty(
      "solution",
    );
    const response = await worker.fetch(
      new Request(
        `https://example.com/api/puzzles/${encodeURIComponent(snapshot.id)}`,
      ) as Parameters<typeof worker.fetch>[0],
      { DB: db } as Env,
    );
    expect(response.status).toBe(200);
    const publicBody: { puzzle: unknown } = await response.json();
    expect(publicBody.puzzle).toEqual(snapshot);
    expect("solution" in (publicBody.puzzle as object)).toBe(false);
    const invalid = await worker.fetch(
      new Request("https://example.com/api/puzzles/not-a-puzzle") as Parameters<
        typeof worker.fetch
      >[0],
      { DB: db } as Env,
    );
    expect(invalid.status).toBe(400);
  });
});

describe("account-owned history storage", () => {
  it("deduplicates matching retries, rejects conflicts, and isolates accounts", async () => {
    const puzzle = generatePuzzle({ seed: "d1-history", difficulty: "easy" });
    const play = await createCompletedPlayUpload({
      id: "550e8400-e29b-41d4-a716-446655440000",
      userId: "local-user-id",
      seedCode: encodePuzzleSeed(puzzle),
      generatorVersion: puzzle.generatorVersion ?? "g1",
      difficulty: puzzle.difficulty ?? "easy",
      startedAt: 1000,
      completedAt: 61000,
      elapsedSeconds: 60,
      mistakes: 0,
      hintsUsed: 1,
      status: "completed",
    });
    const db = env.DB;
    expect(await saveCompletedPlay(db, "account-a", play)).toBe("created");
    expect(await saveCompletedPlay(db, "account-a", play)).toBe("duplicate");
    expect(
      await saveCompletedPlay(db, "account-a", { ...play, mistakes: 1 }),
    ).toBe("conflict");
    expect(await saveCompletedPlay(db, "account-b", play)).toBe("created");
    expect(await listCompletedPlays(db, "account-a")).toEqual([
      { ...play, isPublic: false },
    ]);
    expect(await listCompletedPlays(db, "account-b")).toEqual([
      { ...play, isPublic: false },
    ]);
    expect(await listCompletedPlays(db, "account-c")).toEqual([]);
    await deleteAccount(db, "account-a");
    expect(await listCompletedPlays(db, "account-a")).toEqual([]);
    expect(await listCompletedPlays(db, "account-b")).toEqual([
      { ...play, isPublic: false },
    ]);

    // Withdrawal from kan-game.app, which reaches TAKO-SEN as
    // GameService.deleteAccount (src/worker/game-service.ts).
    await registerAccountProfile(db, "account-b", "テストタコ");
    // A puzzle first solved after consent, so it is ranked.
    const later = Date.now() + 3_600_000;
    const ranked = {
      ...play,
      playId: crypto.randomUUID(),
      puzzleId: `p1:${"f".repeat(64)}`,
      startedAt: later,
      completedAt: later + 60000,
    };
    await saveCompletedPlay(db, "account-b", ranked);
    expect(await listLeaderboard(db, ranked.puzzleId)).toHaveLength(1);
    await deleteAccount(db, "account-b");
    // The ID platform retries an interrupted withdrawal.
    await deleteAccount(db, "account-b");
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM deleted_accounts WHERE account_id = ?",
        )
        .bind("account-b")
        .first("n"),
    ).toBe(1);
    expect(await listCompletedPlays(db, "account-b")).toEqual([]);
    expect(await listLeaderboard(db, ranked.puzzleId)).toEqual([]);
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM leaderboard_profiles WHERE account_id = ?",
        )
        .bind("account-b")
        .first("n"),
    ).toBe(0);

    // A request checked just before the withdrawal can still write once; the
    // daily sweep removes it and keeps other accounts' records.
    await saveCompletedPlay(db, "account-b", {
      ...play,
      playId: crypto.randomUUID(),
    });
    expect(await saveCompletedPlay(db, "account-c", play)).toBe("created");
    expect(await listCompletedPlays(db, "account-c")).toHaveLength(1);
    await sweepDeletedAccounts(db);
    expect(await listCompletedPlays(db, "account-b")).toEqual([]);
    expect(await listCompletedPlays(db, "account-c")).toHaveLength(1);
  });
});

describe("the tables withdrawal deletes from", () => {
  // Tables with an account_id that deleteAccount leaves alone, and why.
  const KEPT = {
    // The withdrawal itself: auth.ts refuses the ID's cookie by it.
    deleted_accounts: "records the withdrawal",
  };

  it("cover every table with an account_id, directly or by ON DELETE CASCADE", async () => {
    const { results } = await env.DB.prepare(
      `SELECT m.name AS name FROM sqlite_master m
       JOIN pragma_table_info(m.name) c ON c.name = 'account_id'
       WHERE m.type = 'table' ORDER BY m.name`,
    ).all<{ name: string }>();
    const tables = results.map((row) => row.name);
    expect(tables.length).toBeGreaterThan(ACCOUNT_TABLES.length);
    for (const table of ACCOUNT_TABLES) expect(tables).toContain(table);

    // A table left out must lose its rows with a table that is deleted from:
    // its account_id refers to one with ON DELETE CASCADE.
    const covered = new Set<string>(ACCOUNT_TABLES);
    const cascades = new Map<string, string[]>();
    for (const table of tables) {
      const { results: keys } = await env.DB.prepare(
        `SELECT "table" AS parent, "from" AS column, on_delete
         FROM pragma_foreign_key_list(?)`,
      )
        .bind(table)
        .all<{ parent: string; column: string; on_delete: string }>();
      cascades.set(
        table,
        keys
          .filter((key) => key.column === "account_id")
          .filter((key) => key.on_delete === "CASCADE")
          .map((key) => key.parent),
      );
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const [table, parents] of cascades)
        if (!covered.has(table) && parents.some((p) => covered.has(p))) {
          covered.add(table);
          grew = true;
        }
    }
    const missed = tables.filter(
      (table) => !covered.has(table) && !(table in KEPT),
    );
    expect(
      missed,
      "add them to ACCOUNT_TABLES (src/worker/history.ts)",
    ).toEqual([]);
  });

  it("are swept again by their own scheduled run, not the daily's", async () => {
    const db = env.DB;
    const puzzle = generatePuzzle({ seed: "d1-sweep", difficulty: "easy" });
    const play = await createCompletedPlayUpload({
      id: crypto.randomUUID(),
      userId: "",
      seedCode: encodePuzzleSeed(puzzle),
      generatorVersion: puzzle.generatorVersion ?? "g1",
      difficulty: puzzle.difficulty ?? "easy",
      startedAt: 1000,
      completedAt: 61000,
      elapsedSeconds: 60,
      mistakes: 0,
      hintsUsed: 0,
      status: "completed",
    });
    await deleteAccount(db, "swept");
    // Written after the withdrawal by a request checked just before it.
    await saveCompletedPlay(db, "swept", play);
    const run = (cron: string) =>
      worker.scheduled(
        { cron, scheduledTime: Date.now() } as ScheduledController,
        env,
      );
    // The daily's run builds tomorrow's board and leaves the records alone.
    await run(CRONS.prepareDaily);
    expect(await listCompletedPlays(db, "swept")).toHaveLength(1);
    await run(CRONS.sweepDeletedAccounts);
    expect(await listCompletedPlays(db, "swept")).toEqual([]);
  });
});
