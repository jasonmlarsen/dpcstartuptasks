import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { deleteUserAccount, revokeAllSessions } from "~/auth/server";
import type { AppDatabase, AppWriter } from "~/database/database";
import { invite, membership, PRACTICE_PEOPLE_CAP, user } from "~/database/schema";
import type { AppServices } from "~/services/services";
import type { CurrentPractice } from "./practice";

/**
 * Who is in a Practice, and the two ways a person stops being in one.
 *
 * A Member can do anything on the list the Owner can — Status, Notes, target
 * dates, Custom Tasks — so there is nothing in this file about what a Member
 * may write. Only three acts are the Owner's alone (invite, remove, delete),
 * and `role` is the whole of the machinery: there is no role editor, no
 * permission table and no second kind of Member to need one.
 *
 * Like the rest of `app/practice`, nothing here takes a Practice id from a
 * caller. The Practice is what the signed-in User's Membership says it is.
 *
 * Reading `user` from outside `app/auth/server.ts` is the same carve-out the
 * Email Consent columns already have, and for the same reason: the People
 * section has to show an address and a name, there is nowhere else for either
 * to live, and the boundary ADR-0004 draws is around the *library* — no file
 * but the auth module imports `better-auth`. Every **write** to that table
 * still goes through the auth module, which is why removing and Leaving are
 * async here.
 */

/** One person in a Practice, as the People section shows them. */
export interface PersonInPractice {
  userId: string;
  email: string;
  /** The Display Name, or null when nobody has typed one. Email is the fallback. */
  name: string | null;
  role: "owner" | "member";
}

/** Everyone in a Practice, the Owner first. */
export function peopleIn(
  database: AppDatabase,
  practice: CurrentPractice,
): PersonInPractice[] {
  return database
    .select({
      userId: membership.userId,
      email: user.email,
      name: user.name,
      role: membership.role,
    })
    .from(membership)
    .innerJoin(user, eq(membership.userId, user.id))
    .where(eq(membership.practiceId, practice.id))
    .orderBy(sql`${membership.role} = 'owner' desc`, membership.createdAt)
    .all()
    .map((row) => ({ ...row, name: row.name.trim() === "" ? null : row.name }));
}

/**
 * How many Memberships a Practice has written.
 *
 * The cap arithmetic lives in this file and only in this file: *three
 * people* is one number about one thing, and a second count of the same
 * rows somewhere else is how a cap comes to mean two different things.
 */
export function memberCount(database: AppWriter, practiceId: number): number {
  return database
    .select({ id: membership.id })
    .from(membership)
    .where(eq(membership.practiceId, practiceId))
    .all().length;
}

/**
 * How many of the three places a Practice has are spoken for.
 *
 * Memberships **and pending Invites**, which is the whole of why acceptance
 * can never put four people in a Practice: the place is taken when the
 * invitation is sent, not when it is answered, so nothing has to be locked or
 * re-checked at the moment someone says yes.
 */
export function placesTaken(
  database: AppWriter,
  practiceId: number,
  now: Date = new Date(),
): number {
  const pending = database
    .select({ id: invite.id })
    .from(invite)
    .where(pendingInvitesOf(practiceId, now))
    .all();

  return memberCount(database, practiceId) + pending.length;
}

/** The three columns that make an Invite pending, in one place. */
export function pendingInvitesOf(practiceId: number, now: Date) {
  return and(
    eq(invite.practiceId, practiceId),
    isNull(invite.acceptedAt),
    isNull(invite.revokedAt),
    gt(invite.expiresAt, now),
  );
}

/** Whether a Practice has room for one more person, Invites counted. */
export function hasRoom(
  database: AppWriter,
  practiceId: number,
  now: Date = new Date(),
): boolean {
  return placesTaken(database, practiceId, now) < PRACTICE_PEOPLE_CAP;
}

/**
 * Whether one more Membership can be written, counting Memberships only.
 *
 * The one question that ignores pending Invites, asked at the moment an
 * Invite is taken up: the Invite doing the asking is itself holding one of
 * the three places, so counting it would mean an Invite blocking itself.
 */
export function roomForAnotherMember(
  database: AppWriter,
  practiceId: number,
): boolean {
  return memberCount(database, practiceId) < PRACTICE_PEOPLE_CAP;
}

export type RemovalOutcome =
  | "removed"
  /** Only the Owner can invite, remove or delete. */
  | "not-owner"
  /** Not a Member of this Practice, or the Owner themselves. */
  | "no-such-member";

/**
 * The Owner removing a Member.
 *
 * Revoke, then delete. ADR-0004 asks for both in one transaction and for the
 * revocation first if they cannot be atomic, and here they cannot: the
 * session delete goes through Better Auth's own adapter and our Membership
 * delete goes through Drizzle, so there is no transaction that spans them.
 * Revoking first is the order that fails safe — a crash between the two
 * leaves a person signed out of a Practice they are still in, which the
 * Owner can see and fix, rather than signed in to one they have left.
 *
 * The removed User is not deleted. They asked for nothing; the Owner acted.
 * What they lose is this Practice, and their next request is unauthenticated.
 */
export async function removeMember(
  services: AppServices,
  practice: CurrentPractice,
  userId: string,
): Promise<RemovalOutcome> {
  if (practice.role !== "owner") return "not-owner";

  const target = services.database
    .select({ id: membership.id })
    .from(membership)
    .where(
      and(
        eq(membership.practiceId, practice.id),
        eq(membership.userId, userId),
        // An Owner is never removed by this control. Ending a Practice is
        // Delete, in the Danger Zone, and it is a different act with a
        // different promise attached to it.
        eq(membership.role, "member"),
      ),
    )
    .get();

  if (!target) return "no-such-member";

  await revokeAllSessions(services, userId);

  services.database.delete(membership).where(eq(membership.id, target.id)).run();

  return "removed";
}

export type LeavingOutcome =
  | "left"
  /**
   * An Owner cannot Leave, because with no co-owners Leaving would orphan the
   * list. The Owner's way out is deleting the Practice.
   */
  | "owner-cannot-leave";

/**
 * A Member Leaving, which for a Member *is* deleting.
 *
 * There is no account without a Practice, so one control does both: the
 * Membership and the User go together, down the same revocation path as
 * being removed. What they wrote stays — Notes live on the Practice's Task
 * Entries and are never touched here, because a Note belongs to the Practice
 * and not to whoever typed it.
 */
export async function leavePractice(
  services: AppServices,
  practice: CurrentPractice,
  userId: string,
): Promise<LeavingOutcome> {
  if (practice.role === "owner") return "owner-cannot-leave";

  // Sessions first, then the User — and the Membership goes with it, by the
  // cascade `membership.user_id` declares. The same order removal uses and
  // for the same reason (ADR-0004): these two writes cannot share a
  // transaction, and a crash after the revocation leaves somebody signed out
  // of a Practice they are still in rather than signed in to one they have
  // left. Their Notes are in neither write, because a Note belongs to the
  // Practice.
  await deleteUserAccount(services, userId);

  return "left";
}
