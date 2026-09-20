import { asc, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import { globalTask, phase } from "~/database/schema";

/**
 * The Phase rail, as the Admin edits it: add, rename, reorder, delete.
 *
 * A Phase's number is derived from its position and is never part of its
 * name, which is the whole reason reordering the rail is a `position` edit
 * and not eleven renames. The cleaned CSV strips the `Phase N: ` prefix for
 * exactly this; nothing here stops an Admin typing one back in, because the
 * refusal would be a spell-checker on one person's own writing.
 *
 * Deleting is the only act with a guard on it, and the guard is not a
 * warning: a Phase holding Tasks cannot be deleted at all until they are
 * reassigned, and the reassignment happens in the same dialog as the delete.
 * Retired Tasks count — one still sits on the list of every Practice that
 * did the work, marked `No longer required`, and a row on a physician's
 * screen has to belong to a Phase.
 *
 * Reordering is up and down buttons for the reason the Helpful Links are:
 * eleven rows, one reader, and no drag-and-drop library worth the client JS.
 */

export type PhaseAdded =
  | { outcome: "added"; phaseId: number }
  | { outcome: "no-name" }
  | { outcome: "name-taken" };

export function addPhase(database: AppDatabase, name: string): PhaseAdded {
  const trimmed = name.trim();
  if (trimmed === "") return { outcome: "no-name" };

  const clash = database
    .select({ id: phase.id })
    .from(phase)
    .where(eq(phase.name, trimmed))
    .get();
  if (clash) return { outcome: "name-taken" };

  const last = database
    .select({ position: phase.position })
    .from(phase)
    .orderBy(sql`${phase.position} desc`)
    .get();

  const created = database
    .insert(phase)
    .values({ name: trimmed, position: (last?.position ?? 0) + 1 })
    .returning({ id: phase.id })
    .get();

  return { outcome: "added", phaseId: created.id };
}

export type PhaseRenamed =
  | { outcome: "renamed" }
  | { outcome: "no-name" }
  | { outcome: "name-taken" }
  | { outcome: "no-phase" };

/**
 * Rename a Phase, which every Practice reads on its next page load.
 *
 * The slug a physician's address carries is derived from the name, so a
 * rename does move the URL of a Phase — unlike a Task, whose slug is frozen.
 * That is the deliberate difference: a Task's address is carried by a
 * Feedback row and a bookmark into a drawer, and a Phase's is a tab on a rail
 * that is one press away from wherever the physician lands.
 */
export function renamePhase(
  database: AppDatabase,
  phaseId: number,
  name: string,
): PhaseRenamed {
  const trimmed = name.trim();
  if (trimmed === "") return { outcome: "no-name" };

  const target = database
    .select({ id: phase.id })
    .from(phase)
    .where(eq(phase.id, phaseId))
    .get();
  if (!target) return { outcome: "no-phase" };

  const clash = database
    .select({ id: phase.id })
    .from(phase)
    .where(eq(phase.name, trimmed))
    .get();
  if (clash && clash.id !== phaseId) return { outcome: "name-taken" };

  database
    .update(phase)
    .set({ name: trimmed })
    .where(eq(phase.id, phaseId))
    .run();

  return { outcome: "renamed" };
}

/**
 * Move a Phase one place up or down the rail.
 *
 * Nothing else has to change. A Dependency may point across Phases — twenty
 * of the sixty seeded edges do — and nothing reads an edge to decide what a
 * physician may do, so there is no invariant here for a reorder to break.
 */
export function movePhase(
  database: AppDatabase,
  move: { phaseId: number; direction: "up" | "down" },
): void {
  const phases = database
    .select({ id: phase.id, position: phase.position })
    .from(phase)
    .orderBy(asc(phase.position))
    .all();

  const index = phases.findIndex((row) => row.id === move.phaseId);
  if (index === -1) return;

  const swapWith = move.direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= phases.length) return;

  const here = phases[index]!;
  const there = phases[swapWith]!;

  database.transaction((tx) => {
    tx.update(phase)
      .set({ position: there.position })
      .where(eq(phase.id, here.id))
      .run();
    tx.update(phase)
      .set({ position: here.position })
      .where(eq(phase.id, there.id))
      .run();
  });
}

export type PhaseDeleted =
  | { outcome: "deleted" }
  /** It still holds Tasks and no Phase was named to take them. */
  | { outcome: "reassign-first"; tasks: number }
  | { outcome: "no-phase" }
  | { outcome: "no-destination" }
  /** The last Phase, which would leave the Library with nowhere to put a Task. */
  | { outcome: "last-phase" };

/**
 * Delete a Phase, reassigning its Tasks in the same act.
 *
 * Blocked rather than cascading, and blocked rather than warned about: a
 * cascade here would delete Tasks that Practices hold Entries against, which
 * is the one thing the Library may never do — a Global Task is only ever
 * Retired. So the Tasks move first, in the same transaction, and the Phase
 * goes only once it is empty.
 *
 * The reassigned Tasks land at the end of the destination Phase, in the
 * order they were in. Their Status, Notes and dates are untouched: nothing
 * about a Practice's work lives in a Phase.
 */
export function deletePhase(
  database: AppDatabase,
  deletion: { phaseId: number; reassignTo: number | null },
): PhaseDeleted {
  const phases = database
    .select({ id: phase.id })
    .from(phase)
    .orderBy(asc(phase.position))
    .all();

  const target = phases.find((row) => row.id === deletion.phaseId);
  if (!target) return { outcome: "no-phase" };
  if (phases.length === 1) return { outcome: "last-phase" };

  const tasks = database
    .select({ id: globalTask.id, position: globalTask.position })
    .from(globalTask)
    .where(eq(globalTask.phaseId, deletion.phaseId))
    .orderBy(asc(globalTask.position))
    .all();

  if (tasks.length > 0) {
    if (deletion.reassignTo === null) {
      return { outcome: "reassign-first", tasks: tasks.length };
    }
    if (
      deletion.reassignTo === deletion.phaseId ||
      !phases.some((row) => row.id === deletion.reassignTo)
    ) {
      return { outcome: "no-destination" };
    }
  }

  database.transaction((tx) => {
    if (tasks.length > 0 && deletion.reassignTo !== null) {
      const last = tx
        .select({ position: globalTask.position })
        .from(globalTask)
        .where(eq(globalTask.phaseId, deletion.reassignTo))
        .orderBy(sql`${globalTask.position} desc`)
        .get();

      let position = last?.position ?? 0;
      for (const task of tasks) {
        position += 1;
        tx.update(globalTask)
          .set({ phaseId: deletion.reassignTo, position })
          .where(eq(globalTask.id, task.id))
          .run();
      }
    }

    tx.delete(phase).where(eq(phase.id, deletion.phaseId)).run();

    // The rail's numbers are derived from position, so closing the gap is
    // what keeps *Phase 4* meaning the fourth one.
    tx.select({ id: phase.id })
      .from(phase)
      .orderBy(asc(phase.position))
      .all()
      .forEach((row, index) => {
        tx.update(phase)
          .set({ position: index + 1 })
          .where(eq(phase.id, row.id))
          .run();
      });
  });

  return { outcome: "deleted" };
}
