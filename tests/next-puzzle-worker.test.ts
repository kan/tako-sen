import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { registerAccountProfile } from "../src/worker/profile";
import { saveCompletedPlay } from "../src/worker/history";
import {
  CURRENT_SEED_CODES,
  listRankedPuzzleCandidates,
  RANKED_PUZZLE_CANDIDATES_SQL,
} from "../src/worker/next-puzzle";
import { LEADERBOARD_SQL, listLeaderboard } from "../src/worker/leaderboard";
import worker from "../src/worker/index";
import { explainQueryPlan, migrateTestDatabase } from "./migrations";
import { fetchAs, session, testAccount } from "./worker-env";

// Only clears made after consent are ranked, so the plays here are cleared
// after the profiles the tests register (an hour from now).
const later = Date.now() + 3_600_000;
const firstId = `p1:${"a".repeat(64)}`;
const secondId = `p1:${"b".repeat(64)}`;

beforeAll(async () => {
  await migrateTestDatabase(env.DB);
  for (const account of [
    "owner-a",
    "owner-b",
    "owner-c",
    testAccount("requester"),
  ])
    await registerAccountProfile(env.DB, account, account);
  for (const [account, puzzleId, seed] of [
    ["owner-a", firstId, "first"],
    ["owner-b", firstId, "first"],
    ["owner-c", secondId, "second"],
  ]) {
    await saveCompletedPlay(env.DB, account, {
      playId: crypto.randomUUID(),
      puzzleId,
      seedCode: `TAKO:g4:easy:${seed}`,
      generatorVersion: "g4",
      difficulty: "easy",
      startedAt: later,
      completedAt: later + 60000,
      elapsedSeconds: 60,
      hintsUsed: 0,
      mistakes: 0,
      maxHintStage: 0,
    });
  }
});

describe("ranked puzzle candidates", () => {
  it("uses indexed difficulty, completed-board exclusion and ranking lookup", async () => {
    const db = env.DB;
    const candidatePlan = await explainQueryPlan(
      db,
      RANKED_PUZZLE_CANDIDATES_SQL,
      "easy",
      CURRENT_SEED_CODES,
      testAccount("requester"),
    );
    // 版の条件を足しても、公開記録は索引だけで読める。
    expect(candidatePlan).toMatch(
      /SEARCH c USING COVERING INDEX completed_plays_public_difficulty/,
    );
    expect(candidatePlan).toContain("completed_plays_account_puzzle");
    expect(candidatePlan).toMatch(
      /SEARCH own USING COVERING INDEX completed_plays_account_puzzle \(account_id=\? AND puzzle_id=\?\)/,
    );
    expect(candidatePlan).not.toContain("first_ranked_plays");
    const rankingPlan = await explainQueryPlan(db, LEADERBOARD_SQL, firstId);
    expect(rankingPlan).not.toContain("SCAN c");
    expect(rankingPlan).toMatch(/SEARCH (c|f).*puzzle_id=/);
    expect(rankingPlan).not.toContain("first_ranked_plays");
  });
  it("offers only boards of the current generator version", async () => {
    const db = env.DB;
    const oldId = `p1:${"e".repeat(64)}`;
    // 旧版の盤面は記録が多くても候補にしない。ランキング自体は残る。
    for (const account of ["owner-a", "owner-b", "owner-c"])
      await saveCompletedPlay(db, account, {
        playId: crypto.randomUUID(),
        puzzleId: oldId,
        seedCode: "TAKO:g2:easy:old",
        generatorVersion: "g2",
        difficulty: "easy",
        startedAt: later,
        completedAt: later + 60000,
        elapsedSeconds: 60,
        hintsUsed: 0,
        mistakes: 0,
        maxHintStage: 0,
      });
    expect(await listLeaderboard(db, oldId)).toHaveLength(3);
    const offered = await listRankedPuzzleCandidates(
      db,
      testAccount("requester"),
      "easy",
    );
    expect(offered.map((candidate) => candidate.puzzleId)).not.toContain(oldId);
    expect(offered.length).toBeGreaterThan(0);
    expect(
      offered.every((candidate) => candidate.seedCode.startsWith("TAKO:g4:")),
    ).toBe(true);
  });
  it("returns popular boards without the requester's completed board", async () => {
    const db = env.DB;
    expect(
      await listRankedPuzzleCandidates(db, testAccount("requester"), "easy"),
    ).toEqual([
      {
        puzzleId: firstId,
        seedCode: "TAKO:g4:easy:first",
        players: 2,
      },
      {
        puzzleId: secondId,
        seedCode: "TAKO:g4:easy:second",
        players: 1,
      },
    ]);
    expect(
      await listRankedPuzzleCandidates(db, testAccount("requester"), "hard"),
    ).toEqual([]);
    await saveCompletedPlay(db, testAccount("requester"), {
      playId: crypto.randomUUID(),
      puzzleId: firstId,
      seedCode: "TAKO:g4:easy:first",
      generatorVersion: "g4",
      difficulty: "easy",
      startedAt: later,
      completedAt: later + 60000,
      elapsedSeconds: 60,
      hintsUsed: 0,
      mistakes: 0,
      maxHintStage: 0,
    });
    expect(
      (
        await listRankedPuzzleCandidates(db, testAccount("requester"), "easy")
      ).map((candidate) => candidate.puzzleId),
    ).toEqual([secondId]);
  });

  it("excludes private completed boards once and respects withdrawn consent", async () => {
    const db = env.DB;
    await registerAccountProfile(
      db,
      "private-check-owner",
      "private-check-owner",
    );
    const first = `p1:${"c".repeat(64)}`;
    const second = `p1:${"d".repeat(64)}`;
    const save = (account: string, puzzleId: string) =>
      saveCompletedPlay(db, account, {
        playId: crypto.randomUUID(),
        puzzleId,
        seedCode: `TAKO:g4:hard:${puzzleId}`,
        generatorVersion: "g4",
        difficulty: "hard",
        startedAt: later,
        completedAt: later + 60000,
        elapsedSeconds: 60,
        hintsUsed: 0,
        mistakes: 0,
        maxHintStage: 0,
      });
    await save("private-check-owner", first);
    await save("private-check-owner", second);
    // A replay is retained privately, but must not count as another participant.
    await save("private-check-owner", first);
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
    await save("private-check-requester", first);
    await save("private-check-requester", first);
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
    const apiEnv = {
      DB: env.DB,
      ALLOWED_ORIGINS: "https://example.com",
    } as Env;
    const call = (path: string) =>
      fetchAs(
        new Request(`https://example.com${path}`) as Parameters<
          typeof worker.fetch
        >[0],
        apiEnv,
      );
    session.account = null;
    expect((await call("/api/next-puzzle?difficulty=easy")).status).toBe(401);
    session.account = testAccount("requester");
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
