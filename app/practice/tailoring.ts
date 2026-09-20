import { and, eq, inArray, ne } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import {
  globalTask,
  practice,
  PRACTICE_STATES,
  taskEntry,
  type PracticeState,
} from "~/database/schema";
import type { CurrentPractice } from "./practice";

/**
 * The Tailoring Wizard: one screen, three questions, once per Practice.
 *
 * It only ever sets a Status to Not Applicable (ADR-0002). It does not hide,
 * filter or delete, it records nothing about having run, and nothing here
 * ever reads back which Tasks it touched — there is no column that could
 * answer that, now or later. Everything else in this file follows from that
 * one constraint: with no provenance there is no undo to write, because the
 * undo is the Status control already sitting on every one of these Tasks,
 * still on the list, still readable, one press from coming back.
 *
 * Like the rest of `app/practice`, nothing here takes a Practice id from a
 * caller. The Wizard is the one screen in the product that writes a Status to
 * fourteen rows at once, so the question *whose list is this?* is answered by
 * the signed-in User's Membership and by nothing a request could carry.
 */

/**
 * The eight Tasks a practice seeing patients on the road will never do.
 *
 * Counted against the real Task Library rather than guessed, which is what
 * earned the question its place on the screen: a question that sets two
 * Tasks aside is not worth the friction of asking. The three Phase 8 Tasks
 * deliberately *not* here — Medical Equipment Purchase, Medical Supplies &
 * Inventory, Point-of-Care Testing Setup — are bought by a mobile practice
 * too.
 */
const FIXED_OFFICE_TASKS = [
  "location-selection-research",
  "office-location-lease",
  "office-design-layout",
  "office-buildout",
  "office-furniture",
  "office-supplies",
  "signage-installation",
  "utilities-services-setup",
] as const;

/** The six Tasks a practice hiring nobody in its first six months will never do. */
const EMPLOYMENT_TASKS = [
  "payroll-system-setup",
  "staff-hiring-plan",
  "employee-handbook",
  "hr-compliance-setup",
  "staff-training",
  "benefits-administration",
] as const;

/**
 * The Practice Profile: what the Practice told the Wizard.
 *
 * Any of the three may be left unanswered, and null is what that looks like.
 * It is kept after the Wizard's work is done, for wording and for segmenting
 * email — never re-applied to Tasks published later (ADR-0002).
 */
export interface PracticeProfile {
  state: PracticeState | null;
  fixedLocation: boolean | null;
  expectsEmployees: boolean | null;
}

/**
 * Is the Wizard still owed to whoever is reading?
 *
 * Three ways to be answered no, and the second and third are the same guard
 * seen from two sides. **A Member never sees it**: the flag lives on the
 * Practice, so a Member accepting an Invite in month three would otherwise
 * be handed a screen that sets fourteen Tasks aside across work the Owner
 * has been doing since. And a Practice that has already moved a Status has
 * started, whatever the flag says — a list with work on it is not an
 * untouched one, and an untouched list is the only thing the Wizard is safe
 * to run against.
 */
export function tailoringOwed(
  database: AppDatabase,
  current: CurrentPractice,
): boolean {
  if (current.role !== "owner") return false;

  const row = database
    .select({ settledAt: practice.tailoringSettledAt })
    .from(practice)
    .where(eq(practice.id, current.id))
    .get();
  if (!row || row.settledAt !== null) return false;

  return !hasStarted(database, current);
}

/**
 * Belt and braces alongside the flag, and asked for by name in the decision
 * behind ADR-0002: a Practice with any Task Entry off `not_started` has
 * started, whatever the flag says. No path in the product reaches this today,
 * because the gate in front of the list is what a physician meets first — it
 * is here for the ones that arrive later, a restored Practice among them.
 */
function hasStarted(database: AppDatabase, current: CurrentPractice): boolean {
  const started = database
    .select({ id: taskEntry.id })
    .from(taskEntry)
    .where(
      and(
        eq(taskEntry.practiceId, current.id),
        ne(taskEntry.status, "not_started"),
      ),
    )
    .limit(1)
    .get();

  return started !== undefined;
}

/**
 * Answer the Wizard: keep the Practice Profile, set the Tasks aside, and
 * stop being owed.
 *
 * One transaction, because the flag and the Statuses are one act — a Practice
 * that had fourteen Tasks set aside and is still owed the Wizard would be
 * offered a screen that could set them aside again, which is the one shape
 * this design has no record to recover from.
 *
 * Only a *no* sets anything aside. An unanswered question sets nothing, which
 * is what makes every question on the screen genuinely optional rather than
 * optional-looking: leaving one blank costs the physician the tailoring that
 * question would have done and nothing else.
 */
export function answerTailoring(
  database: AppDatabase,
  current: CurrentPractice,
  answers: PracticeProfile,
): void {
  database.transaction((tx) => {
    tx.update(practice)
      .set({
        state: answers.state,
        fixedLocation: answers.fixedLocation,
        expectsEmployees: answers.expectsEmployees,
        tailoringSettledAt: new Date(),
      })
      .where(eq(practice.id, current.id))
      .run();

    const slugs = [
      ...(answers.fixedLocation === false ? FIXED_OFFICE_TASKS : []),
      ...(answers.expectsEmployees === false ? EMPLOYMENT_TASKS : []),
    ];
    if (slugs.length === 0) return;

    const targets = tx
      .select({ id: globalTask.id })
      .from(globalTask)
      .where(inArray(globalTask.slug, slugs))
      .all();
    if (targets.length === 0) return;

    tx.update(taskEntry)
      .set({ status: "not_applicable" })
      .where(
        and(
          eq(taskEntry.practiceId, current.id),
          inArray(
            taskEntry.globalTaskId,
            targets.map((target) => target.id),
          ),
        ),
      )
      .run();
  });
}

/**
 * Skip the Wizard, which is an answer and is final.
 *
 * Nothing is set aside and no Profile is kept — a skipper said nothing, and
 * a blank Profile is the honest record of that. There is no re-entry point
 * and no collapsed banner: the two questions are trivially replaceable by
 * marking two Phases Not Applicable by hand, on the list they are now
 * looking at.
 */
export function skipTailoring(
  database: AppDatabase,
  current: CurrentPractice,
): void {
  database
    .update(practice)
    .set({ tailoringSettledAt: new Date() })
    .where(eq(practice.id, current.id))
    .run();
}

/** A yes/no answer as a radio group posts it. Anything else is unanswered. */
export function asYesNo(value: unknown): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}


/** A state as the select posts it, and null for the blank first option. */
export function asPracticeState(value: unknown): PracticeState | null {
  return PRACTICE_STATES.includes(value as PracticeState)
    ? (value as PracticeState)
    : null;
}
