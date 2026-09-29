import { describe, expect, it } from "vitest";
import { createInitialPlayerState } from "../src/core/model";
import {
  countHintUsed,
  recordHintStage,
  resetPlayerProgress,
} from "../src/core/player";
import {
  maximumHintStage,
  hintStageLabel,
  validHintProgress,
} from "../src/core/hint-progress";
import {
  finishPlay,
  sameSeedRanking,
  startPlay,
  type ResultHistory,
} from "../src/core/results";
import {
  loadGame,
  loadResultHistory,
  saveGame,
  type KeyValueStorage,
} from "../src/core/storage";
import { generatePuzzle } from "../src/core/generator";
import { SyncOutbox } from "../src/core/sync-outbox";
import { analyzeOnlineHistory } from "../src/core/online-stats";

function storage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
const puzzle = generatePuzzle({ seed: "hint-progress-save" });

describe("maximum hint disclosure", () => {
  it("labels hint depth as a fraction, separately from usage count", () => {
    expect(hintStageLabel({ hintsUsed: 0 })).toBe("未使用");
    for (const stage of [1, 2, 3, 4] as const) {
      expect(hintStageLabel({ hintsUsed: 2, maxHintStage: stage })).toBe(
        `深さ${stage}/4`,
      );
    }
    expect(hintStageLabel({ hintsUsed: 2 })).toBe("深さ不明");
  });
  it("records monotonically without counting further disclosure or reopening as a new hint", () => {
    const initial = createInitialPlayerState(0);
    const first = recordHintStage(countHintUsed(initial), 1);
    const deeper = recordHintStage(first, 3);
    const reopened = recordHintStage(deeper, 1);
    expect(maximumHintStage(initial)).toBe(0);
    expect(first.maxHintStage).toBe(1);
    expect(deeper.maxHintStage).toBe(3);
    expect(reopened).toEqual(deeper);
    expect(reopened.hintsUsed).toBe(1);
    const contradiction = recordHintStage(countHintUsed(reopened), 4);
    expect(contradiction.maxHintStage).toBe(4);
    expect(contradiction.hintsUsed).toBe(2);
    expect(resetPlayerProgress(contradiction).maxHintStage).toBe(0);
    expect(initial.hintsUsed).toBe(0);
  });
  it("does not fabricate disclosure for old hinted records or invalid stages", () => {
    const legacy = {
      ...createInitialPlayerState(0),
      hintsUsed: 2,
      maxHintStage: null,
    };
    expect(recordHintStage(legacy, 3).maxHintStage).toBeNull();
    expect(hintStageLabel(legacy)).toBe("深さ不明");
    for (const stage of [-1, 0, 1.5, 5, NaN])
      expect(() => recordHintStage(legacy, stage)).toThrow();
    expect(() => recordHintStage(createInitialPlayerState(0), 1)).toThrow();
    for (const stage of [-1, 0, 1.5, 5, "2", false])
      expect(validHintProgress(stage, 1)).toBe(false);
    expect(validHintProgress(1, 0)).toBe(false);
  });
  it("prioritizes maximum stage over time for both local ranking and online personal best", () => {
    let history: ResultHistory = { version: 2, userId: "user", plays: [] };
    for (const [id, hintsUsed, stage, seconds] of [
      ["deep", 1, 3, 1],
      ["shallow", 2, 1, 90],
      ["none", 0, 0, 100],
      ["unknown", 1, null, 0],
    ] as const) {
      history = startPlay(history, {
        id,
        seedCode: "TAKO:g1:easy:one",
        generatorVersion: "g1",
        difficulty: "easy",
        startedAt: 0,
      });
      history = finishPlay(history, id, 100000, 0, hintsUsed, seconds, stage);
    }
    expect(
      sameSeedRanking(history, "TAKO:g1:easy:one").map((play) => play.id),
    ).toEqual(["none", "shallow", "deep", "unknown"]);
    const online = history.plays.map((play) => ({
      playId: play.id,
      puzzleId: "p1:test",
      seedCode: play.seedCode,
      generatorVersion: play.generatorVersion,
      difficulty: play.difficulty,
      startedAt: 0,
      completedAt: 100000,
      elapsedSeconds: play.elapsedSeconds!,
      hintsUsed: play.hintsUsed!,
      mistakes: 0,
      maxHintStage: play.maxHintStage,
    }));
    expect(analyzeOnlineHistory(online).puzzleBests[0].best.playId).toBe(
      "none",
    );
  });
});

