import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { CompletedPlayUpload } from "../src/core/online-history";
import { createCompletedPlayUpload } from "../src/core/online-history";
import {
  deleteAccountHistory,
  listCompletedPlays,
  saveCompletedPlay,
} from "../src/worker/history";
import { listLeaderboard } from "../src/worker/leaderboard";
import {
  getAccountProfile,
  registerAccountProfile,
} from "../src/worker/profile";
import worker from "../src/worker/index";
import { migrateTestDatabase } from "./migrations";

const auth = vi.hoisted(() => ({ account: null as string | null }));
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    authenticateRequest: async () => ({
      isAuthenticated: auth.account !== null,
      toAuth: () => ({ userId: auth.account }),
    }),
    users: { deleteUser: async () => undefined },
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
  const db = platform.env.DB;
  await migrateTestDatabase(
    db,
    async () => {
      await db
        .prepare(
          "INSERT INTO leaderboard_profiles (account_id, display_name) VALUES ('legacy', 'タコ-旧匿名名')",
        )
        .run();
      await db
        .prepare(
          `INSERT INTO completed_plays
      (account_id, play_id, puzzle_id, seed_code, generator_version, difficulty, started_at,
       completed_at, elapsed_seconds, mistakes, hints_used, is_public)
      VALUES ('legacy', ?, ?, 'TAKO:g1:easy:ranking', 'g1', 'easy', 1000, 101000, 100, 0, 0, 1)`,
        )
        .bind(crypto.randomUUID(), puzzleId)
        .run();
    },
    async () => {
      for (const [account, hints] of [
        ["migration-hinted", 2],
        ["migration-unhinted", 0],
      ] as const) {
        await registerAccountProfile(db, account, account);
        await db
          .prepare(
            `INSERT INTO completed_plays
        (account_id, play_id, puzzle_id, seed_code, generator_version, difficulty, started_at,
         completed_at, elapsed_seconds, mistakes, hints_used, ranking_eligible)
        VALUES (?, ?, ?, 'TAKO:g1:easy:ranking', 'g1', 'easy', 1000, 101000, 100, 0, ?, 1)`,
          )
          .bind(account, crypto.randomUUID(), `p1:${"d".repeat(64)}`, hints)
          .run();
      }
    },
  );
});
afterAll(async () => {
  await platform?.dispose();
});

