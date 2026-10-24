import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getPlatformProxy } from "wrangler";
import type { CompletedPlayUpload } from "../src/core/online-history";
import {
  listAchievements,
  recordWithAchievements,
  unlockClientAchievement,
} from "../src/worker/achievements";
import { deleteAccount, saveCompletedPlay } from "../src/worker/history";
import { registerAccountProfile } from "../src/worker/profile";
import { restoreSharedPuzzleSnapshot } from "../src/core/shared-puzzle";
import type { DailyStatus } from "../src/worker/daily";
import worker from "../src/worker/index";
import { migrateTestDatabase } from "./migrations";
import { auth } from "./auth-mock";

vi.mock("../src/worker/auth", () => import("./auth-mock"));

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
const now = Date.parse("2026-10-25T03:00:00Z");

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: "./tests/wrangler.jsonc",
    persist: false,
    remoteBindings: false,
  });
  await migrateTestDatabase(platform.env.DB);
});
afterAll(async () => {
  await platform?.dispose();
});
afterEach(() => {
  auth.account = null;
});

function play(overrides: Partial<CompletedPlayUpload> = {}) {
  return {
    playId: crypto.randomUUID(),
    puzzleId: `p1:${"b".repeat(64)}`,
    seedCode: "TAKO:g4:easy:achievement",
    generatorVersion: "g4",
    difficulty: "easy",
    startedAt: now - 60_000,
    completedAt: now,
    elapsedSeconds: 60,
    mistakes: 1,
    hintsUsed: 1,
    ...overrides,
  } satisfies CompletedPlayUpload;
}

/** 通常のクリアを入れる。送信の検証は history と leaderboard のテストが受け持つ */
async function clears(
  account: string,
  count: number,
  overrides: Partial<CompletedPlayUpload> = {},
): Promise<void> {
  for (let i = 0; i < count; i++) {
    // まとめて入れると投稿の頻度制限（1 分 10 件、completed_plays の trigger）に掛かる。
    await platform.env.DB.prepare(
      "DELETE FROM publication_limits WHERE account_id = ?",
    )
      .bind(account)
      .run();
    await saveCompletedPlay(platform.env.DB, account, play(overrides));
  }
}

/**
 * デイリーの盤面の行（中身は空）。API のテストが今日の本物の盤面を作るので、
 * ここで使う日付は過去にとどめる。
 */
async function dailyBoard(date: string): Promise<void> {
  await platform.env.DB.prepare(
    `INSERT OR IGNORE INTO daily_puzzles (challenge_date, puzzle_id, regions_json, givens_json, created_at)
     VALUES (?, ?, '[]', '[]', 0)`,
  )
    .bind(date, `p1:${date}`)
    .run();
}

interface ClearValues {
  readonly mistakes?: number;
  readonly hintsUsed?: number;
  readonly completedAt?: number;
}

async function dailyClear(
  account: string,
  date: string,
  values: ClearValues = {},
): Promise<void> {
  const db = platform.env.DB;
  await dailyBoard(date);
  await db
    .prepare(
      `INSERT INTO daily_attempts (account_id, challenge_date, play_id, started_at, completed_at,
         elapsed_seconds, mistakes, hints_used)
       VALUES (?, ?, ?, 0, ?, 60, ?, ?)`,
    )
    .bind(
      account,
      date,
      crypto.randomUUID(),
      values.completedAt ?? Date.parse(`${date}T03:00:00Z`),
      values.mistakes ?? 1,
      values.hintsUsed ?? 1,
    )
    .run();
}

async function superClear(
  account: string,
  values: ClearValues = {},
): Promise<void> {
  const db = platform.env.DB;
  await registerAccountProfile(db, account, `超級${account}`).catch(() => {});
  await db
    .prepare("INSERT OR IGNORE INTO super_progress (account_id) VALUES (?)")
    .bind(account)
    .run();
  const id = `p1:${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO super_puzzles (puzzle_id, seed_code, snapshot_json, created_at)
       VALUES (?, ?, '{}', 0)`,
    )
    .bind(id, `TAKO:super-v2:hard:${id}`)
    .run();
  await db
    .prepare(
      `INSERT INTO super_attempts (account_id, play_id, puzzle_id, entry, cycle, started_at,
         completed_at, elapsed_seconds, mistakes, hints_used)
       VALUES (?, ?, ?, 'shared', 0, 0, ?, 60, ?, ?)`,
    )
    .bind(
      account,
      crypto.randomUUID(),
      id,
      values.completedAt ?? now,
      values.mistakes ?? 1,
      values.hintsUsed ?? 1,
    )
    .run();
}

async function states(account: string) {
  return new Map(
    (await listAchievements(platform.env.DB, account, now)).map((item) => [
      item.id,
      item,
    ]),
  );
}

