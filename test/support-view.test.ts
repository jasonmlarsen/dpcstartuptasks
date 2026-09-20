import { and, desc, eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  globalTask,
  impersonationLog,
  membership,
  practice,
  session,
  taskEntry,
  user,
} from "~/database/schema";
import { createTestApp, promoteToAdmin, signInAs, type TestApp } from "./harness";

/**
 * Seam 1, end to end on Support View — including the restore-the-Admin path,
 * which is the one #21 asked for by name.
 *
 * Everything here is observed the way the Admin and the Owner observe it: a
 * banner in the rendered page, a redirect's target, the Status a Task ended
 * up in, the rows in `impersonation_log` and in `session`. Nothing asserts
 * that a function was called, and nothing reaches into the auth module.
 *
 * The harness carries one cookie jar, which is one browser. A Support View
 * *is* one browser holding two sessions, so the tests that need the Owner to
 * act while the Admin is inside snapshot the jar and put it back — that is
 * two browsers, spelled the only way this harness can spell them.
 */

const ADMIN = "operator@directcaretools.com";
const OWNER = "dr.reed@example.com";
const MEMBER = "jamie.reed@example.com";
const PRACTICE_NAME = "Reed Direct Care";

const FOUNDATION = "/tasks/foundation-planning";

/**
 * Where *View as owner* posts. The Practices list is the panel's index
 * route, and an index route's action is only reachable with `?index` —
 * without it the post lands on the layout above, which has none.
 */
const ENTER = "/admin?index";
const EIN = "obtain-ein-employer-identification-number";

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

/** The page as a reader sees it, without React's interpolation markers. */
async function readable(response: Response): Promise<string> {
  return (await response.text()).replaceAll("<!-- -->", "");
}

/** One browser's cookies, so a test can put the other browser down and pick it up again. */
function browser(app: TestApp): Map<string, string> {
  return new Map(app.cookies);
}

