import { and, desc, eq, isNull } from "drizzle-orm";

import {
  currentlyActingAs,
  restoreAdmin,
  startActingAs,
  stopActingAs,
  type SignedInUser,
} from "~/auth/server";
import type { AppDatabase, AppWriter } from "~/database/database";
import {
  impersonationLog,
  membership,
  practice,
  type SupportViewEndReason,
} from "~/database/schema";
import type { AppServices } from "~/services/services";

/**
 * Support View: the Admin inside a Practice, as its Owner, able to act.
 *
 * Writable on purpose. The common bug is *marking done doesn't work*, and a
 * read-only view cannot reproduce it (ADR-0001). What stands in for read-only
 * is everything else in this file: a banner that cannot be dismissed, an hour
 * that does not extend, a row in `impersonation_log` for every view, and the
 * rule that the view dies the instant the Owner's own access does.
 *
 * It aims at an Owner and never at a Member. Three people share one list, so
 * a Member's view carries nothing the Owner's does not, and one target
 * removes a whole class of collision (#21).
 */

/** What pressing *View as Owner* can come to. */
export type EnterSupportViewOutcome =
  | { outcome: "entered"; headers: Headers }
  /** A Practice in its Grace Period cannot be entered at all (ADR-0001). */
  | { outcome: "not-live" }
  /**
   * No Owner to be. Unreachable through the product; refused rather than
   * guessed at.
   */
  | { outcome: "no-owner" }
  /** The library refused. Nothing here can improve on *it did not happen*. */
  | { outcome: "refused" };

/**
 * Enter a Practice as its Owner, and record that it happened.
 *
 * The liveness check is here and not only on the page that draws the button.
 * A Practice can be deleted between the list being rendered and the press
 * landing, and a deleted Practice is one nobody may view — the same rule that
 * throws the Admin out mid-view, applied at the door.
 */
export async function enterSupportView(
  services: AppServices,
  request: Request,
  admin: SignedInUser,
  practiceId: number,
): Promise<EnterSupportViewOutcome> {
  const target = ownerOfLivePractice(services.database, practiceId);
  if (target === "not-live") return { outcome: "not-live" };
  if (target === null) return { outcome: "no-owner" };

  const started = await startActingAs(services, request, target);
  if (!started) return { outcome: "refused" };

  services.database
    .insert(impersonationLog)
    .values({
      adminUserId: admin.id,
      targetUserId: target,
      practiceId,
      expiresAt: started.expiresAt,
    })
    .run();

  return { outcome: "entered", headers: started.headers };
}

/** A Support View in progress, as the banner needs it. */
export interface SupportViewInProgress {
  /**
   * Null when the Owner never named it, and null again in the case below
   * that cannot happen: the banner renders a fallback either way, because
   * an unnamed Practice must never become an unannounced view.
   */
  practiceName: string | null;
  targetUserId: string;
}

/**
 * The Support View this request is inside, or null.
 *
 * Read on every request, because the banner is owed on every page: there is
 * no screen the Admin can reach while acting as somebody where it is
 * acceptable not to say so.
 */
export async function supportViewInProgress(
  services: AppServices,
  request: Request,
): Promise<SupportViewInProgress | null> {
  const acting = await currentlyActingAs(services, request);
  if (!acting) return null;

  const open = services.database
    .select({ practiceName: practice.name })
    .from(impersonationLog)
    .leftJoin(practice, eq(practice.id, impersonationLog.practiceId))
    .where(
      and(
        eq(impersonationLog.targetUserId, acting.targetUserId),
        isNull(impersonationLog.endedAt),
      ),
    )
    .orderBy(desc(impersonationLog.startedAt))
    .get();

  // A borrowed session with no open row is not a thing the app can produce.
  // If it ever happens the banner still has to appear, so the Practice goes
  // unnamed rather than the view going unannounced.
  return {
    practiceName: open?.practiceName ?? null,
    targetUserId: acting.targetUserId,
  };
}

/**
 * The Admin pressing Stop: the one exit that is deliberate, and the only one
 * that says nothing on the way out.
 */
export async function stopSupportView(
  services: AppServices,
  request: Request,
  view: SupportViewInProgress,
): Promise<Headers | null> {
  const headers = await stopActingAs(services, request);
  if (!headers) return null;

  endSupportViewsFor(services.database, view.targetUserId, "stopped");

  return headers;
}

/**
 * Close every open Support View aimed at a User, naming what ended it.
 *
 * Takes an `AppWriter` so that the Owner deleting their Practice can close
 * the row in the same transaction as the column that deletes it — the reason
 * has to be written at the moment it happens, because a deleted session row
 * afterwards is indistinguishable from any other deleted session row.
 *
 * The Purge will call this with `purged` when it lands (#42).
 */
