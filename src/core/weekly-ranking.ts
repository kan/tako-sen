export type WeeklyMetric = "clears" | "time";
export interface WeeklyEntry {
  readonly rank: number;
  readonly displayName: string;
  readonly clears: number;
  readonly averageSeconds: number;
}
export interface WeeklyRanking {
  readonly start: number;
  readonly end: number;
  readonly entries: readonly WeeklyEntry[];
}
const day = 86400000;
const jstOffset = 9 * 3600000;
/** Monday 00:00 JST, independent of the browser/Worker's local timezone. */
export function currentRankingWeek(now: number): {
  start: number;
  end: number;
} {
  const jst = new Date(now + jstOffset);
  const midnight = Date.UTC(
    jst.getUTCFullYear(),
    jst.getUTCMonth(),
    jst.getUTCDate(),
  );
  const start = midnight - ((jst.getUTCDay() + 6) % 7) * day - jstOffset;
  return { start, end: start + 7 * day };
}