function switchTo(app: TestApp, saved: Map<string, string>): void {
  app.cookies.clear();
  for (const [name, value] of saved) app.cookies.set(name, value);
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

function userIdOf(app: TestApp, email: string): string {
  const row = app.database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .get();
  if (!row) throw new Error(`No user ${email}`);
  return row.id;
}

function logRows(app: TestApp) {
  return app.database.select().from(impersonationLog).all();
}

function sessionsOf(app: TestApp, email: string) {
  return app.database
    .select()
    .from(session)
    .where(eq(session.userId, userIdOf(app, email)))
    .all();
}

function statusOf(app: TestApp, email: string, slug: string): string {
  const task = app.database
    .select({ id: globalTask.id })
    .from(globalTask)
    .where(eq(globalTask.slug, slug))
    .get();
  const row = app.database
    .select({ status: taskEntry.status })
    .from(taskEntry)
    .where(
      and(
        eq(taskEntry.practiceId, practiceIdOf(app, email)),
        eq(taskEntry.globalTaskId, task!.id),
      ),
    )
    .get();
  if (!row) throw new Error(`No Task Entry for ${slug}`);
  return row.status;
}

/** A named Practice with an Owner who has skipped the Wizard. */
async function registerPractice(app: TestApp, email: string): Promise<void> {
  await signInAs(app, email);
  await app.fetch(
    "/settings",
    post({
      intent: "practice",
      practiceName: PRACTICE_NAME,
      state: "Idaho",
      displayName: "",
    }),
  );
}

async function signInAsAdmin(app: TestApp): Promise<void> {
  await signInAs(app, ADMIN);
  promoteToAdmin(app, ADMIN);
}

/**
 * The whole arrangement every test below starts from: a Practice with an
 * Owner, an Admin, and the Admin inside the Practice, having pressed the
 * button on the Practices list the way the Admin presses it.
 */
async function adminEntersPractice(app: TestApp): Promise<{
  owner: Map<string, string>;
  practiceId: number;
  entered: Response;
}> {
  await registerPractice(app, OWNER);
  const owner = browser(app);
  const practiceId = practiceIdOf(app, OWNER);

  app.clearCookies();
  await signInAsAdmin(app);

  const entered = await app.fetch(ENTER, post({ practiceId: String(practiceId) }));

  return { owner, practiceId, entered };
}

describe("entering a Practice", () => {
  it("puts the Admin on the Owner's own list, writable", async () => {
    const app = newApp();
    const { entered } = await adminEntersPractice(app);

    expect(entered.status).toBe(302);
    expect(entered.headers.get("Location")).toBe("/tasks");

    // The Owner's list, not the Admin's own: the Practice name on the page
    // is the one the Owner typed into settings.
    const list = await readable(await app.fetch(FOUNDATION));
    expect(list).toContain(PRACTICE_NAME);

    // Writable, which is the whole reason Support View is not read-only:
    // the common bug is *marking done doesn't work*.
    await app.fetch(FOUNDATION, post({ taskRef: EIN, status: "done" }));
    expect(statusOf(app, OWNER, EIN)).toBe("done");
  });

  it("aims at the Owner and never at a Member", async () => {
    const app = newApp();
    await registerPractice(app, OWNER);
    await app.fetch("/settings", post({ intent: "invite", email: MEMBER }));
    const practiceId = practiceIdOf(app, OWNER);

    app.clearCookies();
    await signInAsAdmin(app);
    await app.fetch(ENTER, post({ practiceId: String(practiceId) }));

    const [row] = logRows(app);
    expect(row.targetUserId).toBe(userIdOf(app, OWNER));
  });

  it("records every view, with the hour it would run out in", async () => {
    const app = newApp();
    const before = Date.now();
    const { practiceId } = await adminEntersPractice(app);

    const rows = logRows(app);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      adminUserId: userIdOf(app, ADMIN),
      targetUserId: userIdOf(app, OWNER),
      practiceId,
      endedAt: null,
      endedReason: null,
    });

    // The unextended hour, which is Better Auth's impersonation session and
    // the number the timed-out reason is measured against.
    const hour = rows[0].expiresAt.getTime() - before;
    expect(hour).toBeGreaterThan(59 * 60 * 1000);
    expect(hour).toBeLessThanOrEqual(61 * 60 * 1000);
  });

  it("does not extend the hour, however much the Admin uses it", async () => {
    const app = newApp();
    await adminEntersPractice(app);

    const borrowed = () =>
      app.database
        .select({ expiresAt: session.expiresAt })
        .from(session)
        .where(eq(session.userId, userIdOf(app, OWNER)))
        .orderBy(desc(session.createdAt))
        .get();

    const before = borrowed()?.expiresAt;
    for (const path of [FOUNDATION, "/settings", FOUNDATION]) {
      await app.fetch(path);
    }

    // A forgotten tab must not be a standing key: the hour is measured from
    // the press and every page view afterwards leaves it where it was.
    expect(borrowed()?.expiresAt).toEqual(before);
  });

  it("leaves the Admin's own session untouched", async () => {
    const app = newApp();
    await adminEntersPractice(app);

    // `impersonateUser` borrows a session owned by the target; the Admin's
    // real one stays in the database behind the `admin_session` cookie,
    // which is what makes the rescue possible at all.
    expect(sessionsOf(app, ADMIN)).toHaveLength(1);
    expect(sessionsOf(app, OWNER)).toHaveLength(2);
  });

  it("is refused for a Practice in its Grace Period, and offers no button", async () => {
    const app = newApp();
    await registerPractice(app, OWNER);
    const practiceId = practiceIdOf(app, OWNER);
    await app.fetch("/settings", post({ intent: "delete-practice" }));

    app.clearCookies();
    await signInAsAdmin(app);

    // The deleted row carries no way in — being thrown out mid-view and
    // being unable to get back in are the same rule (ADR-0001).
    const dashboard = await readable(await app.fetch("/admin"));
    expect(dashboard).toContain("Deleted");
    expect(dashboard).not.toContain(`value="${practiceId}"`);

    const pressed = await app.fetch(ENTER, post({ practiceId: String(practiceId) }));
    expect(pressed.status).toBe(404);
    expect(logRows(app)).toHaveLength(0);
  });

  it("is refused to everyone who is not the Admin", async () => {
    const app = newApp();
    await registerPractice(app, OWNER);
    const practiceId = practiceIdOf(app, OWNER);

    const pressed = await app.fetch(ENTER, post({ practiceId: String(practiceId) }));
    expect(pressed.status).toBe(404);
    expect(logRows(app)).toHaveLength(0);
  });
});

