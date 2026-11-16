import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

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

/**
 * Applies migrations/ to a test file's D1 (each file has its own), split into
 * statements as the CLI splits them (readD1Migrations in vitest.config.ts).
 * `before` runs a step just before the named migration, to test how it moves
 * the data an earlier schema held.
 */
export async function migrateTestDatabase(
  db: D1Database,
  before: Record<string, () => Promise<void>> = {},
): Promise<void> {
  const migrations = env.TEST_MIGRATIONS;
  for (const name of Object.keys(before))
    if (!migrations.some((migration) => migration.name === name))
      throw new Error(`No migration named ${name}.`);
  for (const migration of migrations) {
    await before[migration.name]?.();
    await applyD1Migrations(db, [migration]);
  }
}
