import { desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import type { AppDatabase } from "~/database/database";
import { membership, practice, type PracticeState } from "~/database/schema";
import { GRACE_PERIOD_DAYS } from "~/practice/deletion";

/**
 * Every Practice, as the one page the Admin checks.
 *
 * This is the one file in the app that reads Practices without a
 * Membership to scope them, and it lives in `app/admin` for that reason:
 * the invariant `app/practice` holds — nothing there takes a Practice id
 * from a caller — is what makes tenancy a fact about a signature rather
 * than a rule to remember, and a cross-Practice read put in that directory
 * would end it quietly. The guard on these rows is not the query, it is
 * `requireAdmin` on the loader that calls it.
 *
 * **Metadata, and never contents.** There is no Note, no Status, no Task
 * Entry and no Custom Task in anything this file returns, for an Active
 * Practice or a deleted one. For a deleted Practice that is the Grace
 * Period being a real boundary rather than a delay; for an Active one it is
 * the reason Support View exists — the Admin looks at a Practice's work by
 * entering it, announced by a banner, one Practice at a time, and never by
 * reading a column on a list of fifty.
 *
 * So there is also no progress number here and there never should be. A
 * *how far has each Practice got* column is the per-task-status-across-
 * Practices view the spec rules out by name: it reads as insight and is
 * actually the fog, and it is contents besides.
 */

export interface PracticeOnTheDashboard {
  id: number;
  /** Null until the Owner names it. The page renders a fallback, never a blank. */
  name: string | null;
  /** From the Practice Profile, and null when the Wizard was never answered. */
  state: PracticeState | null;
  /** Memberships, which is people in it now and not the three-person cap. */
  people: number;
  createdAt: Date;
  /** Null for an Active Practice; the moment of the Owner's press for the rest. */
  deletedAt: Date | null;
  /** Thirty days after the press, and null for an Active Practice. */
  purgeDueOn: Date | null;
}

/**
 * The two lists, derived from `deleted_at` and nothing else.
 *
 * No status column was added for this. `deleted_at IS NULL` already carries
 * the whole distinction — it is what makes a Practice unreachable to
 * everyone in it — and a second column naming the same fact is a second
 * column to get out of step with the first.
 */
export interface PracticesDashboard {
  active: PracticeOnTheDashboard[];
  deletedInGrace: PracticeOnTheDashboard[];
}

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export function practicesDashboard(database: AppDatabase): PracticesDashboard {
  return {
    // Newest first: a Practice that registered this morning is the one an
    // Admin opening this page has a reason to look at.
    active: practiceRows(database, isNull(practice.deletedAt), [
      desc(practice.createdAt),
    ]),
    // Soonest purge first, which is the opposite order for the opposite
    // reason: the row nearest its thirty days is the one where doing
    // nothing stops being reversible.
    deletedInGrace: practiceRows(database, isNotNull(practice.deletedAt), [
      practice.deletedAt,
    ]),
  };
}

function practiceRows(
  database: AppDatabase,
  matching: SQL,
  order: (SQL | SQLiteColumn)[],
): PracticeOnTheDashboard[] {
  const rows = database
    .select({
      id: practice.id,
      name: practice.name,
      state: practice.state,
      createdAt: practice.createdAt,
      deletedAt: practice.deletedAt,
      people: sql<number>`count(${membership.id})`,
    })
    .from(practice)
    .leftJoin(membership, eq(membership.practiceId, practice.id))
    .where(matching)
    .groupBy(practice.id)
    .orderBy(...order)
    .all();

  return rows.map((row) => ({
    ...row,
    purgeDueOn:
      row.deletedAt === null
        ? null
        : new Date(row.deletedAt.getTime() + GRACE_PERIOD_DAYS * DAY_IN_MILLISECONDS),
  }));
}
