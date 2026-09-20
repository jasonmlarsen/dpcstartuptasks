import { and, eq, isNotNull } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import { customTask, globalTask, taskEntry } from "~/database/schema";
import type { CurrentPractice } from "./practice";
import { customTaskIdIn } from "./task-ref";

/**
 * A Practice's own writing on a Task: the Note, and the target date.
 *
 * The mirror of `task-status.ts`, and deliberately its twin — the same two
 * tables, the same rule about which Tasks a Practice may touch, and the same
 * refusal to take a Practice id from a caller. A Note belongs to the
 * Practice and not to whoever typed it, so nothing here records an author:
 * there is no column to write one into, which is what makes *a Member who
 * Leaves does not take their Notes with them* a fact about the schema rather
 * than a promise some later delete has to keep.
 *
 * One write for both fields, because the drawer offers one Save. A physician
 * writing down a phone number and the date the licence expires is doing one
 * thing, and two forms would mean two presses and two chances to lose half
 * of it.
 *
 * A Retired Task is allowed here, unlike a Status change. The reason the
 * Status control disappears from one is that un-retiring is the Admin's act
 * — and that reason says nothing about a Practice writing down what it
 * already did, on a Task it can still see.
 */

/** What the date field came back with. */
export type TargetDate =
  /** A date was picked. Midnight UTC, because a target date is a day. */
  | { kind: "set"; on: Date }
  /** The field was left empty, which is how a physician clears one. */
  | { kind: "cleared" }
  /** Not a date at all, which no date input produces and a hand-written post can. */
  | { kind: "unreadable" };

/** `yyyy-mm-dd`, which is what `<input type="date">` posts and nothing else. */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Read the date field, strictly.
 *
 * A day and not a moment: the physician picked a square on a calendar, and
 * storing it at midnight UTC means it reads back as the same square wherever
 * the page is rendered. Anything that is not `yyyy-mm-dd`, and anything that
 * is but names no real day — `2026-02-31` — is unreadable rather than
 * quietly rounded, because a silently moved deadline is worse than a refused
 * one.
 */
export function asTargetDate(value: unknown): TargetDate {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return { kind: "cleared" };

  const match = ISO_DAY.exec(text);
  if (!match) return { kind: "unreadable" };

  const [, year, month, day] = match;
  const on = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(on.getTime())) return { kind: "unreadable" };

  // `new Date("2026-02-31")` is not an error in JavaScript, it is March.
  // Reading the parts back is what catches that.
  const same =
    on.getUTCFullYear() === Number(year) &&
    on.getUTCMonth() + 1 === Number(month) &&
    on.getUTCDate() === Number(day);

  return same ? { kind: "set", on } : { kind: "unreadable" };
}

/**
 * Write one Task's Note and target date for this Practice.
 *
 * Returns false for the same set of refusals `setTaskStatus` returns false
 * for, minus the Retired one: another Practice's Custom Task, a Draft, or a
 * ref that is not a Task at all. The caller answers 404 to all of them
 * together, because they are the one answer — there is no such Task here.
 *
 * A Note of nothing but whitespace is stored as null. *No Note* is a state
 * the column already has, and a row holding a blank string would be a second
 * spelling of it for every later reader to remember.
 */
export function setTaskNote(
  database: AppDatabase,
  practice: CurrentPractice,
  written: { taskRef: string; note: string; targetDate: Date | null },
): boolean {
  const values = {
    note: written.note.trim() === "" ? null : written.note,
    targetDate: written.targetDate,
  };

  const customTaskId = customTaskIdIn(written.taskRef);

  if (customTaskId !== null) {
    return (
      database
        .update(customTask)
        .set(values)
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
        eq(globalTask.slug, written.taskRef),
        isNotNull(globalTask.publishedAt),
      ),
    )
    .get();
  if (!target) return false;

  return (
    database
      .update(taskEntry)
      .set(values)
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
