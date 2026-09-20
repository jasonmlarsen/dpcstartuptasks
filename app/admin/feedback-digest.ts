import { max } from "drizzle-orm";

import { appUrl } from "~/auth/config";
import type { AppDatabase } from "~/database/database";
import { feedbackDigest } from "~/database/schema";
import { escapeHtml } from "~/lib/escape-html";
import { asPlainDate, toTheSecond } from "~/lib/plain-date";
import {
  MAIL_ADMIN,
  MAIL_FROM,
  MAIL_REPLY_TO,
  type EmailMessage,
  type EmailSender,
} from "~/services/email-sender";
import { feedbackArrivedAfter, type FeedbackInInbox } from "./feedback-inbox";

/**
 * The Feedback Digest: once a day, what arrived since the last one.
 *
 * Seam 3, the worker seam. A plain function taking its dependencies as
 * arguments, called directly by a test and by whatever runs it daily,
 * because it is genuinely request-less — there is no physician waiting on
 * it and no HTTP request to hang it on, so inventing one would be inventing
 * a seam rather than using one.
 *
 * It is **load-bearing rather than convenient**. The thirty-day Grace Period
 * is only a real window if the Admin actually reads a Feedback inside it,
 * and a solo operator reads their email long before they think to open an
 * admin page. Purge destroying Feedback (ADR-0007) is acceptable *because*
 * this runs; deleting it would quietly change what Purge costs, which is why
 * that sentence is in `CONTEXT.md` and in this file rather than in neither.
 *
 * Two rules and nothing else around them:
 *
 * - **Never sent empty.** A daily email that says *nothing today* trains the
 *   one person who reads it to stop reading it, and then the day something
 *   does arrive it goes unread too.
 * - **Exactly the window since the last one.** No Feedback is in two digests
 *   and none is in none — the mark is written only after Resend takes the
 *   message, so a failed send leaves the window open rather than swallowing
 *   what it was carrying.
 *
 * It lives in `app/admin` for the reason `feedback-inbox.ts` does: it reads
 * across every Practice, and a cross-Practice read in `app/practice` would
 * quietly end the invariant that holds there. The guard is not a route here
 * but the caller — nothing reachable over HTTP calls this.
 */

/** What the run did. */
export type SentDigest =
  /** One email to the Admin, carrying this many Feedback. Never zero. */
  | { outcome: "sent"; feedbackCount: number }
  /** Nothing arrived since the last digest, so nothing was sent. */
  | { outcome: "nothing-new" };

/**
 * Send today's digest, or send nothing.
 *
 * `now` is an argument rather than a call to the clock so that a test can
 * say which day the email is dated. It is only ever read for the subject
 * line and the row: the window itself is ids, never wall time, so a run that
 * happens late, twice, or on a machine whose clock is wrong still carries
 * each Feedback exactly once.
 */
export async function sendFeedbackDigest(
  database: AppDatabase,
  emailSender: EmailSender,
  now: Date = new Date(),
): Promise<SentDigest> {
  const arrived = feedbackArrivedAfter(database, lastDigestThrough(database));

  // Never empty, and the mark does not move: a day with no Feedback is not a
  // day that was covered, it is a day that added nothing to cover.
  if (arrived.length === 0) return { outcome: "nothing-new" };

  await emailSender.send(digestEmail(arrived, now));

  // Written after the send and never before. If Resend throws, this line is
  // not reached, the mark stands, and tomorrow's digest carries these
  // Feedback again — the one direction this is allowed to fail in.
  database
    .insert(feedbackDigest)
    .values({
      // The largest id carried, taken by measuring rather than by trusting
      // the order the rows arrived in. They come back newest by `created_at`
      // first, which is whole seconds — the very thing the mark is an id to
      // avoid depending on.
      throughFeedbackId: Math.max(...arrived.map((one) => one.id)),
      sentAt: toTheSecond(now),
    })
    .run();

  return { outcome: "sent", feedbackCount: arrived.length };
}

/**
 * The high edge of the last digest, or zero if there has never been one.
 *
 * Zero rather than *the beginning of time* is the same statement said in the
 * column's own terms: ids start at one, so `id > 0` is every Feedback there
 * has ever been, which is exactly what the first digest ever sent should
 * carry.
 */
function lastDigestThrough(database: AppDatabase): number {
  const mark = database
    .select({ through: max(feedbackDigest.throughFeedbackId) })
    .from(feedbackDigest)
    .get();

  return mark?.through ?? 0;
}

/**
 * The email itself: the words, in full, and where to go about them.
 *
 * The whole text of every Feedback, never a snippet. The digest exists so
 * that the Admin has read the complaint by the time they open the page, and
 * a truncated one is a complaint whose ending they never read — the same
 * reason nothing truncates on the way in.
 *
 * Newest first, matching the inbox, so that what the Admin skimmed in the
 * morning is in the order they will find it in when they get there.
 *
 * One number and one link, and nothing else around them: what arrived. A
 * second count — how many are waiting in the queue altogether — was left
 * out on purpose, because two numbers in one email is a small report, and
 * the page it links to is where a report belongs.
 */
function digestEmail(arrived: FeedbackInInbox[], now: Date): EmailMessage {
  const inbox = new URL("/admin/feedback", appUrl()).toString();
  const heading = countOf(arrived.length);

  return {
    from: MAIL_FROM,
    replyTo: MAIL_REPLY_TO,
    to: MAIL_ADMIN,
    subject: `Launch Tasks: ${heading}`,
    text: [
      `${heading} arrived since the last digest. It is ${asPlainDate(now)}.`,
      "",
      ...arrived.flatMap((one) => [...asText(one), ""]),
      `Answer them in the admin panel: ${inbox}`,
    ].join("\n"),
    html: [
      `<p>${heading} arrived since the last digest. It is ${asPlainDate(now)}.</p>`,
      ...arrived.flatMap(asHtml),
      `<p><a href="${inbox}">Answer them in the admin panel</a></p>`,
    ].join("\n"),
  };
}

/** *1 piece of feedback*, never *1 pieces*. The Admin reads this every day. */
function countOf(howMany: number): string {
  return howMany === 1 ? "1 piece of feedback" : `${howMany} pieces of feedback`;
}

/**
 * Who sent it and where they were, as one line above the words.
 *
 * The address is on it because replying is the Admin writing back by hand
 * from their own mail client — there is no reply path in the product, and
 * this email is as close as one gets. A Feedback whose author has since left
 * says so rather than showing a blank, because *nobody to reply to* is a
 * fact about what the Admin can do next.
 */
function provenance(one: FeedbackInInbox): string {
  const who = one.authorEmail ?? "the author's account is gone";
  const where = one.taskTitle ? `${one.taskTitle} — ${one.pagePath}` : one.pagePath;

  return `${who} · ${where}`;
}

function asText(one: FeedbackInInbox): string[] {
  return [provenance(one), one.text];
}

function asHtml(one: FeedbackInInbox): string[] {
  // Every part of a Feedback except the path is free text somebody typed,
  // and this is the one place it stops being inert.
  return [
    `<p><strong>${escapeHtml(provenance(one))}</strong><br>`,
    `${escapeHtml(one.text).replaceAll("\n", "<br>")}</p>`,
  ];
}
