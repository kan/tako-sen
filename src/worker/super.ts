import {
  initialSuperProgress,
  type SuperProgress,
  type SuperEntry,
} from "../core/super-progress";
import { parseSuperSeed, generateSuperPuzzle } from "../core/super-puzzle";
import { parsePuzzleSeedCode } from "../core/puzzle-code";
import { puzzleId } from "../core/puzzle-identity";
import {
  restoreSharedPuzzleSnapshot,
  type SharedPuzzleSnapshot,
} from "../core/shared-puzzle";
import { maximumHintStage } from "../core/hint-progress";
import {
  parseDailyCompletion,
  type DailyCompletion,
  type DailyLeaderboardEntry,
} from "./daily";
import type { RankedPuzzleCandidate } from "../core/next-puzzle";
import { rankingScoreSql } from "./ranking-score-sql";

export interface SuperPlayEvent {
  readonly playId: string;
  readonly cycle: number;
  readonly seedCode: string;
}
export interface SuperStart {
  readonly playId: string;
  readonly puzzleId: string;
  readonly entry: SuperEntry;
  readonly cycle: number;
}
export type SuperCompletion = Omit<DailyCompletion, "date">;
export class SuperApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identity = /^p1:[0-9a-f]{64}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SuperApiError(400, "invalid_body");
  return value as Record<string, unknown>;
}
export function parseSuperEvent(value: unknown): SuperPlayEvent {
  const data = object(value);
  if (
    typeof data.playId !== "string" ||
    !uuid.test(data.playId) ||
    !Number.isSafeInteger(data.cycle) ||
    (data.cycle as number) < 0 ||
    typeof data.seedCode !== "string" ||
    data.seedCode.length > 256 ||
    !parsePuzzleSeedCode(data.seedCode)
  )
    throw new SuperApiError(400, "invalid_event");
  return {
    playId: data.playId,
    cycle: data.cycle as number,
    seedCode: data.seedCode,
  };
}
export function parseSuperStart(value: unknown): SuperStart {
  const data = object(value);
  if (
    typeof data.playId !== "string" ||
    !uuid.test(data.playId) ||
    typeof data.puzzleId !== "string" ||
    !identity.test(data.puzzleId) ||
    !Number.isSafeInteger(data.cycle) ||
    (data.cycle as number) < 0 ||
    (data.entry !== "earned" && data.entry !== "shared")
  )
    throw new SuperApiError(400, "invalid_start");
  return {
    playId: data.playId,
    puzzleId: data.puzzleId,
    cycle: data.cycle as number,
    entry: data.entry,
  };
}
export function parseSuperCompletion(value: unknown): SuperCompletion {
  const data = object(value);
  try {
    const { date: _date, ...completion } = parseDailyCompletion({
      ...data,
      date: "2026-01-01",
    });
    return completion;
  } catch {
    throw new SuperApiError(400, "invalid_completion");
  }
}

