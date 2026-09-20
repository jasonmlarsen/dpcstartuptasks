/**
 * The Kit Sync Job worker, as a command a scheduler runs.
 *
 * A thin wrapper around `drainQueue(database, kitClient, now)` and nothing
 * else — the rules all live in the worker, where a test can call them without
 * a shell. Run it as often as is comfortable; a drain with nothing due does
 * one indexed query and exits.
 *
 *   npm run kit:drain
 *   npm run kit:drain -- --database /data/launch-tasks.sqlite
 *
 * `KIT_API_KEY` must be set (ADR-0008). Without it this exits non-zero having
 * done nothing, which is the correct shape: the queue holds, the jobs keep,
 * and the product behind the door never noticed.
 */
import { drainQueue } from "../app/consent/kit-sync-worker";
import { createDatabase } from "../app/database/database";
import { databasePath } from "../app/database/database-path";
import { createKitClient } from "../app/services/kit-http-client";

const databaseFlag = process.argv.indexOf("--database");
const file =
  databaseFlag === -1 ? databasePath() : process.argv[databaseFlag + 1]!;

let kitClient;
try {
  kitClient = createKitClient();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const drained = await drainQueue(createDatabase(file), kitClient);

console.log(
  `Drained ${drained.picked} Kit Sync Jobs from ${file}: ` +
    `${drained.synced} synced, ${drained.suppressed} suppressed, ` +
    `${drained.deferred} deferred, ${drained.failed} failed.`,
);
