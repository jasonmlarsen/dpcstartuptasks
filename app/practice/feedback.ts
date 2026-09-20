import { and, eq, gte, isNotNull } from "drizzle-orm";

import type { SignedInUser } from "~/auth/server";
import type { AppDatabase } from "~/database/database";
import {
  customTask,
  feedback,
  FEEDBACK_CHARACTER_CAP,
  FEEDBACK_PER_HOUR,
  globalTask,
} from "~/database/schema";
import type { CurrentPractice } from "./practice";
import { customTaskIdIn } from "./task-ref";

/**
 * Feedback: one thing a physician told the Admin was wrong.
 *
 * A message and not a case. There is no category to pick, no thread to
 * follow and no reply path — the Admin has the address and writes back by
 * hand if it is worth it — so the whole of this file is: read what the
 * physician could see, take the words, refuse the two abuses, write the row.
 *
 * The page and the Task travel with it so that nobody has to describe where
 * they were. Both are read back against what this Practice may actually see
 * rather than trusted: a hand-written post naming another Practice's Custom
 * Task names no Task at all here, and an off-site `from` is not recorded as
 * a page of ours.
 */

/** Why the words were not taken. Each one is a sentence the box says back. */
export type RefusedFeedback =
  /** Nothing but whitespace. There is nothing to send and nothing to store. */
  | { outcome: "empty" }
  /** Longer than the ceiling. The words are handed back, never truncated. */
  | { outcome: "too-long" }
  /** The hourly ceiling. Counted per User, in our own action. */
  | { outcome: "too-many" };

/** What the Send press did. */
export type SentFeedback =
  /** Stored, and New. Done is the Admin's act, in the admin panel. */
  | { outcome: "sent" }
  | RefusedFeedback;

/** The Task a physician was looking at, as the row will record it. */
export interface TaskInView {
  /** Set only for a Global Task: a Custom Task is nothing the Library knows. */
  globalTaskId: number | null;
  /** The title as it reads now, which is what gets snapshotted. */
  taskTitle: string | null;
}

/** Nothing was open, or what was named is nothing this Practice can see. */
const NO_TASK: TaskInView = { globalTaskId: null, taskTitle: null };

/**
 * Read `?task=` the way the drawer does, and take a copy of the title.
 *
 * A snapshot rather than a join, and the reason is that the two kinds of
 * Task fail a join in two different ways: a Custom Task is hard-deleted and
 * leaves nothing to point at, and a Global Task's title is the Admin's to
 * edit — often as the very fix this Feedback asked for. Either way the row
 * has to keep saying what the physician was reading when they typed.
 *
 * A Draft is not readable by anyone, so a ref naming one names nothing —
 * the same answer a typo gets, because it is the same answer: there is no
 * such Task here.
 */
export function taskInView(
  database: AppDatabase,
  practice: CurrentPractice,
  taskRef: string | null,
): TaskInView {
  if (!taskRef) return NO_TASK;

  const customTaskId = customTaskIdIn(taskRef);
  if (customTaskId !== null) {
    const own = database
      .select({ title: customTask.title })
      .from(customTask)
      .where(
        and(
          eq(customTask.id, customTaskId),
          eq(customTask.practiceId, practice.id),
        ),
      )
      .get();

    return own ? { globalTaskId: null, taskTitle: own.title } : NO_TASK;
  }

  const inLibrary = database
    .select({ id: globalTask.id, title: globalTask.title })
    .from(globalTask)
    .where(
      and(eq(globalTask.slug, taskRef), isNotNull(globalTask.publishedAt)),
    )
    .get();

  return inLibrary
    ? { globalTaskId: inLibrary.id, taskTitle: inLibrary.title }
    : NO_TASK;
}

/** As long a path as any page of ours produces, and then some. */
const PAGE_PATH_LIMIT = 512;

/**
 * Read the page the physician was on: a path of ours, and never a URL.
 *
 * The value arrives in a query parameter, so anyone can type anything into
 * it. What lands in the row has to be somewhere the Admin can paste into a
 * browser and arrive where the physician was — so an absolute URL, a
 * protocol-relative one, or anything not beginning with a slash is not
 * narrowed or rejected with an error page, it simply is not a page of ours
 * and the row says `/`. Losing the page is worth less than losing the words.
 */
export function asPagePath(value: unknown): string {
  const path = typeof value === "string" ? value.trim() : "";

  if (!path.startsWith("/")) return "/";
  if (path.startsWith("//")) return "/";
  if (path.length > PAGE_PATH_LIMIT) return "/";

  return path;
}

/**
 * Take one Feedback from one person in this Practice.
 *
 * The two ceilings are the whole of the abuse story, and they are counted
 * here rather than by the auth library, because every Feedback goes through
 * an action we wrote (ADR-0004 deleted the claim that the library's limiter
 * runs at all). Characters first, because a refusal a physician can see the
 * cause of is cheaper than one they cannot; then the hour, counted against
 * the author and nobody else — a Practice of three people is three people
 * reporting real problems, not one.
 *
 * Nothing is truncated. A complaint cut off at 5,000 characters is a
 * complaint whose ending the Admin never reads, and the physician was never
 * told it happened.
 */
export function sendFeedback(
  database: AppDatabase,
  practice: CurrentPractice,
  author: SignedInUser,
  written: { text: string; pagePath: string; taskRef: string | null },
): SentFeedback {
  const text = written.text.trim();
  if (text === "") return { outcome: "empty" };
  if (text.length > FEEDBACK_CHARACTER_CAP) return { outcome: "too-long" };

  const task = taskInView(database, practice, written.taskRef);
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Counting and writing are one act, so two presses arriving together
  // cannot both read nine and both write.
  return database.transaction((tx) => {
    const thisHour = tx
      .select({ id: feedback.id })
      .from(feedback)
      .where(
        and(
          eq(feedback.authorUserId, author.id),
          gte(feedback.createdAt, anHourAgo),
        ),
      )
      .all();
    if (thisHour.length >= FEEDBACK_PER_HOUR) {
      return { outcome: "too-many" } as const;
    }

    tx.insert(feedback)
      .values({
        practiceId: practice.id,
        authorUserId: author.id,
        text,
        pagePath: written.pagePath,
        globalTaskId: task.globalTaskId,
        taskTitle: task.taskTitle,
      })
      .run();

    return { outcome: "sent" } as const;
  });
}
