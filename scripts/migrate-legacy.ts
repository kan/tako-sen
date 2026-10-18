// Turns an export of the old D1 into the SQL that moves its records to
// kan-game.app IDs (scripts/legacy-migration.ts, docs/DEPLOY_PROD.md).
//
//   npx wrangler d1 export tako-sen-dev --remote --output <dir>/export.sql
//   node scripts/migrate-legacy.ts --dump <dir>/export.sql \
//     --expires 2027-01-31 --out <dir>/out
//
// The output holds the migration tokens in clear, so <dir> must be outside
// the repository; the script refuses a directory inside it, and refuses to
// overwrite anything.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  compareMigration,
  migrateLegacy,
  readMigrations,
} from "./legacy-migration.ts";

const OUTPUTS = {
  tako: "tako-import.sql",
  kanGame: "kan-game-import.sql",
  legacy: "legacy-handoffs.sql",
  accounts: "accounts.json",
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    dump: { type: "string" },
    expires: { type: "string" },
    out: { type: "string" },
  },
});
if (!values.dump || !values.expires || !values.out)
  fail(
    "usage: node scripts/migrate-legacy.ts --dump <export.sql> --expires <YYYY-MM-DD> --out <dir>",
  );

const repository = fileURLToPath(new URL("..", import.meta.url));
const out = resolve(values.out);
const fromRepository = relative(repository, out);
if (
  !isAbsolute(fromRepository) &&
  fromRepository !== ".." &&
  !fromRepository.startsWith(`..${sep}`)
)
  fail(`${out} is inside the repository; the tokens must not be.`);
const paths = Object.values(OUTPUTS).map((name) => resolve(out, name));
for (const path of paths)
  if (existsSync(path)) fail(`${path} exists; give a new directory.`);

// The end of the day in Japan, when the migration period ends.
const now = Date.now();
const tokensExpireAt = Date.parse(`${values.expires}T23:59:59+09:00`);
if (Number.isNaN(tokensExpireAt)) fail(`not a date: ${values.expires}`);
// kan/game deletes expired tokens every day.
if (tokensExpireAt <= now) fail(`${values.expires} has passed.`);

const dump = readFileSync(values.dump, "utf8");
const result = migrateLegacy({
  dump,
  migrations: readMigrations(resolve(repository, "migrations")),
  tokensExpireAt,
  now,
});

// Nothing is written unless every old row arrived with its ID mapped, and
// the ID platform's D1 takes its file whole (foreign keys, unique names).
const differences = compareMigration(dump, result.tako, result.accounts);
if (differences.length > 0)
  fail(`the migrated database differs:\n${differences.join("\n")}`);
const kanGame = new DatabaseSync(":memory:");
try {
  kanGame.exec(
    readFileSync(
      resolve(repository, "tests/kan-game/0001_initial.sql"),
      "utf8",
    ),
  );
  kanGame.exec(result.kanGame);
} catch (error) {
  fail(`the ID platform would refuse its file: ${String(error)}`);
} finally {
  kanGame.close();
}

mkdirSync(out, { recursive: true, mode: 0o700 });
chmodSync(out, 0o700);
const write = (name: string, content: string) => {
  const path = resolve(out, name);
  writeFileSync(path, content, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
};
write(OUTPUTS.tako, result.tako);
write(OUTPUTS.kanGame, result.kanGame);
write(OUTPUTS.legacy, result.legacy);
write(
  OUTPUTS.accounts,
  `${JSON.stringify(
    result.accounts.map(({ clerkUserId, id, name }) => ({
      clerkUserId,
      id,
      name,
    })),
    null,
    2,
  )}\n`,
);
console.log(
  `${result.accounts.length} accounts → ${out} (${Object.values(OUTPUTS).join(", ")})`,
);
