import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { generatePuzzle } from "../src/core/generator";
import { createCompletedPlayUpload } from "../src/core/online-history";
import {
  createSharedPuzzleSnapshot,
  restoreSharedPuzzleSnapshot,
} from "../src/core/shared-puzzle";
import { encodePuzzleSeed } from "../src/core/puzzle-code";
import {
  deleteAccount,
  listCompletedPlays,
  saveCompletedPlay,
  sweepDeletedAccounts,
} from "../src/worker/history";
import worker from "../src/worker/index";
import { getSharedPuzzle, saveSharedPuzzle } from "../src/worker/puzzles";
import { listLeaderboard } from "../src/worker/leaderboard";
import { registerAccountProfile } from "../src/worker/profile";
import { migrateTestDatabase } from "./migrations";

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: "./tests/wrangler.jsonc",
    persist: false,
    remoteBindings: false,
  });
  await migrateTestDatabase(platform.env.DB);
});

describe("public puzzle snapshots", () => {
  it("saves a validated snapshot without a solution", async () => {
    const snapshot = await createSharedPuzzleSnapshot(
      "TAKO:g1:easy:d1-shared-puzzle",
    );
    const db = platform.env.DB;
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

afterAll(async () => {
  await platform?.dispose();
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
    const db = platform.env.DB;
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
    await saveCompletedPlay(db, "account-b", {
      ...play,
      playId: crypto.randomUUID(),
    });
    expect(await listLeaderboard(db, play.puzzleId)).toHaveLength(1);
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
    expect(await listLeaderboard(db, play.puzzleId)).toEqual([]);
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
    await saveCompletedPlay(db, "account-c", play);
    await sweepDeletedAccounts(db);
    expect(await listCompletedPlays(db, "account-b")).toEqual([]);
    expect(await listCompletedPlays(db, "account-c")).toHaveLength(1);
  });
});
