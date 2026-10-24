import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  achievementDefinition,
  achievementProgress,
  isAchievementHidden,
  isAchievementUnlocked,
  isClientUnlockable,
  longestDailyStreak,
  newlyUnlockedAchievementIds,
  type AchievementMetric,
  type AchievementStats,
  type RecordAchievement,
} from "../src/core/achievements";

function stats(
  values: Partial<Record<AchievementMetric, number>> = {},
): AchievementStats {
  return {
    normalClears: 0,
    hardClears: 0,
    noMistakeClears: 0,
    noMistakeHardClears: 0,
    perfectSolves: 0,
    dailyClearDays: 0,
    dailyBestStreak: 0,
    superClears: 0,
    clearDays: 0,
    ...values,
  };
}

const recordAchievements = ACHIEVEMENTS.filter(
  (item): item is RecordAchievement => item.metric !== "client",
);

describe("achievement definitions", () => {
  it("keeps ids unique and thresholds positive integers", () => {
    const ids = ACHIEVEMENTS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of ACHIEVEMENTS) {
      expect(item.id).toMatch(/^[a-z0-9_]+$/);
      expect(item.name).not.toBe("");
      expect(item.description).not.toBe("");
    }
    for (const item of recordAchievements) {
      expect(Number.isInteger(item.threshold)).toBe(true);
      expect(item.threshold).toBeGreaterThan(0);
    }
  });

  it("matches the approved list of conditions", () => {
    // 2026-10-25 に利用者が承認した一覧（docs/NEXT_PHASE.md「実績の候補」）。
    // 説明文と判定の取り違え（例: 連続日数と累計日数）をここで捕まえる。
    expect(
      ACHIEVEMENTS.map((item) =>
        item.metric === "client"
          ? [item.id, "client"]
          : [item.id, item.metric, item.threshold],
      ),
    ).toEqual([
      ["tutorial_complete", "client"],
      ["clear_first", "normalClears", 1],
      ["clear_hard_first", "hardClears", 1],
      ["clear_10", "normalClears", 10],
      ["clear_50", "normalClears", 50],
      ["clear_100", "normalClears", 100],
      ["clear_500", "normalClears", 500],
      ["no_mistake", "noMistakeClears", 1],
      ["no_mistake_hard", "noMistakeHardClears", 1],
      ["perfect_solve", "perfectSolves", 1],
      ["daily_first", "dailyClearDays", 1],
      ["daily_7", "dailyClearDays", 7],
      ["daily_30", "dailyClearDays", 30],
      ["daily_100", "dailyClearDays", 100],
      ["daily_streak_7", "dailyBestStreak", 7],
      ["super_first", "superClears", 1],
      ["super_10", "superClears", 10],
      ["days_7", "clearDays", 7],
      ["days_30", "clearDays", 30],
      ["days_100", "clearDays", 100],
    ]);
  });

  it("marks only the 500 clears as secret", () => {
    expect(
      ACHIEVEMENTS.filter((item) => item.secret).map((item) => item.id),
    ).toEqual(["clear_500"]);
  });

  it("hides a secret achievement only until it is unlocked", () => {
    const secret = achievementDefinition("clear_500")!;
    const open = achievementDefinition("clear_100")!;
    expect(isAchievementHidden(secret, false)).toBe(true);
    expect(isAchievementHidden(secret, true)).toBe(false);
    expect(isAchievementHidden(open, false)).toBe(false);
  });

  it("lets the screen unlock only client achievements", () => {
    expect(isClientUnlockable("tutorial_complete")).toBe(true);
    expect(isClientUnlockable("clear_first")).toBe(false);
    expect(isClientUnlockable("unknown")).toBe(false);
    expect(achievementDefinition("unknown")).toBeUndefined();
  });
});

describe("achievement judgement", () => {
  it("unlocks each record achievement exactly at its threshold", () => {
    for (const item of recordAchievements) {
      const below = stats({ [item.metric]: item.threshold - 1 });
      const at = stats({ [item.metric]: item.threshold });
      expect(isAchievementUnlocked(item, below), item.id).toBe(false);
      expect(isAchievementUnlocked(item, at), item.id).toBe(true);
    }
  });

  it("never unlocks a client achievement from records", () => {
    const tutorial = achievementDefinition("tutorial_complete")!;
    const everything = stats(
      Object.fromEntries(recordAchievements.map((item) => [item.metric, 1000])),
    );
    expect(isAchievementUnlocked(tutorial, everything)).toBe(false);
    expect(newlyUnlockedAchievementIds(everything, [])).not.toContain(
      "tutorial_complete",
    );
  });

  it("unlocks nothing without records", () => {
    expect(newlyUnlockedAchievementIds(stats(), [])).toEqual([]);
  });

  it("unlocks every tier reached at once, in definition order", () => {
    expect(
      newlyUnlockedAchievementIds(
        stats({ normalClears: 120, hardClears: 1 }),
        [],
      ),
    ).toEqual([
      "clear_first",
      "clear_hard_first",
      "clear_10",
      "clear_50",
      "clear_100",
    ]);
  });

  it("returns only achievements not saved yet", () => {
    expect(
      newlyUnlockedAchievementIds(stats({ normalClears: 10 }), [
        "clear_first",
        "removed_achievement",
      ]),
    ).toEqual(["clear_10"]);
    expect(
      newlyUnlockedAchievementIds(stats({ normalClears: 10 }), [
        "clear_first",
        "clear_10",
      ]),
    ).toEqual([]);
  });

  it("caps progress at the threshold", () => {
    const clear50 = achievementDefinition("clear_50") as RecordAchievement;
    expect(achievementProgress(clear50, stats({ normalClears: 12 }))).toBe(12);
    expect(achievementProgress(clear50, stats({ normalClears: 80 }))).toBe(50);
  });
});

describe("daily streak", () => {
  it("finds the longest run of consecutive dates", () => {
    expect(
      longestDailyStreak([
        "2026-10-01",
        "2026-10-02",
        "2026-10-04",
        "2026-10-05",
        "2026-10-06",
      ]),
    ).toBe(3);
  });

  it("crosses month and leap-day boundaries in any order", () => {
    expect(longestDailyStreak(["2026-11-01", "2026-10-30", "2026-10-31"])).toBe(
      3,
    );
    expect(longestDailyStreak(["2028-02-28", "2028-02-29", "2028-03-01"])).toBe(
      3,
    );
    expect(longestDailyStreak(["2027-02-28", "2027-03-01"])).toBe(2);
  });

  it("skips a date it cannot read", () => {
    expect(
      longestDailyStreak(["2026-10-01", "bad", "2026-10-02", "2026-10-03"]),
    ).toBe(3);
  });

  it("counts a repeated date once", () => {
    expect(longestDailyStreak(["2026-10-01", "2026-10-02", "2026-10-02"])).toBe(
      2,
    );
    expect(longestDailyStreak([])).toBe(0);
  });
});