describe("the banner", () => {
  it("is on every page, names the Practice, and cannot be dismissed", async () => {
    const app = newApp();
    await adminEntersPractice(app);

    for (const path of [FOUNDATION, "/settings", `${FOUNDATION}?task=${EIN}`]) {
      const page = await readable(await app.fetch(path));
      expect(page).toContain("Support view");
      expect(page).toContain(PRACTICE_NAME);
      // One control, and it is the one that also ends the view.
      expect(page).toContain('action="/support-view"');
      expect(page).not.toContain("Dismiss");
    }
  });

  it("survives an error page, which is where it would be missed", async () => {
    const app = newApp();
    await adminEntersPractice(app);

    // *For as long as it lasts* has to cover a 404 too. A bannerless screen
    // with a borrowed session still in the cookie jar is exactly the state
    // the banner exists to make impossible — and `/feedback` is the one
    // address the product itself refuses mid-view, so it is the one an
    // Admin actually meets.
    const refused = await app.fetch("/feedback");
    expect(refused.status).toBe(404);
    expect(await readable(refused)).toContain("Support view");

    // An address matching no route at all is the named exception: React
    // Router renders the root error boundary without ever running root's
    // middleware, so there is no session to have read and nothing to draw
    // the banner from. Pinned here so the gap is a known one rather than a
    // surprise.
    const unmatched = await app.fetch("/not-a-page-at-all");
    expect(unmatched.status).toBe(404);
    expect(await readable(unmatched)).not.toContain("Support view");
  });

  it("does not appear for a physician signed in as themselves", async () => {
    const app = newApp();
    await registerPractice(app, OWNER);

    expect(await readable(await app.fetch(FOUNDATION))).not.toContain(
      "Support view",
    );
  });

  it("stops, and lands the Admin back on the Practices list", async () => {
    const app = newApp();
    await adminEntersPractice(app);

    const stopped = await app.fetch("/support-view", post({}));

    expect(stopped.status).toBe(302);
    expect(stopped.headers.get("Location")).toBe("/admin");

    // Back as themselves, with the borrowed session gone and nothing said
    // about it: the deliberate exit is the one that explains nothing.
    const dashboard = await app.fetch("/admin");
    expect(dashboard.status).toBe(200);
    expect(await readable(dashboard)).not.toContain("Support view ended");

    expect(logRows(app)[0]).toMatchObject({ endedReason: "stopped" });
    expect(sessionsOf(app, OWNER)).toHaveLength(1);
  });

  it("has nothing to stop when no view is in progress", async () => {
    const app = newApp();
    await registerPractice(app, OWNER);

    expect((await app.fetch("/support-view", post({}))).status).toBe(404);
  });
});

describe("what the Admin can see and cannot do", () => {
  it("shows a Note, unredacted", async () => {
    const app = newApp();
    await registerPractice(app, OWNER);
    await app.fetch(
      FOUNDATION,
      post({ intent: "note", taskRef: EIN, note: "Chased the bank again", targetDate: "" }),
    );
    const practiceId = practiceIdOf(app, OWNER);

    app.clearCookies();
    await signInAsAdmin(app);
    await app.fetch(ENTER, post({ practiceId: String(practiceId) }));

    const drawer = await readable(
      await app.fetch(`${FOUNDATION}?task=${EIN}`),
    );
    expect(drawer).toContain("Chased the bank again");
  });

  it("cannot send feedback in the Owner's name", async () => {
    const app = newApp();
    await adminEntersPractice(app);

    // Hidden from the bar on every page it appears on...
    const list = await readable(await app.fetch(FOUNDATION));
    expect(list).not.toContain("Send feedback");

    // ...and refused at the page itself, because a hidden link is not the
    // same promise as *never*.
    expect((await app.fetch("/feedback")).status).toBe(404);
    expect(
      (await app.fetch("/feedback", post({ text: "Not in their name", from: FOUNDATION })))
        .status,
    ).toBe(404);
  });
});

