import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, gt, isNotNull, isNull, ne, or } from "drizzle-orm";

import { setDisplayName, type SignedInUser } from "~/auth/server";
import { appUrl } from "~/auth/config";
import type { AppDatabase, AppWriter } from "~/database/database";
import {
  customTask,
  invite,
  membership,
  practice as practiceTable,
  taskEntry,
  user,
} from "~/database/schema";
import { MAIL_FROM, MAIL_REPLY_TO } from "~/services/email-sender";
import type { AppServices } from "~/services/services";
import { hasRoom, memberCount, pendingInvitesOf, roomForAnotherMember } from "./people";
import type { CurrentPractice } from "./practice";

/**
 * An Invite: an Owner's outstanding offer of a Membership to an email address.
 *
 * Two rules pull in opposite directions here, and both are deliberate.
 *
 * The invite **box** is byte-identical for every address the Owner types. It
 * sits behind the door rather than in front of it, but it would be an
 * enumeration oracle all the same: *already a member here*, *already has a
 * practice*, *never heard of them* are three answers about someone who never
 * asked to be looked up.
 *
 * The invite **link** names its own failure — used, expired, revoked, or the
 * practice is full — and only an unrecognised token gets the generic message.
 * Whoever is holding the link was sent it; telling them why it will not work
 * is the difference between asking for another one and giving up.
 *
 * The link itself carries **no authority**. It opens a screen with one button
 * that emails a Sign-in Link, so a forwarded invite cannot hand away a place,
 * and a mail scanner that opens it burns nothing. Acceptance happens on the
 * Continue press, against the address the Invite was sent to.
 */

/**
 * How long an Invite lives.
 *
 * Long enough for a spouse to get to it at the weekend, short enough that an
 * offer nobody took stops being an open door into a Practice. It occupies one
 * of three places for the whole of it, which is the other half of why it
 * expires at all.
 */
export const INVITE_LIFETIME_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;

/** Where an invite email points. The token is the whole of the address. */
export const INVITE_PATH = "/invite";

/** What the Owner's press comes to. */
export type InviteAttempt =
  /**
   * The one answer every address gets. There is no *already invited*, no
   * *already a member* and no *unknown address*, because the Owner typing an
   * address must never learn anything about whoever holds it.
   */
  | { outcome: "invited" }
  /** Only the Owner can invite, remove or delete. */
  | { outcome: "not-owner" }
  /** The shape of what was typed, which says nothing about who holds it. */
  | { outcome: "unreadable-address" }
  /** Three people, counting the Owner and every pending Invite. */
  | { outcome: "practice-full" }
  /**
   * The invitation reads as being from a person and a clinic, so the two
   * names that make it one are asked for at the moment they are first needed
   * — which is here, and nowhere earlier, because registration asks for an
   * email address and nothing else.
   */
  | { outcome: "needs-details"; yourName: boolean; practiceName: boolean };

/**
 * Invite someone, asking for whatever is missing on the way.
 *
 * The two names are written before the Invite, and the Invite before the
 * email, so an Owner who fixed a blank field never has to type it twice.
 */
export async function inviteToPractice(
  services: AppServices,
  practice: CurrentPractice,
  owner: SignedInUser,
  form: { email: string; yourName: string; practiceName: string },
  now: Date = new Date(),
): Promise<InviteAttempt> {
  if (practice.role !== "owner") return { outcome: "not-owner" };

  const email = form.email.trim().toLowerCase();
  if (!looksLikeAnAddress(email)) return { outcome: "unreadable-address" };

  if (!hasRoom(services.database, practice.id, now)) {
    return { outcome: "practice-full" };
  }

  const yourName = form.yourName.trim() || owner.name.trim();
  const practiceName = form.practiceName.trim() || practice.name?.trim() || "";
  if (yourName === "" || practiceName === "") {
    return {
      outcome: "needs-details",
      yourName: yourName === "",
      practiceName: practiceName === "",
    };
  }

  if (yourName !== owner.name) {
    await setDisplayName(services, owner.id, yourName);
  }
  if (practiceName !== practice.name) {
    services.database
      .update(practiceTable)
      .set({ name: practiceName })
      .where(eq(practiceTable.id, practice.id))
      .run();
  }

  const token = mintInvite(services.database, practice.id, email, now);

  // No token means the address is already spoken for in this Practice — a
  // Member, or the Owner typing their own address. Nothing is written and
  // nothing is sent, and the answer is the answer every address gets.
  if (token) {
    await services.emailSender.send(
      inviteEmail({ to: email, token, from: yourName, practiceName }),
    );
  }

  return { outcome: "invited" };
}

/**
 * Write the Invite, or say there is nothing to write.
 *
 * A second press on an address already invited is a **resend**: the same row
 * gets a fresh token and a fresh week, because the physician's intent is
 * plainly *they did not get it*, and two live invitations to one address
 * would hold two of three places.
 */
