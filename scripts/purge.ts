/**
 * The Purge, as a command a scheduler runs.
 *
 * A thin wrapper around `purgeDeletedPractices(services, now)` and nothing
 * else — the thirty days, the order of the writes and the rule that there is
 * no partial Purge all live in the worker, where a test can call them without
 * a shell.
 *
 *   npm run purge
 *   npm run purge -- --database /data/launch-tasks.sqlite
 *
 * Run it daily. A run with nothing due does one indexed query and exits, and
 * a run that is late is not a bug — the Grace Period is the promise, and a
 * Purge a day late keeps it while a Purge a day early breaks it.
 *
 * **The bundle it builds is the point.** `AppServices` carries a mail client
 * and a Kit client because the request seam needs them; the Purge needs
 * neither, and the two getters below throw if it ever reaches for one. A
 * Purge that sent an email would be a bereavement notice nobody asked for,
 * and a Purge that called Kit would unsubscribe a physician from a newsletter
 * they are still entitled to — so in production the only way to find out
 * would be a physician telling us. This finds out here.
 */
import { purgeDeletedPractices } from "../app/admin/purge";
import { createDatabase } from "../app/database/database";
import { databasePath } from "../app/database/database-path";
import type { EmailSender } from "../app/services/email-sender";
import type { KitClient } from "../app/services/kit-client";
import type { AppServices } from "../app/services/services";

const databaseFlag = process.argv.indexOf("--database");
const file =
  databaseFlag === -1 ? databasePath() : process.argv[databaseFlag + 1]!;

const services: AppServices = {
  database: createDatabase(file),

  get emailSender(): EmailSender {
    throw new Error("The Purge sends no email. Nothing should have read this.");
  },
  get kitClient(): KitClient {
    throw new Error("The Purge never calls Kit. Nothing should have read this.");
  },
};

const purged = await purgeDeletedPractices(services);

console.log(
  `Purged ${purged.practices} Practices from ${file}, ` +
    `and ${purged.users} Users with them.`,
);
