import type { PlayResult } from "./results";
import { rankingScore } from "./ranking-score";
import { parsePuzzleSeedCode } from "./puzzle-code";
import { parseSuperSeed } from "./super-puzzle";
import { isDailyDate } from "./daily-puzzle";

export type HistoryDifficulty = "easy" | "normal" | "hard" | "super" | "daily";
export interface HistoryPlay {
  readonly id: string;
  /** Daily attempts have no seed to share or replay. */
  readonly seedCode?: string;
  /** The challenge date (`YYYY-MM-DD`) of a daily attempt. */
  readonly date?: string;
  readonly difficulty: HistoryDifficulty;
  readonly playedAt: number;
  readonly completed: boolean;
  readonly elapsedSeconds?: number;
  readonly mistakes?: number;
  readonly hintsUsed?: number;
}
export function localHistory(plays: readonly PlayResult[]): HistoryPlay[] {
  return plays.map((play) => ({
    id: play.id,
    seedCode: play.seedCode,
    difficulty: play.difficulty,
    playedAt: play.completedAt ?? play.startedAt,
    completed: play.status === "completed",
    elapsedSeconds: play.elapsedSeconds,
    mistakes: play.mistakes,
    hintsUsed: play.hintsUsed,
  }));
}
const isCount = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
/** API data is validated here; UI rendering never infers a mode from a colour. */
export function onlineHistory(
  value: unknown,
  mode: "normal" | "super",
): HistoryPlay[] {
  if (!Array.isArray(value)) throw new Error("Invalid history response.");
  const records: HistoryPlay[] = [];
  for (const play of value) {
    if (
      !play ||
      typeof play !== "object" ||
      typeof play.playId !== "string" ||
      typeof play.seedCode !== "string" ||
      ![
        play.completedAt,
        play.elapsedSeconds,
        play.mistakes,
        play.hintsUsed,
      ].every(isCount)
    )
      throw new Error("Invalid history record.");
    const code = parsePuzzleSeedCode(play.seedCode);
    if (
      mode === "super"
        ? parseSuperSeed(play.seedCode) === undefined
        : !code || code.difficulty !== play.difficulty
    )
      throw new Error("Invalid history mode.");
    records.push({
      id: play.playId,
      seedCode: play.seedCode,
      difficulty: mode === "super" ? "super" : play.difficulty,
      playedAt: play.completedAt,
      completed: true,
      elapsedSeconds: play.elapsedSeconds,
      mistakes: play.mistakes,
      hintsUsed: play.hintsUsed,
    });
  }
  return records;
}
/** Daily attempts include unfinished ones, whose results are all null. */
export function dailyHistory(value: unknown): HistoryPlay[] {
  if (!Array.isArray(value)) throw new Error("Invalid history response.");
  return value.map((play) => {
    if (
      !play ||
      typeof play !== "object" ||
      typeof play.playId !== "string" ||
      typeof play.date !== "string" ||
      !isDailyDate(play.date) ||
      !isCount(play.startedAt)
    )
      throw new Error("Invalid history record.");
    const results = [
      play.completedAt,
      play.elapsedSeconds,
      play.mistakes,
      play.hintsUsed,
    ];
    const completed = results.every(isCount);
    if (!completed && !results.every((v) => v === null))
      throw new Error("Invalid history record.");
    return {
      id: play.playId,
      date: play.date,
      difficulty: "daily",
      playedAt: completed ? play.completedAt : play.startedAt,
      completed,
      ...(completed
        ? {
            elapsedSeconds: play.elapsedSeconds,
            mistakes: play.mistakes,
            hintsUsed: play.hintsUsed,
          }
        : {}),
    };
  });
}
export function historyView(
  records: readonly HistoryPlay[],
  difficulty: HistoryDifficulty,
) {
  const plays = records
    .filter((play) => play.difficulty === difficulty)
    // Daily attempts order by challenge date: a late completion of an earlier
    // day must not rise above a later day.
    .sort(
      (a, b) =>
        (b.date ?? "").localeCompare(a.date ?? "") ||
        b.playedAt - a.playedAt ||
        a.id.localeCompare(b.id),
    );
  const completed = plays.filter(
    (p) => p.completed && p.elapsedSeconds !== undefined,
  );
  const average = (key: "elapsedSeconds" | "mistakes" | "hintsUsed") =>
    completed.length
      ? completed.reduce((sum, play) => sum + (play[key] ?? 0), 0) /
        completed.length
      : undefined;
  const trend = completed.slice(0, 20).reverse();
  const max = Math.max(1, ...trend.map((p) => p.elapsedSeconds!));
  return {
    plays: plays.length,
    clears: completed.length,
    averageSeconds: average("elapsedSeconds"),
    averageMistakes: average("mistakes"),
    averageHints: average("hintsUsed"),
    bestScore: completed.length
      ? Math.max(
          ...completed.map((p) =>
            rankingScore({
              elapsedSeconds: p.elapsedSeconds!,
              mistakes: p.mistakes ?? 0,
              hintsUsed: p.hintsUsed ?? 0,
            }),
          ),
        )
      : undefined,
    recent: plays.slice(0, 20),
    trend: trend.map((play, i) => ({
      play,
      x: 20 + (i * 260) / Math.max(1, trend.length - 1),
      y: 100 - (play.elapsedSeconds! * 80) / max,
    })),
    maxSeconds: max,
  };
}