function mintInvite(
  database: AppDatabase,
  practiceId: number,
  email: string,
  now: Date,
): string | null {
  const alreadyHere = database
    .select({ id: membership.id })
    .from(membership)
    .innerJoin(user, eq(membership.userId, user.id))
    .where(and(eq(membership.practiceId, practiceId), eq(user.email, email)))
    .get();
  if (alreadyHere) return null;

  const token = randomBytes(32).toString("base64url");
  const values = {
    tokenDigest: tokenDigest(token),
    expiresAt: new Date(now.getTime() + INVITE_LIFETIME_DAYS * DAY),
  };

  const outstanding = database
    .select({ id: invite.id })
    .from(invite)
    .where(and(pendingInvitesOf(practiceId, now), eq(invite.email, email)))
    .get();

  if (outstanding) {
    database.update(invite).set(values).where(eq(invite.id, outstanding.id)).run();
  } else {
    database.insert(invite).values({ practiceId, email, ...values }).run();
  }

  return token;
}

/** Every Invite of this Practice's that is still standing. */
export interface PendingInvite {
  id: number;
  email: string;
  expiresAt: Date;
}

export function pendingInvites(
  database: AppDatabase,
  practice: CurrentPractice,
  now: Date = new Date(),
): PendingInvite[] {
  return database
    .select({
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expiresAt,
    })
    .from(invite)
    .where(pendingInvitesOf(practice.id, now))
    .orderBy(invite.createdAt)
    .all();
}

/**
 * The Owner taking an offer back.
 *
 * Revoking is a column and not a delete, so the link can go on saying *this
 * invitation was withdrawn* rather than falling through to the generic
 * message, which would read as *we have never heard of this* to someone who
 * is holding an email we sent them.
 */
export function revokeInvite(
  database: AppDatabase,
  practice: CurrentPractice,
  inviteId: number,
  now: Date = new Date(),
): boolean {
  if (practice.role !== "owner") return false;

  return (
    database
      .update(invite)
      .set({ revokedAt: now })
      .where(and(pendingInvitesOf(practice.id, now), eq(invite.id, inviteId)))
      .returning({ id: invite.id })
      .all().length > 0
  );
}

/** What the invite link opens onto. */
export type InviteLink =
  /** The acceptance screen: this address, a name field, one button. */
  | { status: "open"; email: string; name: string; practiceName: string | null }
  /** Somebody signed in with it already. */
  | { status: "used" }
  /** The Owner took it back. */
  | { status: "revoked" }
  /** A week went by. */
  | { status: "expired" }
  /** Three people are in that Practice now. */
  | { status: "practice-full" }
  /**
   * The invitee is already somewhere on Launch Tasks with work of their own.
   * Only an *empty* Practice is abandoned on acceptance, so this is the one
   * case the product will not quietly resolve — deleting a practice with a
   * list in it is the physician's decision, never a side effect of pressing
   * a button in someone else's invitation.
   */
  | { status: "own-practice-in-use" }
  /** Anything that matches no row, which is the only generic answer here. */
  | { status: "unrecognised" };

export function readInvite(
  database: AppDatabase,
  token: string,
  now: Date = new Date(),
): InviteLink {
  const row = database
    .select()
    .from(invite)
    .where(eq(invite.tokenDigest, tokenDigest(token)))
    .get();

  // The one place the generic message belongs, and the only one: a token
  // nobody was ever sent has no failure of its own to name.
  if (!row) return { status: "unrecognised" };

  if (row.acceptedAt) return { status: "used" };
  if (row.revokedAt) return { status: "revoked" };
  if (row.expiresAt <= now) return { status: "expired" };
  if (!roomForAnotherMember(database, row.practiceId)) return { status: "practice-full" };
  if (elsewhereWithWork(database, row.email)) {
    return { status: "own-practice-in-use" };
  }

  const inviting = database
    .select({ name: practiceTable.name })
    .from(practiceTable)
    .where(eq(practiceTable.id, row.practiceId))
    .get();

  return {
    status: "open",
    email: row.email,
    name: row.inviteeName ?? "",
    practiceName: inviting?.name ?? null,
  };
}

/** Keep the name the invitee typed, for the User their sign-in will create. */
export function rememberInviteeName(
  database: AppDatabase,
  token: string,
  name: string,
): void {
  const trimmed = name.trim();

  database
    .update(invite)
    .set({ inviteeName: trimmed === "" ? null : trimmed })
    .where(eq(invite.tokenDigest, tokenDigest(token)))
    .run();
}

/**
 * Take up an Invite for the address that has just signed in, if there is one
 * to take up.
 *
 * This is where a Membership is created, and it is deliberately not where the
 * button was pressed: the invite link carries no authority, so the only thing
 * that can turn an offer into a place in a Practice is a Sign-in Link
 * delivered to the invited address.
 *
 * Runs inside registration's transaction, so a physician either joins or
 * registers, never both and never neither.
 */
