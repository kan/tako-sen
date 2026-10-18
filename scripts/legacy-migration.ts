/**
 * Moves the records of the old URL (Clerk accounts, D1 `tako-sen-dev`) to
 * kan-game.app IDs (docs/NEXT_PHASE.md「既存の記録の移行」).
 *
 * Input is the old D1 as `wrangler d1 export` writes it. Every Clerk user ID
 * gets a new ID and a migration token, and three SQL files come out:
 *
 * - tako: the whole database with the new IDs, at the latest migration, for
 *   an empty TAKO-SEN D1. Rows are written before the triggers, as in an
 *   export, so importing them changes nothing (no rate limit, no ranking).
 * - kanGame: the IDs, names and token hashes for the ID platform's D1
 *   (kan/game docs/ID_DESIGN.md「引き継ぎ用トークン」).
 * - legacy: the Clerk user ID → token table for the old URL's D1, which hands
 *   each player their token after a Clerk sign-in.
 *
 * The tokens are secrets until the migration period ends: the kanGame file
 * holds only their hashes, but the legacy file holds them in clear.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
// The ID platform's name rules, from kan/game's test kit (copied unchanged).
import { normalizeName } from "../tests/kan-game/fake-id-platform.ts";

export interface Migration {
  /** File name (e.g. 0014_unnamed_history.sql) and SQL. */
  readonly name: string;
  readonly sql: string;
}

export interface MigrateOptions {
  /** The old D1, as `wrangler d1 export` writes it. */
  readonly dump: string;
  /** Every migration of this repository, in order (readMigrations). */
  readonly migrations: readonly Migration[];
  /** When the migration tokens stop working (ms). */
  readonly tokensExpireAt: number;
  readonly now: number;
  readonly newId?: () => string;
  readonly newToken?: () => string;
}

export interface MigratedAccount {
  readonly clerkUserId: string;
  readonly id: string;
  readonly token: string;
  readonly name: string | null;
  /**
   * The new ID's creation time: the account's first clear or consent, or the
   * time of the migration for an account with neither.
   */
  readonly createdAt: number;
}

export interface MigrationResult {
  readonly accounts: readonly MigratedAccount[];
  readonly tako: string;
  readonly kanGame: string;
  readonly legacy: string;
}

/** The migrations in a directory, in the order wrangler applies them. */
export function readMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(resolve(dir, name), "utf8") }));
}

/** 32 random bytes in base64url without padding: 43 characters. */
export function randomMigrationToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}

/** As kan/game stores it: SHA-256 of the token string, lowercase hex. */
export function migrationTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Clerk user IDs; anything else means the dump is not the old database. */
const CLERK_USER_ID = /^user_[A-Za-z0-9]+$/;

/** Foreign keys stay off while IDs are rewritten table by table. */
function openScratchDb(sql: string): DatabaseSync {
  const db = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: false,
  });
  db.exec(sql);
  return db;
}

export function migrateLegacy(options: MigrateOptions): MigrationResult {
  const {
    dump,
    migrations,
    tokensExpireAt,
    now,
    newId = () => crypto.randomUUID(),
    newToken = randomMigrationToken,
  } = options;
  const db = openScratchDb(dump);
  try {
    applyPendingMigrations(db, migrations);

    const tables = accountTables(db);
    const clerkUserIds = [
      ...new Set(
        tables.flatMap((table) =>
          db
            .prepare(`SELECT DISTINCT account_id AS id FROM "${table}"`)
            .all()
            .map((row) => String(row.id)),
        ),
      ),
    ].sort();
    for (const clerkUserId of clerkUserIds)
      if (!CLERK_USER_ID.test(clerkUserId))
        throw new Error(`not a Clerk user ID: ${clerkUserId}`);

    const names = new Map(
      db
        .prepare(
          "SELECT account_id AS id, display_name AS name FROM leaderboard_profiles",
        )
        .all()
        .map((row) => [String(row.id), String(row.name)]),
    );
    // The ID platform takes names only in their normalized form.
    for (const name of names.values())
      if (normalizeName(name) !== name)
        throw new Error(`a name breaks the current rules: ${name}`);
    const firstActivity = db.prepare(
      `SELECT MIN(t) AS t FROM (
         SELECT completed_at AS t FROM completed_plays WHERE account_id = ?
         UNION ALL
         SELECT consented_at FROM leaderboard_profiles WHERE account_id = ?)`,
    );
    const accounts = clerkUserIds.map((clerkUserId) => {
      const first = firstActivity.get(clerkUserId, clerkUserId)?.t;
      return {
        clerkUserId,
        id: newId(),
        token: newToken(),
        name: names.get(clerkUserId) ?? null,
        createdAt: first == null ? now : Number(first),
      };
    });

    db.exec("CREATE TEMP TABLE account_map (old TEXT PRIMARY KEY, new TEXT)");
    const map = db.prepare("INSERT INTO account_map (old, new) VALUES (?, ?)");
    for (const { clerkUserId, id } of accounts) map.run(clerkUserId, id);
    for (const table of tables)
      db.exec(
        `UPDATE "${table}" SET account_id = (SELECT new FROM account_map WHERE old = account_id)`,
      );
    db.exec("DROP TABLE account_map");

    return {
      accounts,
      tako: dumpDatabase(db),
      kanGame: kanGameSql(accounts, tokensExpireAt, now),
      legacy: legacySql(accounts),
    };
  } finally {
    db.close();
  }
}

