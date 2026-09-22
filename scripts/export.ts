/**
 * The Export Script: the content pass, written back to the Task Library.
 *
 * The mirror of `scripts/seed.ts`, and a thin wrapper for the same reason —
 * the guarantees live in `exportTaskLibrary()`, where a test can call them
 * without a shell.
 *
 *   npm run db:export
 *   npm run db:export -- --database /tmp/content.sqlite
 *   npm run db:export -- --out /tmp/review.csv
 *
 * It overwrites `docs/seed/task-library.csv` in place, because git is the
 * review: the diff of a content pass is the point of running it, and a file
 * written beside the real one is a file somebody forgets to move. Commit the
 * diff, and production is seeded from what you just read.
 *
 * Like the Seed, it is not in the production image and never runs inside the
 * container.
 */
import { writeFileSync } from "node:fs";

import { createDatabase } from "../app/database/database";
import { exportTaskLibrary, ExportError } from "../app/seed/export";
import { TASK_LIBRARY_CSV_PATH } from "../app/seed/seed";
import { databasePath } from "../app/database/database-path";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const file = flag("database") ?? databasePath();
const out = flag("out") ?? TASK_LIBRARY_CSV_PATH;

try {
  const result = exportTaskLibrary(createDatabase(file));
  writeFileSync(out, result.csv);

  console.log(
    `Exported ${file} to ${out}: ` +
      `${result.tasks} Tasks across ${result.phases} Phases, ` +
      `${result.helpfulLinks} Helpful Links, ` +
      `${result.dependencies} Dependencies.`,
  );

  // Never a silent drop: Retire is how an Admin deletes during a content
  // pass, and a Draft is work that is not finished. Both are reasonable and
  // both are invisible in the diff, so they are said out loud here.
  for (const { title, state } of result.skipped) {
    console.log(`  left out (${state}): ${title}`);
  }
} catch (error) {
  if (!(error instanceof ExportError)) throw error;
  console.error(error.message);
  process.exit(1);
}
