import { describe, expect, it, onTestFinished } from "vitest";

import { sendFeedbackDigest } from "~/admin/feedback-digest";
import { feedbackDigest } from "~/database/schema";
import {
  MAIL_ADMIN,
  MAIL_FROM,
  MAIL_REPLY_TO,
  type EmailMessage,
  type EmailSender,
  type SentEmail,
} from "~/services/email-sender";
import { FakeEmailSender } from "./fakes/fake-email-sender";
import { createTestApp, signInAs, type TestApp } from "./harness";

/**
 * Seam 3, the worker seam, on the one email nobody asked to receive.
 *
 * The function takes its database and its sender as arguments and is called
 * here directly, because there is no request to dispatch: a scheduler runs
 * it, not a physician. The Feedback it carries is put there through the real
 * box at seam 1 — arranging rows by hand would be arranging a state no
 * physician can produce, and the whole point of the digest is that it
 * carries what physicians actually sent.
 *
 * Two assertions are load-bearing rather than thorough. **Never sent empty**
 * is what stops the one person who reads this from learning to ignore it.
 * **Exactly the window since the last one** is what makes the thirty-day
 * Grace Period a real window, which is what makes Purge destroying Feedback
 * acceptable (ADR-0007) — a digest that dropped a Feedback would quietly
 * change what Purge costs.
 */

const PHYSICIAN = "dr.reed@example.com";
const OTHER_PHYSICIAN = "dr.okafor@example.com";

const FOUNDATION = "/tasks/foundation-planning";
const EIN = "obtain-ein-employer-identification-number";
const EIN_TITLE = "Obtain EIN";

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

/**
 * A sender of the digest's own, separate from the app's.
 *
 * So that *nothing was sent* is literally an empty list, rather than the
 * absence of one message among the sign-in links every test mails on its way
 * in.
 */
function digestSender(): FakeEmailSender {
  return new FakeEmailSender();
}

/** Send one Feedback as a physician, through the real box. */
async function send(
  app: TestApp,
  written: { text: string; from?: string; task?: string },
): Promise<void> {
  await app.fetch("/feedback", {
    method: "post",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      text: written.text,
      from: written.from ?? FOUNDATION,
      task: written.task ?? "",
    }),
  });
}

/** The one message the digest sent, or a failure saying it sent none. */
function theDigest(sender: FakeEmailSender): EmailMessage {
  expect(sender.sent).toHaveLength(1);
  return sender.sent[0];
}

