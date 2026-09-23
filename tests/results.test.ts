import { describe, expect, it } from "vitest";
import {
  finishPlay,
  hasPlayerMarks,
  playerMarksChanged,
  sameSeedRanking,
  startPlay,
  summarizeUser,
  type ResultHistory,
} from "../src/core/results";
import {
  loadGame,
  loadResultHistory,
  saveGame,
  saveResultHistory,
  type KeyValueStorage,
} from "../src/core/storage";
import { createInitialPlayerState, type Puzzle } from "../src/core/model";

function memoryStorage(): KeyValueStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

function begin(
  history: ResultHistory,
  id: string,
  seedCode = "TAKO:g1:easy:one",
  difficulty: "easy" | "hard" = "easy",
  startedAt = 1000,
): ResultHistory {
  return startPlay(history, {
    id,
    seedCode,
    generatorVersion: "g1",
    difficulty,
    startedAt,
  });
}

describe("local results", () => {
  it("creates and retains an anonymous local session", () => {
    const storage = memoryStorage();
    const first = loadResultHistory(storage, () => "random-user");
    expect(first.userId).toBe("random-user");
    saveResultHistory(begin(first, "attempt"), storage);
    expect(loadResultHistory(storage, () => "different-user")).toEqual(
      begin(first, "attempt"),
    );
  });

  it("keeps the current attempt id in the separate in-progress save", () => {
    const storage = memoryStorage();
    const puzzle = {
      size: 8,
      regions: Array(64).fill(0),
      solution: [],
      seed: "one",
    } as Puzzle;
    const state = createInitialPlayerState(1234);
    const history = begin(
      loadResultHistory(storage, () => "user"),
      "attempt",
    );
    saveResultHistory(history, storage);
    saveGame(puzzle, state, storage, "attempt", {
      waitingToStart: true,
      elapsedMs: 0,
      hasStarted: false,
    });
    expect(loadGame(storage)?.playId).toBe("attempt");
    expect(loadGame(storage)?.timer).toEqual({
      waitingToStart: true,
      elapsedMs: 0,
      hasStarted: false,
    });
    saveGame(puzzle, { ...state, startedAt: 4567 }, storage, "attempt", {
      waitingToStart: false,
      elapsedMs: 12000,
      hasStarted: true,
    });
    expect(loadGame(storage)?.timer).toEqual({
      waitingToStart: false,
      elapsedMs: 12000,
      hasStarted: true,
    });
    expect(loadGame(storage)?.state.startedAt).toBe(4567);
    expect(loadResultHistory(storage).plays).toHaveLength(1);
  });

  it("treats an older save without a ready flag as already started", () => {
    const storage = memoryStorage();
    storage.setItem(
      "tako-sen.current-game.v1",
      JSON.stringify({
        puzzle: { size: 8, regions: [], solution: [], seed: "old" },
        state: {
          excluded: [],
          pieces: [],
          fixedErrors: [],
          mistakes: 0,
          hintsUsed: 0,
          startedAt: 1234,
        },
      }),
    );
    expect(loadGame(storage)?.timer.waitingToStart).toBe(false);
  });

  it("does not start a play for an untouched board, even with a given piece", () => {
    const initial = createInitialPlayerState(1000, [7]);
    const puzzle = { givens: [7] };
    expect(hasPlayerMarks(puzzle, initial)).toBe(false);
    expect(playerMarksChanged(initial, initial)).toBe(false);
    const marked = { ...initial, excluded: new Set([1]) };
    expect(playerMarksChanged(initial, marked)).toBe(true);
    expect(hasPlayerMarks(puzzle, marked)).toBe(true);
    const unmarked = { ...marked, excluded: new Set<number>() };
    expect(playerMarksChanged(marked, unmarked)).toBe(true);
    expect(hasPlayerMarks(puzzle, unmarked)).toBe(false);
    expect(
      hasPlayerMarks(puzzle, { ...initial, pieces: new Set([7, 10]) }),
    ).toBe(true);
    expect(
      hasPlayerMarks(puzzle, { ...initial, fixedErrors: new Set([3]) }),
    ).toBe(true);
  });

  it("records completion only once and keeps separate attempts for the same seed", () => {
    let history = begin({ version: 1, userId: "user", plays: [] }, "first");
    history = finishPlay(history, "first", 62000, 1, 2, 61);
    expect(finishPlay(history, "first", 122000, 9, 9, 121)).toBe(history);
    history = begin(history, "second");
    history = finishPlay(history, "second", 62000, 0, 1, 61);
    expect(history.plays).toHaveLength(2);
    expect(
      sameSeedRanking(history, "TAKO:g1:easy:one").map((play) => play.id),
    ).toEqual(["second", "first"]);
  });

  it("records active play time rather than wall-clock time after pauses", () => {
    const history = begin({ version: 1, userId: "user", plays: [] }, "paused");
    const finished = finishPlay(history, "paused", 900000, 0, 0, 42);
    expect(finished.plays[0].elapsedSeconds).toBe(42);
  });

  it("sorts by seconds, then hints, then mistakes and separates seed/version/difficulty", () => {
    let history: ResultHistory = { version: 1, userId: "user", plays: [] };
    for (const [id, duration, mistakes, hints] of [
      ["slow", 64000, 0, 0],
      ["hint", 63000, 0, 1],
      ["miss", 63000, 1, 0],
      ["best", 63000, 0, 0],
    ] as const) {
      history = finishPlay(
        begin(history, id),
        id,
        duration,
        mistakes,
        hints,
        (duration - 1000) / 1000,
      );
    }
    history = finishPlay(
      begin(history, "other", "TAKO:g2:easy:one"),
      "other",
      2000,
      0,
      0,
      1,
    );
    expect(
      sameSeedRanking(history, "TAKO:g1:easy:one").map((play) => play.id),
    ).toEqual(["best", "miss", "hint", "slow"]);
  });

  it("summarizes plays, clears, averages, best updates and recent seeds", () => {
    let history: ResultHistory = { version: 1, userId: "user", plays: [] };
    history = finishPlay(begin(history, "a"), "a", 61000, 1, 2, 60);
    history = finishPlay(
      begin(history, "b", undefined, "easy", 62000),
      "b",
      92000,
      0,
      0,
      30,
    );
    history = begin(history, "unfinished", "TAKO:g1:hard:two", "hard", 93000);
    const summary = summarizeUser(history);
    expect(summary.plays).toBe(3);
    expect(summary.clears).toBe(2);
    expect(summary.personalBests).toBe(2);
    expect(summary.byDifficulty[0]).toMatchObject({
      plays: 2,
      clears: 2,
      averageSeconds: 45,
      averageMistakes: 0.5,
      averageHints: 1,
    });
    expect(summary.byDifficulty[2]).toMatchObject({
      plays: 1,
      clears: 0,
      averageSeconds: undefined,
    });
    expect(summary.recentSeeds[0]).toBe("TAKO:g1:hard:two");
  });
});
