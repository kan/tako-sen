import type { CompletedPlayUpload, OnlinePlay } from "../core/online-history";

export type SaveOutcome = "created" | "duplicate" | "conflict";

export async function deleteAccountHistory(
  db: D1Database,
  accountId: string,
): Promise<void> {
  await db.batch([
    db
      .prepare("DELETE FROM completed_plays WHERE account_id = ?")
      .bind(accountId),
    db
      .prepare("DELETE FROM leaderboard_profiles WHERE account_id = ?")
      .bind(accountId),
    db
      .prepare("DELETE FROM publication_limits WHERE account_id = ?")
      .bind(accountId),
  ]);
}

export async function saveCompletedPlay(
  db: D1Database,
  accountId: string,
  play: CompletedPlayUpload,
): Promise<SaveOutcome> {
  const inserted = await db
    .prepare(
      `INSERT INTO completed_plays
       (account_id, play_id, puzzle_id, seed_code, generator_version, difficulty,
        started_at, completed_at, elapsed_seconds, mistakes, hints_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, play_id) DO NOTHING`,
    )
    .bind(
      accountId,
      play.playId,
      play.puzzleId,
      play.seedCode,
      play.generatorVersion,
      play.difficulty,
      play.startedAt,
      play.completedAt,
      play.elapsedSeconds,
      play.mistakes,
      play.hintsUsed,
    )
    .run();
  if (inserted.meta.changes > 0) return "created";

  const existing = await db
    .prepare(
      `SELECT puzzle_id, seed_code, generator_version, difficulty, started_at,
              completed_at, elapsed_seconds, mistakes, hints_used
       FROM completed_plays WHERE account_id = ? AND play_id = ?`,
    )
    .bind(accountId, play.playId)
    .first<StoredPlay>();
  if (!existing) throw new Error("Stored play disappeared after conflict.");
  return samePlay(existing, play) ? "duplicate" : "conflict";
}

export async function listCompletedPlays(
  db: D1Database,
  accountId: string,
): Promise<OnlinePlay[]> {
  const result = await db
    .prepare(
      `SELECT play_id, puzzle_id, seed_code, generator_version, difficulty,
              started_at, completed_at, elapsed_seconds, mistakes, hints_used, is_public
       FROM completed_plays WHERE account_id = ?
       ORDER BY completed_at DESC, play_id DESC LIMIT 500`,
    )
    .bind(accountId)
    .all<StoredPlay & { is_public: number }>();
  return result.results.map((row) => ({
    playId: row.play_id,
    puzzleId: row.puzzle_id,
    seedCode: row.seed_code,
    generatorVersion: row.generator_version,
    difficulty: row.difficulty,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    elapsedSeconds: row.elapsed_seconds,
    mistakes: row.mistakes,
    hintsUsed: row.hints_used,
    isPublic: row.is_public === 1,
  }));
}

interface StoredPlay {
  readonly play_id: string;
  readonly puzzle_id: string;
  readonly seed_code: string;
  readonly generator_version: string;
  readonly difficulty: CompletedPlayUpload["difficulty"];
  readonly started_at: number;
  readonly completed_at: number;
  readonly elapsed_seconds: number;
  readonly mistakes: number;
  readonly hints_used: number;
}

function samePlay(stored: StoredPlay, play: CompletedPlayUpload): boolean {
  return (
    stored.puzzle_id === play.puzzleId &&
    stored.seed_code === play.seedCode &&
    stored.generator_version === play.generatorVersion &&
    stored.difficulty === play.difficulty &&
    stored.started_at === play.startedAt &&
    stored.completed_at === play.completedAt &&
    stored.elapsed_seconds === play.elapsedSeconds &&
    stored.mistakes === play.mistakes &&
    stored.hints_used === play.hintsUsed
  );
}