describe("when the view ends underneath the Admin", () => {
  it("restores them onto the Practices list when the Owner deletes the Practice", async () => {
    const app = newApp();
    const { owner } = await adminEntersPractice(app);
    const inSupportView = browser(app);

    // The Owner's own browser, and the one press that guarantees the
    // collision: deleting the Practice revokes the Owner's sessions, and the
    // Admin's view is one of them.
    switchTo(app, owner);
    await app.fetch("/settings", post({ intent: "delete-practice" }));

    // No carve-out: the borrowed session went with every other one.
    expect(sessionsOf(app, OWNER)).toHaveLength(0);
    expect(logRows(app)[0]).toMatchObject({ endedReason: "practice_deleted" });
    expect(logRows(app)[0].endedAt).not.toBeNull();

    switchTo(app, inSupportView);
    const next = await app.fetch(FOUNDATION);

    expect(next.status).toBe(302);
    expect(next.headers.get("Location")).toBe("/admin?ended=practice_deleted");

    const landed = await app.fetch(next.headers.get("Location")!);
    expect(landed.status).toBe(200);
    expect(await readable(landed)).toContain(
      "the owner deleted this practice while you were viewing it",
    );
  });

  it("abandons the action that was in flight rather than replaying it", async () => {
    const app = newApp();
    const { owner } = await adminEntersPractice(app);
    const inSupportView = browser(app);

    switchTo(app, owner);
    await app.fetch("/settings", post({ intent: "delete-practice" }));

    // The Admin was pressing *mark done* to reproduce a bug in the same
    // second. A write landing under the Admin's own identity, after the
    // deletion, with no banner on screen is the one write nobody could
    // explain (ADR-0001) — so it does not land.
    switchTo(app, inSupportView);
    const inFlight = await app.fetch(FOUNDATION, post({ taskRef: EIN, status: "done" }));

    expect(inFlight.headers.get("Location")).toBe("/admin?ended=practice_deleted");
    expect(statusOf(app, OWNER, EIN)).toBe("not_started");
  });

  it("tells the Owner nothing", async () => {
    const app = newApp();
    const { owner } = await adminEntersPractice(app);

    switchTo(app, owner);
    const deleted = await app.fetch("/settings", post({ intent: "delete-practice" }));
    const landed = await app.fetch(deleted.headers.get("Location") ?? "/");

    const words = (await readable(landed)).toLowerCase();
    expect(words).not.toContain("support view");
    expect(words).not.toContain("operator was viewing");
  });

  it("says the hour ran out when it did", async () => {
    const app = newApp();
    await adminEntersPractice(app);

    // An hour passes. The borrowed session expires and is not extended, and
    // `expires_at` on the log is what lets the way back in tell this apart
    // from a session that was deleted without a reason.
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    app.database
      .update(session)
      .set({ expiresAt: anHourAgo })
      .where(eq(session.userId, userIdOf(app, OWNER)))
      .run();
    app.database
      .update(impersonationLog)
      .set({ expiresAt: anHourAgo })
      .run();

    const next = await app.fetch(FOUNDATION);

    expect(next.headers.get("Location")).toBe("/admin?ended=timed_out");
    expect(logRows(app)[0]).toMatchObject({ endedReason: "timed_out" });

    const landed = await app.fetch("/admin?ended=timed_out");
    expect(await readable(landed)).toContain("Support view timed out after an hour");
  });

  it("says as little as it honestly can when nothing named a reason", async () => {
    const app = newApp();
    await adminEntersPractice(app);

    // The borrowed session vanishes well inside the hour, with no reason
    // written. The rescue still runs; it just does not guess.
    app.database
      .delete(session)
      .where(eq(session.userId, userIdOf(app, OWNER)))
      .run();

    const next = await app.fetch(FOUNDATION);
    expect(next.headers.get("Location")).toBe("/admin?ended=unknown");

    const landed = await app.fetch("/admin?ended=unknown");
    const words = await readable(landed);
    expect(words).toContain("Support view ended.");
    expect(words).not.toContain("timed out");
  });

  it("refuses to restore anyone who is not the Admin", async () => {
    const app = newApp();
    await adminEntersPractice(app);

    // The stash is a signed cookie holding a session token, so the rescue's
    // only guard against it being a way into somebody's account is the
    // `admin` role — `stopImpersonating`'s own check cannot be used, because
    // the row carrying it is the row that was deleted (#21).
    app.database
      .update(user)
      .set({ role: null })
      .where(eq(user.email, ADMIN))
      .run();
    app.database
      .delete(session)
      .where(eq(session.userId, userIdOf(app, OWNER)))
      .run();

    const next = await app.fetch(FOUNDATION);

    expect(next.headers.get("Location")).toBe("/sign-in");
    expect((await app.fetch("/admin")).status).toBe(404);
  });

  it("does not fire while the view is still live", async () => {
    const app = newApp();
    await adminEntersPractice(app);

    const page = await app.fetch(FOUNDATION);
    expect(page.status).toBe(200);
    expect(await readable(page)).toContain("Support view");
  });
});

describe("the Practice the view was into", () => {
  it("is still in its Grace Period afterwards, contents and all", async () => {
    const app = newApp();
    const { owner, practiceId } = await adminEntersPractice(app);

    switchTo(app, owner);
    await app.fetch("/settings", post({ intent: "delete-practice" }));

    // The view ending destroys a session and nothing else: thirty days are
    // thirty days, and the log row survives whatever happens to the rest.
    const row = app.database
      .select()
      .from(practice)
      .where(eq(practice.id, practiceId))
      .get();
    expect(row?.deletedAt).not.toBeNull();
    expect(logRows(app)).toHaveLength(1);
  });
});
