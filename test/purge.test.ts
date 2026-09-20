import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import { purgeDeletedPractices } from "~/admin/purge";
import {
  customTask,
  feedback,
  globalTask,
  impersonationLog,
  invite,
  kitSyncJob,
  membership,
  practice,
  session,
  taskEntry,
  user,
} from "~/database/schema";
import { GRACE_PERIOD_DAYS } from "~/practice/deletion";
import { createTestApp, promoteToAdmin, signInAs, type TestApp } from "./harness";

/**
 * Seam 3, the worker seam, on the one act in this product that cannot be
 * undone.
 *
 * The function takes its dependencies as arguments and is called here
 * directly, because there is nobody to dispatch a request for: thirty days
 * after the Owner pressed delete, a scheduler runs this and the Owner is
 * long gone. Everything it destroys is put there through the real screens at
 * seam 1 — a Practice arranged by hand would be a Practice no registration
 * ever produced, and *Purge takes everything* is only worth asserting about
 * the everything a physician actually made.
 *
 * The one thing the clock is asked to do here is pass. A test cannot wait
 * thirty days, so it moves `deleted_at` backwards and asks the worker what
 * day it is — the same two edges the whole ticket rests on: **day 30 takes
 * everything, day 29 takes nothing.**
 */

const OWNER = "dr.reed@example.com";
const SPOUSE = "jamie.reed@example.com";
const STRANGER = "dr.okafor@example.com";
const ADMIN = "operator@directcaretools.com";

const OWNER_NAME = "Dr Alex Reed";
const PRACTICE_NAME = "Reed Direct Care";
const INVITEE = "manager@reeddirectcare.example";

const FOUNDATION = "/tasks/foundation-planning";
const EIN = "obtain-ein-employer-identification-number";

const DAY = 24 * 60 * 60 * 1000;

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

function post(body: Record<string, string>): RequestInit {
  return {
    method: "post",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  };
}

/** The token out of the most recent email to an address. */
function tokenIn(app: TestApp, email: string): string {
  const link = app.emailSender.linksTo(email).at(-1);
  if (!link) throw new Error(`Nothing was mailed to ${email}`);
  return new URL(link).searchParams.get("token") ?? "";
}

function signInAgainAs(app: TestApp, email: string) {
  app.clearCookies();
  return signInAs(app, email);
}

function practiceIdOf(app: TestApp, email: string): number {
  const row = app.database
    .select({ practiceId: membership.practiceId })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(eq(user.email, email))
    .get();
  if (!row) throw new Error(`${email} has no Membership`);
  return row.practiceId;
}

function userRow(app: TestApp, email: string) {
  return app.database.select().from(user).where(eq(user.email, email)).get();
}

/**
 * A Practice with everything in it a Purge is supposed to take: two people,
 * an outstanding Invite for the third, a Custom Task, a Note on a Global
 * Task, and a Feedback from each of them.
 *
 * All of it through the real screens. `deleted` presses the Danger Zone at
 * the end, which is how a Practice normally arrives at a Purge; the one test
 * that needs a Support View still open passes `false`, because the press is
 * exactly what would have closed it.
 */
async function aPracticeWithEverythingInIt(
  app: TestApp,
  { deleted = true }: { deleted?: boolean } = {},
): Promise<number> {
  await signInAs(app, OWNER);
  await app.fetch(
    "/settings",
    post({
      intent: "practice",
      practiceName: PRACTICE_NAME,
      state: "Idaho",
      displayName: OWNER_NAME,
    }),
  );
  await app.fetch(
    FOUNDATION,
    post({ intent: "note", taskRef: EIN, note: "Filed it on Tuesday" }),
  );
  await app.fetch(
    FOUNDATION,
    post({ intent: "add-task", title: "Call the landlord back", body: "" }),
  );
  await app.fetch(
    "/feedback",
    post({ text: "The SS-4 link goes to the wrong form.", from: FOUNDATION, task: EIN }),
  );

  // The spouse, who accepts, and the practice manager, who has not yet.
  await app.fetch(
    "/settings",
    post({
      intent: "invite",
      email: SPOUSE,
      yourName: OWNER_NAME,
      practiceName: PRACTICE_NAME,
    }),
  );
  const accepted = tokenIn(app, SPOUSE);
  await app.fetch(
    "/settings",
    post({
      intent: "invite",
      email: INVITEE,
      yourName: OWNER_NAME,
      practiceName: PRACTICE_NAME,
    }),
  );

  app.clearCookies();
  await app.fetch("/invite", post({ token: accepted, name: "Jamie Reed" }));
  await app.fetch("/continue", post({ token: tokenIn(app, SPOUSE) }));
  await app.fetch(
    "/feedback",
    post({ text: "We could not do this in Idaho without an office.", from: FOUNDATION, task: "" }),
  );

  const practiceId = practiceIdOf(app, OWNER);

  if (deleted) {
    await signInAgainAs(app, OWNER);
    await app.fetch("/settings", post({ intent: "delete-practice" }));
  }

  return practiceId;
}

