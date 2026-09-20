import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import { customTask, phase } from "~/database/schema";
import { slugify } from "~/lib/slug";
import type { CurrentPractice } from "./practice";
import { customRef, customTaskIdIn } from "./task-ref";

/**
 * The four things specific to this building, written by the physician.
 *
 * A Custom Task is the only content a Practice authors, and it is
 * deliberately lighter than a Global Task: a title, a body and a Phase, and
 * that is the whole of it. Helpful Links, Dependencies and the state flag are
 * editorial acts, and there is nowhere on the row to put them (ADR-0003) — so
 * *lighter* is a fact about the schema here rather than a form that happens
 * to ask for less.
 *
 * Like the rest of `app/practice`, nothing here takes a Practice id from a
 * caller: a `CurrentPractice` is what the signed-in User's Membership says it
 * is, so a hand-written post naming another Practice's Task matches no row
 * rather than being caught by a check someone had to remember to write.
 */

/** What came back from the add form, once it has been read. */
export type AddedCustomTask =
  /** It exists. The ref is what `?task=` and `?moved=` carry. */
  | { outcome: "added"; ref: string }
  /** No title, which is the one field a Task cannot do without. */
  | { outcome: "no-title" }
  /** The Phase named by the address is not one. The caller answers 404. */
  | { outcome: "no-phase" };

/**
 * Write a Custom Task into the Phase the physician is looking at.
 *
 * The Phase comes from the address rather than from a field, because the
 * form lives at the bottom of one Phase's list and a physician adding a Task
 * there means *here*. A blank body is fine and stored as one: a title can be
 * the whole Task — *Call the landlord back* says everything it needs to —
 * and demanding prose would make adding one the editorial exercise it is
 * meant not to be. A blank title is not, because a card with no title is
 * nothing a physician could find again.
 */
export function addCustomTask(
  database: AppDatabase,
  practice: CurrentPractice,
  written: { phaseSlug: string; title: string; body: string },
): AddedCustomTask {
  const title = written.title.trim();
  if (title === "") return { outcome: "no-title" };

  const target = database
    .select({ id: phase.id, name: phase.name })
    .from(phase)
    .all()
    .find((row) => slugify(row.name) === written.phaseSlug);
  if (!target) return { outcome: "no-phase" };

  const added = database
    .insert(customTask)
    .values({
      practiceId: practice.id,
      phaseId: target.id,
      title,
      body: written.body.trim(),
    })
    .returning({ id: customTask.id })
    .get();

  return { outcome: "added", ref: customRef(added.id) };
}

/**
 * Destroy one of a Practice's own Tasks.
 *
 * This is the one thing a Practice can delete outright: everything else it
 * can end is deleted-then-purged, and a Global Task is Retired by the Admin
 * and never deleted at all. It can be immediate here because nothing else
 * in the system points at the row — a Custom Task has no Task Entries
 * behind it, no other Practice can see it, and the Task Library does not
 * know it exists. A Global Task is the opposite of all three, which is why
 * Retiring exists and why this is not it.
 *
 * Any Member may do it, not only the Owner: a Member can do anything on the
 * list itself, and a Task the Practice wrote is part of the list.
 *
 * Returns false for every ref this Practice may not delete — another
 * Practice's Custom Task, a Global Task's slug, a typo. The caller answers
 * 404 to all of them together, because they are the one answer: there is no
 * such Task of yours here.
 */
export function deleteCustomTask(
  database: AppDatabase,
  practice: CurrentPractice,
  taskRef: string,
): boolean {
  const customTaskId = customTaskIdIn(taskRef);
  if (customTaskId === null) return false;

  return (
    database
      .delete(customTask)
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
