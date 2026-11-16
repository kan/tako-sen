import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { generatePuzzle } from "../src/core/generator";
import { createCompletedPlayUpload } from "../src/core/online-history";
import { encodePuzzleSeed } from "../src/core/puzzle-code";
import { listCompletedPlays, saveCompletedPlay } from "../src/worker/history";
import { migrateTestDatabase } from "./migrations";
import { testAccount } from "./worker-env";

/*
 * The other tests call index.ts directly; these go through the entry the
 * deployed Worker has (src/worker/main.ts), as a browser request or the ID
 * platform's GAME_TAKO binding reaches it.
 */
beforeAll(async () => {
  await migrateTestDatabase(env.DB);
});

describe("the Worker's entry", () => {
  it("serves the HTTP API through the default export", async () => {
    const origin = env.ALLOWED_ORIGINS;
    const history = await exports.default.fetch(
      new Request(`${origin}/api/plays`, { headers: { Origin: origin } }),
    );
    expect(history.status).toBe(401);
    expect(history.headers.get("Cache-Control")).toBe("no-store");
    const puzzle = await exports.default.fetch(
      new Request(`${origin}/api/puzzles/not-a-puzzle`),
    );
    expect(puzzle.status).toBe(400);
  });

  it("deletes an ID's records when the ID platform calls GameService", async () => {
    const id = testAccount("withdrawn-over-rpc");
    const other = testAccount("stays-over-rpc");
    const puzzle = generatePuzzle({ seed: "entrypoint", difficulty: "easy" });
    const play = await createCompletedPlayUpload({
      id: crypto.randomUUID(),
      userId: "local-user-id",
      seedCode: encodePuzzleSeed(puzzle),
      generatorVersion: puzzle.generatorVersion ?? "g1",
      difficulty: puzzle.difficulty ?? "easy",
      startedAt: 1000,
      completedAt: 61000,
      elapsedSeconds: 60,
      mistakes: 0,
      hintsUsed: 0,
      status: "completed",
    });
    await saveCompletedPlay(env.DB, id, play);
    await saveCompletedPlay(env.DB, other, play);

    await exports.GameService.deleteAccount(id);
    expect(await listCompletedPlays(env.DB, id)).toEqual([]);
    expect(await listCompletedPlays(env.DB, other)).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT 1 AS n FROM deleted_accounts WHERE account_id = ?",
      )
        .bind(id)
        .first("n"),
    ).toBe(1);
    // The ID platform retries a withdrawal that did not answer.
    await exports.GameService.deleteAccount(id);
    expect(await listCompletedPlays(env.DB, id)).toEqual([]);
  });
});