describe("achievement counting", () => {
  it("counts only ordinary clears, by difficulty and mistakes", async () => {
    await clears("count", 9);
    await clears("count", 1, { difficulty: "hard", mistakes: 0 });
    // デイリーや超級の版の記録が completed_plays にあっても、通常には数えない。
    await clears("count", 5, { generatorVersion: "daily-v2" });
    const list = await states("count");
    expect(list.get("clear_10")).toMatchObject({ progress: 10 });
    expect(list.get("clear_10")?.unlockedAt).toBe(now);
    expect(list.get("clear_50")).toMatchObject({
      unlockedAt: null,
      progress: 10,
    });
    expect(list.get("clear_hard_first")?.unlockedAt).toBe(now);
    expect(list.get("no_mistake_hard")?.unlockedAt).toBe(now);
    expect(list.get("perfect_solve")?.unlockedAt).toBeNull();
  });

  it("counts Perfect Solve in any mode", async () => {
    const perfect = { mistakes: 0, hintsUsed: 0 };
    const modes: [string, (account: string) => Promise<void>][] = [
      ["perfect-super", (account) => superClear(account, perfect)],
      [
        "perfect-daily",
        (account) => dailyClear(account, "2026-10-01", perfect),
      ],
      ["perfect-normal", (account) => clears(account, 1, perfect)],
    ];
    for (const [account, clear] of modes) {
      await clear(account);
      expect((await states(account)).get("perfect_solve")?.unlockedAt).toBe(
        now,
      );
    }
  });

  it("counts daily days and the longest streak", async () => {
    for (const date of [
      "2026-09-01",
      "2026-09-02",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ])
      await dailyClear("daily", date);
    // 始めただけの日は数えない。
    await dailyBoard("2026-09-03");
    await platform.env.DB.prepare(
      `INSERT INTO daily_attempts (account_id, challenge_date, play_id, started_at)
       VALUES ('daily', '2026-09-03', ?, 0)`,
    )
      .bind(crypto.randomUUID())
      .run();
    const list = await states("daily");
    expect(list.get("daily_7")?.unlockedAt).toBe(now);
    expect(list.get("daily_30")?.progress).toBe(8);
    expect(list.get("daily_streak_7")).toMatchObject({
      unlockedAt: null,
      progress: 6,
    });
    await dailyClear("daily", "2026-09-10");
    expect((await states("daily")).get("daily_streak_7")?.unlockedAt).toBe(now);
  });

  it("counts clear days across modes by the date in Japan", async () => {
    // 2025-10-24 23:59:59.999 と 2025-10-25 0:00（日本時間）は別の日。
    await clears("days", 1, {
      completedAt: Date.parse("2025-10-24T14:59:59.999Z"),
      startedAt: 0,
    });
    await clears("days", 1, {
      completedAt: Date.parse("2025-10-24T15:00:00.000Z"),
      startedAt: 0,
    });
    // 同じ日本時間の日のデイリーと超級は 1 日。
    await dailyClear("days", "2025-10-25", {
      completedAt: Date.parse("2025-10-25T14:59:59.999Z"),
    });
    await superClear("days", {
      completedAt: Date.parse("2025-10-25T10:00:00Z"),
    });
    expect((await states("days")).get("days_7")?.progress).toBe(2);
    for (let day = 1; day <= 5; day++)
      await superClear("days", {
        completedAt: Date.parse(`2025-11-0${day}T03:00:00Z`),
      });
    const list = await states("days");
    expect(list.get("days_7")).toMatchObject({ unlockedAt: now, progress: 7 });
    expect(list.get("super_first")?.unlockedAt).toBe(now);
  });
});

/** 通常のクリアを 1 件、完了の API と同じ手順で登録する */
function record(account: string, value = play()) {
  const db = platform.env.DB;
  return recordWithAchievements(
    db,
    account,
    now,
    value.playId,
    () => saveCompletedPlay(db, account, value),
    (status) => status === "created",
  );
}

