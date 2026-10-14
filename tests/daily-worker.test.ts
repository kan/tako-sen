import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { migrateTestDatabase } from "./migrations";
import { registerAccountProfile } from "../src/worker/profile";
import { deleteAccountHistory } from "../src/worker/history";
import {
  completeDailyAttempt,
  getDailyStatus,
  listDailyHistory,
  listDailyLeaderboard,
  parseDailyCompletion,
  prepareNextDailyPuzzle,
  startDailyAttempt,
} from "../src/worker/daily";
import {
  DAILY_V2_START_DATE,
  dailyDate,
  generateDailyPuzzle,
} from "../src/core/daily-puzzle";
import { puzzleId } from "../src/core/puzzle-identity";
import { restoreSharedPuzzleSnapshot } from "../src/core/shared-puzzle";

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
  await registerAccountProfile(platform.env.DB, "daily-c", "デイリーC");
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
    const thirdPlayId = crypto.randomUUID();
    expect(
      await startDailyAttempt(db, "daily-c", status.date, thirdPlayId, now),
    ).toBe("started");
    expect(
      await completeDailyAttempt(
        db,
        "daily-c",
        {
          ...completion,
          playId: thirdPlayId,
          elapsedSeconds: 200,
          mistakes: 0,
        },
        later,
      ),
    ).toBe("completed");
    const scoredRanking = await listDailyLeaderboard(
      db,
      status.date,
      "daily-b",
    );
    expect(scoredRanking.map((entry) => entry.rank)).toEqual([1, 2, 2]);
    expect(scoredRanking[0].displayName).toBe("デイリーC");
    await deleteAccountHistory(db, "daily-a");
    expect(
      (await listDailyLeaderboard(db, status.date, "daily-b")).map(
        (entry) => entry.displayName,
      ),
    ).toEqual(["デイリーC", "デイリーB"]);
  });

  it("lists only the account's own attempts, unfinished ones with null results", async () => {
    const db = platform.env.DB;
    await registerAccountProfile(db, "daily-d", "デイリーD");
    const status = await getDailyStatus(db, "daily-d", now);
    const ownPlayId = crypto.randomUUID();
    await startDailyAttempt(db, "daily-d", status.date, ownPlayId, now);
    expect(await listDailyHistory(db, "daily-d")).toEqual([
      {
        playId: ownPlayId,
        date: status.date,
        startedAt: now,
        completedAt: null,
        elapsedSeconds: null,
        mistakes: null,
        hintsUsed: null,
      },
    ]);
    const puzzle = await restoreSharedPuzzleSnapshot(status.puzzle);
    await completeDailyAttempt(
      db,
      "daily-d",
      parseDailyCompletion({
        date: status.date,
        playId: ownPlayId,
        puzzleId: status.puzzle.id,
        pieces: puzzle.solution,
        elapsedSeconds: 95,
        mistakes: 2,
        hintsUsed: 1,
        maxHintStage: 1,
      }),
      later,
    );
    expect(await listDailyHistory(db, "daily-d")).toMatchObject([
      {
        playId: ownPlayId,
        completedAt: later,
        elapsedSeconds: 95,
        mistakes: 2,
        hintsUsed: 1,
      },
    ]);
    expect(await listDailyHistory(db, "nobody")).toEqual([]);
  });
});

describe("daily-v2 switch and the board prepared a day ahead", () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const startDay = Date.parse(`${DAILY_V2_START_DATE}T00:00:00+09:00`);
  const dateAfter = (days: number) => dailyDate(startDay + days * dayMs);
  const storedRow = (date: string) =>
    platform.env.DB.prepare(
      "SELECT puzzle_id, generator_version, created_at FROM daily_puzzles WHERE challenge_date = ?",
    )
      .bind(date)
      .first<{
        puzzle_id: string;
        generator_version: string;
        created_at: number;
      }>();

  it("stores tomorrow's board ahead and serves it unchanged", async () => {
    const db = platform.env.DB;
    const eve = startDay - 60 * 60 * 1000;
    expect((await getDailyStatus(db, "daily-b", eve)).puzzle).toMatchObject({
      generatorVersion: "daily-v1",
    });
    await prepareNextDailyPuzzle(db, eve);
    const stored = await storedRow(DAILY_V2_START_DATE);
    expect(stored).toMatchObject({
      generator_version: "daily-v2",
      created_at: eve,
    });
    await prepareNextDailyPuzzle(db, eve + 1000);
    expect(await storedRow(DAILY_V2_START_DATE)).toEqual(stored);
    const status = await getDailyStatus(db, "daily-b", startDay + 1000);
    expect(status.date).toBe(DAILY_V2_START_DATE);
    expect(status.puzzle).toMatchObject({
      id: stored!.puzzle_id,
      generatorVersion: "daily-v2",
      givens: [],
    });
    expect((await storedRow(DAILY_V2_START_DATE))!.created_at).toBe(eve);
  });

  it("builds a day nothing prepared on its first request, and accepts its solution", async () => {
    const db = platform.env.DB;
    const date = dateAfter(1);
    const at = startDay + dayMs + 1000;
    expect(await storedRow(date)).toBeNull();
    const status = await getDailyStatus(db, "daily-b", at);
    expect(status.date).toBe(date);
    expect(status.puzzle.generatorVersion).toBe("daily-v2");
    expect(await storedRow(date)).toMatchObject({
      puzzle_id: status.puzzle.id,
      generator_version: "daily-v2",
    });
    const puzzle = await restoreSharedPuzzleSnapshot(status.puzzle);
    const attempt = crypto.randomUUID();
    expect(await startDailyAttempt(db, "daily-b", date, attempt, at)).toBe(
      "started",
    );
    expect(
      await completeDailyAttempt(
        db,
        "daily-b",
        parseDailyCompletion({
          date,
          playId: attempt,
          puzzleId: status.puzzle.id,
          pieces: puzzle.solution,
          elapsedSeconds: 300,
          mistakes: 0,
          hintsUsed: 0,
          maxHintStage: 0,
        }),
        at,
      ),
    ).toBe("completed");
  });

  it("keeps the version a stored board was built with", async () => {
    const db = platform.env.DB;
    const date = dateAfter(5);
    const at = startDay + 5 * dayMs + 1000;
    const old = generateDailyPuzzle(date, "daily-v1");
    // Written the way rows were before the version column existed.
    await db
      .prepare(
        `INSERT INTO daily_puzzles (challenge_date, puzzle_id, regions_json, givens_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        date,
        await puzzleId(old),
        JSON.stringify(old.regions),
        JSON.stringify(old.givens),
        at,
      )
      .run();
    const status = await getDailyStatus(db, "daily-b", at);
    expect(status.puzzle.generatorVersion).toBe("daily-v1");
    expect(await restoreSharedPuzzleSnapshot(status.puzzle)).toEqual(old);
    const attempt = crypto.randomUUID();
    expect(await startDailyAttempt(db, "daily-b", date, attempt, at)).toBe(
      "started",
    );
    expect(
      await completeDailyAttempt(
        db,
        "daily-b",
        parseDailyCompletion({
          date,
          playId: attempt,
          puzzleId: status.puzzle.id,
          pieces: old.solution,
          elapsedSeconds: 300,
          mistakes: 0,
          hintsUsed: 0,
          maxHintStage: 0,
        }),
        at,
      ),
    ).toBe("completed");
  });
});