async function ensureProgress(
  db: D1Database,
  accountId: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO super_progress(account_id)
    SELECT account_id FROM leaderboard_profiles WHERE account_id = ? AND consent_version = 1
    ON CONFLICT(account_id) DO NOTHING`,
    )
    .bind(accountId)
    .run();
  if (
    !(await db
      .prepare("SELECT 1 FROM super_progress WHERE account_id = ?")
      .bind(accountId)
      .first())
  )
    throw new SuperApiError(403, "profile_required");
}
export async function getSuperProgress(
  db: D1Database,
  accountId: string,
): Promise<SuperProgress> {
  await ensureProgress(db, accountId);
  const row = await db
    .prepare(
      "SELECT cycle, count, offer_pending FROM super_progress WHERE account_id = ?",
    )
    .bind(accountId)
    .first<{ cycle: number; count: number; offer_pending: number }>();
  return row
    ? {
        cycle: row.cycle,
        count: row.count,
        offerPending: row.offer_pending === 1,
      }
    : initialSuperProgress();
}
export async function recordSuperEvent(
  db: D1Database,
  accountId: string,
  event: SuperPlayEvent,
  now: number,
): Promise<SuperProgress> {
  await ensureProgress(db, accountId);
  // Rate check only for new IDs; retries remain idempotent even at the limit.
  await db
    .prepare(
      `INSERT INTO super_play_events(account_id, play_id, cycle, seed_code, received_at)
    SELECT ?, ?, ?, ?, ? WHERE
      EXISTS (SELECT 1 FROM super_play_events WHERE account_id = ? AND play_id = ?)
      OR (SELECT COUNT(*) FROM super_play_events WHERE account_id = ? AND received_at > ? - 60000) < 30
    ON CONFLICT(account_id, play_id) DO NOTHING`,
    )
    .bind(
      accountId,
      event.playId,
      event.cycle,
      event.seedCode,
      now,
      accountId,
      event.playId,
      accountId,
      now,
    )
    .run();
  const row = await db
    .prepare(
      "SELECT cycle, seed_code FROM super_play_events WHERE account_id = ? AND play_id = ?",
    )
    .bind(accountId, event.playId)
    .first<{ cycle: number; seed_code: string }>();
  if (!row) throw new SuperApiError(429, "rate_limited");
  if (row.cycle !== event.cycle || row.seed_code !== event.seedCode)
    throw new SuperApiError(409, "play_id_conflict");
  return getSuperProgress(db, accountId);
}
export async function deferSuperProgress(
  db: D1Database,
  accountId: string,
  cycle: number,
): Promise<SuperProgress> {
  await ensureProgress(db, accountId);
  await db
    .prepare(
      "UPDATE super_progress SET offer_pending = 0 WHERE account_id = ? AND cycle = ?",
    )
    .bind(accountId, cycle)
    .run();
  return getSuperProgress(db, accountId);
}
export async function prepareSuperPuzzle(
  db: D1Database,
  accountId: string,
  seedCode: string,
  now: number,
): Promise<SharedPuzzleSnapshot> {
  await ensureProgress(db, accountId);
  const seed = parseSuperSeed(seedCode);
  if (seed === undefined) throw new SuperApiError(400, "invalid_seed");
  const existing = await db
    .prepare("SELECT snapshot_json FROM super_puzzles WHERE seed_code = ?")
    .bind(seedCode)
    .first<{ snapshot_json: string }>();
  if (existing)
    return JSON.parse(existing.snapshot_json) as SharedPuzzleSnapshot;
  const minute = Math.floor(now / 60000);
  const allowed = await db
    .prepare(
      `INSERT INTO super_prepare_limits(account_id, minute, requests) VALUES (?, ?, 1)
    ON CONFLICT(account_id, minute) DO UPDATE SET requests = requests + 1 WHERE requests < 10 RETURNING requests`,
    )
    .bind(accountId, minute)
    .first();
  if (!allowed) throw new SuperApiError(429, "rate_limited");
  await db
    .prepare(
      "DELETE FROM super_prepare_limits WHERE account_id = ? AND minute < ?",
    )
    .bind(accountId, minute - 1)
    .run();
  const puzzle = generateSuperPuzzle(seed);
  const snapshot: SharedPuzzleSnapshot = {
    id: await puzzleId(puzzle),
    size: 10,
    regions: puzzle.regions,
    givens: puzzle.givens ?? [],
    seed,
    difficulty: "hard",
    generatorVersion: "super-v1",
  };
  await db
    .prepare(
      "INSERT INTO super_puzzles(puzzle_id, seed_code, snapshot_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
    )
    .bind(snapshot.id, seedCode, JSON.stringify(snapshot), now)
    .run();
  return snapshot;
}
export async function startSuperAttempt(
  db: D1Database,
  accountId: string,
  start: SuperStart,
  now: number,
): Promise<string> {
  await ensureProgress(db, accountId);
  const existing = await db
    .prepare(
      "SELECT puzzle_id, entry, cycle FROM super_attempts WHERE account_id = ? AND play_id = ?",
    )
    .bind(accountId, start.playId)
    .first<{ puzzle_id: string; entry: string; cycle: number }>();
  if (existing) {
    if (
      existing.puzzle_id !== start.puzzleId ||
      existing.entry !== start.entry ||
      existing.cycle !== start.cycle
    )
      throw new SuperApiError(409, "play_id_conflict");
    return "duplicate";
  }
  if (
    !(await db
      .prepare("SELECT 1 FROM super_puzzles WHERE puzzle_id = ?")
      .bind(start.puzzleId)
      .first())
  )
    throw new SuperApiError(400, "puzzle_not_prepared");
  try {
    await db
      .prepare(
        "INSERT INTO super_attempts(account_id, play_id, puzzle_id, entry, cycle, started_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        accountId,
        start.playId,
        start.puzzleId,
        start.entry,
        start.cycle,
        now,
      )
      .run();
  } catch (error) {
    // Concurrent retry may have inserted the very same trial between reads.
    const retry = await db
      .prepare(
        "SELECT puzzle_id, entry, cycle FROM super_attempts WHERE account_id = ? AND play_id = ?",
      )
      .bind(accountId, start.playId)
      .first<{ puzzle_id: string; entry: string; cycle: number }>();
    if (retry) {
      if (
        retry.puzzle_id === start.puzzleId &&
        retry.entry === start.entry &&
        retry.cycle === start.cycle
      )
        return "duplicate";
      throw new SuperApiError(409, "play_id_conflict");
    }
    if (
      String(error).includes("super_right_required") ||
      String(error).includes("UNIQUE constraint failed")
    )
      throw new SuperApiError(409, "right_unavailable");
    throw error;
  }
  return "started";
}
export async function completeSuperAttempt(
  db: D1Database,
  accountId: string,
  completion: SuperCompletion,
  now: number,
): Promise<string> {
  const existing = await db
    .prepare(
      `SELECT a.puzzle_id, a.completed_at, a.elapsed_seconds, a.mistakes, a.hints_used, a.max_hint_stage, p.snapshot_json
    FROM super_attempts a JOIN super_puzzles p ON p.puzzle_id = a.puzzle_id WHERE a.account_id = ? AND a.play_id = ?`,
    )
    .bind(accountId, completion.playId)
    .first<{
      puzzle_id: string;
      completed_at: number | null;
      elapsed_seconds: number;
      mistakes: number;
      hints_used: number;
      max_hint_stage: number | null;
      snapshot_json: string;
    }>();
  if (!existing) throw new SuperApiError(409, "not_started");
  if (existing.puzzle_id !== completion.puzzleId)
    throw new SuperApiError(400, "invalid_solution");
  const puzzle = await restoreSharedPuzzleSnapshot(
    JSON.parse(existing.snapshot_json),
  );
  if (
    new Set(completion.pieces).size !== 10 ||
    !completion.pieces.every((cell) => puzzle.solution.includes(cell))
  )
    throw new SuperApiError(400, "invalid_solution");
  if (existing.completed_at !== null) {
    if (
      existing.elapsed_seconds !== completion.elapsedSeconds ||
      existing.mistakes !== completion.mistakes ||
      existing.hints_used !== completion.hintsUsed ||
      existing.max_hint_stage !== maximumHintStage(completion)
    )
      throw new SuperApiError(409, "play_id_conflict");
    return "duplicate";
  }
  const result = await db
    .prepare(
      `UPDATE super_attempts SET completed_at = ?, elapsed_seconds = ?, mistakes = ?, hints_used = ?, max_hint_stage = ?
    WHERE account_id = ? AND play_id = ? AND completed_at IS NULL`,
    )
    .bind(
      now,
      completion.elapsedSeconds,
      completion.mistakes,
      completion.hintsUsed,
      maximumHintStage(completion),
      accountId,
      completion.playId,
    )
    .run();
  if (!result.meta.changes)
    return completeSuperAttempt(db, accountId, completion, now);
  return "completed";
}
export async function listSuperCandidates(
  db: D1Database,
  accountId: string,
): Promise<RankedPuzzleCandidate[]> {
  const result = await db
    .prepare(
      `SELECT f.puzzle_id AS puzzleId, p.seed_code AS seedCode, COUNT(*) AS players
    FROM super_first_scores f JOIN super_puzzles p ON p.puzzle_id = f.puzzle_id
    JOIN leaderboard_profiles n ON n.account_id = f.account_id AND n.consent_version = 1
    WHERE NOT EXISTS (SELECT 1 FROM super_attempts a WHERE a.account_id = ? AND a.puzzle_id = f.puzzle_id AND a.completed_at IS NOT NULL)
    GROUP BY f.puzzle_id ORDER BY players DESC, RANDOM() LIMIT 30`,
    )
    .bind(accountId)
    .all<RankedPuzzleCandidate>();
  return result.results;
}
export async function listSuperHistory(db: D1Database, accountId: string) {
  return (
    await db
      .prepare(
        `SELECT a.play_id AS playId, a.puzzle_id AS puzzleId, p.seed_code AS seedCode,
    a.started_at AS startedAt, a.completed_at AS completedAt, a.elapsed_seconds AS elapsedSeconds,
    a.mistakes, a.hints_used AS hintsUsed, a.max_hint_stage AS maxHintStage
    FROM super_attempts a JOIN super_puzzles p ON p.puzzle_id = a.puzzle_id
    WHERE a.account_id = ? AND a.completed_at IS NOT NULL ORDER BY a.completed_at DESC LIMIT 500`,
      )
      .bind(accountId)
      .all()
  ).results;
}
export async function listSuperRanking(
  db: D1Database,
  accountId: string,
  id: string,
): Promise<DailyLeaderboardEntry[]> {
  if (!identity.test(id)) throw new SuperApiError(400, "invalid_puzzle_id");
  const rows = await db
    .prepare(
      `WITH ranked AS (
    SELECT a.account_id, p.display_name, a.elapsed_seconds, a.mistakes, a.hints_used, a.max_hint_stage,
      RANK() OVER (ORDER BY ${rankingScoreSql("a")} DESC, a.elapsed_seconds, a.mistakes, a.hints_used) AS rank,
      ROW_NUMBER() OVER (ORDER BY ${rankingScoreSql("a")} DESC, a.elapsed_seconds, a.mistakes, a.hints_used, p.display_name) AS place
    FROM super_first_scores f JOIN super_attempts a ON a.account_id = f.account_id AND a.play_id = f.play_id
    JOIN leaderboard_profiles p ON p.account_id = f.account_id AND p.consent_version = 1
    WHERE f.puzzle_id = ?)
    SELECT * FROM ranked WHERE place <= 100 OR account_id = ? ORDER BY place LIMIT 101`,
    )
    .bind(id, accountId)
    .all<{
      account_id: string;
      display_name: string;
      elapsed_seconds: number;
      mistakes: number;
      hints_used: number;
      max_hint_stage: DailyLeaderboardEntry["maxHintStage"];
      rank: number;
    }>();
  return rows.results.map((r) => ({
    rank: r.rank,
    displayName: r.display_name,
    elapsedSeconds: r.elapsed_seconds,
    mistakes: r.mistakes,
    hintsUsed: r.hints_used,
    maxHintStage: r.max_hint_stage,
    isSelf: r.account_id === accountId,
  }));
}