describe("achievement unlocking", () => {
  it("reports only what the new clear unlocked", async () => {
    // 導入前の 9 回で満たした初クリアは載せず、このクリアで届いた 10 回だけを返す。
    await clears("retro", 9);
    const first = play();
    expect(await record("retro", first)).toEqual({
      result: "created",
      newAchievements: ["clear_10"],
    });
    expect((await states("retro")).get("clear_first")?.unlockedAt).toBe(now);
    // 同じ記録の再送では空にする。
    expect(await record("retro", first)).toEqual({
      result: "duplicate",
      newAchievements: [],
    });
  });

  it("keeps past unlocks out of the response after the tutorial", async () => {
    // 遊び方の解除が先に行を作っていても、遡った分は応答に載せない。
    await unlockClientAchievement(
      platform.env.DB,
      "tutored",
      "tutorial_complete",
      now,
    );
    await clears("tutored", 9);
    expect((await record("tutored")).newAchievements).toEqual(["clear_10"]);
  });

  it("reports an unlock even when another request saved it first", async () => {
    // 一覧の取得が先に clear_10 を保存しても、越えさせたクリアの応答に載る。
    await clears("race", 9);
    const [recorded, listed] = await Promise.all([
      record("race"),
      listAchievements(platform.env.DB, "race", now),
    ]);
    expect(recorded.newAchievements).toEqual(["clear_10"]);
    expect(listed).toHaveLength(20);
    expect((await states("race")).get("clear_10")?.unlockedAt).toBe(now);
  });

  it("reads nothing for a resent record", async () => {
    const db = platform.env.DB;
    const batch = vi.spyOn(db, "batch");
    const resent = await recordWithAchievements(
      db,
      "resent",
      now,
      "play",
      async () => "duplicate",
      (status) => status === "created",
    );
    expect(resent).toEqual({ result: "duplicate", newAchievements: [] });
    expect(batch).not.toHaveBeenCalled();
    batch.mockRestore();
  });

  it("keeps accounts apart and forgets a deleted account", async () => {
    expect((await record("mine")).newAchievements).toEqual(["clear_first"]);
    expect((await states("other")).get("clear_first")?.unlockedAt).toBeNull();
    await deleteAccount(platform.env.DB, "mine");
    const rows = await platform.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM achievements WHERE account_id = 'mine'",
    ).first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("returns nothing rather than failing when the judgement fails", async () => {
    const broken = {
      prepare() {
        throw new Error("D1 is down");
      },
      batch() {
        throw new Error("D1 is down");
      },
    } as unknown as D1Database;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordWithAchievements(
        broken,
        "x",
        now,
        "play",
        async () => "created",
        () => true,
      ),
    ).resolves.toEqual({ result: "created", newAchievements: [] });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("saves the tutorial unlock once", async () => {
    const db = platform.env.DB;
    expect(
      await unlockClientAchievement(db, "client", "tutorial_complete", now),
    ).toBe(true);
    expect(
      await unlockClientAchievement(db, "client", "tutorial_complete", now + 1),
    ).toBe(false);
    const tutorial = (await states("client")).get("tutorial_complete");
    expect(tutorial).toEqual({
      id: "tutorial_complete",
      unlockedAt: now,
      progress: null,
    });
  });

  it("withholds the progress of a locked secret achievement", async () => {
    await clears("secret", 3);
    const list = await states("secret");
    expect(list.get("clear_500")).toEqual({
      id: "clear_500",
      unlockedAt: null,
      progress: null,
    });
    expect(list.get("clear_100")?.progress).toBe(3);
  });
});

describe("achievement API", () => {
  const env = () =>
    ({ DB: platform.env.DB, ALLOWED_ORIGINS: "https://example.test" }) as Env;
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(
      new Request(`https://example.test${path}`, {
        ...init,
        headers: {
          Origin: "https://example.test",
          "Content-Type": "application/json",
          ...init?.headers,
        },
      }) as Parameters<typeof worker.fetch>[0],
      env(),
    );

  it("lists every definition for an ID, and needs one", async () => {
    expect((await call("/api/achievements")).status).toBe(401);
    auth.account = "api-list";
    const response = await call("/api/achievements");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body: { achievements: { id: string }[] } = await response.json();
    expect(body.achievements).toHaveLength(20);
    expect((await call("/api/achievements", { method: "POST" })).status).toBe(
      405,
    );
  });

  it("unlocks the tutorial from the screen and refuses others", async () => {
    auth.account = "api-unlock";
    const unlock = (body: unknown) =>
      call("/api/achievements/unlock", {
        method: "POST",
        body: JSON.stringify(body),
      });
    expect(await (await unlock({ id: "tutorial_complete" })).json()).toEqual({
      newAchievements: ["tutorial_complete"],
    });
    expect(await (await unlock({ id: "tutorial_complete" })).json()).toEqual({
      newAchievements: [],
    });
    expect((await unlock({ id: "clear_500" })).status).toBe(400);
    expect((await unlock({})).status).toBe(400);
    expect(
      (
        await call("/api/achievements/unlock", {
          method: "POST",
          headers: { Origin: "https://evil.test" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect((await call("/api/achievements/unlock")).status).toBe(405);
  });

  it("reports a daily clear's unlocks in the completion", async () => {
    auth.account = "api-daily";
    await registerAccountProfile(platform.env.DB, "api-daily", "デイリー実績");
    const status: DailyStatus = await (await call("/api/daily")).json();
    const playId = crypto.randomUUID();
    expect(
      (
        await call("/api/daily/start", {
          method: "POST",
          body: JSON.stringify({ date: status.date, playId }),
        })
      ).status,
    ).toBe(201);
    const puzzle = await restoreSharedPuzzleSnapshot(status.puzzle);
    const completion = JSON.stringify({
      date: status.date,
      playId,
      puzzleId: status.puzzle.id,
      pieces: puzzle.solution,
      elapsedSeconds: 120,
      mistakes: 1,
      hintsUsed: 0,
      maxHintStage: 0,
    });
    const complete = () =>
      call("/api/daily/complete", { method: "POST", body: completion });
    expect(await (await complete()).json()).toEqual({
      status: "completed",
      newAchievements: ["daily_first"],
    });
    expect(await (await complete()).json()).toEqual({
      status: "duplicate",
      newAchievements: [],
    });
  }, 60_000);
});