export function acceptInviteOnSignIn(
  database: AppWriter,
  signedInUser: SignedInUser,
  existing: { practiceId: number } | null,
  now: Date = new Date(),
): { joined: true; displayName: string | null } | { joined: false } {
  const waiting = database
    .select()
    .from(invite)
    .where(
      and(
        eq(invite.email, signedInUser.email.trim().toLowerCase()),
        isNull(invite.acceptedAt),
        isNull(invite.revokedAt),
        gt(invite.expiresAt, now),
      ),
    )
    .orderBy(desc(invite.createdAt))
    .all()
    .find(
      (row) =>
        // Their own Practice is never the one they are joining, and a
        // Practice that filled up while the email sat in an inbox is not
        // joinable either — the link says so, in those words.
        row.practiceId !== existing?.practiceId &&
        roomForAnotherMember(database, row.practiceId),
    );

  if (!waiting) return { joined: false };

  // A physician who signed up alone and is then invited into a colleague's
  // Practice has their own empty Practice abandoned here — one Practice per
  // User is a unique index, so without this the two of them are permanently
  // stranded apart. Only ever an empty one: a list with work on it is not
  // debris, and this is not the place to destroy it.
  if (existing) {
    if (!untouched(database, existing.practiceId)) return { joined: false };
    database
      .delete(practiceTable)
      .where(eq(practiceTable.id, existing.practiceId))
      .run();
  }

  database
    .insert(membership)
    .values({
      practiceId: waiting.practiceId,
      userId: signedInUser.id,
      role: "member",
    })
    .run();

  database
    .update(invite)
    .set({ acceptedAt: now })
    .where(eq(invite.id, waiting.id))
    .run();

  // Only when there is nothing to overwrite: the name on the acceptance
  // screen is how a Member gets one, not a chance to rename someone who
  // already has.
  const displayName =
    signedInUser.name.trim() === "" ? waiting.inviteeName : null;

  return { joined: true, displayName };
}

/**
 * Whether the invited address already belongs to someone who is somewhere
 * else on Launch Tasks that acceptance could not quietly resolve.
 *
 * Two shapes: a Member of another Practice, who would have to Leave first,
 * and an Owner whose own list has work on it. An Owner of an untouched
 * Practice is neither — that Practice is abandoned on acceptance.
 */
function elsewhereWithWork(database: AppDatabase, email: string): boolean {
  const theirs = database
    .select({ practiceId: membership.practiceId, role: membership.role })
    .from(membership)
    .innerJoin(user, eq(membership.userId, user.id))
    .where(eq(user.email, email))
    .get();

  if (!theirs) return false;
  if (theirs.role === "member") return true;

  return !untouched(database, theirs.practiceId);
}

/**
 * A Practice nobody has done anything to: no second person, no Task written,
 * no Status moved, no Note, no target date.
 *
 * The Tailoring Wizard having been answered or skipped does not count as
 * work — it leaves no trace worth keeping a Practice for (ADR-0002), and a
 * physician who skipped a screen and then took an invitation should not be
 * held apart from the colleague who invited them because of it.
 */
function untouched(database: AppWriter, practiceId: number): boolean {
  if (memberCount(database, practiceId) > 1) return false;

  const written = database
    .select({ id: customTask.id })
    .from(customTask)
    .where(eq(customTask.practiceId, practiceId))
    .limit(1)
    .get();
  if (written) return false;

  const worked = database
    .select({ id: taskEntry.id })
    .from(taskEntry)
    .where(
      and(
        eq(taskEntry.practiceId, practiceId),
        or(
          ne(taskEntry.status, "not_started"),
          isNotNull(taskEntry.note),
          isNotNull(taskEntry.targetDate),
        ),
      ),
    )
    .limit(1)
    .get();

  return !worked;
}

/** The shape of an address, and nothing about who holds it. */
function looksLikeAnAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** SHA-256, so a stolen database is not a drawer full of working invitations. */
function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The second and last transactional email in v1.
 *
 * From a person and a clinic, which is why the Owner is asked for both names
 * at the moment they first invite someone. It says what the link does, since
 * the link does not sign anyone in and an invitation that looked like a
 * sign-in link would read as broken.
 */
function inviteEmail({
  to,
  token,
  from,
  practiceName,
}: {
  to: string;
  token: string;
  from: string;
  practiceName: string;
}) {
  const url = new URL(INVITE_PATH, appUrl());
  url.searchParams.set("token", token);
  const link = url.toString();

  // Both names are free text a physician typed, and the HTML part is the one
  // place in either email where that is not inert.
  const sender = escapeHtml(from);
  const clinic = escapeHtml(practiceName);

  return {
    from: MAIL_FROM,
    replyTo: MAIL_REPLY_TO,
    to,
    subject: `${from} invited you to ${practiceName} on Launch Tasks`,
    text: [
      `${from} has invited you to share the Launch Tasks list for ${practiceName}.`,
      "",
      link,
      "",
      "Opening the link asks for your name and then emails you a sign-in link.",
      `The invitation lasts ${INVITE_LIFETIME_DAYS} days.`,
      "If you were not expecting this, you can ignore this email.",
    ].join("\n"),
    html: [
      `<p>${sender} has invited you to share the Launch Tasks list for ${clinic}.</p>`,
      `<p><a href="${link}">Accept the invitation</a></p>`,
      "<p>Opening the link asks for your name and then emails you a sign-in link.</p>",
      `<p>The invitation lasts ${INVITE_LIFETIME_DAYS} days.</p>`,
      "<p>If you were not expecting this, you can ignore this email.</p>",
    ].join("\n"),
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
