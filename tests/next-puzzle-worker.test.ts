import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { registerAccountProfile } from "../src/worker/profile";
import { saveCompletedPlay } from "../src/worker/history";
import { listRankedPuzzleCandidates } from "../src/worker/next-puzzle";
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