export function endSupportViewsFor(
  writer: AppWriter,
  targetUserId: string,
  reason: SupportViewEndReason,
  now: Date = new Date(),
): void {
  writer
    .update(impersonationLog)
    .set({ endedAt: now, endedReason: reason })
    .where(
      and(
        eq(impersonationLog.targetUserId, targetUserId),
        isNull(impersonationLog.endedAt),
      ),
    )
    .run();
}

/**
 * What the Admin is told when a Support View ended underneath them: one of
 * the four reasons, or `unknown`.
 *
 * The fifth value is not a fifth reason. #21 asks the rescue to fail vague
 * rather than wrong — a code path that ends a view and forgets to name why
 * must produce *something ended it* and never a guess at one of the four —
 * and naming that case is what keeps it from being spelled as a null
 * somebody later reads as *nothing happened*.
 */
export type SupportViewEnding = SupportViewEndReason | "unknown";

/**
 * Hand the Admin their own account back, and work out what to tell them.
 *
 * Every way a Support View can end other than the Admin's own press arrives
 * here, because all three look identical from the Admin's browser: a session
 * cookie that resolves to nothing, next to a stash that still does. The
 * attempted action — the *mark done* that was in flight when the Owner
 * pressed delete — is **abandoned and never replayed** (ADR-0001): this
 * restores the account, says what happened, and does nothing else.
 */
export async function rescueAdmin(
  services: AppServices,
  request: Request,
): Promise<{ headers: Headers; ending: SupportViewEnding } | null> {
  const restored = await restoreAdmin(services, request);
  if (!restored) return null;

  return {
    headers: restored.headers,
    ending: closeAdminsLastView(services.database, restored.admin.id),
  };
}

/**
 * Close whatever the Admin was last inside, and say why it ended.
 *
 * The rescue only runs when a Support View has just ended, so the Admin's
 * most recent row is that view — a deliberate Stop expires the stash, so it
 * cannot be the row reached from here.
 *
 * An open row means nothing got the chance to name a reason. `expires_at` is
 * what decides between the two readings: past it, the hour ran out; short of
 * it, something ended the session without saying so, and the Admin gets a
 * vague message rather than a wrong one — deliberately the safe direction to
 * fail (#21).
 */
function closeAdminsLastView(
  database: AppDatabase,
  adminUserId: string,
  now: Date = new Date(),
): SupportViewEnding {
  const last = database
    .select({
      id: impersonationLog.id,
      expiresAt: impersonationLog.expiresAt,
      endedAt: impersonationLog.endedAt,
      endedReason: impersonationLog.endedReason,
    })
    .from(impersonationLog)
    .where(eq(impersonationLog.adminUserId, adminUserId))
    .orderBy(desc(impersonationLog.startedAt), desc(impersonationLog.id))
    .get();

  // No row at all is a browser holding a stash from a database that no
  // longer has the view in it. Nothing to name.
  if (!last) return "unknown";

  if (last.endedAt !== null) return last.endedReason ?? "unknown";

  const timedOut = last.expiresAt.getTime() <= now.getTime();

  database
    .update(impersonationLog)
    .set({
      // The hour is the one unnamed ending whose moment is known exactly:
      // it ended when it expired, not when the Admin next clicked. For the
      // other, `now` is the honest answer — *by here*, and no closer.
      endedAt: timedOut ? last.expiresAt : now,
      // `unknown` is this app's word for *nobody said*, and the column's
      // vocabulary is the four reasons and nothing else (#21). Left null,
      // which is what the column already means.
      endedReason: timedOut ? "timed_out" : null,
    })
    .where(eq(impersonationLog.id, last.id))
    .run();

  return timedOut ? "timed_out" : "unknown";
}

/**
 * The Owner of a live Practice, or why there is nobody to be.
 *
 * One query, because *is this Practice still live* and *who owns it* are the
 * same question here: entering a Practice in its Grace Period is exactly what
 * ADR-0001 forbids, and a check that could pass one and fail the other would
 * be two rules where there is one.
 */
function ownerOfLivePractice(
  database: AppDatabase,
  practiceId: number,
): string | null | "not-live" {
  const row = database
    .select({ deletedAt: practice.deletedAt, ownerId: membership.userId })
    .from(practice)
    .leftJoin(
      membership,
      and(
        eq(membership.practiceId, practice.id),
        eq(membership.role, "owner"),
      ),
    )
    .where(eq(practice.id, practiceId))
    .get();

  if (!row || row.deletedAt !== null) return "not-live";

  return row.ownerId;
}
