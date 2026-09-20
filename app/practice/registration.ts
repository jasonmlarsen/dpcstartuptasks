import { eq, isNotNull } from "drizzle-orm";

import type { SignedInUser } from "~/auth/server";
import { claimEmailConsent } from "~/consent/email-consent";
import { enqueueKitSyncJob } from "~/consent/kit-sync-queue";
import type { AppDatabase, AppWriter } from "~/database/database";
import { globalTask, membership, practice, taskEntry } from "~/database/schema";
import { acceptInviteOnSignIn } from "./invite";

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
 *
 * It is also where an Invite is taken up, because a Sign-in Link delivered to
 * the invited address is the only thing in the product that proves who is
 * holding it — the invite link itself carries no authority at all. So the
 * question this asks is not *are you new?* but *where do you belong?*, and
 * the three answers are: the Practice that invited you, the one you already
 * have, or a new one.
 */
export interface Registration {
  /**
   * A name an Invite carried, for the caller to write onto the User.
   *
   * Handed back rather than written here because `user.name` is Better Auth's
   * own column and only `app/auth/server.ts` writes those (ADR-0004) — and
   * because that write is async and this is one synchronous transaction.
   */
  displayName: string | null;
}

export function registerPractice(
  database: AppDatabase,
  signedInUser: SignedInUser,
): Registration {
  return database.transaction((tx) => {
    const existing = tx
      .select({ practiceId: membership.practiceId })
      .from(membership)
      .where(eq(membership.userId, signedInUser.id))
      .get();

    // Before the newcomer question, not after: a physician who signed up
    // alone and then accepted a colleague's invitation has their own empty
    // Practice abandoned here, which is the only thing that keeps one
    // Practice per User from stranding the two of them apart.
    const invited = acceptInviteOnSignIn(tx, signedInUser, existing ?? null);

    if (!invited.joined && !existing) createPractice(tx, signedInUser.id);

    // Claimed for a returning physician too. Consent is append-only, so this
    // can only ever add one that was never given — it cannot rewrite or clear
    // an act already recorded.
    const consented = claimEmailConsent(tx, signedInUser.id, signedInUser.email);

    // A row in a table, and never a call to Kit. This is the single most
    // load-bearing thing about the whole Kit integration: registration is the
    // one moment a physician is waiting, and a Kit outage may not delay it,
    // fail it, or show them anything at all. Enqueued inside the same
    // transaction as the consent it follows from, so there is no world in
    // which one exists without the other.
    if (consented) enqueueKitSyncJob(tx, signedInUser.id, "signup");

    return { displayName: invited.joined ? invited.displayName : null };
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
