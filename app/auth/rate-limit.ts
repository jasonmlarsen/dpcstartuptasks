import { createHash } from "node:crypto";

import { and, count, eq, gt, lt } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

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

  // Both windows have to hold, and the longer one is checked first so that a
  // day's worth of requests is not reset by fifteen quiet minutes.
  return recordIfUnder(database, sendLeg(emailDigest), now, [
    { limit: LONG_WINDOW_LIMIT, milliseconds: LONG_WINDOW_HOURS * HOUR },
    { limit: SHORT_WINDOW_LIMIT, milliseconds: SHORT_WINDOW_MINUTES * MINUTE },
  ]);
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
  return recordIfUnder(database, verifyLeg(ipAddress), now, [
    { limit: CONTINUE_LIMIT, milliseconds: CONTINUE_WINDOW_MINUTES * MINUTE },
  ]);
}

/**
 * An axis: one table, the column its rows are keyed by, and the key.
 *
 * The two axes differ in what they count and how loudly they refuse, and in
 * nothing else — so the counting lives here once and each axis is a handful
 * of columns rather than a copy of the same three steps.
 */
interface Axis {
  key: string;
  subject: SQLiteColumn;
  at: SQLiteColumn;
  table: SQLiteTable;
  /** Spelled out rather than derived: a column's `name` is its database name. */
  row(at: Date): Record<string, unknown>;
}

function sendLeg(emailDigest: string): Axis {
  return {
    key: emailDigest,
    subject: signInLinkRequest.emailDigest,
    at: signInLinkRequest.requestedAt,
    table: signInLinkRequest,
    row: (requestedAt) => ({ emailDigest, requestedAt }),
  };
}

function verifyLeg(ipAddress: string): Axis {
  return {
    key: ipAddress,
    subject: continueAttempt.ipAddress,
    at: continueAttempt.attemptedAt,
    table: continueAttempt,
    row: (attemptedAt) => ({ ipAddress, attemptedAt }),
  };
}

interface Window {
  limit: number;
  milliseconds: number;
}

/**
 * Record this attempt if every window still has room for it, and say whether
 * it was recorded.
 *
 * Only attempts that were allowed are kept, so a refusal never extends its own
 * lockout: pressing again while over the limit costs nothing and waits no
 * longer. The limits are what they say they are rather than a punishment that
 * grows.
 */
function recordIfUnder(
  database: AppDatabase,
  axis: Axis,
  now: Date,
  windows: Window[],
): boolean {
  const longest = Math.max(...windows.map((window) => window.milliseconds));

  // Nothing older than the longest window can affect any count, so this is the
  // natural moment to drop it.
  database
    .delete(axis.table)
    .where(
      and(
        eq(axis.subject, axis.key),
        lt(axis.at, new Date(now.getTime() - longest)),
      ),
    )
    .run();

  for (const window of windows) {
    const since = new Date(now.getTime() - window.milliseconds);
    const row = database
      .select({ value: count() })
      .from(axis.table)
      .where(and(eq(axis.subject, axis.key), gt(axis.at, since)))
      .get();

    if ((row?.value ?? 0) >= window.limit) return false;
  }

  database.insert(axis.table).values(axis.row(now)).run();

  return true;
}

/** Addresses differ only by case and surrounding space as often as not. */
function digestOf(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
