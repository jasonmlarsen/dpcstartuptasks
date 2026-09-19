import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";

import type { AppWriter } from "~/database/database";
import { pendingEmailConsent, user } from "~/database/schema";
import { emailDigest } from "~/lib/email-digest";

/**
 * Email Consent: a physician's permission to be sent occasional
 * non-transactional email.
 *
 * Consent here is an **act, never a state**. The app can record that it was
 * given and can never record that it was taken back, because withdrawal
 * happens in Kit, through the footer of an email, and a revocation column here
 * would only rot out of sync with the place that actually knows. A User who
 * consented and later unsubscribed still has Email Consent recorded, and the
 * app does not know — which is the honest shape, not a gap.
 */

/**
 * The Consent Wording, identified by a version.
 *
 * Never rewritten in place. If the sentence changes, the new sentence gets a
 * new version and this one stays exactly as it is, so that an old
 * `email_consent_version` keeps meaning what it meant when someone agreed to
 * it. Deliberately not wired to the Terms and Privacy versions, which move for
 * their own reasons.
 */
export const EMAIL_CONSENT_VERSION = "2026-09-signup-v1";

/**
 * The owner's own words, first person on purpose: it is one person asking, not
 * a company harvesting a list, and it is the persuasion that earns a tick
 * without a gate.
 */
export const EMAIL_CONSENT_WORDING =
  "In order to keep this a free service to members, I would really " +
  "appreciate being able to communicate with you over email. You can still " +
  "unsubscribe at any time, and I will never sell or give away your email " +
  "address to anyone else.";

/**
 * How long a consent given on the registration form waits for its account.
 *
 * The same ten minutes a Sign-in Link lives, because the two travel together:
 * the box is ticked and the link is sent in one request, and once the link is
 * dead the choice that rode with it is stale. Named here rather than imported
 * from the auth module so that this file does not depend on the door.
 */
const PENDING_CONSENT_LIFETIME_MS = 10 * 60 * 1000;

/**
 * Record what the registration form said about email.
 *
 * The registration form *is* the sign-in form, and when it is posted there is
 * no User to write the consent onto — the User arrives when Continue is
 * pressed, possibly on another device and certainly in another request. So the
 * act is parked against a digest of the address and claimed when the account
 * appears.
 *
 * Called for every posted form, ticked or not, and it must stay that way:
 * this is in front of the only door in the product, and nothing in front of
 * that door may ever behave differently for an address that is known.
 */
export function recordEmailConsentChoice(
  database: AppWriter,
  email: string,
  granted: boolean,
  now: Date = new Date(),
): void {
  const digest = emailDigest(email);

  // The last thing a physician said is the thing they said, so an earlier
  // choice for this address goes before a later one is written. Stale rows for
  // everyone else go at the same time: nothing older than a Sign-in Link can
  // ever be claimed, so there is no reason to keep it.
  database.delete(pendingEmailConsent).where(eq(pendingEmailConsent.emailDigest, digest)).run();
  database
    .delete(pendingEmailConsent)
    .where(
      lt(
        pendingEmailConsent.grantedAt,
        new Date(now.getTime() - PENDING_CONSENT_LIFETIME_MS),
      ),
    )
    .run();

  // Declining writes nothing at all. There is no row meaning *no*, because
  // there is no question the app ever needs to answer with one.
  if (!granted) return;

  database
    .insert(pendingEmailConsent)
    .values({
      emailDigest: digest,
      version: EMAIL_CONSENT_VERSION,
      grantedAt: now,
    })
    .run();
}

/**
 * Hand a User the Email Consent their registration form recorded, if there is
 * one waiting and they have not already granted it.
 *
 * Append-only in both directions: an act that is already on the User is never
 * rewritten — not its timestamp and not its version, because an old version
 * has to keep meaning what it meant — and nothing here can clear one. A
 * physician who declined and later ticks the box has granted consent, which is
 * a grant like any other; the Subscribe button in settings is the deliberate
 * path to the same place.
 */
export function claimEmailConsent(
  database: AppWriter,
  userId: string,
  email: string,
  now: Date = new Date(),
): void {
  const digest = emailDigest(email);

  const waiting = database
    .select()
    .from(pendingEmailConsent)
    .where(
      and(
        eq(pendingEmailConsent.emailDigest, digest),
        gt(
          pendingEmailConsent.grantedAt,
          new Date(now.getTime() - PENDING_CONSENT_LIFETIME_MS),
        ),
      ),
    )
    .orderBy(desc(pendingEmailConsent.grantedAt))
    .get();

  database
    .delete(pendingEmailConsent)
    .where(eq(pendingEmailConsent.emailDigest, digest))
    .run();

  if (!waiting) return;

  database
    .update(user)
    .set({
      emailConsentGrantedAt: waiting.grantedAt,
      emailConsentVersion: waiting.version,
    })
    .where(and(eq(user.id, userId), isNull(user.emailConsentGrantedAt)))
    .run();
}