describe("consented automatic first-clear ranking", () => {
  it("migrates old first scores without deleting, replacing or republishing records", async () => {
    const db = platform.env.DB;
    const hinted = (await listCompletedPlays(db, "migration-hinted"))[0];
    const unhinted = (await listCompletedPlays(db, "migration-unhinted"))[0];
    expect(hinted.maxHintStage).toBeNull();
    expect(unhinted.maxHintStage).toBe(0);
    expect(hinted.isPublic).toBe(true);
    expect(unhinted.isPublic).toBe(true);
    expect(
      await saveCompletedPlay(
        db,
        "migration-hinted",
        { ...hinted, maxHintStage: undefined },
        true,
      ),
    ).toBe("duplicate");
    const ranked = await listLeaderboard(db, hinted.puzzleId);
    expect(ranked.map((entry) => entry.maxHintStage)).toEqual([0, null]);
    await deleteAccountHistory(db, "migration-hinted");
    await deleteAccountHistory(db, "migration-unhinted");
  });
  it("scores time, mistakes and hints while keeping ties and detecting changed-depth retries", async () => {
    const db = platform.env.DB;
    const id = `p1:${"e".repeat(64)}`;
    const records = [
      ["depth-none", 0, 0, 200],
      ["depth-shallow", 1, 1, 90],
      ["depth-tie-a", 1, 2, 10],
      ["depth-tie-b", 1, 2, 10],
      ["depth-deep", 1, 4, 1],
      ["depth-unknown", 1, null, 0],
    ] as const;
    for (const [account, hintsUsed, maxHintStage, elapsedSeconds] of records) {
      await registerAccountProfile(db, account, account);
      const first = play({
        puzzleId: id,
        hintsUsed,
        maxHintStage,
        elapsedSeconds,
      });
      expect(await saveCompletedPlay(db, account, first, true)).toBe("created");
      expect(await saveCompletedPlay(db, account, first, true)).toBe(
        "duplicate",
      );
      if (maxHintStage === 2)
        expect(
          await saveCompletedPlay(
            db,
            account,
            { ...first, maxHintStage: 3 },
            true,
          ),
        ).toBe("conflict");
      expect((await listCompletedPlays(db, account))[0].maxHintStage).toBe(
        maxHintStage,
      );
    }
    const leaderboard = await listLeaderboard(db, id);
    expect(leaderboard.map((entry) => entry.rank)).toEqual([1, 2, 3, 3, 5, 6]);
    expect(leaderboard.map((entry) => entry.maxHintStage)).toEqual([
      null,
      4,
      2,
      2,
      1,
      0,
    ]);
    // より浅い再挑戦も初回スコアの置換はしない。
    await saveCompletedPlay(
      db,
      "depth-deep",
      play({ puzzleId: id, elapsedSeconds: 0, maxHintStage: 0 }),
      true,
    );
    expect(
      (await listLeaderboard(db, id)).find(
        (entry) => entry.displayName === "depth-deep",
      )?.maxHintStage,
    ).toBe(4);
    for (const [account] of records) await deleteAccountHistory(db, account);
  });

  it("puts a slower clean solve ahead of a faster solve with a mistake", async () => {
    const db = platform.env.DB;
    const id = `p1:${"f".repeat(64)}`;
    for (const [account, elapsedSeconds, mistakes] of [
      ["score-fast-miss", 30, 1],
      ["score-slow-clean", 120, 0],
    ] as const) {
      await registerAccountProfile(db, account, account);
      expect(
        await saveCompletedPlay(
          db,
          account,
          play({ puzzleId: id, elapsedSeconds, mistakes }),
          true,
        ),
      ).toBe("created");
    }
    expect(
      (await listLeaderboard(db, id)).map((entry) => entry.displayName),
    ).toEqual(["score-slow-clean", "score-fast-miss"]);
  });
  it("withdraws legacy publications without deleting history or treating generated aliases as consent", async () => {
    const db = platform.env.DB;
    expect(await getAccountProfile(db, "legacy")).toBeNull();
    expect((await listCompletedPlays(db, "legacy"))[0].isPublic).toBe(false);
    expect(await listLeaderboard(db, puzzleId)).toEqual([]);
    await registerAccountProfile(db, "legacy", "新しいゲーム名");
    expect((await getAccountProfile(db, "legacy"))?.displayName).toBe(
      "新しいゲーム名",
    );
    expect(await listLeaderboard(db, puzzleId)).toEqual([]);
    await deleteAccountHistory(db, "legacy");
  });
  it("never publishes old history when consent is registered or old uploads are retried", async () => {
    const db = platform.env.DB;
    const old = play();
    await saveCompletedPlay(db, "old", old);
    expect(await saveCompletedPlay(db, "missing", play(), true)).toBe(
      "profile_required",
    );
    await registerAccountProfile(db, "old", "昔のタコ");
    expect(await saveCompletedPlay(db, "old", old, true)).toBe("duplicate");
    expect(await listLeaderboard(db, puzzleId)).toEqual([]);
    expect((await listCompletedPlays(db, "old"))[0].isPublic).toBe(false);
    await deleteAccountHistory(db, "old");
  });

  it("publishes the first server registration, not the fastest or earliest completed play", async () => {
    const db = platform.env.DB;
    await registerAccountProfile(db, "first", "初回タコ");
    const first = play({ completedAt: 200000, elapsedSeconds: 150 });
    const retry = play({ completedAt: 100000, elapsedSeconds: 1 });
    expect(await saveCompletedPlay(db, "first", first, true)).toBe("created");
    expect(await saveCompletedPlay(db, "first", retry, true)).toBe("created");
    expect(await saveCompletedPlay(db, "first", first, true)).toBe("duplicate");
    expect(
      await saveCompletedPlay(db, "first", { ...first, mistakes: 1 }, true),
    ).toBe("conflict");
    expect(await listLeaderboard(db, puzzleId)).toEqual([
      {
        rank: 1,
        displayName: "初回タコ",
        elapsedSeconds: 150,
        hintsUsed: 0,
        maxHintStage: 0,
        mistakes: 0,
      },
    ]);
    expect(
      (await listCompletedPlays(db, "first")).filter((p) => p.isPublic),
    ).toHaveLength(1);
    await deleteAccountHistory(db, "first");
  });

  it("atomically selects exactly one initial score for concurrent requests", async () => {
    const db = platform.env.DB;
    await registerAccountProfile(db, "race", "並列タコ");
    const records = [
      play({ elapsedSeconds: 80 }),
      play({ elapsedSeconds: 10 }),
    ];
    expect(
      await Promise.all(
        records.map((p) => saveCompletedPlay(db, "race", p, true)),
      ),
    ).toEqual(["created", "created"]);
    const history = await listCompletedPlays(db, "race");
    expect(history.filter((p) => p.isPublic)).toHaveLength(1);
    expect((await listLeaderboard(db, puzzleId))[0].elapsedSeconds).toBe(
      history.find((p) => p.isPublic)?.elapsedSeconds,
    );
    await deleteAccountHistory(db, "race");
  });

  it("ranks equal scores equally, isolates puzzles and removes all account data on deletion", async () => {
    const db = platform.env.DB;
    const owners = ["tie-a", "tie-b", "tie-c", "different"];
    for (const [index, owner] of owners.entries()) {
      await registerAccountProfile(db, owner, `タコ-${owner}`);
      await saveCompletedPlay(
        db,
        owner,
        play({
          hintsUsed: index === 2 ? 1 : 0,
          puzzleId: index === 3 ? `p1:${"b".repeat(64)}` : puzzleId,
        }),
        true,
      );
    }
    expect((await listLeaderboard(db, puzzleId)).map((p) => p.rank)).toEqual([
      1, 1, 3,
    ]);
    await deleteAccountHistory(db, "tie-a");
    expect(await getAccountProfile(db, "tie-a")).toBeNull();
    expect(await listCompletedPlays(db, "tie-a")).toEqual([]);
    expect(await listLeaderboard(db, puzzleId)).toHaveLength(2);
    expect(await saveCompletedPlay(db, "tie-a", play(), true)).toBe(
      "profile_required",
    );
    for (const owner of owners) await deleteAccountHistory(db, owner);
  });

  it("limits new uploads, leaves retries idempotent, and rolls back denied scores", async () => {
    const db = platform.env.DB;
    await registerAccountProfile(db, "limited", "制限タコ");
    const records = Array.from({ length: 10 }, () => play());
    for (const record of records)
      await saveCompletedPlay(db, "limited", record, true);
    expect(await saveCompletedPlay(db, "limited", records[0], true)).toBe(
      "duplicate",
    );
    const blocked = play({ puzzleId: `p1:${"c".repeat(64)}` });
    await expect(
      saveCompletedPlay(db, "limited", blocked, true),
    ).rejects.toThrow("play_rate_limited");
    expect(await listCompletedPlays(db, "limited")).toHaveLength(10);
    expect(await listLeaderboard(db, blocked.puzzleId)).toEqual([]);
    await db
      .prepare(
        "UPDATE publication_limits SET window_start = 0 WHERE account_id = ?",
      )
      .bind("limited")
      .run();
    expect(await saveCompletedPlay(db, "limited", blocked, true)).toBe(
      "created",
    );
    await deleteAccountHistory(db, "limited");
  });

  it("requires authenticated explicit consent and never exposes account identifiers", async () => {
    const db = platform.env.DB;
    const env = { DB: db, ALLOWED_ORIGINS: "https://example.com" } as Env;
    const call = (
      path: string,
      method = "GET",
      body?: unknown,
      origin = "https://example.com",
    ) =>
      worker.fetch(
        new Request(`https://example.com/api/${path}`, {
          method,
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }) as Parameters<typeof worker.fetch>[0],
        env,
      );
    auth.account = null;
    expect((await call("profile")).status).toBe(401);
    auth.account = "http";
    expect(
      (await call("profile", "POST", { displayName: "HTTPタコ" })).status,
    ).toBe(400);
    expect(
      (
        await call("profile", "POST", {
          displayName: "<script>",
          consentVersion: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "profile",
          "POST",
          { displayName: "HTTPタコ", consentVersion: 1 },
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect((await call("plays", "POST", {})).status).toBe(403);
    expect(
      (
        await call("profile", "POST", {
          displayName: "HTTPタコ",
          consentVersion: 1,
        })
      ).status,
    ).toBe(200);
    expect(await getAccountProfile(db, "http")).toEqual({
      displayName: "HTTPタコ",
      consentVersion: 1,
    });
    await registerAccountProfile(db, "http", "上書きしない");
    expect((await getAccountProfile(db, "http"))?.displayName).toBe("HTTPタコ");
    auth.account = "other-http";
    expect(
      (
        await call("profile", "POST", {
          displayName: "HTTPタコ",
          consentVersion: 1,
        })
      ).status,
    ).toBe(409);
    expect(await getAccountProfile(db, "other-http")).toBeNull();
    auth.account = "emoji-http";
    const emojiName = "👨‍👩‍👧‍👦".repeat(20);
    expect(
      (
        await call("profile", "POST", {
          displayName: emojiName,
          consentVersion: 1,
        })
      ).status,
    ).toBe(200);
    expect((await getAccountProfile(db, "emoji-http"))?.displayName).toBe(
      emojiName,
    );
    await deleteAccountHistory(db, "emoji-http");
    auth.account = "http";
    const upload = await createCompletedPlayUpload({
      id: crypto.randomUUID(),
      userId: "local-id",
      status: "completed",
      seedCode: "TAKO:g1:easy:http-first",
      generatorVersion: "g1",
      difficulty: "easy",
      startedAt: 1000,
      completedAt: 61000,
      elapsedSeconds: 60,
      hintsUsed: 0,
      mistakes: 0,
    });
    expect((await call("plays", "POST", upload)).status).toBe(201);
    expect((await call("plays", "POST", upload)).status).toBe(200);
    expect(
      (await call("plays", "POST", { ...upload, mistakes: 1 })).status,
    ).toBe(409);
    expect(
      (await call(`plays/${upload.playId}/publication`, "DELETE")).status,
    ).toBe(404);
    expect((await call("publications", "DELETE")).status).toBe(404);
    auth.account = null;
    const response = await call(
      `leaderboards/${encodeURIComponent(upload.puzzleId)}`,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body: { entries: object[] } = await response.json();
    expect(Object.keys(body.entries[0]).sort()).toEqual([
      "displayName",
      "elapsedSeconds",
      "hintsUsed",
      "maxHintStage",
      "mistakes",
      "rank",
    ]);
    expect((await call("leaderboards/%ZZ")).status).toBe(400);
    auth.account = "http";
    expect((await call("account", "DELETE")).status).toBe(200);
    expect(await listLeaderboard(db, upload.puzzleId)).toEqual([]);
    auth.account = null;
  });
});
