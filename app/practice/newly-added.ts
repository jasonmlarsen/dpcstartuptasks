import { and, eq, isNotNull, isNull } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import { globalTask, taskEntry } from "~/database/schema";
import { toTheSecond } from "~/lib/plain-date";
import type { CurrentPractice } from "./practice";

/**
 * Newly Added, and the one act that clears it.
 *
 * `announced_at IS NOT NULL AND acknowledged_at IS NULL`. Two timestamps
 * rather than a boolean, because the pair says both things worth knowing:
 * that this Task arrived after the Practice did, and whether anyone there
 * has read it yet. A Task present when the Practice was created has a null
 * `announced_at` forever, which is what stops a brand-new Practice opening
 * to ninety-eight flags.
 *
 * It is cleared by **opening the Task, not by viewing the Phase**, so the
 * flag means *I have read this* rather than *I have scrolled past this*.
 * That is why this is a write on a `GET`: opening the drawer is a link and
 * not a form, and it is the act being recorded. The write is idempotent and
 * carries no other consequence, so a reload, a prefetch or a back button
 * costs nothing beyond the timestamp that is already there.
 *
 * It belongs to the Practice and not to whoever opened it. There is one
 * shared list and up to three people reading it; a per-person flag would
 * mean the Owner marking a Task done and the Member still being told it is
 * new.
 *
 * One thing to settle when Support View arrives (#40): the Admin reading a
 * Practice's list is not *someone there*, so entering a Practice and opening
 * a Task would clear a flag nobody in it has seen. The guard belongs to that
 * ticket, which is where the app first knows a borrowed session from a real
 * one.
 */
export function acknowledgeTask(
  database: AppDatabase,
  practice: CurrentPractice,
  taskRef: string,
): void {
  const target = database
    .select({ id: globalTask.id })
    .from(globalTask)
    .where(eq(globalTask.slug, taskRef))
    .get();
  // A Custom Task's ref, or a typo. Neither is ever Newly Added: a Practice
  // does not announce a Task to itself.
  if (!target) return;

  database
    .update(taskEntry)
    .set({ acknowledgedAt: toTheSecond(new Date()) })
    .where(
      and(
        eq(taskEntry.practiceId, practice.id),
        eq(taskEntry.globalTaskId, target.id),
        isNotNull(taskEntry.announcedAt),
        // Already acknowledged stays as it was, so the column records when
        // the Practice first read it rather than when it last looked.
        isNull(taskEntry.acknowledgedAt),
      ),
    )
    .run();
}
