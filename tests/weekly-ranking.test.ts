import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { currentRankingWeek } from "../src/core/weekly-ranking";
import {
  listWeeklyRanking,
  weeklyRankingSql,
} from "../src/worker/weekly-ranking";
import worker from "../src/worker/index";
import { migrateTestDatabase } from "./migrations";

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
const now = Date.parse("2026-10-14T03:00:00Z");
const week = currentRankingWeek(now);
async function clear(
  account: string,
  puzzle: string,
  elapsed: number,
  at = week.start + 1000,
  difficulty = "easy",
  eligible = 1,
  version = "g3",
): Promise<void> {
  await platform.env.DB.prepare(
    `INSERT INTO completed_plays
    (account_id, play_id, puzzle_id, seed_code, generator_version, difficulty,
     started_at, completed_at, elapsed_seconds, mistakes, hints_used, ranking_eligible)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0, ?)`,
  )
    .bind(
      account,
      crypto.randomUUID(),
      puzzle,
      `TAKO:g2:${difficulty}:${puzzle}`,
      version,
      difficulty,
      at,
      elapsed,
      eligible,
    )
    .run();
}
beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: "./tests/wrangler.jsonc",
    persist: false,
    remoteBindings: false,
  });
  await migrateTestDatabase(platform.env.DB);
  for (const [id, name, consent] of [
    ["alpha", "🐙甲", 1],
    ["beta", "🐙乙", 1],
    ["gamma", "🐙丙", 1],
    ["private", "🐙非公開", null],
  ] as const) {
    await platform.env.DB.prepare(
      "INSERT INTO leaderboard_profiles (account_id, display_name, consent_version) VALUES (?, ?, ?)",
    )
      .bind(id, name, consent)
      .run();
  }
  await clear("beta", "b0", 1, week.start - 1);
  for (let i = 0; i < 5; i++) {
    await clear("alpha", `a${i}`, 50 + i * 10);
    // 旧版の盤面の記録も、新しい版の記録と同じ重みで数える。
    await clear("gamma", `g${i}`, 70, undefined, undefined, undefined, "g2");
    if (i < 4) await clear("beta", `b${i}`, 10);
  }
  await clear("alpha", "a0", 1, week.start + 2000); // faster replay must not replace first
  await clear("alpha", "old", 1, week.start - 1);
  await clear("alpha", "future", 1, now + 1000);
  await clear("alpha", "end", 1, week.end);
  await clear("alpha", "a0", 2, week.end + 1);
  await clear("alpha", "no-consent", 1, week.start + 1000, "easy", 0);
  await clear("private", "private", 1);
  await clear("beta", "normal", 100, week.start + 1000, "normal");
  await clear("beta", "b0", 1, week.start + 2000, "normal");
  await clear("beta", "special", 1, week.start + 1000, "hard", 1, "daily-v1");
});
afterAll(async () => {
  await platform?.dispose();
});
describe("weekly player ranking", () => {
  it("switches weeks exactly at Monday midnight JST, including year boundaries", () => {
    expect(currentRankingWeek(Date.parse("2026-10-11T14:59:59.999Z")).end).toBe(
      Date.parse("2026-10-11T15:00:00Z"),
    );
    expect(week).toEqual({
      start: Date.parse("2026-10-11T15:00:00Z"),
      end: Date.parse("2026-10-18T15:00:00Z"),
    });
    expect(currentRankingWeek(Date.parse("2027-01-01T00:00:00Z")).start).toBe(
      Date.parse("2026-12-27T15:00:00Z"),
    );
  });
  it("ranks distinct weekly puzzles, retains ties and excludes private, old, future and ineligible clears", async () => {
    const result = await listWeeklyRanking(
      platform.env.DB,
      "easy",
      "clears",
      now,
    );
    expect(result.entries).toEqual([
      { rank: 1, displayName: "🐙丙", clears: 5, averageSeconds: 70 },
      { rank: 1, displayName: "🐙甲", clears: 5, averageSeconds: 70 },
      { rank: 3, displayName: "🐙乙", clears: 4, averageSeconds: 10 },
    ]);
    expect(result).not.toHaveProperty("accountId");
  });
  it("requires five distinct clears for average time, isolates difficulty and never chooses faster replays", async () => {
    expect(
      (await listWeeklyRanking(platform.env.DB, "easy", "time", now)).entries,
    ).toHaveLength(2);
    expect(
      (await listWeeklyRanking(platform.env.DB, "normal", "clears", now))
        .entries,
    ).toEqual([
      { rank: 1, displayName: "🐙乙", clears: 1, averageSeconds: 100 },
    ]);
    expect(
      (await listWeeklyRanking(platform.env.DB, "hard", "clears", now)).entries,
    ).toEqual([]);
    expect(
      (await listWeeklyRanking(platform.env.DB, "normal", "time", now)).entries,
    ).toEqual([]);
  });
  it("counts a puzzle again next week and removes participation when consent is withdrawn", async () => {
    expect(
      (await listWeeklyRanking(platform.env.DB, "easy", "clears", week.end + 2))
        .entries,
    ).toEqual([
      { rank: 1, displayName: "🐙甲", clears: 2, averageSeconds: 1.5 },
    ]);
    await platform.env.DB.prepare(
      "UPDATE leaderboard_profiles SET consent_version = NULL WHERE account_id = 'beta'",
    ).run();
    expect(
      (await listWeeklyRanking(platform.env.DB, "normal", "clears", now))
        .entries,
    ).toEqual([]);
    await platform.env.DB.prepare(
      "UPDATE leaderboard_profiles SET consent_version = 1 WHERE account_id = 'beta'",
    ).run();
  });
  it("uses the weekly time range index instead of scanning all history", async () => {
    const plan = await platform.env.DB.prepare(
      `EXPLAIN QUERY PLAN ${weeklyRankingSql("time")}`,
    )
      .bind("easy", week.start, week.end, now)
      .all<{ detail: string }>();
    expect(
      plan.results.some(
        (row) =>
          row.detail.includes("completed_plays_weekly_eligible") &&
          row.detail.includes("SEARCH"),
      ),
    ).toBe(true);
  });
  it("provides anonymous read-only access and validates all filters without exposing account identifiers", async () => {
    const get = (suffix: string, method = "GET") =>
      worker.fetch(
        new Request(`https://test.example/api/weekly-ranking${suffix}`, {
          method,
        }) as Parameters<typeof worker.fetch>[0],
        platform.env,
      );
    expect((await get("?difficulty=super&metric=clears")).status).toBe(400);
    expect((await get("?difficulty=easy&metric=unknown")).status).toBe(400);
    expect((await get("?difficulty=easy&metric=clears", "POST")).status).toBe(
      405,
    );
    const response = await get("?difficulty=easy&metric=clears");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain('"account');
  });
});
