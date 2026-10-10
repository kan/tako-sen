import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { registerAccountProfile } from "../src/worker/profile";
import { saveCompletedPlay } from "../src/worker/history";
import {
  listRankedPuzzleCandidates,
  RANKED_PUZZLE_CANDIDATES_SQL,
} from "../src/worker/next-puzzle";
import { LEADERBOARD_SQL } from "../src/worker/leaderboard";
import worker from "../src/worker/index";
import { migrateTestDatabase } from "./migrations";

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
const firstId = `p1:${"a".repeat(64)}`;
const secondId = `p1:${"b".repeat(64)}`;

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: "./tests/wrangler.jsonc",
    persist: false,
    remoteBindings: false,
  });
  await migrateTestDatabase(platform.env.DB);
  for (const account of ["owner-a", "owner-b", "owner-c", "requester"])
    await registerAccountProfile(platform.env.DB, account, account);
  for (const [account, puzzleId, seed] of [
    ["owner-a", firstId, "first"],
    ["owner-b", firstId, "first"],
    ["owner-c", secondId, "second"],
  ]) {
    await saveCompletedPlay(
      platform.env.DB,
      account,
      {
        playId: crypto.randomUUID(),
        puzzleId,
        seedCode: `TAKO:g2:easy:${seed}`,
        generatorVersion: "g2",
        difficulty: "easy",
        startedAt: 1000,
        completedAt: 61000,
        elapsedSeconds: 60,
        hintsUsed: 0,
        mistakes: 0,
        maxHintStage: 0,
      },
      true,
    );
  }
});
afterAll(async () => platform?.dispose());

describe("ranked puzzle candidates", () => {
  it("uses indexed difficulty, completed-board exclusion and ranking lookup", async () => {
    const db = platform.env.DB;
    const candidates = await db
      .prepare(`EXPLAIN QUERY PLAN ${RANKED_PUZZLE_CANDIDATES_SQL}`)
      .bind("easy", "requester")
      .all<{ detail: string }>();
    const candidatePlan = candidates.results
      .map((row) => row.detail)
      .join("\n");
    expect(candidatePlan).toContain("completed_plays_public_difficulty");
    expect(candidatePlan).toContain("completed_plays_account_puzzle");
    expect(candidatePlan).toMatch(
      /SEARCH own USING COVERING INDEX completed_plays_account_puzzle \(account_id=\? AND puzzle_id=\?\)/,
    );
    expect(candidatePlan).not.toContain("first_ranked_plays");
    const ranking = await db
      .prepare(`EXPLAIN QUERY PLAN ${LEADERBOARD_SQL}`)
      .bind(firstId)
      .all<{ detail: string }>();
    const rankingPlan = ranking.results.map((row) => row.detail).join("\n");
    expect(rankingPlan).not.toContain("SCAN c");
    expect(rankingPlan).toMatch(/SEARCH (c|f).*puzzle_id=/);
    expect(rankingPlan).not.toContain("first_ranked_plays");
  });
  it("returns popular boards without the requester's completed board", async () => {
    const db = platform.env.DB;
    expect(await listRankedPuzzleCandidates(db, "requester", "easy")).toEqual([
      {
        puzzleId: firstId,
        seedCode: "TAKO:g2:easy:first",
        players: 2,
      },
      {
        puzzleId: secondId,
        seedCode: "TAKO:g2:easy:second",
        players: 1,
      },
    ]);
    expect(await listRankedPuzzleCandidates(db, "requester", "hard")).toEqual(
      [],
    );
    await saveCompletedPlay(
      db,
      "requester",
      {
        playId: crypto.randomUUID(),
        puzzleId: firstId,
        seedCode: "TAKO:g2:easy:first",
        generatorVersion: "g2",
        difficulty: "easy",
        startedAt: 1000,
        completedAt: 61000,
        elapsedSeconds: 60,
        hintsUsed: 0,
        mistakes: 0,
        maxHintStage: 0,
      },
      true,
    );
    expect(
      (await listRankedPuzzleCandidates(db, "requester", "easy")).map(
        (candidate) => candidate.puzzleId,
      ),
    ).toEqual([secondId]);
  });

  it("excludes private completed boards once and respects withdrawn consent", async () => {
    const db = platform.env.DB;
    await registerAccountProfile(
      db,
      "private-check-owner",
      "private-check-owner",
    );
    const first = `p1:${"c".repeat(64)}`;
    const second = `p1:${"d".repeat(64)}`;
    const save = (account: string, puzzleId: string, publicPlay: boolean) =>
      saveCompletedPlay(
        db,
        account,
        {
          playId: crypto.randomUUID(),
          puzzleId,
          seedCode: `TAKO:g2:hard:${puzzleId}`,
          generatorVersion: "g2",
          difficulty: "hard",
          startedAt: 1000,
          completedAt: 61000,
          elapsedSeconds: 60,
          hintsUsed: 0,
          mistakes: 0,
          maxHintStage: 0,
        },
        publicPlay,
      );
    await save("private-check-owner", first, true);
    await save("private-check-owner", second, true);
    // A replay is retained privately, but must not count as another participant.
    await save("private-check-owner", first, true);
    const repeated = await listRankedPuzzleCandidates(
      db,
      "private-check-requester",
      "hard",
    );
    expect(repeated.find((entry) => entry.puzzleId === first)?.players).toBe(1);
    const invalidPublic = await db
      .prepare(
        `SELECT COUNT(*) AS count
      FROM completed_plays c WHERE c.is_public = 1 AND NOT EXISTS (
        SELECT 1 FROM first_ranked_plays f WHERE f.account_id = c.account_id
          AND f.puzzle_id = c.puzzle_id AND f.play_id = c.play_id
      )`,
      )
      .first<{ count: number }>();
    expect(invalidPublic?.count).toBe(0);
    expect(
      await listRankedPuzzleCandidates(db, "private-check-requester", "hard"),
    ).toHaveLength(2);
    await save("private-check-requester", first, false);
    await save("private-check-requester", first, false);
    expect(
      (
        await listRankedPuzzleCandidates(db, "private-check-requester", "hard")
      ).map((entry) => entry.puzzleId),
    ).toEqual([second]);
    await db
      .prepare(
        "UPDATE leaderboard_profiles SET consent_version = NULL WHERE account_id = ?",
      )
      .bind("private-check-owner")
      .run();
    expect(
      await listRankedPuzzleCandidates(db, "private-check-requester", "hard"),
    ).toEqual([]);
  });

  it("requires authentication and validates difficulty without exposing accounts", async () => {
    const env = {
      DB: platform.env.DB,
      ALLOWED_ORIGINS: "https://example.com",
    } as Env;
    const call = (path: string) =>
      worker.fetch(
        new Request(`https://example.com${path}`) as Parameters<
          typeof worker.fetch
        >[0],
        env,
      );
    auth.account = null;
    expect((await call("/api/next-puzzle?difficulty=easy")).status).toBe(401);
    auth.account = "requester";
    expect((await call("/api/next-puzzle?difficulty=unknown")).status).toBe(
      400,
    );
    const response = await call("/api/next-puzzle?difficulty=easy");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body: { candidates: object[] } = await response.json();
    expect(body.candidates).toHaveLength(1);
    expect(Object.keys(body.candidates[0]).sort()).toEqual([
      "players",
      "puzzleId",
      "seedCode",
    ]);
  });
});
