import {
  dailyDate,
  generateDailyPuzzle,
  isDailyDate,
  DAILY_GENERATOR_VERSION,
} from "../core/daily-puzzle";
import { puzzleId } from "../core/puzzle-identity";
import {
  restoreSharedPuzzleSnapshot,
  type SharedPuzzleSnapshot,
} from "../core/shared-puzzle";
import {
  maximumHintStage,
  validHintProgress,
  type HintStage,
} from "../core/hint-progress";
import type { LeaderboardEntry } from "../core/leaderboard";
import { rankingScoreSql } from "./ranking-score-sql";

export interface DailyStatus {
  readonly date: string;
  readonly puzzle: SharedPuzzleSnapshot;
  readonly attempt: "not_started" | "active" | "completed";
  readonly playId?: string;
}

export async function getDailyStatus(
  db: D1Database,
  accountId: string,
  now: number,
): Promise<DailyStatus> {
  const date = dailyDate(now);
  const puzzle = await getOrCreateDailyPuzzle(db, date, now);
  const attempt = await db
    .prepare(
      "SELECT play_id, completed_at FROM daily_attempts WHERE account_id = ? AND challenge_date = ?",
    )
    .bind(accountId, date)
    .first<{ play_id: string; completed_at: number | null }>();
  return {
    date,
    puzzle,
    attempt: !attempt
      ? "not_started"
      : attempt.completed_at === null
        ? "active"
        : "completed",
    playId: attempt?.play_id,
  };
}

export async function getOrCreateDailyPuzzle(
  db: D1Database,
  date: string,
  now: number,
): Promise<SharedPuzzleSnapshot> {
  if (!isDailyDate(date)) throw new Error("Invalid daily date.");
  const existing = await readDailyPuzzle(db, date);
  if (existing) return existing;
  const puzzle = generateDailyPuzzle(date);
  const snapshot: SharedPuzzleSnapshot = {
    id: await puzzleId(puzzle),
    size: puzzle.size,
    regions: puzzle.regions,
    givens: puzzle.givens ?? [],
    seed: date,
    difficulty: "hard",
    generatorVersion: DAILY_GENERATOR_VERSION,
  };
  await db
    .prepare(
      `INSERT INTO daily_puzzles (challenge_date, puzzle_id, regions_json, givens_json, created_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(challenge_date) DO NOTHING`,
    )
    .bind(
      date,
      snapshot.id,
      JSON.stringify(snapshot.regions),
      JSON.stringify(snapshot.givens),
      now,
    )
    .run();
  return (await readDailyPuzzle(db, date)) ?? snapshot;
}

async function readDailyPuzzle(
  db: D1Database,
  date: string,
): Promise<SharedPuzzleSnapshot | undefined> {
  const row = await db
    .prepare(
      "SELECT puzzle_id, regions_json, givens_json FROM daily_puzzles WHERE challenge_date = ?",
    )
    .bind(date)
    .first<{ puzzle_id: string; regions_json: string; givens_json: string }>();
  if (!row) return undefined;
  return {
    id: row.puzzle_id,
    size: 10,
    regions: JSON.parse(row.regions_json),
    givens: JSON.parse(row.givens_json),
    seed: date,
    difficulty: "hard",
    generatorVersion: DAILY_GENERATOR_VERSION,
  };
}

export async function startDailyAttempt(
  db: D1Database,
  accountId: string,
  date: string,
  playId: string,
  now: number,
): Promise<
  "started" | "duplicate" | "already_started" | "completed" | "expired"
> {
  if (date !== dailyDate(now)) return "expired";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      playId,
    )
  )
    throw new Error("Invalid play ID.");
  await getOrCreateDailyPuzzle(db, date, now);
  const inserted = await db
    .prepare(
      `INSERT INTO daily_attempts (account_id, challenge_date, play_id, started_at)
     VALUES (?, ?, ?, ?) ON CONFLICT(account_id, challenge_date) DO NOTHING`,
    )
    .bind(accountId, date, playId, now)
    .run();
  if (inserted.meta.changes > 0) return "started";
  const existing = await db
    .prepare(
      "SELECT play_id, completed_at FROM daily_attempts WHERE account_id = ? AND challenge_date = ?",
    )
    .bind(accountId, date)
    .first<{ play_id: string; completed_at: number | null }>();
  if (!existing) throw new Error("Daily attempt disappeared after conflict.");
  if (existing.completed_at !== null) return "completed";
  return existing.play_id === playId ? "duplicate" : "already_started";
}

export interface DailyCompletion {
  readonly date: string;
  readonly playId: string;
  readonly puzzleId: string;
  readonly pieces: readonly number[];
  readonly elapsedSeconds: number;
  readonly mistakes: number;
  readonly hintsUsed: number;
  readonly maxHintStage: HintStage | null;
}

