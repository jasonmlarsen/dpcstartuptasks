import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  customTask,
  feedback,
  globalTask,
  membership,
  phase,
  user,
} from "~/database/schema";
import { createTestApp, signInAs, type TestApp } from "./harness";

/**
 * Seam 1, on the one free-text box in the product.
 *
 * What a physician can observe is the item in the appbar wherever they are,
 * a box with no dropdown in it, and a line telling them it was sent. What
 * the Admin can observe is the row: the words, the page, the Task, and the
 * title as it read at the time. Both are asserted here, because a Feedback
 * that is confirmed and not stored and a Feedback that is stored without
 * its page are each the whole feature failing quietly.
 */

const PHYSICIAN = "dr.reed@example.com";
const OTHER_PHYSICIAN = "dr.okafor@example.com";
const MEMBER = "nurse.hale@example.com";

const FOUNDATION = "/tasks/foundation-planning";
const EIN = "obtain-ein-employer-identification-number";

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

async function readable(response: Response): Promise<string> {
  return (await response.text()).replaceAll("<!-- -->", "");
}

async function page(app: TestApp, path: string): Promise<string> {
  return readable(await app.fetch(path));
}

/** Press Send, the way the form posts it. */
async function send(
  app: TestApp,
  written: { text: string; from?: string; task?: string },
): Promise<Response> {
  return app.fetch("/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      text: written.text,
      from: written.from ?? "/tasks/foundation-planning",
      task: written.task ?? "",
    }),
  });
}

function rowsSentBy(app: TestApp, email: string) {
  return app.database
    .select()
    .from(feedback)
    .innerJoin(user, eq(feedback.authorUserId, user.id))
    .where(eq(user.email, email))
    .all()
    .map((joined) => joined.feedback);
}

function practiceIdOf(app: TestApp, email: string): number {
  const row = app.database
    .select({ practiceId: membership.practiceId })
    .from(membership)
    .innerJoin(user, eq(membership.userId, user.id))
    .where(eq(user.email, email))
    .get();
  if (!row) throw new Error(`${email} has no Membership`);
  return row.practiceId;
}

function globalTaskIdOf(app: TestApp, slug: string): number {
  const row = app.database
    .select({ id: globalTask.id })
    .from(globalTask)
    .where(eq(globalTask.slug, slug))
    .get();
  if (!row) throw new Error(`No Global Task with the slug ${slug}`);
  return row.id;
}

function insertCustomTask(app: TestApp, email: string, title: string): number {
  const foundation = app.database
    .select({ id: phase.id })
    .from(phase)
    .where(eq(phase.name, "Foundation & Planning"))
    .get();

  return app.database
    .insert(customTask)
    .values({
      practiceId: practiceIdOf(app, email),
      phaseId: foundation!.id,
      title,
      body: "",
    })
    .returning({ id: customTask.id })
    .get().id;
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

/**
 * Invite someone in and leave them signed in, exactly as an invitee
 * arrives: the Owner's invite box, the link, the one button, the Sign-in
 * Link that follows.
 */
async function signInAsMember(app: TestApp, member: string): Promise<void> {
  await app.fetch(
    "/settings",
    post({
      intent: "invite",
      email: member,
      yourName: "Dr. Reed",
      practiceName: "Reed Family Care",
    }),
  );

  const inviteToken = tokenIn(app, member);
  app.clearCookies();
  await app.fetch(`/invite?token=${inviteToken}`);
  await app.fetch("/invite", post({ token: inviteToken, name: "Nurse Hale" }));
  await app.fetch("/continue", post({ token: tokenIn(app, member) }));
}

describe("the Send feedback item", () => {
  it("is in the appbar on the list, carrying the page and the Task", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).toContain("Send feedback");
    expect(open).toContain(
      `/feedback?from=${encodeURIComponent(`${FOUNDATION}?task=${EIN}`)}`,
    );
    expect(open).toContain(`task=${EIN}`);
  });

  it("is on settings too, and on every page behind the door", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    expect(await page(app, "/settings")).toContain("Send feedback");
    expect(await page(app, `${FOUNDATION}`)).toContain("Send feedback");
  });

  it("is there for a Member, not only the Owner", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await signInAsMember(app, MEMBER);

    expect(await page(app, FOUNDATION)).toContain("Send feedback");
  });

  it("sends a visitor with no session to the door", async () => {
    const app = newApp();

    const response = await app.fetch("/feedback");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/sign-in");
  });
});

describe("the form", () => {
  it("is a box and a send button, with no category to choose", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const form = await page(app, "/feedback");

    expect(form).toContain("<textarea");
    expect(form).not.toContain("<select");
  });

  it("names the Task it is carrying, so nothing is sent unseen", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const form = await page(
      app,
      `/feedback?from=${encodeURIComponent(`${FOUNDATION}?task=${EIN}`)}&task=${EIN}`,
    );

    expect(form).toContain("Obtain EIN");
  });
});

