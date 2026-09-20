import { and, count, eq, isNotNull, isNull, min } from "drizzle-orm";

import type { AppDatabase, AppWriter } from "~/database/database";
import {
  kitSyncJob,
  membership,
  user,
  type KitSyncKind,
} from "~/database/schema";

/**
 * The queue side of the Kit Sync Job: putting work in, and looking at what is
 * waiting. Taking work out is the worker's, next door.
 *
 * Everything the app does about Kit in a request is here, and all it ever does
 * is write a row. **No loader and no action calls Kit** — a physician
 * registering during a Kit outage must get their Practice, their list and
 * their Sign-in Link at the usual speed, and a newsletter that syncs four
 * minutes later costs nobody anything. That is the whole reason this table
 * exists, and it is why every caller below is a `void` that cannot fail in a
 * way a physician would see.
 */

/**
 * Enqueue one Kit Sync Job, unless one of the same kind is already waiting.
 *
 * Pressing Subscribe twice, or saving the Practice state five times in a
 * minute, leaves one job — the worker reads both facts live when it drains, so
 * a second queued row of the same kind would do the same work twice and tell
 * Kit the same thing twice. A job that has already settled is not in the way
 * of a new one: that is the Subscribe press that re-reads Kit after a
 * physician has been through the Resubscribe Form.
 */
export function enqueueKitSyncJob(
  database: AppWriter,
  userId: string,
  kind: KitSyncKind,
  now: Date = new Date(),
): void {
  const waiting = database
    .select({ id: kitSyncJob.id })
    .from(kitSyncJob)
    .where(
      and(
        eq(kitSyncJob.userId, userId),
        eq(kitSyncJob.kind, kind),
        isNull(kitSyncJob.outcome),
      ),
    )
    .get();

  if (waiting) return;

  database
    .insert(kitSyncJob)
    .values({ userId, kind, runAfter: now, createdAt: now })
    .run();
}

/**
 * Enqueue a job for everyone in a Practice who has Email Consent.
 *
 * The Practice State is a fact about a Practice and Kit holds it against a
 * person, so a Practice that moves state has as many facts to tell Kit as it
 * has consenting people in it. Anyone who never consented is not on Kit's list
 * at all and has nothing to update — enqueuing for them would only produce a
 * job the worker suppresses.
 */
export function enqueueKitSyncForPractice(
  database: AppWriter,
  practiceId: number,
  kind: KitSyncKind,
  now: Date = new Date(),
): void {
  const consenting = database
    .select({ userId: membership.userId })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(
      and(
        eq(membership.practiceId, practiceId),
        isNotNull(user.emailConsentGrantedAt),
      ),
    )
    .all();

  for (const person of consenting) {
    enqueueKitSyncJob(database, person.userId, kind, now);
  }
}

/** What the admin panel's System page says about the queue. */
export interface KitQueueHealth {
  /** Jobs that have not settled, including ones waiting out a deferral. */
  queued: number;
  /** The oldest unsettled job's age, which is the number that means *stuck*. */
  oldestQueuedAt: Date | null;
  synced: number;
  /** Cancelled addresses and people with no consent. Not failures. */
  suppressed: number;
  /** Dead letters: a warning on a `2xx`, or a job out of attempts. */
  failed: number;
}

export function kitQueueHealth(database: AppDatabase): KitQueueHealth {
  const settled = database
    .select({ outcome: kitSyncJob.outcome, howMany: count() })
    .from(kitSyncJob)
    .where(isNotNull(kitSyncJob.outcome))
    .groupBy(kitSyncJob.outcome)
    .all();

  const waiting = database
    .select({ howMany: count(), oldest: min(kitSyncJob.createdAt) })
    .from(kitSyncJob)
    .where(isNull(kitSyncJob.outcome))
    .get();

  const howMany = (outcome: string) =>
    settled.find((row) => row.outcome === outcome)?.howMany ?? 0;

  return {
    queued: waiting?.howMany ?? 0,
    // `min` over a timestamp column comes back as the stored integer, which is
    // seconds since the epoch — Drizzle's mode only decorates the column, not
    // an aggregate over it.
    oldestQueuedAt: waiting?.oldest ? new Date(Number(waiting.oldest) * 1000) : null,
    synced: howMany("synced"),
    suppressed: howMany("suppressed"),
    failed: howMany("failed"),
  };
}
