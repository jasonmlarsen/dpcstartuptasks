import { createHash } from "node:crypto";

import { and, count, eq, lt, gt } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import { continueAttempt, signInLinkRequest } from "~/database/schema";

/**
 * Rate limiting is ours, on two axes, with two different behaviours
 * (ADR-0004). Better Auth's own limiter runs in the router's `onRequest` hook
 * and the router is never mounted, so it never fires; and it could not do the
 * per-address axis anyway, because it keys on `${ip}|${path}` and runs before
 * the body is parsed.
 *
 * Both axes count rows in SQLite rather than in memory. A redeploy is not
 * supposed to hand anyone a fresh allowance, and the twenty-four hour window
 * is longer than the interval between deploys.
 */

/** Per address, on the send leg: the short burst window. */
export const SHORT_WINDOW_MINUTES = 15;
export const SHORT_WINDOW_LIMIT = 3;

/** Per address, on the send leg: the rolling day. */
export const LONG_WINDOW_HOURS = 24;
export const LONG_WINDOW_LIMIT = 10;

/** Per IP, on the verify leg. */
export const CONTINUE_WINDOW_MINUTES = 10;
export const CONTINUE_LIMIT = 20;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Whether we may send this address a Sign-in Link, recording the send if we
 * may. Called from inside `sendMagicLink` and nowhere else: in front of the
 * endpoint it would be a branch on the address, and the *check your email*
 * page has to be byte-identical whether or not this returns false.
 *
 * The address is reduced to a digest on the way in. Anyone at all can type an
 * address into the sign-in form, so this table must not become a record of who
 * was asked about — counting is the whole job.
 */
export function allowSignInLinkRequest(
  database: AppDatabase,
  email: string,
  now: Date = new Date(),
): boolean {
  const emailDigest = digestOf(email);
  const longWindowStart = new Date(now.getTime() - LONG_WINDOW_HOURS * HOUR);

  // Nothing older than the longest window can affect any count, so this is
  // the natural moment to drop it.
  database
    .delete(signInLinkRequest)
    .where(
      and(
        eq(signInLinkRequest.emailDigest, emailDigest),
        lt(signInLinkRequest.requestedAt, longWindowStart),
      ),
    )
    .run();

  const inLongWindow = countSince(database, emailDigest, longWindowStart);
  if (inLongWindow >= LONG_WINDOW_LIMIT) return false;

  const shortWindowStart = new Date(now.getTime() - SHORT_WINDOW_MINUTES * MINUTE);
  if (countSince(database, emailDigest, shortWindowStart) >= SHORT_WINDOW_LIMIT) {
    return false;
  }

  database
    .insert(signInLinkRequest)
    .values({ emailDigest, requestedAt: now })
    .run();

  return true;
}

function countSince(
  database: AppDatabase,
  emailDigest: string,
  since: Date,
): number {
  const row = database
    .select({ value: count() })
    .from(signInLinkRequest)
    .where(
      and(
        eq(signInLinkRequest.emailDigest, emailDigest),
        gt(signInLinkRequest.requestedAt, since),
      ),
    )
    .get();

  return row?.value ?? 0;
}

/**
 * Whether this IP may press Continue, recording the press if it may.
 *
 * Unlike the send leg this one is visible when it trips: whoever is pressing
 * holds a token already, so there is nothing a refusal could tell them that
 * they did not already know, and a silent refusal would read as a broken link.
 */
export function allowContinueAttempt(
  database: AppDatabase,
  ipAddress: string,
  now: Date = new Date(),
): boolean {
  const windowStart = new Date(now.getTime() - CONTINUE_WINDOW_MINUTES * MINUTE);

  database
    .delete(continueAttempt)
    .where(
      and(
        eq(continueAttempt.ipAddress, ipAddress),
        lt(continueAttempt.attemptedAt, windowStart),
      ),
    )
    .run();

  const row = database
    .select({ value: count() })
    .from(continueAttempt)
    .where(
      and(
        eq(continueAttempt.ipAddress, ipAddress),
        gt(continueAttempt.attemptedAt, windowStart),
      ),
    )
    .get();

  if ((row?.value ?? 0) >= CONTINUE_LIMIT) return false;

  database
    .insert(continueAttempt)
    .values({ ipAddress, attemptedAt: now })
    .run();

  return true;
}

/** Addresses differ only by case and surrounding space as often as not. */
function digestOf(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
