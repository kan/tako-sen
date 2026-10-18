import { readFileSync } from "node:fs";
import { unstable_splitSqlQuery } from "wrangler";

/** The plan of a query as one string, for asserting which indexes it uses. */
export async function explainQueryPlan(
  db: D1Database,
  sql: string,
  ...values: unknown[]
): Promise<string> {
  const plan = await db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...values)
    .all<{ detail: string }>();
  return plan.results.map((row) => row.detail).join("\n");
}

export async function migrateTestDatabase(
  db: D1Database,
  beforeAutomaticRanking?: () => Promise<void>,
  beforeHintStage?: () => Promise<void>,
  beforeSuperClearCredit?: () => Promise<void>,
): Promise<void> {
  for (const file of [
    "0001_completed_plays.sql",
    "0002_shared_puzzles.sql",
    "0003_public_leaderboards.sql",
    "0004_automatic_ranking.sql",
    "0005_hint_stage.sql",
    "0006_daily_challenge.sql",
    "0007_super_challenge.sql",
    "0008_ranking_query_indexes.sql",
    "0009_super_clear_credit.sql",
    "0010_weekly_ranking_index.sql",
    "0011_super_query_indexes.sql",
    "0012_daily_version.sql",
    "0013_deleted_accounts.sql",
    "0014_unnamed_history.sql",
  ]) {
    if (file === "0004_automatic_ranking.sql") await beforeAutomaticRanking?.();
    if (file === "0005_hint_stage.sql") await beforeHintStage?.();
    if (file === "0009_super_clear_credit.sql")
      await beforeSuperClearCredit?.();
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
