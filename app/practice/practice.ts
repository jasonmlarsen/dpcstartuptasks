import { and, eq, isNull } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import { membership, practice, type PracticeState } from "~/database/schema";

/**
 * Reading a Practice and naming one, always through the User who is signed
 * in.
 *
 * Tenancy is a fact about these signatures rather than a rule someone has to
 * remember: nothing here takes a Practice id from a caller, so there is no
 * value a request could carry that would point one physician at another
 * physician's list. A Practice is what the signed-in User's Membership says it
 * is, and the only way to widen that is to change this file.
 *
 * A Practice in its Grace Period is not one of the answers `practiceFor` can
 * give. That single `IS NULL` is how a deleted Practice becomes unreachable
 * to everyone in it for the whole thirty days: every screen behind the door
 * begins here, so there is no page to remember to guard and no second place
 * the rule could be written slightly differently.
 */

export interface CurrentPractice {
  id: number;
  /** Null until the Owner names it. Callers render a fallback, never a blank. */
  name: string | null;
  role: "owner" | "member";
  /**
   * What the Practice told the Tailoring Wizard about where it practises,
   * and null if it never said. The one part of the Practice Profile with a
   * reader: it turns the journey map's `Varies by state` pill from a warning
   * into a pointer. It is not per-state content and never becomes it —
   * stale state law is worse than none.
   */
  state: PracticeState | null;
}

/** The one Practice this User belongs to, or nobody's. */
export function practiceFor(
  database: AppDatabase,
  userId: string,
): CurrentPractice | null {
  const row = database
    .select({
      id: practice.id,
      name: practice.name,
      role: membership.role,
      state: practice.state,
    })
    .from(membership)
    .innerJoin(practice, eq(membership.practiceId, practice.id))
    .where(and(eq(membership.userId, userId), isNull(practice.deletedAt)))
    .get();

  return row ?? null;
}

/**
 * The two details a Practice has that anyone in it may change.
 *
 * Not the Owner's alone: invite, remove and delete are the three acts
 * `role` exists for, and naming the clinic is not one of them — a Member
 * doing the paperwork can fix a typo in it. The two Practice Profile
 * booleans are absent on purpose, here and on the screen: nothing re-reads
 * them, so an editor for them would promise a re-tailoring that does not
 * exist (ADR-0002).
 *
 * State has a second reader that is not built yet: Kit's `practice_state`
 * custom field. Changing it here will have to enqueue a Kit Sync Job when
 * #41 lands — until then this write is the whole of it, and the `Varies by
 * state` pointer on the list is its only consumer. Changing it never
 * re-runs the Tailoring Wizard, which is once per Practice and gone.
 */
export function describePractice(
  database: AppDatabase,
  current: CurrentPractice,
  details: { name: string; state: PracticeState | null },
): void {
  const named = details.name.trim();

  database
    .update(practice)
    // A blank box is a Practice that has no name rather than one named the
    // empty string, which is the state registration leaves it in anyway.
    .set({ name: named === "" ? null : named, state: details.state })
    .where(eq(practice.id, current.id))
    .run();
}

/**
 * Whether this User's Practice is one that has been deleted and is sitting
 * out its Grace Period.
 *
 * A read that looks past `deleted_at`, and it answers a question rather
 * than opening a door — a yes chooses a paragraph on the landing page and
 * nothing else. Somebody who signs in during the thirty days is told their
 * practice was deleted; without this they land on a page inviting them to
 * sign in, already signed in, which reads as the product having lost them.
 */
export function hasDeletedPractice(
  database: AppDatabase,
  userId: string,
): boolean {
  const row = database
    .select({ deletedAt: practice.deletedAt })
    .from(membership)
    .innerJoin(practice, eq(membership.practiceId, practice.id))
    .where(eq(membership.userId, userId))
    .get();

  return row?.deletedAt != null;
}
