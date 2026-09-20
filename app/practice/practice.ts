import { eq } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import { membership, practice, type PracticeState } from "~/database/schema";

/**
 * Reading a Practice, always through the User who is signed in.
 *
 * Tenancy is a fact about these signatures rather than a rule someone has to
 * remember: nothing here takes a Practice id from a caller, so there is no
 * value a request could carry that would point one physician at another
 * physician's list. A Practice is what the signed-in User's Membership says it
 * is, and the only way to widen that is to change this file.
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
    .where(eq(membership.userId, userId))
    .get();

  return row ?? null;
}
