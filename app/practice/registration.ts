import { eq, isNotNull } from "drizzle-orm";

import type { SignedInUser } from "~/auth/server";
import { claimEmailConsent } from "~/consent/email-consent";
import type { AppDatabase, AppWriter } from "~/database/database";
import { globalTask, membership, practice, taskEntry } from "~/database/schema";

/**
 * Registration: the first time an address signs in, it becomes a Practice.
 *
 * There is no registration form beyond the sign-in form and no step a
 * physician has to complete — the account, the Practice, the Owner Membership
 * and a Task Entry for every Task all come into being on one Continue press,
 * so the first thing anyone sees after signing in is a list that is already
 * theirs.
 *
 * Run on every successful sign-in, not only the first. It is the *absence of a
 * Membership* that means newcomer, and asking that question every time is what
 * makes signing in again cost nothing: a physician who has a Practice keeps
 * the one they have.
 */
export function registerPractice(
  database: AppDatabase,
  signedInUser: SignedInUser,
): void {
  database.transaction((tx) => {
    const existing = tx
      .select({ id: membership.id })
      .from(membership)
      .where(eq(membership.userId, signedInUser.id))
      .get();

    if (!existing) createPractice(tx, signedInUser.id);

    // Claimed for a returning physician too. Consent is append-only, so this
    // can only ever add one that was never given — it cannot rewrite or clear
    // an act already recorded.
    claimEmailConsent(tx, signedInUser.id, signedInUser.email);
  });
}

/**
 * One Practice, one Owner, and one Task Entry per Published Global Task.
 *
 * The Entries are written here rather than on first touch (ADR-0003): at ~98
 * Tasks and ~50 Practices the whole table is about 4,900 rows, and buying that
 * removes the question *does no row mean not started, or never rendered, or
 * published after this Practice existed?* from every read path in the product.
 *
 * `announced_at` is left null, which is what makes Tasks present at creation
 * never Newly Added — only a Task published into a Practice that already
 * existed is new to it.
 */
function createPractice(tx: AppWriter, userId: string): void {
  const created = tx
    .insert(practice)
    // No name: registration asks for an email address and nothing else, and
    // the Owner names their Practice later if they want to.
    .values({})
    .returning({ id: practice.id })
    .get();

  tx.insert(membership)
    .values({ practiceId: created.id, userId, role: "owner" })
    .run();

  // Drafts are excluded by the same clause that defines them: a Global Task
  // with no `published_at` is not yet part of anyone's list.
  const tasks = tx
    .select({ id: globalTask.id })
    .from(globalTask)
    .where(isNotNull(globalTask.publishedAt))
    .all();

  if (tasks.length === 0) return;

  tx.insert(taskEntry)
    .values(
      tasks.map((task) => ({
        practiceId: created.id,
        globalTaskId: task.id,
      })),
    )
    .run();
}
