/**
 * The Seed Script: a thin wrapper around `seed(db, csvPath)`.
 *
 * Deliberately a CLI and never a panel screen: v1 has no bulk edit, and the
 * guarantees that make a Seed safe belong to `seed()` rather than to this
 * wrapper. See `docs/seed/README.md` for what the file it reads contains.
 *
 *   npm run db:seed
 *   npm run db:seed -- --database /data/launch-tasks.sqlite
 *
 * There is no flag for the CSV: a Seed loads the committed Task Library or it
 * does not run.
 */
import { createDatabase } from "../app/database/database";
import {
  seed,
  SeedError,
  TASK_LIBRARY_CSV_PATH,
} from "../app/seed/seed";
import { databasePath } from "../app/database/database-path";

const databaseFlag = process.argv.indexOf("--database");
const file =
  databaseFlag === -1 ? databasePath() : process.argv[databaseFlag + 1]!;

try {
  const result = seed(createDatabase(file), TASK_LIBRARY_CSV_PATH);
  console.log(
    `Seeded ${file} from ${TASK_LIBRARY_CSV_PATH}: ` +
      `${result.tasks} Tasks across ${result.phases} Phases, ` +
      `${result.helpfulLinks} Helpful Links, ` +
      `${result.dependencies} Dependencies, ` +
      `all published at ${result.publishedAt.toISOString()}.`,
  );
} catch (error) {
  if (!(error instanceof SeedError)) throw error;
  // A refusal is not a crash: it is the script doing its job, so it says so
  // in one line rather than in a stack trace.
  console.error(error.message);
  process.exit(1);
}
