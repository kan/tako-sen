import { describe, expect, it } from "vitest";
import {
  dailyHistory,
  historyView,
  localHistory,
  onlineHistory,
  type HistoryPlay,
} from "../src/core/history-view";
import { encodeSuperSeed } from "../src/core/super-puzzle";
const play = (
  id: string,
  difficulty: HistoryPlay["difficulty"],
  elapsedSeconds: number,
  playedAt: number,
): HistoryPlay => ({
  id,
  difficulty,
  seedCode: "TAKO:g2:easy:test",
  completed: true,
  elapsedSeconds,
  playedAt,
  mistakes: 0,
  hintsUsed: 0,
});
describe("unified difficulty history", () => {
  it("isolates four modes and counts unfinished local trials without graphing them", () => {
    const records = [
      play("a", "easy", 30, 1),
      play("b", "easy", 60, 2),
      play("n", "normal", 300, 3),
      play("s", "super", 900, 4),
      { ...play("unfinished", "easy", 0, 5), completed: false },
    ];
    expect(historyView(records, "easy")).toMatchObject({
      plays: 3,
      clears: 2,
      averageSeconds: 45,
      bestScore: 9970,
    });
    expect(
      historyView(records, "easy").trend.map((point) => point.play.id),
    ).toEqual(["a", "b"]);
    expect(historyView(records, "easy").recent[0].id).toBe("unfinished");
    expect(historyView(records, "super").clears).toBe(1);
    expect(historyView(records, "hard").averageSeconds).toBeUndefined();
  });
  it("keeps graph coordinates finite for one zero-second play, limits to 20, and never mutates input", () => {
    const zero = [play("a", "hard", 0, 0)];
    expect(historyView(zero, "hard").trend[0]).toMatchObject({ x: 20, y: 100 });
    const records = Array.from({ length: 25 }, (_, i) =>
      play(String(i), "easy", i, i),
    );
    const copy = [...records];
    const view = historyView(records, "easy");
    expect(view.recent).toHaveLength(20);
    expect(view.trend).toHaveLength(20);
    expect(view.trend[0].play.playedAt).toBe(5);
    expect(view.trend.at(-1)!.play.playedAt).toBe(24);
    expect(records).toEqual(copy);
  });
  it("normalizes online completions without claiming to know all attempts and validates mode and scores", () => {
    const record = {
      playId: "id",
      seedCode: "TAKO:g2:normal:test",
      difficulty: "normal",
      completedAt: 100,
      elapsedSeconds: 0,
      mistakes: 0,
      hintsUsed: 0,
    };
    expect(onlineHistory([record], "normal")[0]).toMatchObject({
      difficulty: "normal",
      completed: true,
      playedAt: 100,
    });
    expect(
      onlineHistory(
        [{ ...record, seedCode: encodeSuperSeed("test") }],
        "super",
      )[0].difficulty,
    ).toBe("super");
    expect(() => onlineHistory([record], "super")).toThrow();
    expect(() =>
      onlineHistory([{ ...record, elapsedSeconds: -1 }], "normal"),
    ).toThrow();
    expect(() => onlineHistory({}, "normal")).toThrow();
    expect(() =>
      onlineHistory([{ ...record, difficulty: "easy" }], "normal"),
    ).toThrow();
  });
  it("normalizes daily attempts, keeping unfinished days without results or seeds", () => {
    const done = {
      playId: "d1",
      date: "2026-10-13",
      startedAt: 10,
      completedAt: 90,
      elapsedSeconds: 80,
      mistakes: 1,
      hintsUsed: 2,
    };
    const open = {
      playId: "d2",
      date: "2026-10-14",
      startedAt: 200,
      completedAt: null,
      elapsedSeconds: null,
      mistakes: null,
      hintsUsed: null,
    };
    const records = dailyHistory([done, open]);
    expect(records).toEqual([
      {
        id: "d1",
        date: "2026-10-13",
        difficulty: "daily",
        playedAt: 90,
        completed: true,
        elapsedSeconds: 80,
        mistakes: 1,
        hintsUsed: 2,
      },
      {
        id: "d2",
        date: "2026-10-14",
        difficulty: "daily",
        playedAt: 200,
        completed: false,
      },
    ]);
    expect(historyView(records, "daily")).toMatchObject({
      plays: 2,
      clears: 1,
      averageSeconds: 80,
    });
    expect(historyView(records, "hard").plays).toBe(0);
    // A day completed late (here after the next day began) stays below it.
    const late = dailyHistory([{ ...done, completedAt: 500 }, open]);
    expect(historyView(late, "daily").recent.map((p) => p.id)).toEqual([
      "d2",
      "d1",
    ]);
    expect(() => dailyHistory({})).toThrow();
    expect(() => dailyHistory([{ ...done, date: "10/13" }])).toThrow();
    expect(() => dailyHistory([{ ...done, mistakes: null }])).toThrow();
    expect(() => dailyHistory([{ ...open, elapsedSeconds: 3 }])).toThrow();
  });
  it("preserves local trial dates, completion metrics and status", () => {
    expect(
      localHistory([
        {
          id: "x",
          userId: "local",
          seedCode: "TAKO:g2:easy:x",
          generatorVersion: "g2",
          difficulty: "easy",
          startedAt: 20,
          status: "in-progress",
        },
      ])[0],
    ).toMatchObject({ id: "x", playedAt: 20, completed: false });
  });
});