describe("the Feedback Digest", () => {
  it("is never sent empty", async () => {
    const app = newApp();
    const mail = digestSender();

    const ran = await sendFeedbackDigest(app.database, mail);

    expect(ran).toEqual({ outcome: "nothing-new" });
    expect(mail.sent).toEqual([]);
    // No row either: a day that added nothing to cover is not a day covered.
    expect(app.database.select().from(feedbackDigest).all()).toEqual([]);
  });

  it("is never sent empty on a day when nothing new arrived", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });

    const yesterday = digestSender();
    await sendFeedbackDigest(app.database, yesterday);
    expect(yesterday.sent).toHaveLength(1);

    const today = digestSender();
    const ran = await sendFeedbackDigest(app.database, today);

    expect(ran).toEqual({ outcome: "nothing-new" });
    expect(today.sent).toEqual([]);
  });

  it("covers exactly the window since the last one", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });
    await send(app, { text: "The license fee is out of date." });

    const yesterday = digestSender();
    const first = await sendFeedbackDigest(app.database, yesterday);

    expect(first).toEqual({ outcome: "sent", feedbackCount: 2 });
    expect(theDigest(yesterday).text).toContain("The SS-4 link goes to the wrong form.");
    expect(theDigest(yesterday).text).toContain("The license fee is out of date.");

    await send(app, { text: "This body says nothing about a sole proprietor." });

    const today = digestSender();
    const second = await sendFeedbackDigest(app.database, today);

    expect(second).toEqual({ outcome: "sent", feedbackCount: 1 });
    expect(theDigest(today).text).toContain(
      "This body says nothing about a sole proprietor.",
    );
    // Neither of yesterday's is in it: no Feedback is in two digests.
    expect(theDigest(today).text).not.toContain("The SS-4 link");
    expect(theDigest(today).text).not.toContain("The license fee");
  });

  it("carries everything that ever arrived, the first time it runs", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });
    await signInAs(app, OTHER_PHYSICIAN);
    await send(app, { text: "The license fee is out of date." });

    const mail = digestSender();
    const ran = await sendFeedbackDigest(app.database, mail);

    expect(ran).toEqual({ outcome: "sent", feedbackCount: 2 });
    expect(theDigest(mail).text).toContain("The SS-4 link goes to the wrong form.");
    expect(theDigest(mail).text).toContain("The license fee is out of date.");
  });

  it("goes to the Admin's own address, and to nobody else", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });

    const mail = digestSender();
    await sendFeedbackDigest(app.database, mail);

    const message = theDigest(mail);
    expect(message.to).toBe(MAIL_ADMIN);
    expect(message.from).toBe(MAIL_FROM);
    expect(message.replyTo).toBe(MAIL_REPLY_TO);
    // Not to the physician who sent it: there is no reply path in the product.
    expect(mail.lastTo(PHYSICIAN)).toBeUndefined();
  });

  it("is dated by the day it was run, and not by the clock", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });

    const mail = digestSender();
    const march = new Date("2026-03-03T06:00:00.000Z");
    await sendFeedbackDigest(app.database, mail, march);

    expect(theDigest(mail).text).toContain("3 March 2026");
    expect(theDigest(mail).html).toContain("3 March 2026");
    // And the row says when it went, for an operator reading the log.
    const [row] = app.database.select().from(feedbackDigest).all();
    expect(row.sentAt).toEqual(march);
  });

  it("says who sent it, where they were, and what they were reading", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, {
      text: "This body says nothing about a sole proprietor.",
      from: `${FOUNDATION}?task=${EIN}`,
      task: EIN,
    });

    const mail = digestSender();
    await sendFeedbackDigest(app.database, mail);

    const message = theDigest(mail);
    expect(message.text).toContain(PHYSICIAN);
    expect(message.text).toContain(`${FOUNDATION}?task=${EIN}`);
    expect(message.text).toContain(EIN_TITLE);
    // Somewhere to go about it, in both parts.
    expect(message.text).toContain("/admin/feedback");
    expect(message.html).toContain("/admin/feedback");
  });

  it("carries the whole of a complaint, never a snippet of one", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    const long = `The SS-4 link is wrong. ${"And here is the rest of it. ".repeat(100)}`;
    await send(app, { text: long });

    const mail = digestSender();
    await sendFeedbackDigest(app.database, mail);

    expect(theDigest(mail).text).toContain(long.trim());
  });

  it("counts one piece of feedback as one", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });

    const mail = digestSender();
    await sendFeedbackDigest(app.database, mail);

    expect(theDigest(mail).subject).toBe("Launch Tasks: 1 piece of feedback");
  });

  it("leaves free text inert in the HTML part", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "<script>alert('the ein task')</script>" });

    const mail = digestSender();
    await sendFeedbackDigest(app.database, mail);

    const message = theDigest(mail);
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
  });

  it("leaves the window open when the send fails", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });

    await expect(
      sendFeedbackDigest(app.database, refusingSender()),
    ).rejects.toThrow("Resend is down");
    expect(app.database.select().from(feedbackDigest).all()).toEqual([]);

    // Tomorrow carries it instead of losing it, which is the one direction
    // this is allowed to fail in.
    const tomorrow = digestSender();
    const ran = await sendFeedbackDigest(app.database, tomorrow);

    expect(ran).toEqual({ outcome: "sent", feedbackCount: 1 });
    expect(theDigest(tomorrow).text).toContain(
      "The SS-4 link goes to the wrong form.",
    );
  });
});

/** A sender that cannot send, which is what an outage looks like from here. */
function refusingSender(): EmailSender {
  return {
    async send(): Promise<SentEmail> {
      throw new Error("Resend is down");
    },
  };
}
