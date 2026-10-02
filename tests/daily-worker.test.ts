import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { migrateTestDatabase } from "./migrations";
import { registerAccountProfile } from "../src/worker/profile";
import { deleteAccountHistory } from "../src/worker/history";
import {
  completeDailyAttempt,
  getDailyStatus,
  listDailyLeaderboard,
  parseDailyCompletion,
  startDailyAttempt,
} from "../src/worker/daily";

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
const now = Date.parse("2026-10-01T15:30:00Z");
const later = Date.parse("2026-10-02T15:30:00Z");
const playId = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: "./tests/wrangler.jsonc",
    persist: false,
    remoteBindings: false,
  });
  await migrateTestDatabase(platform.env.DB);
  await registerAccountProfile(platform.env.DB, "daily-a", "デイリーA");
  await registerAccountProfile(platform.env.DB, "daily-b", "デイリーB");
});
afterAll(async () => {
  await platform?.dispose();
});

describe("daily challenge server contract", () => {
  it("fixes one board per Japan date without returning its solution", async () => {
    const first = await getDailyStatus(platform.env.DB, "daily-a", now);
    const second = await getDailyStatus(platform.env.DB, "daily-b", now);
    expect(first.date).toBe("2026-10-02");
    expect(first.puzzle).toEqual(second.puzzle);
    expect(first.puzzle.size).toBe(10);
    expect(first.puzzle).not.toHaveProperty("solution");
    expect(first.attempt).toBe("not_started");
  });

  it("permits only one attempt, verifies completion, and ranks only completed accounts", async () => {
    const db = platform.env.DB;
    const status = await getDailyStatus(db, "daily-a", now);
    expect(
      await startDailyAttempt(db, "daily-a", status.date, playId, now),
    ).toBe("started");
    expect(
      await startDailyAttempt(db, "daily-a", status.date, playId, now),
    ).toBe("duplicate");
    expect(
      await startDailyAttempt(
        db,
        "daily-a",
        status.date,
        crypto.randomUUID(),
        now,
      ),
    ).toBe("already_started");
    expect(
      await startDailyAttempt(
        db,
        "daily-a",
        "2026-10-01",
        crypto.randomUUID(),
        now,
      ),
    ).toBe("expired");
    expect((await getDailyStatus(db, "daily-a", now)).attempt).toBe("active");
    const { restoreSharedPuzzleSnapshot } =
      await import("../src/core/shared-puzzle");
    const puzzle = await restoreSharedPuzzleSnapshot(status.puzzle);
    const completion = parseDailyCompletion({
      date: status.date,
      playId,
      puzzleId: status.puzzle.id,
      pieces: puzzle.solution,
      elapsedSeconds: 120,
      mistakes: 1,
      hintsUsed: 0,
      maxHintStage: 0,
    });
    expect(
      await completeDailyAttempt(
        db,
        "daily-a",
        { ...completion, pieces: Array(10).fill(0) },
        now,
      ),
    ).toBe("invalid_solution");
    expect(await completeDailyAttempt(db, "daily-b", completion, now)).toBe(
      "not_started",
    );
    expect(await completeDailyAttempt(db, "daily-a", completion, later)).toBe(
      "completed",
    );
    expect(await completeDailyAttempt(db, "daily-a", completion, later)).toBe(
      "duplicate",
    );
    expect((await getDailyStatus(db, "daily-a", now)).attempt).toBe(
      "completed",
    );
    expect(
      await listDailyLeaderboard(db, status.date, "daily-a"),
    ).toMatchObject([{ rank: 1, displayName: "デイリーA", isSelf: true }]);
    const secondPlayId = crypto.randomUUID();
    expect(
      await startDailyAttempt(db, "daily-b", status.date, secondPlayId, now),
    ).toBe("started");
    expect(
      await completeDailyAttempt(
        db,
        "daily-b",
        { ...completion, playId: secondPlayId },
        later,
      ),
    ).toBe("completed");
    const tiedRanking = await listDailyLeaderboard(db, status.date, "daily-b");
    expect(tiedRanking.map((entry) => entry.rank)).toEqual([1, 1]);
    expect(tiedRanking.filter((entry) => entry.isSelf)).toHaveLength(1);
    await deleteAccountHistory(db, "daily-a");
    expect(
      await listDailyLeaderboard(db, status.date, "daily-b"),
    ).toMatchObject([{ displayName: "デイリーB", isSelf: true }]);
  });
});
