import { and, eq, isNull } from "drizzle-orm";

import { endSupportViewsFor } from "~/admin/support-view";
import { revokeAllSessions } from "~/auth/server";
import type { AppWriter } from "~/database/database";
import { membership, practice } from "~/database/schema";
import type { AppServices } from "~/services/services";
import type { CurrentPractice } from "./practice";

/**
 * Deleting a Practice, and the thirty days that follow.
 *
 * The Owner's act is one column and a revocation: `deleted_at` is set,
 * every session of every person in it is ended, and **nothing is
 * destroyed**. That last part is the whole design. The confirmation the
 * Owner read says the practice is permanently deleted after thirty days,
 * and that sentence is only true because a Purge (#42) is what does the
 * deleting — telling someone their data is gone while holding it for a
 * month is the one false promise available here, so the app holds the data
 * and says the number.
 *
 * Restoring inside the window is the operator clearing the column by hand,
 * documented in the restore runbook. That is a named v1 gap rather than an
 * oversight, and deliberately not a screen: a self-serve undo would be a
 * second control on the most dangerous act in the product, and the Admin
 * hears about a mistaken press through the Feedback Digest inside the same
 * window.
 */

/**
 * The Grace Period, in days. The number in the confirmation's sentence and
 * the number the Purge counts to are the same number, and it lives here.
 */
export const GRACE_PERIOD_DAYS = 30;

export type DeletionOutcome =
  | "deleted"
  /** Only the Owner can invite, remove or delete. */
  | "not-owner";

/**
 * The Owner ending their Practice.
 *
 * Sessions first, then the column. ADR-0004 asks for the revocation and the
 * write in one transaction and for the revocation first if they cannot be
 * atomic, and here they cannot: the session deletes go through Better
 * Auth's own adapter and the column goes through Drizzle, so no transaction
 * spans them. Revoking first is the order that fails safe — a crash between
 * the two leaves everyone signed out of a Practice that still exists, which
 * the Owner can see and the operator can fix, rather than a deleted
 * Practice someone is still reading.
 *
 * Every Membership, the Owner's own included: there is nothing left to read
 * here for anybody, and an Owner who deleted their Practice and stayed
 * signed in would be looking at a list the product has stopped serving.
 *
 * An Admin inside this Practice in Support View goes with them, and that is
 * the rule rather than a side effect (ADR-0001): the view *is* a session
 * belonging to the Owner, so revoking the Owner's sessions ends it, and
 * there is deliberately **no carve-out exempting impersonation rows** — one
 * would leave the operator holding writable access to a Practice that had
 * just been deleted. Why it ended is written here, in the same transaction
 * as the column, because afterwards a deleted session row is
 * indistinguishable from any other deleted session row.
 */
export async function deletePractice(
  services: AppServices,
  current: CurrentPractice,
  now: Date = new Date(),
): Promise<DeletionOutcome> {
  if (current.role !== "owner") return "not-owner";

  const everyone = services.database
    .select({ userId: membership.userId })
    .from(membership)
    .where(eq(membership.practiceId, current.id))
    .all();

  for (const person of everyone) {
    await revokeAllSessions(services, person.userId);
  }

  services.database.transaction((transaction) => {
    for (const person of everyone) {
      endSupportViewsFor(transaction, person.userId, "practice_deleted", now);
    }

    transaction
      .update(practice)
      .set({ deletedAt: now })
      .where(eq(practice.id, current.id))
      .run();
  });

  return "deleted";
}

/**
 * Whether a Practice is still one anybody may be let into.
 *
 * Asked by the invite link and by invite acceptance, which are the only two
 * paths into a Practice that do not start from a Membership — and so the
 * only two that `practiceFor`'s filter cannot cover.
 */
export function practiceIsLive(
  database: AppWriter,
  practiceId: number,
): boolean {
  const row = database
    .select({ id: practice.id })
    .from(practice)
    .where(and(eq(practice.id, practiceId), isNull(practice.deletedAt)))
    .get();

  return row !== undefined;
}
