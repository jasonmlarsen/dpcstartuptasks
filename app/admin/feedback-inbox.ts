import { and, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import { feedback, globalTask, user } from "~/database/schema";
import { toTheSecond } from "~/lib/plain-date";

/**
 * The Admin's side of Feedback: a queue, a grouping, and one press.
 *
 * Everything here exists because a Feedback is a message and not a case.
 * There is no assignee, no priority, no thread and no kind — so the only
 * questions this file answers are *what has nobody finished with*, *which
 * Body is being complained about over and over*, and *what happened about
 * this one*.
 *
 * The state model is two values held in one nullable timestamp, exactly as
 * `published_at` and `retired_at` are: null is New, set is Done. There is no
 * Dismissed, because *I disagreed and changed nothing* is a finished
 * outcome, and the one-line note is where it says so. There is no delete and
 * no expiry either: only a Purge destroys a Feedback (ADR-0007), so nothing
 * in this file removes a row, and nothing in it ever will.
 *
 * Like `practices-dashboard.ts` and `task-library.ts`, this reads across
 * every Practice and lives in `app/admin` for that reason — the guard is
 * `requireAdmin` on the route, and putting a cross-Practice read in
 * `app/practice` would quietly end the invariant that holds there.
 */

/** Which half of the queue is being looked at. New is the default and the point. */
export type FeedbackShowing = "new" | "done" | "all";

/** Flat, or gathered by the Task the physician was reading. */
export type FeedbackGrouping = "none" | "task";

/** One Feedback as the Admin reads it. */
export interface FeedbackInInbox {
  id: number;
  text: string;
  /** A path to paste into a browser and arrive where the physician was. */
  pagePath: string;
  /** The title as it read when it was sent, which is not always how it reads now. */
  taskTitle: string | null;
  /** The Global Task it was about, when it was about one. */
  globalTaskId: number | null;
  /**
   * The address the Admin writes back to by hand, and null once that person's
   * account is gone. The row outlives them; only the reply address does not.
   */
  authorEmail: string | null;
  createdAt: Date;
  /** Null is New. Set is Done, and the page says which. */
  doneAt: Date | null;
  doneNote: string | null;
}

/** The Feedback about one Task — or, once, the Feedback about no Task at all. */
export interface FeedbackGroup {
  /** Null for the trailing group: a Custom Task, a settings page, a typo'd ref. */
  taskId: number | null;
  /**
   * The Task's title **as the Library reads it now**, not as it read when the
   * Feedback was sent. The heading is a way into the edit screen, so it has
   * to match what the Admin will find there — often the very rename the
   * feedback asked for.
   */
  heading: string;
  /** The rows in view, which is whichever half of the queue is being read. */
  feedback: FeedbackInInbox[];
  /**
   * Every Feedback about this Task, New and Done together, however the page
   * is filtered.
   *
   * Grouping exists to say *this Body has been complained about five times*,
   * and five stays five after the Admin has finished four of them. A group
   * headed by the filtered count would answer a question nobody asked, and
   * would shrink as the Body's case against it got stronger.
   */
  total: number;
}

/** How long the one line on Done may be. A line, not a case history. */
export const DONE_NOTE_CAP = 200;

/**
 * Newest first, always.
 *
 * `created_at` is whole seconds, so two Feedback sent in the same second are
 * tied on it; the id breaks the tie in the same direction, which is why the
 * queue never reorders itself between two reads of the same rows.
 */
const NEWEST_FIRST = [desc(feedback.createdAt), desc(feedback.id)];

function only(showing: FeedbackShowing): SQL | undefined {
  if (showing === "new") return isNull(feedback.doneAt);
  if (showing === "done") return isNotNull(feedback.doneAt);
  return undefined;
}

/** Read `?show=`, and treat anything else as the default: the queue. */
export function showingIn(value: string | null): FeedbackShowing {
  return value === "done" || value === "all" ? value : "new";
}

/** Read `?group=`, and treat anything else as the flat list. */
export function groupingIn(value: string | null): FeedbackGrouping {
  return value === "task" ? "task" : "none";
}

function rows(database: AppDatabase, where: SQL | undefined): FeedbackInInbox[] {
  return database
    .select({
      id: feedback.id,
      text: feedback.text,
      pagePath: feedback.pagePath,
      taskTitle: feedback.taskTitle,
      globalTaskId: feedback.globalTaskId,
      authorEmail: user.email,
      createdAt: feedback.createdAt,
      doneAt: feedback.doneAt,
      doneNote: feedback.doneNote,
    })
    .from(feedback)
    // Left, and never inner: a Feedback whose author has left the Practice
    // has a null `author_user_id`, and an inner join would drop exactly the
    // rows that only a Purge is allowed to take.
    .leftJoin(user, eq(feedback.authorUserId, user.id))
    .where(where)
    .orderBy(...NEWEST_FIRST)
    .all();
}

/** The flat queue: New by default, newest first. */
export function feedbackInbox(
  database: AppDatabase,
  showing: FeedbackShowing,
): FeedbackInInbox[] {
  return rows(database, only(showing));
}

/** How many are waiting, which is the number the section is named by. */
export function newFeedbackCount(database: AppDatabase): number {
  const counted = database
    .select({ count: sql<number>`count(*)` })
    .from(feedback)
    .where(isNull(feedback.doneAt))
    .get();

  return counted?.count ?? 0;
}

/**
 * The same rows, gathered by Task, heaviest group first.
 *
 * This is the query the section exists for: three pieces of feedback on one
 * Body tell the Admin that Body needs rewriting, and they only read as three
 * if they are counted in one place. Grouping is by the foreign key rather
 * than by the `task_title` snapshot, because the snapshot is deliberately
 * frozen at the moment of sending — two complaints either side of a rename
 * are still two complaints about one Body.
 *
 * Everything naming no Global Task falls into one trailing group. A Custom
 * Task, a settings page and a ref that named nothing are three different
 * stories, and none of them is a Body to rewrite.
 */
export function feedbackByTask(
  database: AppDatabase,
  showing: FeedbackShowing,
): FeedbackGroup[] {
  const titles = new Map(
    database
      .select({ id: globalTask.id, title: globalTask.title })
      .from(globalTask)
      .all()
      .map((task) => [task.id, task.title] as const),
  );

  // Counted over every row and not over the filtered ones, so a Body's
  // weight does not fall as the Admin works through the queue.
  const totals = new Map<number | null, number>();
  for (const row of rows(database, undefined)) {
    totals.set(row.globalTaskId, (totals.get(row.globalTaskId) ?? 0) + 1);
  }

  const groups = new Map<number, FeedbackGroup>();
  const aboutNoTask: FeedbackInInbox[] = [];

  for (const row of rows(database, only(showing))) {
    if (row.globalTaskId === null) {
      aboutNoTask.push(row);
      continue;
    }

    const group = groups.get(row.globalTaskId) ?? {
      taskId: row.globalTaskId,
      // A Global Task is never deleted — only Retired — so the title the
      // Library reads now is always there to be found. The snapshot behind
      // it covers nothing the product can do, only a row written by hand
      // against an id the Library never had.
      heading:
        titles.get(row.globalTaskId) ??
        row.taskTitle ??
        `Task #${row.globalTaskId}`,
      feedback: [],
      total: totals.get(row.globalTaskId) ?? 0,
    };
    groups.set(row.globalTaskId, group);
    group.feedback.push(row);
  }

  // The most-complained-about Body first, and the rows inside each group
  // stay newest first because they were read that way. A tie keeps the order
  // they arrived in, which is newest first — the flat list's order.
  const byTask = [...groups.values()].sort(
    (one, other) => other.total - one.total,
  );

  if (aboutNoTask.length > 0) {
    byTask.push({
      taskId: null,
      heading: "Not about a task in the library",
      feedback: aboutNoTask,
      total: totals.get(null) ?? 0,
    });
  }

  return byTask;
}

/**
 * The Feedback about one Task, for the screen where the fix is typed.
 *
 * New first and then Done, rather than New only: an Admin who has just
 * rewritten a Body wants to see that the last three complaints about it were
 * finished, and a Done row carries the note saying what was done. Both halves
 * are here because this is the other door onto the same rows, not a second
 * inbox with rules of its own.
 */
export function feedbackForTask(
  database: AppDatabase,
  taskId: number,
): FeedbackInInbox[] {
  const about = rows(database, eq(feedback.globalTaskId, taskId));

  return [
    ...about.filter((row) => row.doneAt === null),
    ...about.filter((row) => row.doneAt !== null),
  ];
}

/** What the Done press did. */
export type FinishedFeedback =
  | { outcome: "done" }
  /** No such row. A hand-typed id, or one from a Practice since purged. */
  | { outcome: "no-feedback" }
  /** Already Done. The first note stands; a second press does not overwrite it. */
  | { outcome: "already" }
  /** Longer than a line. The note is handed back rather than truncated. */
  | { outcome: "note-too-long" };

/**
 * The one intent every Done form posts, on either door.
 *
 * The same string on both screens rather than one each, because it is the
 * same act: the row carries it in a hidden field and the screen it lands on
 * is whichever one the Admin was reading.
 */
export const FINISH_FEEDBACK = "feedback-done";

/**
 * Finish one Feedback, with or without the line saying why.
 *
 * The note is optional on purpose and empty means empty: *I read it and
 * changed nothing* is a finished outcome, and forcing a sentence out of the
 * Admin every time would make the ones that do carry a sentence worth less.
 *
 * Whitespace is collapsed rather than kept, because this is one line in a
 * list and a pasted paragraph would break the row it sits in. Anything
 * longer than the cap is refused instead of cut: a note that ends mid-word
 * is a note whose ending nobody ever reads.
 *
 * There is no un-Done. Two states means two, and the durable record of a
 * content judgement is worth more than the ability to tidy a mis-press.
 */
export function markFeedbackDone(
  database: AppDatabase,
  feedbackId: number,
  note: string,
): FinishedFeedback {
  const oneLine = note.replace(/\s+/g, " ").trim();
  if (oneLine.length > DONE_NOTE_CAP) return { outcome: "note-too-long" };

  const existing = database
    .select({ doneAt: feedback.doneAt })
    .from(feedback)
    .where(eq(feedback.id, feedbackId))
    .get();

  if (!existing) return { outcome: "no-feedback" };
  if (existing.doneAt) return { outcome: "already" };

  database
    .update(feedback)
    .set({
      doneAt: toTheSecond(new Date()),
      // Null rather than an empty string: the column means *there is a line*,
      // and a blank one would have to be told apart from nothing everywhere
      // it is read.
      doneNote: oneLine === "" ? null : oneLine,
    })
    .where(and(eq(feedback.id, feedbackId), isNull(feedback.doneAt)))
    .run();

  return { outcome: "done" };
}

/**
 * The Done press, as both doors handle it.
 *
 * Shared rather than copied, because a second door that refused a note at a
 * different length — or said so in different words — would be the same act
 * behaving two ways. The routes keep what is theirs: the guard, and where
 * to send the Admin back to.
 *
 * Returns the sentence to show, or null when there is nothing to say. Every
 * outcome says something except the one that worked: an id that names
 * nothing and a second press on a finished row both look like success
 * otherwise, and the second one silently keeps the first note.
 */
export function pressDone(
  database: AppDatabase,
  submitted: FormData,
): string | null {
  const finished = markFeedbackDone(
    database,
    Number(submitted.get("feedbackId")),
    String(submitted.get("doneNote") ?? ""),
  );

  if (finished.outcome === "note-too-long") {
    return `A done note is one line, and ${DONE_NOTE_CAP} characters at most.`;
  }
  if (finished.outcome === "no-feedback") return "There is no such feedback.";
  if (finished.outcome === "already") {
    return "That feedback was already done, and the note on it stands.";
  }

  return null;
}