export function parseDailyCompletion(value: unknown): DailyCompletion {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid daily completion.");
  const record = value as Record<string, unknown>;
  if (
    typeof record.date !== "string" ||
    !isDailyDate(record.date) ||
    typeof record.playId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      record.playId,
    ) ||
    typeof record.puzzleId !== "string" ||
    !/^p1:[0-9a-f]{64}$/.test(record.puzzleId) ||
    !Array.isArray(record.pieces) ||
    record.pieces.length !== 10 ||
    !record.pieces.every(
      (item) => Number.isInteger(item) && item >= 0 && item < 100,
    ) ||
    ![record.elapsedSeconds, record.mistakes, record.hintsUsed].every(
      (item) => Number.isSafeInteger(item) && (item as number) >= 0,
    ) ||
    !validHintProgress(
      record.maxHintStage as HintStage | null | undefined,
      record.hintsUsed as number,
    )
  )
    throw new Error("Invalid daily completion.");
  return record as unknown as DailyCompletion;
}

export async function completeDailyAttempt(
  db: D1Database,
  accountId: string,
  completion: DailyCompletion,
  now: number,
): Promise<
  "completed" | "duplicate" | "not_started" | "expired" | "invalid_solution"
> {
  if (completion.date > dailyDate(now)) return "expired";
  const snapshot = await readDailyPuzzle(db, completion.date);
  if (!snapshot || snapshot.id !== completion.puzzleId)
    return "invalid_solution";
  const puzzle = await restoreSharedPuzzleSnapshot(snapshot);
  if (
    completion.pieces.length !== puzzle.solution.length ||
    !completion.pieces.every((piece) => puzzle.solution.includes(piece)) ||
    new Set(completion.pieces).size !== puzzle.solution.length
  )
    return "invalid_solution";
  const updated = await db
    .prepare(
      `UPDATE daily_attempts SET completed_at = ?, elapsed_seconds = ?, mistakes = ?, hints_used = ?, max_hint_stage = ?
     WHERE account_id = ? AND challenge_date = ? AND play_id = ? AND completed_at IS NULL`,
    )
    .bind(
      now,
      completion.elapsedSeconds,
      completion.mistakes,
      completion.hintsUsed,
      maximumHintStage(completion),
      accountId,
      completion.date,
      completion.playId,
    )
    .run();
  if (updated.meta.changes > 0) return "completed";
  const existing = await db
    .prepare(
      "SELECT play_id, completed_at FROM daily_attempts WHERE account_id = ? AND challenge_date = ?",
    )
    .bind(accountId, completion.date)
    .first<{ play_id: string; completed_at: number | null }>();
  if (!existing || existing.play_id !== completion.playId) return "not_started";
  return existing.completed_at !== null ? "duplicate" : "not_started";
}

export interface DailyLeaderboardEntry extends LeaderboardEntry {
  readonly isSelf: boolean;
}

export async function listDailyLeaderboard(
  db: D1Database,
  date: string,
  accountId: string,
): Promise<DailyLeaderboardEntry[]> {
  if (!isDailyDate(date)) throw new Error("Invalid daily date.");
  const result = await db
    .prepare(
      `WITH ranked AS (
       SELECT a.account_id, p.display_name, a.elapsed_seconds, a.hints_used, a.mistakes, a.max_hint_stage,
         RANK() OVER (ORDER BY ${rankingScoreSql("a")} DESC, a.elapsed_seconds, a.mistakes, a.hints_used) AS rank,
         ROW_NUMBER() OVER (ORDER BY ${rankingScoreSql("a")} DESC, a.elapsed_seconds, a.mistakes, a.hints_used, p.display_name) AS place
       FROM daily_attempts a JOIN leaderboard_profiles p ON p.account_id = a.account_id
       WHERE a.challenge_date = ? AND a.completed_at IS NOT NULL AND p.consent_version = 1
     )
     SELECT * FROM ranked WHERE place <= 100 OR account_id = ?
     ORDER BY place LIMIT 101`,
    )
    .bind(date, accountId)
    .all<{
      account_id: string;
      display_name: string;
      elapsed_seconds: number;
      hints_used: number;
      mistakes: number;
      max_hint_stage: HintStage | null;
      rank: number;
    }>();
  return result.results.map((row) => ({
    rank: row.rank,
    displayName: row.display_name,
    elapsedSeconds: row.elapsed_seconds,
    hintsUsed: row.hints_used,
    mistakes: row.mistakes,
    maxHintStage: row.max_hint_stage,
    isSelf: row.account_id === accountId,
  }));
}
