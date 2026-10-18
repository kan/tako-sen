import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  compareMigration,
  dumpDatabase,
  migrateLegacy,
  migrationTokenHash,
  randomMigrationToken,
  readMigrations,
} from "../scripts/legacy-migration";
import { parseHandoff } from "../src/core/handoff";
import { normalizeName } from "./kan-game/fake-id-platform";

const MIGRATIONS = readMigrations("migrations");
// The old URL stopped at 0012 (the legacy-clerk branch).
const LEGACY_MIGRATIONS = MIGRATIONS.filter((m) => m.name < "0013");
// The ID platform's D1 (kan/game migrations/0001_initial.sql, copied
// unchanged), which kan-game.sql is run against.
const KAN_GAME_SCHEMA = readFileSync("tests/kan-game/0001_initial.sql", "utf8");

const ALICE = "user_2alice";
const BOB = "user_2bob";
const T = 1_790_000_000_000;

/** The old D1 as `wrangler d1 export` writes it. */
function legacyDump(): string {
  const db = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: false,
  });
  db.exec(`CREATE TABLE IF NOT EXISTS "d1_migrations"(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`);
  applyPendingMigrations(db, LEGACY_MIGRATIONS);
  db.exec(`INSERT INTO leaderboard_profiles
    (account_id, display_name, consent_version, consented_at) VALUES
    ('${ALICE}', 'アリス_タコ🐙', 1, ${T}),
    ('${BOB}', 'ボブ', 1, ${T + 5})`);
  const play = db.prepare(`INSERT INTO completed_plays
    (account_id, play_id, puzzle_id, seed_code, generator_version, difficulty,
     started_at, completed_at, elapsed_seconds, mistakes, hints_used,
     ranking_eligible, max_hint_stage)
    VALUES (?, ?, ?, 'TAKO:g4:easy:it''s', 'g4', 'easy', ?, ?, ?, 0, 0, ?, 0)`);
  // Ranked first clears of one puzzle, which the old trigger publishes.
  play.run(ALICE, "a-1", "p1:one", T + 10, T + 70, 60, 1);
  play.run(BOB, "b-1", "p1:one", T + 20, T + 50, 30, 1);
  // More uploads than the new rate limit allows in a minute: importing them
  // must not run the trigger.
  for (let i = 0; i < 12; i++)
    play.run(ALICE, `a-r${i}`, "p1:one", T + 100, T + 160, 60, 0);
  db.exec(`INSERT INTO super_progress (account_id) VALUES ('${ALICE}')`);
  const dump = dumpDatabase(db);
  db.close();
  return dump;
}

function migrate(dump = legacyDump()) {
  let n = 0;
  return migrateLegacy({
    dump,
    migrations: MIGRATIONS,
    tokensExpireAt: T + 1_000_000,
    now: T + 500,
    newId: () => `00000000-0000-4000-8000-00000000000${++n}`,
    newToken: () => String(n).repeat(43),
  });
}

/** An empty D1, as the new database starts. */
function load(sql: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  return db;
}

