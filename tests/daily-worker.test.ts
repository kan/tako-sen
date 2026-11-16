import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { migrateTestDatabase } from "./migrations";
import { registerAccountProfile } from "../src/worker/profile";
import { deleteAccount } from "../src/worker/history";
import {
  completeDailyAttempt,
  getDailyStatus,
  listDailyHistory,
  listDailyLeaderboard,
  parseDailyCompletion,
  getOrCreateDailyPuzzle,
  prepareNextDailyPuzzle,
  startDailyAttempt,
} from "../src/worker/daily";
import {
  DAILY_V2_START_DATE,
  dailyDate,
  dailySeed,
  generateDailyPuzzle,
} from "../src/core/daily-puzzle";
import { puzzleId } from "../src/core/puzzle-identity";
import { restoreSharedPuzzleSnapshot } from "../src/core/shared-puzzle";

const now = Date.parse("2026-10-01T15:30:00Z");
const later = Date.parse("2026-10-02T15:30:00Z");
const playId = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  await migrateTestDatabase(env.DB);
  await registerAccountProfile(env.DB, "daily-a", "デイリーA");
  await registerAccountProfile(env.DB, "daily-b", "デイリーB");
  await registerAccountProfile(env.DB, "daily-c", "デイリーC");
});
describe("daily challenge server contract", () => {
  it("fixes one board per Japan date without returning its solution", async () => {
    const first = await getDailyStatus(
      env.DB,
      "daily-a",
      now,
      env.DAILY_SEED_SECRET,
    );
    const second = await getDailyStatus(
      env.DB,
      "daily-b",
      now,
      env.DAILY_SEED_SECRET,
    );
    expect(first.date).toBe("2026-10-02");
    expect(first.puzzle).toEqual(second.puzzle);
    expect(first.puzzle.size).toBe(10);
    expect(first.puzzle).not.toHaveProperty("solution");
    expect(first.attempt).toBe("not_started");
  });

  it("permits only one attempt, verifies completion, and ranks only completed accounts", async () => {
    const db = env.DB;
    const status = await getDailyStatus(
      db,
      "daily-a",
      now,
      env.DAILY_SEED_SECRET,
    );
    expect(
      await startDailyAttempt(
        db,
        "daily-a",
        status.date,
        playId,
        now,
        env.DAILY_SEED_SECRET,
      ),
    ).toBe("started");
    expect(
      await startDailyAttempt(
        db,
        "daily-a",
        status.date,
        playId,
        now,
        env.DAILY_SEED_SECRET,
      ),
    ).toBe("duplicate");
    expect(
      await startDailyAttempt(
        db,
        "daily-a",
        status.date,
        crypto.randomUUID(),
        now,
        env.DAILY_SEED_SECRET,
      ),
    ).toBe("already_started");
    expect(
      await startDailyAttempt(
        db,
        "daily-a",
        "2026-10-01",
        crypto.randomUUID(),
        now,
        env.DAILY_SEED_SECRET,
      ),
    ).toBe("expired");
    expect(
      (await getDailyStatus(db, "daily-a", now, env.DAILY_SEED_SECRET)).attempt,
    ).toBe("active");
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
    expect(
      (await getDailyStatus(db, "daily-a", now, env.DAILY_SEED_SECRET)).attempt,
    ).toBe("completed");
    expect(
      await listDailyLeaderboard(db, status.date, "daily-a"),
    ).toMatchObject([{ rank: 1, displayName: "デイリーA", isSelf: true }]);
    const secondPlayId = crypto.randomUUID();
    expect(
      await startDailyAttempt(
        db,
        "daily-b",
        status.date,
        secondPlayId,
        now,
        env.DAILY_SEED_SECRET,
      ),
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
      await startDailyAttempt(
        db,
        "daily-c",
        status.date,
        thirdPlayId,
        now,
        env.DAILY_SEED_SECRET,
      ),
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
    await deleteAccount(db, "daily-a");
    expect(
      (await listDailyLeaderboard(db, status.date, "daily-b")).map(
        (entry) => entry.displayName,
      ),
    ).toEqual(["デイリーC", "デイリーB"]);
  });

  it("lists only the account's own attempts, unfinished ones with null results", async () => {
    const db = env.DB;
    await registerAccountProfile(db, "daily-d", "デイリーD");
    const status = await getDailyStatus(
      db,
      "daily-d",
      now,
      env.DAILY_SEED_SECRET,
    );
    const ownPlayId = crypto.randomUUID();
    await startDailyAttempt(
      db,
      "daily-d",
      status.date,
      ownPlayId,
      now,
      env.DAILY_SEED_SECRET,
    );
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
    env.DB.prepare(
      "SELECT puzzle_id, generator_version, created_at FROM daily_puzzles WHERE challenge_date = ?",
    )
      .bind(date)
      .first<{
        puzzle_id: string;
        generator_version: string;
        created_at: number;
      }>();

  it("stores tomorrow's board ahead and serves it unchanged", async () => {
    const db = env.DB;
    const eve = startDay - 60 * 60 * 1000;
    expect(
      (await getDailyStatus(db, "daily-b", eve, env.DAILY_SEED_SECRET)).puzzle,
    ).toMatchObject({
      generatorVersion: "daily-v1",
    });
    await prepareNextDailyPuzzle(db, eve, env.DAILY_SEED_SECRET);
    const stored = await storedRow(DAILY_V2_START_DATE);
    expect(stored).toMatchObject({
      generator_version: "daily-v2",
      created_at: eve,
    });
    await prepareNextDailyPuzzle(db, eve + 1000, env.DAILY_SEED_SECRET);
    expect(await storedRow(DAILY_V2_START_DATE)).toEqual(stored);
    const status = await getDailyStatus(
      db,
      "daily-b",
      startDay + 1000,
      env.DAILY_SEED_SECRET,
    );
    expect(status.date).toBe(DAILY_V2_START_DATE);
    expect(status.puzzle).toMatchObject({
      id: stored!.puzzle_id,
      generatorVersion: "daily-v2",
      givens: [],
    });
    expect((await storedRow(DAILY_V2_START_DATE))!.created_at).toBe(eve);
  });

  it("builds a day nothing prepared on its first request, and accepts its solution", async () => {
    const db = env.DB;
    const date = dateAfter(1);
    const at = startDay + dayMs + 1000;
    expect(await storedRow(date)).toBeNull();
    const status = await getDailyStatus(
      db,
      "daily-b",
      at,
      env.DAILY_SEED_SECRET,
    );
    expect(status.date).toBe(date);
    expect(status.puzzle.generatorVersion).toBe("daily-v2");
    expect(await storedRow(date)).toMatchObject({
      puzzle_id: status.puzzle.id,
      generator_version: "daily-v2",
    });
    const puzzle = await restoreSharedPuzzleSnapshot(status.puzzle);
    const attempt = crypto.randomUUID();
    expect(
      await startDailyAttempt(
        db,
        "daily-b",
        date,
        attempt,
        at,
        env.DAILY_SEED_SECRET,
      ),
    ).toBe("started");
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
    const db = env.DB;
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
    const status = await getDailyStatus(
      db,
      "daily-b",
      at,
      env.DAILY_SEED_SECRET,
    );
    expect(status.puzzle.generatorVersion).toBe("daily-v1");
    expect(await restoreSharedPuzzleSnapshot(status.puzzle)).toEqual(old);
    const attempt = crypto.randomUUID();
    expect(
      await startDailyAttempt(
        db,
        "daily-b",
        date,
        attempt,
        at,
        env.DAILY_SEED_SECRET,
      ),
    ).toBe("started");
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

describe("daily-v3 boards", () => {
  it("are built from the secret, and stored without it", async () => {
    const date = "2026-12-01";
    const at = Date.parse("2026-11-30T15:30:00Z");
    // Without the secret, no board is made or stored.
    await expect(
      getOrCreateDailyPuzzle(env.DB, date, at, ""),
    ).rejects.toThrow();
    const snapshot = await getOrCreateDailyPuzzle(
      env.DB,
      date,
      at,
      env.DAILY_SEED_SECRET,
    );
    expect(snapshot.generatorVersion).toBe("daily-v3");
    expect(snapshot.seed).toBe(date);
    const seed = await dailySeed(env.DAILY_SEED_SECRET, date);
    const expected = generateDailyPuzzle(date, "daily-v3", seed);
    expect(snapshot.id).toBe(await puzzleId(expected));
    expect(snapshot.regions).toEqual(expected.regions);
    // The board of the date's code and date alone (daily-v2) is another.
    expect(snapshot.regions).not.toEqual(
      generateDailyPuzzle(date, "daily-v2").regions,
    );
    const row = await env.DB.prepare(
      "SELECT * FROM daily_puzzles WHERE challenge_date = ?",
    )
      .bind(date)
      .first();
    expect(JSON.stringify(row)).not.toContain(seed);
    // A stored board no longer depends on the secret.
    expect(
      await getOrCreateDailyPuzzle(env.DB, date, at, "another-secret"),
    ).toEqual(snapshot);
  });

  it("are not sent before their day begins in Japan", async () => {
    // 23:00 on 2026-12-09 in Japan: the scheduled run builds 2026-12-10.
    const prepared = Date.parse("2026-12-09T14:00:00Z");
    await prepareNextDailyPuzzle(env.DB, prepared, env.DAILY_SEED_SECRET);
    const tomorrow = await getOrCreateDailyPuzzle(
      env.DB,
      "2026-12-10",
      prepared,
      env.DAILY_SEED_SECRET,
    );
    const beforeMidnight = Date.parse("2026-12-09T14:59:59Z");
    const status = await getDailyStatus(
      env.DB,
      "daily-a",
      beforeMidnight,
      env.DAILY_SEED_SECRET,
    );
    expect(status.date).toBe("2026-12-09");
    expect(status.puzzle.id).not.toBe(tomorrow.id);
    expect(
      await startDailyAttempt(
        env.DB,
        "daily-a",
        "2026-12-10",
        crypto.randomUUID(),
        beforeMidnight,
        env.DAILY_SEED_SECRET,
      ),
    ).toBe("expired");
    const atMidnight = await getDailyStatus(
      env.DB,
      "daily-a",
      Date.parse("2026-12-09T15:00:00Z"),
      env.DAILY_SEED_SECRET,
    );
    expect(atMidnight.date).toBe("2026-12-10");
    expect(atMidnight.puzzle).toEqual(tomorrow);
  });
});
