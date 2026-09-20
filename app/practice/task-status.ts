import { and, eq, isNotNull, isNull } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import {
  customTask,
  globalTask,
  taskEntry,
  TASK_STATUSES,
  type TaskStatus,
} from "~/database/schema";
import type { CurrentPractice } from "./practice";
import { customTaskIdIn } from "./task-ref";

/**
 * Setting a Status: the one act the whole list exists for.
 *
 * Like the rest of `app/practice`, nothing here takes a Practice id from a
 * caller — a `CurrentPractice` is what the signed-in User's Membership says
 * it is, so a hand-written post naming another Practice's Custom Task
 * matches no row rather than being caught by a check someone had to
 * remember to write.
 *
 * The write is the mirror of the read in `journey-map.ts`: the same two
 * tables, and the same rule about which Tasks a Practice may touch. A Task
 * the physician cannot see on their list is a Task they cannot set a Status
 * on, and both facts come out of the same `where` clauses.
 */

/** The four Statuses, as they arrive from a form. Anything else is not one. */
export function asTaskStatus(value: unknown): TaskStatus | null {
  return TASK_STATUSES.includes(value as TaskStatus)
    ? (value as TaskStatus)
    : null;
}

/**
 * Set one Task's Status for this Practice.
 *
 * Returns false when `taskRef` names nothing this Practice may set: another
 * Practice's Custom Task, a Draft, a Retired Task, or a ref that is simply
 * not a Task. The caller answers 404 to all four together, because they are
 * the same answer — there is no such Task here — and distinguishing them
 * would be telling a stranger what exists.
 *
 * A Retired Task is refused rather than merely hidden behind a missing
 * control: un-retiring is the Admin's act, and `No longer required` counts
 * neither way towards progress, so letting a post move one would be letting
 * a Practice edit a row nothing in the product will ever show them again.
 */
export function setTaskStatus(
  database: AppDatabase,
  practice: CurrentPractice,
  change: { taskRef: string; status: TaskStatus },
): boolean {
  const customTaskId = customTaskIdIn(change.taskRef);

  if (customTaskId !== null) {
    return (
      database
        .update(customTask)
        .set({ status: change.status })
        .where(
          and(
            eq(customTask.id, customTaskId),
            eq(customTask.practiceId, practice.id),
          ),
        )
        .returning({ id: customTask.id })
        .all().length > 0
    );
  }

  const target = database
    .select({ id: globalTask.id })
    .from(globalTask)
    .where(
      and(
        eq(globalTask.slug, change.taskRef),
        isNotNull(globalTask.publishedAt),
        isNull(globalTask.retiredAt),
      ),
    )
    .get();
  if (!target) return false;

  return (
    database
      .update(taskEntry)
      .set({ status: change.status })
      .where(
        and(
          eq(taskEntry.practiceId, practice.id),
          eq(taskEntry.globalTaskId, target.id),
        ),
      )
      .returning({ id: taskEntry.id })
      .all().length > 0
  );
}
