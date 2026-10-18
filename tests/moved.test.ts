import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { handoffUrl } from "../src/core/handoff-link";
import worker from "../src/worker/index";
import { handleMoved, movedState, type Moved } from "../src/worker/moved";
import { migrateTestDatabase } from "./migrations";

function memoryStorage(entries: Record<string, string> = {}) {
  return {
    getItem: (key: string) => entries[key] ?? null,
    setItem: (key: string, value: string) => void (entries[key] = value),
  };
}

const TARGET = "https://tako.kan-game.app";
const TOKEN = "A".repeat(43);

describe("the address to the new URL", () => {
  it("keeps the path and query and passes the chosen settings", () => {
    const url = handoffUrl(
      TARGET,
      { pathname: "/", search: "?seed=TAKO%3Ag4%3Aeasy%3Ax" },
      memoryStorage({
        "tako-sen:auto-exclusions-enabled": "1",
        "tako-sen:difficulty-selection": "hard",
        "tako-sen:sound-enabled": "0",
        "tako-sen:haptics-enabled": "0",
        "tako-sen.tutorial.v2": "seen",
      }),
      TOKEN,
    );
    expect(url).toBe(
      `${TARGET}/?seed=TAKO%3Ag4%3Aeasy%3Ax#migration=${TOKEN}&auto=1&difficulty=hard&sound=0&haptics=0&tutorial=seen`,
    );
  });

  it("passes nothing the player has not chosen", () => {
    expect(
      handoffUrl(TARGET, { pathname: "/", search: "" }, memoryStorage()),
    ).toBe(`${TARGET}/`);
    expect(
      handoffUrl(
        TARGET,
        { pathname: "/", search: "" },
        memoryStorage({ "tako-sen:difficulty-selection": "extreme" }),
      ),
    ).toBe(`${TARGET}/`);
  });

  it("goes without settings when storage refuses", () => {
    const storage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    };
    expect(handoffUrl(TARGET, { pathname: "/", search: "" }, storage)).toBe(
      `${TARGET}/`,
    );
  });
});

describe("the move setting", () => {
  it("needs an https origin and a date", () => {
    const db = {} as D1Database;
    expect(movedState({ DB: db, MOVED_TO: "", MIGRATION_ENDS: "" })).toBe(null);
    expect(
      movedState({
        DB: db,
        MOVED_TO: "http://tako.kan-game.app",
        MIGRATION_ENDS: "2027-01-31",
      }),
    ).toBe(null);
    expect(
      movedState({
        DB: db,
        MOVED_TO: `${TARGET}/`,
        MIGRATION_ENDS: "2027-01-31",
      }),
    ).toEqual({ target: TARGET, endsOn: "2027-01-31" });
  });
});

describe("the moved site", () => {
  let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
  const moved: Moved = { target: TARGET, endsOn: "2027-01-31" };

  beforeAll(async () => {
    platform = await getPlatformProxy<Env>({
      configPath: "./tests/wrangler.jsonc",
      persist: false,
      remoteBindings: false,
    });
    await migrateTestDatabase(platform.env.DB);
    await platform.env.DB.prepare(
      "INSERT INTO migration_handoffs (clerk_user_id, token) VALUES ('user_2alice', ?)",
    )
      .bind(TOKEN)
      .run();
  });
  afterAll(async () => {
    await platform?.dispose();
  });

  const BEFORE_END = Date.parse("2027-01-31T23:00:00+09:00");
  const ask = (
    path: string,
    account: string | null = null,
    method = "GET",
    options: { origin?: string; now?: number; origins?: string[] } = {},
  ) =>
    handleMoved({
      request: new Request(`https://example.com${path}`, {
        method,
        headers: options.origin ? { Origin: options.origin } : {},
      }),
      pathname: path,
      moved,
      env: platform.env,
      origins: options.origins ?? ["https://example.com"],
      account: async () => account,
      now: options.now ?? BEFORE_END,
    });

  it("tells the screen where TAKO-SEN went", async () => {
    const response = await ask("/api/moved");
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual(moved);
  });

  it("hands a signed-in player their token, and no one else's", async () => {
    const mine = await ask("/api/migration-handoff", "user_2alice");
    expect(await mine?.json()).toEqual({ token: TOKEN });
    const none = await ask("/api/migration-handoff", "user_2nobody");
    expect(none?.status).toBe(404);
    expect(await none?.json()).toEqual({ error: "no_records" });
    expect((await ask("/api/migration-handoff"))?.status).toBe(401);
  });

  it("guards the token as the signed-in API does", async () => {
    const path = "/api/migration-handoff";
    const other = await ask(path, "user_2alice", "GET", {
      origin: "https://evil.example",
    });
    expect(other?.status).toBe(403);
    expect(
      (await ask(path, "user_2alice", "GET", { origins: [] }))?.status,
    ).toBe(503);
    const failing = await handleMoved({
      request: new Request(`https://example.com${path}`),
      pathname: path,
      moved,
      env: platform.env,
      origins: ["https://example.com"],
      account: () => Promise.reject(new Error("Clerk is down")),
      now: BEFORE_END,
    });
    expect(failing?.status).toBe(503);
  });

  it("stops handing tokens out after the last day", async () => {
    const late = await ask("/api/migration-handoff", "user_2alice", "GET", {
      now: Date.parse("2027-02-01T00:00:00+09:00"),
    });
    expect(late?.status).toBe(410);
    expect(await late?.json()).toEqual({ error: "migration_ended" });
  });

  it("refuses every write and leaves reads and pages alone", async () => {
    for (const path of ["/api/plays", "/api/profile", "/api/account"]) {
      const response = await ask(path, "user_2alice", "POST");
      expect(response?.status).toBe(410);
    }
    // Taken, so Clerk does not turn the endpoint off, but changes nothing.
    const webhook = await ask("/api/clerk-webhook", null, "POST");
    expect(webhook?.status).toBe(202);
    expect(await ask("/api/plays", "user_2alice")).toBe(null);
    expect(await ask("/")).toBe(null);
  });

  it("answers null and hands no token before the move", async () => {
    const before = (path: string) =>
      handleMoved({
        request: new Request(`https://example.com${path}`),
        pathname: path,
        moved: null,
        env: platform.env,
        origins: ["https://example.com"],
        account: async () => "user_2alice",
      });
    const response = await before("/api/moved");
    expect(response?.status).toBe(200);
    expect(await response?.json()).toBe(null);
    expect(await before("/api/migration-handoff")).toBe(null);
  });

  it("is told through the Worker whether the move is set", async () => {
    const env = {
      ...platform.env,
      ALLOWED_ORIGINS: "https://example.com",
    } as Env;
    const request = () =>
      new Request("https://example.com/api/moved") as Parameters<
        typeof worker.fetch
      >[0];
    const before = await worker.fetch(request(), {
      ...env,
      MOVED_TO: "",
      MIGRATION_ENDS: "",
    } as Env);
    expect(await before.json()).toBe(null);
    const after = await worker.fetch(request(), {
      ...env,
      MOVED_TO: TARGET,
      MIGRATION_ENDS: "2027-01-31",
    } as unknown as Env);
    expect(await after.json()).toEqual(moved);
  });
});