/** Move the Owner's press to a chosen moment, which is the only clock a test has. */
function deletedOn(app: TestApp, practiceId: number, when: Date): void {
  app.database
    .update(practice)
    .set({ deletedAt: when })
    .where(eq(practice.id, practiceId))
    .run();
}

/** The same thing said in days, for the tests where the edge is not the point. */
function deletedDaysAgo(app: TestApp, practiceId: number, days: number): void {
  deletedOn(app, practiceId, new Date(Date.now() - days * DAY));
}

/** The moment the Owner pressed delete, in the tests that count from it. */
const THE_PRESS = new Date("2026-03-01T09:15:00Z");
const daysAfterThePress = (days: number) =>
  new Date(THE_PRESS.getTime() + days * DAY);

function counts(app: TestApp) {
  return {
    practices: app.database.select().from(practice).all().length,
    memberships: app.database.select().from(membership).all().length,
    taskEntries: app.database.select().from(taskEntry).all().length,
    customTasks: app.database.select().from(customTask).all().length,
    invites: app.database.select().from(invite).all().length,
    feedback: app.database.select().from(feedback).all().length,
    users: app.database.select().from(user).all().length,
  };
}

describe("the Purge at the end of the Grace Period", () => {
  it("destroys the Practice and everything in it at day 30", async () => {
    const app = newApp();
    const practiceId = await aPracticeWithEverythingInIt(app);
    deletedOn(app, practiceId, THE_PRESS);

    const purged = await purgeDeletedPractices(
      app.services,
      daysAfterThePress(GRACE_PERIOD_DAYS),
    );

    expect(purged).toEqual({ practices: 1, users: 2 });
    expect(counts(app)).toEqual({
      practices: 0,
      memberships: 0,
      taskEntries: 0,
      customTasks: 0,
      invites: 0,
      feedback: 0,
      users: 0,
    });
  });

  it("takes Feedback, and every User including the Owner", async () => {
    const app = newApp();
    const practiceId = await aPracticeWithEverythingInIt(app);

    // Both were written through the box on the page, by two different
    // people, and one of them names the state its author practises in.
    expect(app.database.select().from(feedback).all()).toHaveLength(2);

    deletedDaysAgo(app, practiceId, GRACE_PERIOD_DAYS);
    await purgeDeletedPractices(app.services);

    // Not severed and kept (ADR-0007): free text names its own author, so a
    // row stripped of its foreign keys would be de-identified only in the
    // schema. There is no row left to strip.
    expect(app.database.select().from(feedback).all()).toEqual([]);

    // The Owner goes with the Member, which is the half of *no partial
    // Purge* that is easiest to leave out: there is no account without a
    // Practice, so an Owner left behind would be an account with nothing in
    // it and no way to say so.
    expect(userRow(app, OWNER)).toBeUndefined();
    expect(userRow(app, SPOUSE)).toBeUndefined();
    expect(app.database.select().from(session).all()).toEqual([]);
  });

  it("takes nothing on day 29", async () => {
    const app = newApp();
    const practiceId = await aPracticeWithEverythingInIt(app);
    deletedOn(app, practiceId, THE_PRESS);
    const before = counts(app);

    const purged = await purgeDeletedPractices(
      app.services,
      daysAfterThePress(GRACE_PERIOD_DAYS - 1),
    );

    expect(purged).toEqual({ practices: 0, users: 0 });
    expect(counts(app)).toEqual(before);
    expect(userRow(app, OWNER)).toBeDefined();
  });

  it("leaves a Practice nobody deleted entirely alone", async () => {
    const app = newApp();
    const practiceId = await aPracticeWithEverythingInIt(app);
    await signInAgainAs(app, STRANGER);
    deletedDaysAgo(app, practiceId, GRACE_PERIOD_DAYS);

    const purged = await purgeDeletedPractices(app.services);

    expect(purged).toEqual({ practices: 1, users: 2 });
    expect(app.database.select().from(practice).all()).toHaveLength(1);
    expect(userRow(app, STRANGER)).toBeDefined();
    // Their 98 Task Entries, and not a row fewer.
    expect(app.database.select().from(taskEntry).all()).toHaveLength(
      app.database.select().from(globalTask).all().length,
    );
  });

  it("leaves the Task Library untouched", async () => {
    const app = newApp();
    const practiceId = await aPracticeWithEverythingInIt(app);
    const library = app.database.select().from(globalTask).all().length;
    deletedDaysAgo(app, practiceId, GRACE_PERIOD_DAYS);

    await purgeDeletedPractices(app.services);

    expect(app.database.select().from(globalTask).all()).toHaveLength(library);
  });

  it("ends an in-flight Support View on that Practice with `purged`", async () => {
    const app = newApp();
    // Never through the Danger Zone: the Owner's press is what would have
    // closed this view already, with `practice_deleted`. What is left is the
    // Grace Period running out underneath a view that is still open, and the
    // Admin is owed one of the four sentences for it.
    const practiceId = await aPracticeWithEverythingInIt(app, { deleted: false });

    app.clearCookies();
    await signInAs(app, ADMIN);
    promoteToAdmin(app, ADMIN);
    await app.fetch("/admin?index", post({ practiceId: String(practiceId) }));

    const open = app.database.select().from(impersonationLog).all();
    expect(open).toHaveLength(1);
    expect(open[0].endedAt).toBeNull();

    deletedDaysAgo(app, practiceId, GRACE_PERIOD_DAYS);
    await purgeDeletedPractices(app.services);

    const [row] = app.database.select().from(impersonationLog).all();
    expect(row).toMatchObject({ endedReason: "purged", practiceId });
    expect(row.endedAt).not.toBeNull();

    // The row outlives its subject: `impersonation_log` has no foreign keys
    // precisely so that the one disclosure the privacy policy promises is
    // not destroyed by the thing it is a record of.
    expect(userRow(app, OWNER)).toBeUndefined();
  });

  it("names the view even when there is nobody left in the Practice", async () => {
    const app = newApp();
    const practiceId = await aPracticeWithEverythingInIt(app, { deleted: false });

    app.clearCookies();
    await signInAs(app, ADMIN);
    promoteToAdmin(app, ADMIN);
    await app.fetch("/admin?index", post({ practiceId: String(practiceId) }));

    // A run that died between its two writes: the Users are gone and the
    // Practice is still standing, which is the state the worker is built to
    // be resumable through. There is no Membership left to enumerate, so a
    // Purge that closed views by person would leave this row open forever.
    app.database.delete(membership).where(eq(membership.practiceId, practiceId)).run();
    deletedDaysAgo(app, practiceId, GRACE_PERIOD_DAYS);

    const purged = await purgeDeletedPractices(app.services);

    expect(purged).toEqual({ practices: 1, users: 0 });
    expect(
      app.database.select().from(practice).where(eq(practice.id, practiceId)).all(),
    ).toEqual([]);
    expect(app.database.select().from(impersonationLog).all()[0]).toMatchObject({
      endedReason: "purged",
    });
  });

  it("never calls Kit", async () => {
    const app = newApp();
    const practiceId = await aPracticeWithEverythingInIt(app);

    // Registration queued a Kit Sync Job for each of them, which is exactly
    // the state a Purge could be tempted to tidy up over at Kit.
    expect(app.database.select().from(kitSyncJob).all().length).toBeGreaterThan(0);
    const before = app.kitClient.calls.length;

    deletedDaysAgo(app, practiceId, GRACE_PERIOD_DAYS);
    await purgeDeletedPractices(app.services);

    // A purged physician still gets the newsletter, correctly: they
    // consented to a separate relationship and leave it through the
    // unsubscribe link, never through deleting a Practice.
    expect(app.kitClient.calls).toHaveLength(before);
    // The queued jobs go, because a purged User has no fact left to tell
    // Kit — that is the cascade, and it is not a Kit call.
    expect(app.database.select().from(kitSyncJob).all()).toEqual([]);
  });

  it("finds nothing to do on the next run", async () => {
    const app = newApp();
    const practiceId = await aPracticeWithEverythingInIt(app);
    deletedDaysAgo(app, practiceId, GRACE_PERIOD_DAYS);

    await purgeDeletedPractices(app.services);
    const again = await purgeDeletedPractices(app.services);

    expect(again).toEqual({ practices: 0, users: 0 });
  });
});