describe("hint stage save migration", () => {
  it("backs up an invalid v2 stage without resurrecting an older v1 board", () => {
    const local = storage();
    saveGame(puzzle, createInitialPlayerState(1000), local, "current");
    const saved = JSON.parse(local.getItem("tako-sen.current-game.v2")!);
    const oldRaw = JSON.stringify({ ...saved, playId: "older" });
    local.setItem("tako-sen.current-game.v1", oldRaw);
    saved.state.maxHintStage = 5;
    const corrupt = JSON.stringify(saved);
    local.setItem("tako-sen.current-game.v2", corrupt);
    expect(loadGame(local)).toBeUndefined();
    expect(local.getItem("tako-sen.current-game.v2.corrupt")).toBe(corrupt);
    expect(local.getItem("tako-sen.current-game.v1")).toBe(oldRaw);
  });
  it("retains stage across reload and migrates old saves without deleting the original", () => {
    const local = storage();
    const state = recordHintStage(
      countHintUsed(createInitialPlayerState(1000)),
      2,
    );
    saveGame(puzzle, state, local, "trial");
    expect(loadGame(local)?.state.maxHintStage).toBe(2);
    const oldRaw = JSON.stringify({
      puzzle,
      state: {
        excluded: [],
        pieces: [],
        fixedErrors: [],
        mistakes: 0,
        hintsUsed: 2,
        startedAt: 1000,
      },
    });
    const old = storage();
    old.setItem("tako-sen.current-game.v1", oldRaw);
    expect(loadGame(old)?.state.maxHintStage).toBeNull();
    expect(old.getItem("tako-sen.current-game.v1")).toBe(oldRaw);
    expect(old.getItem("tako-sen.current-game.v2")).not.toBeNull();
  });
  it("migrates history and the account-owned pending queue, keeping old data and retry contents", async () => {
    const local = storage();
    const play = {
      id: "legacy",
      userId: "user",
      seedCode: "TAKO:g1:easy:one",
      generatorVersion: "g1",
      difficulty: "easy",
      startedAt: 0,
      completedAt: 1000,
      elapsedSeconds: 1,
      hintsUsed: 1,
      mistakes: 0,
      status: "completed",
    };
    const raw = JSON.stringify({
      version: 1,
      userId: "user",
      plays: [play, { ...play, id: "unhinted", hintsUsed: 0 }],
    });
    local.setItem("tako-sen.results.v1", raw);
    const history = loadResultHistory(local);
    expect(history.version).toBe(2);
    expect(history.plays.map((p) => p.maxHintStage)).toEqual([null, 0]);
    expect(local.getItem("tako-sen.results.v1")).toBe(raw);
    expect(local.getItem("tako-sen.results.v2")).not.toBeNull();
    const outboxRaw = JSON.stringify({
      version: 1,
      pending: [{ accountId: "account", play }],
    });
    local.setItem("tako-sen.sync-outbox.v1", outboxRaw);
    const outbox = new SyncOutbox(history.plays, local);
    expect(outbox.count("account")).toBe(1);
    expect(outbox.count("other")).toBe(0);
    expect(local.getItem("tako-sen.sync-outbox.v1")).toBe(outboxRaw);
    await outbox.drain(
      "account",
      () => true,
      async (pending) => {
        expect(pending.maxHintStage).toBeNull();
      },
    );
    expect(new SyncOutbox(history.plays, local).count("account")).toBe(0);
  });
  it("keeps a known depth unchanged through offline queue persistence and retries", async () => {
    const local = storage();
    const pending = {
      id: "depth-queue",
      userId: "user",
      seedCode: "TAKO:g1:easy:one",
      generatorVersion: "g1",
      difficulty: "easy" as const,
      status: "completed" as const,
      startedAt: 0,
      completedAt: 1000,
      elapsedSeconds: 1,
      hintsUsed: 1,
      maxHintStage: 2 as const,
      mistakes: 0,
    };
    const outbox = new SyncOutbox([], local);
    outbox.capture([pending], "account");
    await expect(
      outbox.drain(
        "account",
        () => true,
        async () => {
          throw new Error("offline");
        },
      ),
    ).rejects.toThrow("offline");
    const restored = new SyncOutbox([pending], local);
    expect(restored.count("other")).toBe(0);
    await restored.drain(
      "account",
      () => true,
      async (sent) => {
        expect(sent).toEqual(pending);
      },
    );
    expect(new SyncOutbox([pending], local).count("account")).toBe(0);
  });
});
