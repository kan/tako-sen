import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { generatePuzzle } from "../src/core/generator";
import { createCompletedPlayUpload } from "../src/core/online-history";
import { encodePuzzleSeed } from "../src/core/puzzle-code";
import {
  deleteAccountHistory,
  listCompletedPlays,
  saveCompletedPlay,
} from "../src/worker/history";

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: "./tests/wrangler.jsonc",
    persist: false,
    remoteBindings: false,
  });
  const migration = readFileSync(
    new URL("../migrations/0001_completed_plays.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration.split(";").map((sql) => sql.trim())) {
    if (statement) await platform.env.DB.prepare(statement).run();
  }
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
    expect(await listCompletedPlays(db, "account-a")).toEqual([play]);
    expect(await listCompletedPlays(db, "account-b")).toEqual([play]);
    expect(await listCompletedPlays(db, "account-c")).toEqual([]);
    await deleteAccountHistory(db, "account-a");
    await deleteAccountHistory(db, "account-a");
    expect(await listCompletedPlays(db, "account-a")).toEqual([]);
    expect(await listCompletedPlays(db, "account-b")).toEqual([play]);
  });
});
