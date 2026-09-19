import { eq } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import {
  customTask,
  globalTask,
  membership,
  practice,
  taskEntry,
} from "~/database/schema";

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
    })
    .from(membership)
    .innerJoin(practice, eq(membership.practiceId, practice.id))
    .where(eq(membership.userId, userId))
    .get();

  return row ?? null;
}

/** How big a Practice's list is: Tasks, and the Phases they fall into. */
export interface TaskListSize {
  tasks: number;
  phases: number;
}

/**
 * The size of a Practice's list, with both content tables merged at read time.
 *
 * Two tables and one merge is the whole of ADR-0003's cost, and this is the
 * first place it is paid. A Custom Task is a Task on the list, so a count that
 * read only `task_entry` would be a count of the Task Library rather than of
 * what the physician is looking at.
 *
 * Takes a `CurrentPractice` rather than an id, so the only Practice that can
 * be counted is one `practiceFor` already handed back for the signed-in User.
 * A number would have been a number, and a caller could have got it anywhere.
 */
export function taskListSize(
  database: AppDatabase,
  practice: CurrentPractice,
): TaskListSize {
  const entries = database
    .select({ phaseId: globalTask.phaseId })
    .from(taskEntry)
    .innerJoin(globalTask, eq(taskEntry.globalTaskId, globalTask.id))
    .where(eq(taskEntry.practiceId, practice.id))
    .all();

  const customTasks = database
    .select({ phaseId: customTask.phaseId })
    .from(customTask)
    .where(eq(customTask.practiceId, practice.id))
    .all();

  const phases = new Set(
    [...entries, ...customTasks].map((row) => row.phaseId),
  );

  return {
    tasks: entries.length + customTasks.length,
    phases: phases.size,
  };
}
