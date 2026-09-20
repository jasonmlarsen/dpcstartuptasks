import { isNotNull, ne, or, type SQL } from "drizzle-orm";

import { taskEntry } from "~/database/schema";

/**
 * A Task Entry the Practice has done something with: the Status moved, a
 * Note written, or a target date set.
 *
 * One spelling, in one file, because two things turn on it and they must
 * never disagree. Retiring a Global Task hard-deletes the Entries of
 * Practices that did nothing and keeps the rest, and accepting an Invite
 * abandons a Practice nobody has touched — a fourth column appearing in one
 * of those and not the other would mean a physician losing work in exactly
 * the case nobody tested.
 *
 * Newly Added is deliberately not in it. Being told about a Task is not
 * doing it, and an unopened flag is not work worth keeping a row for.
 *
 * Not Applicable **is** in it, including the Not Applicable the Tailoring
 * Wizard set. The Wizard records no provenance (ADR-0002), so there is no
 * way to tell a Status a physician chose from one a skipped screen chose for
 * them, and where the two cannot be told apart this errs towards keeping the
 * row: a Retired Task the Practice set aside renders exactly as it already
 * did, dimmed at the bottom of its Phase, and keeping it costs a line a
 * physician was ignoring anyway.
 */
export function didSomething(): SQL {
  return or(
    ne(taskEntry.status, "not_started"),
    isNotNull(taskEntry.note),
    isNotNull(taskEntry.targetDate),
  )!;
}
