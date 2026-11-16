import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CompletedPlayUpload } from "../src/core/online-history";
import { createCompletedPlayUpload } from "../src/core/online-history";
import { generatePuzzle } from "../src/core/generator";
import { encodePuzzleSeed } from "../src/core/puzzle-code";
import {
  CONSENT_CLOCK_SKEW_MS,
  deleteAccount,
  listCompletedPlays,
  saveCompletedPlay,
  takeUploadSlot,
  UPLOADS_PER_WINDOW,
} from "../src/worker/history";
import { listLeaderboard } from "../src/worker/leaderboard";
import {
  getAccountProfile,
  registerAccountProfile,
} from "../src/worker/profile";
import worker from "../src/worker/index";
import { migrateTestDatabase } from "./migrations";
import { fetchAs, session, testAccount } from "./worker-env";
import { createFakeIdPlatform } from "./kan-game/fake-id-platform";

/** The fake ID platform as the Worker's ID binding. */
const idBinding = (platform: ReturnType<typeof createFakeIdPlatform>) =>
  platform.rpc as unknown as Env["ID"];

const puzzleId = `p1:${"a".repeat(64)}`;
// Only clears made after consent are ranked, so the plays here are cleared
// after the profiles the tests register (an hour from now).
const later = Date.now() + 3_600_000;
// A clear made half an hour before the profiles the tests register, well
// beyond CONSENT_CLOCK_SKEW_MS.
const beforeConsent = {
  startedAt: Date.now() - 1_900_000,
  completedAt: Date.now() - 1_800_000,
};
function play(
  overrides: Partial<CompletedPlayUpload> = {},
): CompletedPlayUpload {
  return {
    playId: crypto.randomUUID(),
    puzzleId,
    seedCode: "TAKO:g1:easy:ranking",
    generatorVersion: "g1",
    difficulty: "easy",
    startedAt: later,
    completedAt: later + 100000,
    elapsedSeconds: 100,
    mistakes: 0,
    hintsUsed: 0,
    ...overrides,
  };
}
beforeAll(async () => {
  const db = env.DB;
  await migrateTestDatabase(db, {
    "0004_automatic_ranking.sql": async () => {
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
    "0005_hint_stage.sql": async () => {
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
  });
});
describe("consented automatic first-clear ranking", () => {
  it("migrates old first scores without deleting, replacing or republishing records", async () => {
    const db = env.DB;
    const hinted = (await listCompletedPlays(db, "migration-hinted"))[0];
    const unhinted = (await listCompletedPlays(db, "migration-unhinted"))[0];
    expect(hinted.maxHintStage).toBeNull();
    expect(unhinted.maxHintStage).toBe(0);
    expect(hinted.isPublic).toBe(true);
    expect(unhinted.isPublic).toBe(true);
    expect(
      await saveCompletedPlay(db, "migration-hinted", {
        ...hinted,
        maxHintStage: undefined,
      }),
    ).toBe("duplicate");
    const ranked = await listLeaderboard(db, hinted.puzzleId);
    expect(ranked.map((entry) => entry.maxHintStage)).toEqual([0, null]);
    await deleteAccount(db, "migration-hinted");
    await deleteAccount(db, "migration-unhinted");
  });
  it("scores time, mistakes and hints while keeping ties and detecting changed-depth retries", async () => {
    const db = env.DB;
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
      expect(await saveCompletedPlay(db, account, first)).toBe("created");
      expect(await saveCompletedPlay(db, account, first)).toBe("duplicate");
      if (maxHintStage === 2)
        expect(
          await saveCompletedPlay(db, account, { ...first, maxHintStage: 3 }),
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
    );
    expect(
      (await listLeaderboard(db, id)).find(
        (entry) => entry.displayName === "depth-deep",
      )?.maxHintStage,
    ).toBe(4);
    for (const [account] of records) await deleteAccount(db, account);
  });

  it("puts a slightly slower clean solve ahead of a faster solve with a mistake", async () => {
    const db = env.DB;
    const id = `p1:${"f".repeat(64)}`;
    // 30 s with a mistake: 2,000 + 200. 35 s clean: 1,714 + 500.
    for (const [account, elapsedSeconds, mistakes] of [
      ["score-fast-miss", 30, 1],
      ["score-slow-clean", 35, 0],
    ] as const) {
      await registerAccountProfile(db, account, account);
      expect(
        await saveCompletedPlay(
          db,
          account,
          play({ puzzleId: id, elapsedSeconds, mistakes }),
        ),
      ).toBe("created");
    }
    expect(
      (await listLeaderboard(db, id)).map((entry) => entry.displayName),
    ).toEqual(["score-slow-clean", "score-fast-miss"]);
  });
  it("withdraws legacy publications without deleting history or treating generated aliases as consent", async () => {
    const db = env.DB;
    expect(await getAccountProfile(db, "legacy")).toBeNull();
    expect((await listCompletedPlays(db, "legacy"))[0].isPublic).toBe(false);
    expect(await listLeaderboard(db, puzzleId)).toEqual([]);
    await registerAccountProfile(db, "legacy", "新しいゲーム名");
    expect((await getAccountProfile(db, "legacy"))?.displayName).toBe(
      "新しいゲーム名",
    );
    expect(await listLeaderboard(db, puzzleId)).toEqual([]);
    await deleteAccount(db, "legacy");
  });
  it("never publishes old history when consent is registered or old uploads are retried", async () => {
    const db = env.DB;
    // A clear made before consent, even one uploaded after it.
    const old = play(beforeConsent);
    await saveCompletedPlay(db, "old", old);
    // An ID without a name keeps its clears as history, unranked.
    expect(await saveCompletedPlay(db, "missing", play())).toBe("created");
    expect((await listCompletedPlays(db, "missing"))[0].isPublic).toBe(false);
    await registerAccountProfile(db, "old", "昔のタコ");
    expect(await saveCompletedPlay(db, "old", old)).toBe("duplicate");
    expect(await listLeaderboard(db, puzzleId)).toEqual([]);
    expect((await listCompletedPlays(db, "old"))[0].isPublic).toBe(false);
    const unsent = play({
      puzzleId: `p1:${"9".repeat(64)}`,
      ...beforeConsent,
    });
    expect(await saveCompletedPlay(db, "old", unsent)).toBe("created");
    expect(await listLeaderboard(db, unsent.puzzleId)).toEqual([]);
    await deleteAccount(db, "old");
    await deleteAccount(db, "missing");
  });

  it("never ranks a puzzle the ID solved before it had a name", async () => {
    const db = env.DB;
    const id = `p1:${"8".repeat(64)}`;
    await saveCompletedPlay(
      db,
      "renamed",
      play({ puzzleId: id, ...beforeConsent }),
    );
    await registerAccountProfile(db, "renamed", "あとから名乗るタコ");
    expect(await saveCompletedPlay(db, "renamed", play({ puzzleId: id }))).toBe(
      "created",
    );
    expect(await listLeaderboard(db, id)).toEqual([]);
    // Another puzzle solved after consent is ranked as usual.
    const fresh = `p1:${"7".repeat(64)}`;
    await saveCompletedPlay(db, "renamed", play({ puzzleId: fresh }));
    expect(await listLeaderboard(db, fresh)).toHaveLength(1);
    await deleteAccount(db, "renamed");
  });

  it("ranks a clear made just before consent only within the clock margin", async () => {
    const db = env.DB;
    await registerAccountProfile(db, "skewed", "時計の遅いタコ");
    const consentedAt = await db
      .prepare(
        "SELECT consented_at FROM leaderboard_profiles WHERE account_id = ?",
      )
      .bind("skewed")
      .first<number>("consented_at");
    const at = (completedAt: number, puzzle: string) =>
      play({
        puzzleId: `p1:${puzzle.repeat(64)}`,
        startedAt: completedAt - 60_000,
        completedAt,
      });
    // A device clock that lags the server by the whole margin still ranks.
    const within = at(consentedAt! - CONSENT_CLOCK_SKEW_MS, "6");
    const beyond = at(consentedAt! - CONSENT_CLOCK_SKEW_MS - 1, "5");
    await saveCompletedPlay(db, "skewed", within);
    await saveCompletedPlay(db, "skewed", beyond);
    expect(await listLeaderboard(db, within.puzzleId)).toHaveLength(1);
    expect(await listLeaderboard(db, beyond.puzzleId)).toEqual([]);
    await deleteAccount(db, "skewed");
  });

  it("publishes the first server registration, not the fastest or earliest completed play", async () => {
    const db = env.DB;
    await registerAccountProfile(db, "first", "初回タコ");
    const first = play({ completedAt: later + 200000, elapsedSeconds: 150 });
    const retry = play({ completedAt: later + 100000, elapsedSeconds: 1 });
    expect(await saveCompletedPlay(db, "first", first)).toBe("created");
    expect(await saveCompletedPlay(db, "first", retry)).toBe("created");
    expect(await saveCompletedPlay(db, "first", first)).toBe("duplicate");
    expect(
      await saveCompletedPlay(db, "first", { ...first, mistakes: 1 }),
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
    await deleteAccount(db, "first");
  });

  it("atomically selects exactly one initial score for concurrent requests", async () => {
    const db = env.DB;
    await registerAccountProfile(db, "race", "並列タコ");
    const records = [
      play({ elapsedSeconds: 80 }),
      play({ elapsedSeconds: 10 }),
    ];
    expect(
      await Promise.all(records.map((p) => saveCompletedPlay(db, "race", p))),
    ).toEqual(["created", "created"]);
    const history = await listCompletedPlays(db, "race");
    expect(history.filter((p) => p.isPublic)).toHaveLength(1);
    expect((await listLeaderboard(db, puzzleId))[0].elapsedSeconds).toBe(
      history.find((p) => p.isPublic)?.elapsedSeconds,
    );
    await deleteAccount(db, "race");
  });

  it("ranks equal scores equally, isolates puzzles and removes all account data on deletion", async () => {
    const db = env.DB;
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
      );
    }
    expect((await listLeaderboard(db, puzzleId)).map((p) => p.rank)).toEqual([
      1, 1, 3,
    ]);
    await deleteAccount(db, "tie-a");
    expect(await getAccountProfile(db, "tie-a")).toBeNull();
    expect(await listCompletedPlays(db, "tie-a")).toEqual([]);
    expect(await listLeaderboard(db, puzzleId)).toHaveLength(2);
    // The deleted ID has no consent, so a later record is not ranked (and its
    // cookie is refused before this; see tests/id-auth.test.ts).
    expect(await saveCompletedPlay(db, "tie-a", play())).toBe("created");
    expect(await listLeaderboard(db, puzzleId)).toHaveLength(2);
    for (const owner of owners) await deleteAccount(db, owner);
  });

  /** POST /api/plays as `account`. */
  async function upload(account: string, body: unknown): Promise<Response> {
    session.account = account;
    try {
      return await fetchAs(
        new Request("https://example.com/api/plays", {
          method: "POST",
          headers: {
            Origin: "https://example.com",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        { DB: env.DB, ALLOWED_ORIGINS: "https://example.com" } as Env,
      );
    } finally {
      session.account = null;
    }
  }
  const slots = async (account: string) =>
    await env.DB.prepare(
      "SELECT attempts FROM publication_limits WHERE account_id = ?",
    )
      .bind(account)
      .first("attempts");

  // play() names a puzzle its seed code does not make, so verifying it (which
  // regenerates the board) answers 400. An answer other than 400 shows the
  // board was not regenerated.
  it("answers a resend from the stored record, without a slot or a board", async () => {
    const account = testAccount("resender");
    const stored = play();
    expect(await saveCompletedPlay(env.DB, account, stored)).toBe("created");
    const resend = await upload(account, stored);
    expect(resend.status).toBe(200);
    expect(await resend.json()).toMatchObject({
      status: "duplicate",
      newAchievements: [],
    });
    expect((await upload(account, { ...stored, mistakes: 1 })).status).toBe(
      409,
    );
    expect(await slots(account)).toBeNull();
    // A new upload of the same unverifiable claim is verified, and refused.
    expect((await upload(account, play())).status).toBe(400);
    expect(await slots(account)).toBe(1);
    await deleteAccount(env.DB, account);
  });

  it("refuses an upload past the limit before regenerating its board", async () => {
    const account = testAccount("limited");
    await registerAccountProfile(env.DB, account, "制限タコ");
    const now = Date.now();
    for (let i = 0; i < UPLOADS_PER_WINDOW; i++)
      expect(await takeUploadSlot(env.DB, account, now)).toBe(true);
    const stored = play();
    await saveCompletedPlay(env.DB, account, stored);
    const refused = await upload(account, play());
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");
    // A resend is not limited.
    expect((await upload(account, stored)).status).toBe(200);
    expect(await listCompletedPlays(env.DB, account)).toHaveLength(1);
    // The window starts over a minute later.
    await env.DB.prepare(
      "UPDATE publication_limits SET window_start = 0 WHERE account_id = ?",
    )
      .bind(account)
      .run();
    expect((await upload(account, play())).status).toBe(400);
    const puzzle = generatePuzzle({ seed: "upload-slot", difficulty: "easy" });
    const valid = await createCompletedPlayUpload({
      id: crypto.randomUUID(),
      userId: "",
      status: "completed",
      seedCode: encodePuzzleSeed(puzzle),
      generatorVersion: puzzle.generatorVersion ?? "g1",
      difficulty: puzzle.difficulty ?? "easy",
      startedAt: later,
      completedAt: later + 100000,
      elapsedSeconds: 100,
      mistakes: 0,
      hintsUsed: 0,
    });
    expect((await upload(account, valid)).status).toBe(201);
    expect(await slots(account)).toBe(2);
    await deleteAccount(env.DB, account);
  });

  it("limits uploads from an ID without a name too", async () => {
    const account = testAccount("unnamed-limited");
    for (let i = 0; i < UPLOADS_PER_WINDOW; i++)
      expect(await takeUploadSlot(env.DB, account, Date.now())).toBe(true);
    expect(await takeUploadSlot(env.DB, account, Date.now())).toBe(false);
    expect((await upload(account, play())).status).toBe(429);
    // A slot is not given back when the window is past: the next one starts it.
    expect(await takeUploadSlot(env.DB, account, Date.now() + 60_000)).toBe(
      true,
    );
    await deleteAccount(env.DB, account);
  });

  it("requires authenticated explicit consent and never exposes account identifiers", async () => {
    const db = env.DB;
    const apiEnv = {
      DB: db,
      ALLOWED_ORIGINS: "https://example.com",
      ID: idBinding(createFakeIdPlatform()),
    } as Env;
    const call = (
      path: string,
      method = "GET",
      body?: unknown,
      origin = "https://example.com",
    ) =>
      fetchAs(
        new Request(`https://example.com/api/${path}`, {
          method,
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }) as Parameters<typeof worker.fetch>[0],
        apiEnv,
      );
    session.account = null;
    expect((await call("profile")).status).toBe(401);
    session.account = testAccount("http");
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
    expect((await call("plays", "POST", {})).status).toBe(400);
    expect(
      (
        await call("profile", "POST", {
          displayName: "HTTPタコ",
          consentVersion: 1,
        })
      ).status,
    ).toBe(200);
    expect(await getAccountProfile(db, testAccount("http"))).toEqual({
      displayName: "HTTPタコ",
      consentVersion: 1,
    });
    await registerAccountProfile(db, testAccount("http"), "上書きしない");
    expect(
      (await getAccountProfile(db, testAccount("http")))?.displayName,
    ).toBe("HTTPタコ");
    session.account = testAccount("other-http");
    expect(
      (
        await call("profile", "POST", {
          displayName: "HTTPタコ",
          consentVersion: 1,
        })
      ).status,
    ).toBe(409);
    expect(await getAccountProfile(db, testAccount("other-http"))).toBeNull();
    session.account = testAccount("emoji-http");
    const emojiName = "👨‍👩‍👧‍👦".repeat(20);
    expect(
      (
        await call("profile", "POST", {
          displayName: emojiName,
          consentVersion: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (await getAccountProfile(db, testAccount("emoji-http")))?.displayName,
    ).toBe(emojiName);
    await deleteAccount(db, testAccount("emoji-http"));
    session.account = testAccount("http");
    const upload = await createCompletedPlayUpload({
      id: crypto.randomUUID(),
      userId: "local-id",
      status: "completed",
      seedCode: "TAKO:g1:easy:http-first",
      generatorVersion: "g1",
      difficulty: "easy",
      startedAt: later,
      completedAt: later + 60000,
      elapsedSeconds: 60,
      hintsUsed: 0,
      mistakes: 0,
    });
    // 登録の応答に、その問題のランキングを自分の記録込みで返す。再送でも同じ。
    // 新しく解除した実績は登録したときだけ返し、再送では空にする。
    const ownEntry = [
      expect.objectContaining({ rank: 1, displayName: "HTTPタコ" }),
    ];
    const created = await call("plays", "POST", upload);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      status: "created",
      entries: ownEntry,
      newAchievements: ["clear_first", "no_mistake", "perfect_solve"],
    });
    const resent = await call("plays", "POST", upload);
    expect(resent.status).toBe(200);
    expect(await resent.json()).toEqual({
      status: "duplicate",
      entries: ownEntry,
      newAchievements: [],
    });
    expect(
      (await call("plays", "POST", { ...upload, mistakes: 1 })).status,
    ).toBe(409);
    // 同意が無効になった ID の再送も、本人の履歴の重複として受け付ける。
    // ランキングにはもう出ない。
    const consent = (version: number | null) =>
      env.DB.prepare(
        "UPDATE leaderboard_profiles SET consent_version = ? WHERE account_id = ?",
      )
        .bind(version, testAccount("http"))
        .run();
    await consent(null);
    const withoutConsent = await call("plays", "POST", upload);
    expect(withoutConsent.status).toBe(200);
    expect(await withoutConsent.json()).toEqual({
      status: "duplicate",
      entries: [],
      newAchievements: [],
    });
    await consent(1);
    expect(
      (await call(`plays/${upload.playId}/publication`, "DELETE")).status,
    ).toBe(404);
    expect((await call("publications", "DELETE")).status).toBe(404);
    session.account = null;
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
    session.account = testAccount("http");
    // Withdrawal moved to kan-game.app, which calls GameService.deleteAccount.
    expect((await call("account", "DELETE")).status).toBe(404);
    await deleteAccount(db, testAccount("http"));
    expect(await listLeaderboard(db, upload.puzzleId)).toEqual([]);
    session.account = null;
  });
});

describe("names shared across kan-game.app", () => {
  const ids = createFakeIdPlatform({
    ids: [
      testAccount("named-elsewhere"),
      testAccount("newcomer"),
      testAccount("rival"),
    ],
  });
  const call = (path: string, method = "GET", body?: unknown) =>
    fetchAs(
      new Request(`https://example.com/api/${path}`, {
        method,
        headers: {
          Origin: "https://example.com",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }) as Parameters<typeof worker.fetch>[0],
      {
        DB: env.DB,
        ALLOWED_ORIGINS: "https://example.com",
        ID: idBinding(ids),
      } as Env,
    );
  const register = (displayName: string) =>
    call("profile", "POST", { displayName, consentVersion: 1 });
  afterEach(() => {
    session.account = null;
  });

  it("keeps a name chosen in another game on consent", async () => {
    ids.setName(testAccount("named-elsewhere"), "よそのタコ");
    session.account = testAccount("named-elsewhere");
    // The screen learns the name with the ID; this reads TAKO-SEN's profile.
    expect(await (await call("profile")).json()).toEqual({ profile: null });
    // The name cannot change; TAKO-SEN stores the platform's.
    const response = await register("別の名前");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      profile: { displayName: "よそのタコ", consentVersion: 1 },
    });
    expect(await (await call("profile")).json()).toEqual({
      profile: { displayName: "よそのタコ", consentVersion: 1 },
    });
    await deleteAccount(env.DB, testAccount("named-elsewhere"));
  });

  it("refuses a name another ID holds in any game", async () => {
    ids.setName(testAccount("rival"), "取られた名前");
    session.account = testAccount("newcomer");
    expect((await register("取られた名前")).status).toBe(409);
    expect(await getAccountProfile(env.DB, testAccount("newcomer"))).toBeNull();
    expect(await (await call("profile")).json()).toEqual({ profile: null });
  });

  it("answers 410 when the ID platform no longer knows the ID", async () => {
    session.account = testAccount("unknown-to-platform");
    expect((await register("消えたタコ")).status).toBe(410);
  });

  it("refuses a name another account holds here though the platform gave it", async () => {
    // TAKO-SEN's copy of the names drifted from the platform's.
    await registerAccountProfile(env.DB, "stale-holder", "ずれた名前");
    session.account = testAccount("newcomer");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await register("ずれた名前")).status).toBe(409);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("profile_name_out_of_sync"),
    );
    error.mockRestore();
    await deleteAccount(env.DB, "stale-holder");
  });
});