describe("moving the old URL's records to kan-game.app IDs", () => {
  it("gives every Clerk account a new ID and keeps every row", () => {
    const dump = legacyDump();
    const result = migrate(dump);
    expect(result.accounts.map((a) => [a.clerkUserId, a.name])).toEqual([
      [ALICE, "アリス_タコ🐙"],
      [BOB, "ボブ"],
    ]);
    expect(compareMigration(dump, result.tako, result.accounts)).toEqual([]);

    const db = load(result.tako);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const owners = db
      .prepare(
        "SELECT DISTINCT account_id AS id FROM completed_plays ORDER BY id",
      )
      .all()
      .map((row) => row.id);
    expect(owners).toEqual(result.accounts.map((a) => a.id));
    expect(
      db
        .prepare(
          "SELECT account_id AS id, play_id AS play FROM first_ranked_plays ORDER BY play",
        )
        .all()
        .map((row) => ({ ...row })),
    ).toEqual([
      { id: result.accounts[0].id, play: "a-1" },
      { id: result.accounts[1].id, play: "b-1" },
    ]);
  });

  it("brings the database to the latest migration", () => {
    const db = load(migrate().tako);
    expect(
      db
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all()
        .map((row) => row.name),
    ).toEqual(MIGRATIONS.map((m) => m.name));
    // The next migration is numbered after the imported ones.
    db.exec("INSERT INTO d1_migrations (name) VALUES ('next')");
    expect(
      db.prepare("SELECT id FROM d1_migrations WHERE name = 'next'").get()?.id,
    ).toBe(MIGRATIONS.length + 1);
    // 0013 and 0014 are in effect.
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM deleted_accounts").get()?.n,
    ).toBe(0);
    expect(() =>
      db.exec(`INSERT INTO completed_plays
        (account_id, play_id, puzzle_id, seed_code, generator_version,
         difficulty, started_at, completed_at, elapsed_seconds, mistakes,
         hints_used, max_hint_stage)
        SELECT account_id, 'a-new', 'p1:two', seed_code, generator_version,
          difficulty, started_at, completed_at, elapsed_seconds, 0, 0, 0
        FROM completed_plays WHERE play_id = 'a-1'`),
    ).not.toThrow();
  });

  it("registers the IDs, names and token hashes with the ID platform", () => {
    const result = migrate();
    const db = load(`${KAN_GAME_SCHEMA}\n${result.kanGame}`);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const [alice, bob] = result.accounts;
    for (const { name } of result.accounts)
      expect(normalizeName(name)).toBe(name);
    expect(
      db
        .prepare("SELECT id, created_at AS at FROM ids ORDER BY created_at")
        .all()
        .map((row) => ({ ...row })),
    ).toEqual([
      { id: alice.id, at: T },
      { id: bob.id, at: T + 5 },
    ]);
    expect(
      db
        .prepare("SELECT display_name AS name FROM names WHERE id = ?")
        .get(alice.id)?.name,
    ).toBe("アリス_タコ🐙");
    expect(
      db
        .prepare(
          "SELECT id, expires_at AS at FROM migration_tokens WHERE token_hash = ?",
        )
        .get(migrationTokenHash(bob.token)),
    ).toEqual({ id: bob.id, at: T + 1_000_000 });
  });

  it("gives the old URL each account's token", () => {
    const result = migrate();
    const db = load(`CREATE TABLE migration_handoffs (
      clerk_user_id TEXT PRIMARY KEY, token TEXT NOT NULL);
      ${result.legacy}`);
    expect(
      db
        .prepare("SELECT token FROM migration_handoffs WHERE clerk_user_id = ?")
        .get(BOB)?.token,
    ).toBe(result.accounts[1].token);
  });

  it("refuses a database whose IDs are not Clerk's", () => {
    const migrated = migrate().tako;
    expect(() => migrate(migrated)).toThrow("not a Clerk user ID");
  });

  it("refuses a name the ID platform would not take as it is", () => {
    const dump = legacyDump().replace("'ボブ'", "' ボブ'");
    expect(() => migrate(dump)).toThrow("a name breaks the current rules");
  });

  it("reports rows that did not arrive or changed", () => {
    const dump = legacyDump();
    const result = migrate(dump);
    const db = load(result.tako);
    db.exec("DELETE FROM super_progress");
    db.exec(
      "UPDATE completed_plays SET elapsed_seconds = 1 WHERE play_id = 'b-1'",
    );
    expect(compareMigration(dump, dumpDatabase(db), result.accounts)).toEqual([
      "completed_plays: rows differ",
      "super_progress: 1 rows before, 0 after",
    ]);
  });

  it("makes tokens the new URL accepts", () => {
    const token = randomMigrationToken();
    expect(parseHandoff(`#migration=${token}`)?.migrationToken).toBe(token);
    expect(migrationTokenHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
