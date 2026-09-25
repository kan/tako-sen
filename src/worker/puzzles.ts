import type { SharedPuzzleSnapshot } from "../core/shared-puzzle";

export async function saveSharedPuzzle(
  db: D1Database,
  snapshot: SharedPuzzleSnapshot,
): Promise<"created" | "existing"> {
  const result = await db
    .prepare(
      `INSERT INTO shared_puzzles
       (puzzle_id, size, regions_json, givens_json, seed, difficulty,
        generator_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(puzzle_id) DO NOTHING`,
    )
    .bind(
      snapshot.id,
      snapshot.size,
      JSON.stringify(snapshot.regions),
      JSON.stringify(snapshot.givens),
      snapshot.seed,
      snapshot.difficulty,
      snapshot.generatorVersion,
      Date.now(),
    )
    .run();
  return result.meta.changes > 0 ? "created" : "existing";
}

export async function getSharedPuzzle(
  db: D1Database,
  id: string,
): Promise<SharedPuzzleSnapshot | undefined> {
  const row = await db
    .prepare(
      `SELECT puzzle_id, size, regions_json, givens_json, seed, difficulty,
              generator_version
       FROM shared_puzzles WHERE puzzle_id = ?`,
    )
    .bind(id)
    .first<StoredSharedPuzzle>();
  if (!row) return undefined;
  return {
    id: row.puzzle_id,
    size: row.size,
    regions: JSON.parse(row.regions_json),
    givens: JSON.parse(row.givens_json),
    seed: row.seed,
    difficulty: row.difficulty,
    generatorVersion: row.generator_version,
  };
}

interface StoredSharedPuzzle {
  readonly puzzle_id: string;
  readonly size: number;
  readonly regions_json: string;
  readonly givens_json: string;
  readonly seed: string;
  readonly difficulty: SharedPuzzleSnapshot["difficulty"];
  readonly generator_version: string;
}
