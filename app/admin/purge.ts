import { and, eq, isNotNull, lte } from "drizzle-orm";

import { deleteUserAccount } from "~/auth/server";
import { membership, practice } from "~/database/schema";
import { DAY_IN_MILLISECONDS, GRACE_PERIOD_DAYS } from "~/practice/deletion";
import type { AppServices } from "~/services/services";
import { endSupportViewsForPractice } from "./support-view";

/**
 * The Purge: the irreversible end of the Grace Period.
 *
 * Thirty days after the Owner pressed delete, this takes the Practice, its
 * Task Entries, its Custom Tasks, its Memberships, its outstanding Invites,
 * its Feedback (ADR-0007) and every User who was in it — the Owner included.
 * Deletion means what the word means, and the confirmation the Owner read is
 * only true because this runs.
 *
 * Seam 3, the worker seam: dependencies as arguments, `now` among them, and
 * no request anywhere near it. It is the most request-less of the three —
 * nobody is waiting, and by the time it runs the person it is acting for has
 * been locked out for a month.
 *
 * It **departs from the other two in one way**, and the departure is the
 * whole of it: `drainQueue` and the digest take a database and one client,
 * and this takes the entire `AppServices`, because it deletes Users and
 * deleting a User goes through the auth module (ADR-0004), which takes the
 * bundle. The cost is named below.
 *
 * It lives in `app/admin` for the reason `feedback-digest.ts` does: it reads
 * across every Practice, and a cross-Practice read in `app/practice` would
 * quietly end the invariant that holds there. The guard is not a route but
 * the caller — nothing reachable over HTTP calls this, and the day an admin
 * screen grows a *Purge now* button is the day this needs one.
 *
 * **It never calls Kit.** A Kit subscriber consented to a separate
 * relationship and leaves it through the unsubscribe link in the footer of
 * an email, never through deleting a Practice: a purged physician still gets
 * the newsletter, and that is correct rather than a leak. The queued Kit Sync
 * Jobs go with their User by the cascade `kit_sync_job.user_id` declares — a
 * purged User has no fact left to tell Kit — and that is a row disappearing
 * here, not a call going out there.
 *
 * That is the cost of taking the bundle: `drainQueue(database, kitClient)`
 * cannot call something it was not handed, and this can. Two things stand in
 * for the missing signature — a test asserting the fake was never touched,
 * and `scripts/purge.ts`, which hands this a `kitClient` that throws if
 * anything so much as reads it.
 */

/** What one run destroyed. Every number is rows that are gone. */
export interface CompletedPurge {
  practices: number;
  /** Across every Practice taken, Owners included. */
  users: number;
}

/**
 * Purge every Practice whose thirty days have run out.
 *
 * `now` is an argument rather than a call to the clock for the same reason
 * it is on the other two workers, and here it is load-bearing: the whole
 * ticket is two edges a day apart, and a test that could not say what day it
 * is could not assert either one.
 *
 * Practices are taken one at a time and each is finished before the next is
 * started. That is the most this can honestly claim about *no partial
 * Purge*: the two writes it makes cannot share a transaction (see
 * `purgeOne`), so a crash really can land between them and leave one
 * Practice half taken. What the loop buys is that it can only ever be *one*
 * — the alternative shape, one pass deleting every User and a second
 * deleting every Practice, would spread that state across all of them at
 * once — and that the next run finishes it. The rule #18 states is about
 * what a Purge leaves behind when it completes, and no completed Purge here
 * leaves a survivor.
 */
export async function purgeDeletedPractices(
  services: AppServices,
  now: Date = new Date(),
): Promise<CompletedPurge> {
  const due = services.database
    .select({ id: practice.id })
    .from(practice)
    .where(
      and(
        isNotNull(practice.deletedAt),
        // Day 30 is due and day 29 is not, which is the only arithmetic in
        // this file and the reason `GRACE_PERIOD_DAYS` is imported rather
        // than repeated: the number the confirmation promised and the
        // number counted to here must be one number.
        lte(
          practice.deletedAt,
          new Date(now.getTime() - GRACE_PERIOD_DAYS * DAY_IN_MILLISECONDS),
        ),
      ),
    )
    .all();

  let users = 0;
  for (const row of due) {
    users += await purgeOne(services, row.id, now);
  }

  return { practices: due.length, users };
}

/**
 * One Practice, taken whole.
 *
 * The Users go first and the Practice row second, and the order is the one
 * that fails safe. These two writes cannot share a transaction — the User
 * deletes go through Better Auth's own adapter (ADR-0004) and the Practice
 * goes through Drizzle — so the question is not whether a crash can land
 * between them but what it leaves when it does. Users first leaves a
 * Practice nobody can sign in to, still listed as overdue on the Practices
 * page, which the next run finishes: every Membership went with its User by
 * cascade, so the second run finds no one left to delete and takes the row.
 * Practice first would leave the opposite — a User with no Practice, who
 * could sign in and be handed a fresh empty one, which is the state the
 * product has no words for. Resumable, in the one direction that matters.
 *
 * Everything else is a cascade and deliberately so. `membership`, `invite`,
 * `custom_task`, `task_entry` and `feedback` all declare
 * `references(practice.id, { onDelete: "cascade" })`, so *Purge takes
 * everything* is a property of the schema rather than a list in this file
 * that a later table could be forgotten from. `impersonation_log` declares
 * no foreign keys at all, for the opposite reason: the record of an Admin
 * having been inside a Practice has to outlive its subject.
 */
async function purgeOne(
  services: AppServices,
  practiceId: number,
  now: Date,
): Promise<number> {
  const everyone = services.database
    .select({ userId: membership.userId })
    .from(membership)
    .where(eq(membership.practiceId, practiceId))
    .all();

  // Why the view ended, written while there is still something to write it
  // about — afterwards an ended session is indistinguishable from any other
  // ended session, and `purged` is one of the four sentences the rescue owes
  // the Admin. Almost always a no-op, because deleting the Practice ended
  // these thirty days ago with `practice_deleted`; the case this covers is a
  // view open on a Practice whose Grace Period ran out underneath it.
  //
  // By Practice and not by the people in it, which is the same set in every
  // case the product can produce and not the same set after a run that died
  // where the comment above says it can: a Practice with no Memberships left
  // to enumerate must not be a Practice whose open view is never named.
  endSupportViewsForPractice(services.database, practiceId, "purged", now);

  for (const person of everyone) {
    await deleteUserAccount(services, person.userId);
  }

  services.database.delete(practice).where(eq(practice.id, practiceId)).run();

  return everyone.length;
}
