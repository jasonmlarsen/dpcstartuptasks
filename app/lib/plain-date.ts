/**
 * A date as a physician reads it: *3 March 2026*.
 *
 * One function so that every date in the product — the day a consent was
 * granted, the day a Practice was deleted, the day its Purge falls due —
 * reads the same way, and so that the settings page and the admin panel
 * cannot come to disagree about how a day is written.
 *
 * Always the full month name and never a numeric format: `3/4/2026` is two
 * different days depending on who is reading it, and the one place this
 * appears next to a thirty-day deadline is the one place that matters.
 */
export function asPlainDate(when: Date): string {
  return when.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * The same instant, truncated to the second the timestamp columns store.
 *
 * Every column in this schema is `integer(… { mode: "timestamp" })`, which is
 * whole seconds, so a `Date` carrying milliseconds is one that will not read
 * back as it was written. Truncating at the moment of the write means what a
 * caller is told matches what it could select afterwards — which the Seed
 * Script already relied on, and which publishing a Task now relies on too.
 */
export function toTheSecond(when: Date): Date {
  return new Date(Math.floor(when.getTime() / 1000) * 1000);
}