/** Applies the migrations d1_migrations does not list, and lists them. */
export function applyPendingMigrations(
  db: DatabaseSync,
  migrations: readonly Migration[],
): void {
  const applied = new Set(
    db
      .prepare("SELECT name FROM d1_migrations")
      .all()
      .map((row) => String(row.name)),
  );
  const record = db.prepare(
    "INSERT INTO d1_migrations (name, applied_at) VALUES (?, CURRENT_TIMESTAMP)",
  );
  for (const { name, sql } of migrations) {
    if (applied.has(name)) continue;
    db.exec(sql);
    record.run(name);
  }
}

function columnsOf(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((column) => String(column.name));
}

/** Every table with an account_id column. */
function accountTables(db: DatabaseSync): string[] {
  return userTables(db)
    .map(({ name }) => name)
    .filter((table) => columnsOf(db, table).includes("account_id"));
}

/** Tables of the app and of wrangler, not of SQLite or D1 itself. */
function userTables(db: DatabaseSync): { name: string; sql: string }[] {
  return db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' ORDER BY rowid",
    )
    .all()
    .map((row) => ({ name: String(row.name), sql: String(row.sql) }));
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "bigint") return String(value);
  // The schema has no REAL columns; a number that is not finite has no
  // literal, so stop rather than write one SQL cannot read.
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`no SQL literal for ${value}`);
    return String(value);
  }
  if (value instanceof Uint8Array)
    return `X'${Buffer.from(value).toString("hex")}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * The database in the shape `wrangler d1 export` gives: tables with their
 * rows, then indexes, then triggers and views, so that no trigger runs while
 * the rows are imported.
 */
export function dumpDatabase(db: DatabaseSync): string {
  const lines = ["PRAGMA defer_foreign_keys=TRUE;"];
  for (const { name: table, sql } of userTables(db)) {
    lines.push(`${sql};`);
    const columns = columnsOf(db, table);
    const columnList = columns.map((column) => `"${column}"`).join(",");
    for (const row of db
      .prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
      .all())
      lines.push(
        `INSERT INTO "${table}" (${columnList}) VALUES(${columns
          .map((column) => sqlLiteral(row[column]))
          .join(",")});`,
      );
  }
  for (const type of ["index", "trigger", "view"])
    for (const { sql } of db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL AND substr(name, 1, 7) <> 'sqlite_' ORDER BY rowid",
      )
      .all(type))
      lines.push(`${String(sql)};`);
  return `${lines.join("\n")}\n`;
}

/**
 * Differences between the old database and the migrated one: every row of
 * every old table must be in the new one, with the account IDs mapped, and
 * nothing else. Tables the migrations added are not compared. An empty list
 * means the records, the ranked first clears and the names all match, so the
 * rankings computed from them match too.
 */
export function compareMigration(
  oldDump: string,
  newDump: string,
  accounts: readonly Pick<MigratedAccount, "clerkUserId" | "id">[],
): string[] {
  const idOf = new Map(accounts.map((a) => [a.clerkUserId, a.id]));
  const before = openScratchDb(oldDump);
  const after = openScratchDb(newDump);
  try {
    const afterTables = new Set(userTables(after).map(({ name }) => name));
    const differences: string[] = [];
    for (const { name: table } of userTables(before)) {
      if (table === "d1_migrations") continue;
      if (!afterTables.has(table)) {
        differences.push(`${table}: missing`);
        continue;
      }
      const columns = columnsOf(before, table);
      const select = `SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM "${table}"`;
      const rows = (db: DatabaseSync, accountId: (id: string) => string) =>
        db
          .prepare(select)
          .all()
          .map((row) =>
            JSON.stringify(
              columns.map((column) =>
                column === "account_id"
                  ? accountId(String(row[column]))
                  : row[column],
              ),
            ),
          )
          .sort();
      const expected = rows(before, (id) => idOf.get(id) ?? `unmapped:${id}`);
      const actual = rows(after, (id) => id);
      if (expected.length !== actual.length)
        differences.push(
          `${table}: ${expected.length} rows before, ${actual.length} after`,
        );
      else if (expected.some((row, i) => row !== actual[i]))
        differences.push(`${table}: rows differ`);
    }
    return differences;
  } finally {
    before.close();
    after.close();
  }
}

/** IDs first: names and tokens refer to them, and D1 enforces it. */
function kanGameSql(
  accounts: readonly MigratedAccount[],
  tokensExpireAt: number,
  now: number,
): string {
  const lines: string[] = [];
  for (const { id, token, name, createdAt } of accounts) {
    lines.push(
      `INSERT INTO ids (id, status, created_at, last_seen_at) VALUES (${sqlLiteral(id)}, 'active', ${createdAt}, ${now});`,
    );
    if (name !== null)
      lines.push(
        `INSERT INTO names (id, display_name, created_at) VALUES (${sqlLiteral(id)}, ${sqlLiteral(name)}, ${createdAt});`,
      );
    lines.push(
      `INSERT INTO migration_tokens (token_hash, id, expires_at) VALUES (${sqlLiteral(migrationTokenHash(token))}, ${sqlLiteral(id)}, ${tokensExpireAt});`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function legacySql(accounts: readonly MigratedAccount[]): string {
  return `${accounts
    .map(
      ({ clerkUserId, token }) =>
        `INSERT INTO migration_handoffs (clerk_user_id, token) VALUES (${sqlLiteral(clerkUserId)}, ${sqlLiteral(token)});`,
    )
    .join("\n")}\n`;
}
