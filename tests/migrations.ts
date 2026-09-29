import { readFileSync } from "node:fs";
import { unstable_splitSqlQuery } from "wrangler";

export async function migrateTestDatabase(
  db: D1Database,
  beforeAutomaticRanking?: () => Promise<void>,
  beforeHintStage?: () => Promise<void>,
): Promise<void> {
  for (const file of [
    "0001_completed_plays.sql",
    "0002_shared_puzzles.sql",
    "0003_public_leaderboards.sql",
    "0004_automatic_ranking.sql",
    "0005_hint_stage.sql",
  ]) {
    if (file === "0004_automatic_ranking.sql") await beforeAutomaticRanking?.();
    if (file === "0005_hint_stage.sql") await beforeHintStage?.();
    const sql = readFileSync(
      new URL(`../migrations/${file}`, import.meta.url),
      "utf8",
    );
    // Match the CLI's SQL splitting, not just D1's acceptance of a whole trigger.
    for (const statement of unstable_splitSqlQuery(sql)) {
      await db.prepare(statement).run();
    }
  }
}