describe("sending one", () => {
  it("stores the words, the page and the Task, and says so", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await send(app, {
      text: "The SS-4 link goes to the wrong form.",
      from: `${FOUNDATION}?task=${EIN}`,
      task: EIN,
    });

    const [row] = rowsSentBy(app, PHYSICIAN);
    expect(row.text).toBe("The SS-4 link goes to the wrong form.");
    // The page as a person can read it and paste it, never a route name.
    expect(row.pagePath).toBe(`${FOUNDATION}?task=${EIN}`);
    expect(row.globalTaskId).toBe(globalTaskIdOf(app, EIN));
    expect(row.taskTitle).toContain("Obtain EIN");
    expect(row.practiceId).toBe(practiceIdOf(app, PHYSICIAN));
    // Created New. Done is the Admin's act, and there is nothing else.
    expect(row.doneAt).toBeNull();

    const sent = await readable(await app.fetch(response.headers.get("Location")!));
    expect(sent).toContain("Thank you");
    // No thread and no reply path: the confirmation is a sentence, and
    // there is nothing on it to write a second message into.
    expect(sent).not.toContain("<textarea");
  });

  it("carries no Task when none was open", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await send(app, { text: "The phase rail scrolls oddly.", from: "/settings" });

    const [row] = rowsSentBy(app, PHYSICIAN);
    expect(row.pagePath).toBe("/settings");
    expect(row.globalTaskId).toBeNull();
    expect(row.taskTitle).toBeNull();
  });

  it("keeps the title it was sent with when the Admin edits the Task", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "This title is wrong.", task: EIN });

    app.database
      .update(globalTask)
      .set({ title: "Get your EIN from the IRS" })
      .where(eq(globalTask.slug, EIN))
      .run();

    const [row] = rowsSentBy(app, PHYSICIAN);
    expect(row.taskTitle).toContain("Obtain EIN");
  });

  it("keeps the title of a Custom Task that has since been deleted", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    const id = insertCustomTask(app, PHYSICIAN, "Ask the landlord about parking");

    await send(app, { text: "Adding a task lost my note.", task: `custom-${id}` });
    app.database.delete(customTask).where(eq(customTask.id, id)).run();

    const [row] = rowsSentBy(app, PHYSICIAN);
    expect(row.taskTitle).toBe("Ask the landlord about parking");
    // A Custom Task is nothing the Task Library knows about, so there is no
    // FK for it — the snapshot is the whole of what survives.
    expect(row.globalTaskId).toBeNull();
  });

  it("outlives the Member who wrote it, having lost only their address", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await signInAsMember(app, MEMBER);
    await send(app, { text: "This phase is in the wrong order." });

    // Leaving deletes a Member's account outright, and must not take a
    // Feedback with it: only a Purge destroys one.
    await app.fetch("/settings", post({ intent: "leave" }));

    const rows = app.database.select().from(feedback).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("This phase is in the wrong order.");
    expect(rows[0].practiceId).toBe(practiceIdOf(app, PHYSICIAN));
    // The person is gone, so the address the Admin would reply to is too.
    expect(rows[0].authorUserId).toBeNull();
  });

  it("names no Task at all for another Practice's Custom Task", async () => {
    const app = newApp();
    await signInAs(app, OTHER_PHYSICIAN);
    const theirs = insertCustomTask(app, OTHER_PHYSICIAN, "Okafor lease review");
    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    await send(app, { text: "Something is off.", task: `custom-${theirs}` });

    const [row] = rowsSentBy(app, PHYSICIAN);
    expect(row.taskTitle).toBeNull();
  });

  it("refuses a page path that is not a page of ours", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await send(app, { text: "Sent from nowhere.", from: "https://evil.test/x" });

    const [row] = rowsSentBy(app, PHYSICIAN);
    expect(row.pagePath).toBe("/");
  });
});

describe("the ceiling", () => {
  it("refuses more than 5,000 characters, and keeps what was typed", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await send(app, { text: "a".repeat(5001) });

    expect(rowsSentBy(app, PHYSICIAN)).toHaveLength(0);
    expect(await readable(response)).toContain("5,000");
  });

  it("takes exactly 5,000", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await send(app, { text: "a".repeat(5000) });

    expect(rowsSentBy(app, PHYSICIAN)).toHaveLength(1);
  });

  it("refuses an empty box", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await send(app, { text: "   " });

    expect(rowsSentBy(app, PHYSICIAN)).toHaveLength(0);
  });

  it("refuses the eleventh in an hour", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    for (let sent = 1; sent <= 10; sent += 1) {
      await send(app, { text: `Report number ${sent}` });
    }
    const response = await send(app, { text: "Report number 11" });

    expect(rowsSentBy(app, PHYSICIAN)).toHaveLength(10);
    expect(await readable(response)).toContain("in an hour");
  });

  it("counts only the last hour", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    const anHourAndOneMinuteAgo = new Date(Date.now() - 61 * 60 * 1000);

    for (let sent = 1; sent <= 10; sent += 1) {
      app.database
        .insert(feedback)
        .values({
          practiceId: practiceIdOf(app, PHYSICIAN),
          authorUserId: app.database
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, PHYSICIAN))
            .get()!.id,
          text: `Yesterday's report ${sent}`,
          pagePath: FOUNDATION,
          createdAt: anHourAndOneMinuteAgo,
        })
        .run();
    }

    await send(app, { text: "Today's report" });

    expect(rowsSentBy(app, PHYSICIAN)).toHaveLength(11);
  });

  it("counts one User's own sending and nobody else's", async () => {
    const app = newApp();
    await signInAs(app, OTHER_PHYSICIAN);
    for (let sent = 1; sent <= 10; sent += 1) {
      await send(app, { text: `Okafor report ${sent}` });
    }
    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    await send(app, { text: "Reed's first report" });

    expect(rowsSentBy(app, PHYSICIAN)).toHaveLength(1);
  });
});
