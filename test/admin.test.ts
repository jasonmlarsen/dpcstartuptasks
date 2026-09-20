import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import { practice, user } from "~/database/schema";
import { GRACE_PERIOD_DAYS } from "~/practice/deletion";
import {
  createTestApp,
  promoteToAdmin,
  signInAs,
  type TestApp,
} from "./harness";

/**
 * Seam 1, on the admin panel's shell and the Practices dashboard.
 *
 * Two things are under test, and the first is a boundary rather than a
 * screen: `/admin` is at a guessable address on a public host, so what a
 * physician, a Member and a stranger get from it has to be the answer an
 * unserved address gives — not a redirect, not a 403, and not a page that
 * is merely empty. The tests that matter most here are the refusals.
 *
 * The second is the dashboard, where the load-bearing assertion is a
 * negative one: a Practice in its Grace Period appears with its metadata
 * and **none of its contents**, because that is what makes the thirty days
 * a boundary and not a delay.
 *
 * Support View is #40 and nothing here asserts anything about entering a
 * Practice; the Library, System and Feedback sections are stubs on purpose
 * and are tested only as far as being four navigable sections.
 */

const ADMIN = "operator@directcaretools.com";
const OWNER = "dr.reed@example.com";
const MEMBER = "jamie.reed@example.com";
const PRACTICE_NAME = "Reed Direct Care";

const DAY = 24 * 60 * 60 * 1000;

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

/**
 * The page a browser renders: the body, without the streaming payload.
 *
 * Neither the payload nor the `<head>` is part of what a refusal could
 * give away. React Router ships its route manifest in a `<script>` on every
 * response and preloads the modules a URL matched, so a 404 from `/admin`
 * and a 404 from an address that was never a page differ in their head
 * whatever the loader does — and they differ in a fact that is already
 * public, since the client build of every page in the app names every
 * route in it. What a refusal must not reveal is anything about whether
 * this reader would have been let in, and that is the body.
 */
async function markup(response: Response): Promise<string> {
  const document = (await response.text())
    .replaceAll("<!-- -->", "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/g, "");

  return document.slice(document.indexOf("<body>"));
}

/** The same again as plain words, for reading a sentence off the page. */
async function readable(response: Response): Promise<string> {
  return (await markup(response))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function post(body: Record<string, string>): RequestInit {
  return {
    method: "post",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  };
}

/**
 * Sign in the way everyone signs in, then run the statement the operator
 * runs on the VPS. There is no other way to become the Admin.
 */
async function signInAsAdmin(app: TestApp): Promise<void> {
  await signInAs(app, ADMIN);
  promoteToAdmin(app, ADMIN);
}

/** A Practice with a name, a state and an Owner who has skipped the Wizard. */
async function registerPractice(
  app: TestApp,
  email: string,
  name: string,
  state = "Idaho",
): Promise<void> {
  await signInAs(app, email);
  await app.fetch(
    "/settings",
    post({ intent: "practice", practiceName: name, state, displayName: "" }),
  );
}

const EVERY_ADMIN_PATH = [
  "/admin",
  "/admin/library",
  "/admin/system",
  "/admin/feedback",
];

describe("who may reach the admin panel", () => {
  it("lets the Admin in", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const response = await app.fetch("/admin");

    expect(response.status).toBe(200);
    expect(await readable(response)).toContain("Launch Tasks admin");
  });

  it("refuses a physician with the answer an unserved address gives", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    // The body of a real 404, fetched from an address that has never been a
    // page, is the yardstick: the refusal is not merely *a* 404, it is
    // indistinguishable from the panel not being there.
    const unserved = await markup(await app.fetch("/not-a-page-at-all"));

    for (const path of EVERY_ADMIN_PATH) {
      const response = await app.fetch(path);
      expect(response.status).toBe(404);
      expect(await markup(response)).toBe(unserved);
    }
  });

  it("refuses a Member the same way", async () => {
    const app = newApp();
    await registerPractice(app, OWNER, PRACTICE_NAME);
    await app.fetch(
      "/settings",
      post({ intent: "invite", email: MEMBER, yourName: "Dr Alex Reed" }),
    );
    app.clearCookies();
    await signInAs(app, MEMBER);

    const response = await app.fetch("/admin");

    expect(response.status).toBe(404);
  });

  it("refuses a visitor with no session, and never sends them to sign in", async () => {
    const app = newApp();

    for (const path of EVERY_ADMIN_PATH) {
      const response = await app.fetch(path);
      expect(response.status).toBe(404);
      // A redirect would be the panel announcing itself: *there is something
      // here, and you are not it*.
      expect(response.headers.get("Location")).toBeNull();
    }
  });

  it("refuses the Admin once their role is taken away again", async () => {
    const app = newApp();
    await signInAsAdmin(app);
    expect((await app.fetch("/admin")).status).toBe(200);

    // The same statement in reverse, and the same session. The role is read
    // from the database on every request, so demotion lands on the next one.
    app.database.update(user).set({ role: null }).where(eq(user.email, ADMIN)).run();

    expect((await app.fetch("/admin")).status).toBe(404);
  });
});

describe("there is no way to become the Admin from a browser", () => {
  /**
   * The spec's reason for never mounting `auth.handler` (ADR-0004) stops
   * being abstract once the `admin` plugin is installed: a catch-all would
   * expose `set-role`, `ban-user` and `impersonate-user` at guessable
   * addresses, and `set-role` is precisely the promotion UI the panel is
   * built without. So this asserts the endpoints are unreachable rather
   * than trusting that nobody adds a route later.
   */
  const PLUGIN_ENDPOINTS = [
    "/api/auth/admin/set-role",
    "/api/auth/admin/impersonate-user",
    "/api/auth/admin/ban-user",
    "/api/auth/admin/list-users",
  ];

  it("serves none of the admin plugin's own endpoints", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    for (const endpoint of PLUGIN_ENDPOINTS) {
      const asked = await app.fetch(endpoint, post({ role: "admin" }));
      expect(asked.status).toBe(404);

      const read = await app.fetch(endpoint);
      expect(read.status).toBe(404);
    }
  });

  it("leaves every registered User without a role", async () => {
    const app = newApp();
    await registerPractice(app, OWNER, PRACTICE_NAME);

    const owner = app.database
      .select({ role: user.role })
      .from(user)
      .where(eq(user.email, OWNER))
      .get();

    // The plugin stamps its `defaultRole` on every User it creates, and that
    // default is `user` — which is to say, not the Admin. Registration has no
    // opinion about roles and must never acquire one.
    expect(owner?.role).toBe("user");
  });
});

describe("the four sections", () => {
  it("are all navigable from the shell", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const page = await markup(await app.fetch("/admin"));

    expect(page).toContain('href="/admin"');
    expect(page).toContain('href="/admin/library"');
    expect(page).toContain('href="/admin/system"');
    expect(page).toContain('href="/admin/feedback"');
  });

  it("are flat, and the three that are not built say so", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    for (const path of ["/admin/library", "/admin/system", "/admin/feedback"]) {
      const response = await app.fetch(path);
      expect(response.status).toBe(200);
      expect(await readable(response)).toContain("Not built yet.");
    }
  });

  it("does not offer the Admin the physician's Send feedback item", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    expect(await readable(await app.fetch("/admin"))).not.toContain(
      "Send feedback",
    );
  });
});

describe("the Practices dashboard", () => {
  it("lists an Active Practice with its metadata", async () => {
    const app = newApp();
    await registerPractice(app, OWNER, PRACTICE_NAME, "Montana");
    app.clearCookies();
    await signInAsAdmin(app);

    const page = await readable(await app.fetch("/admin"));

    expect(page).toContain(PRACTICE_NAME);
    expect(page).toContain("Montana");
    expect(page).toContain("1 person");
  });

  it("names a Practice its Owner never named, rather than showing a blank", async () => {
    const app = newApp();
    await signInAs(app, OWNER);
    app.clearCookies();
    await signInAsAdmin(app);

    expect(await readable(await app.fetch("/admin"))).toContain(
      "Unnamed practice",
    );
  });

  it("counts everyone in a Practice", async () => {
    const app = newApp();
    await registerPractice(app, OWNER, PRACTICE_NAME);
    await app.fetch(
      "/settings",
      post({ intent: "invite", email: MEMBER, yourName: "Dr Alex Reed" }),
    );
    app.clearCookies();
    await signInAs(app, MEMBER);
    app.clearCookies();
    await signInAsAdmin(app);

    expect(await readable(await app.fetch("/admin"))).toContain("2 people");
  });

  it("moves a deleted Practice out of Active and into the deleted list", async () => {
    const app = newApp();
    await registerPractice(app, OWNER, PRACTICE_NAME);
    await app.fetch("/settings", post({ intent: "delete-practice" }));
    app.clearCookies();
    await signInAsAdmin(app);

    const page = await readable(await app.fetch("/admin"));

    // The Admin's own Practice is the one left in Active — they signed in the
    // way everyone does, so they have one.
    expect(page).toContain("Active (1)");
    expect(page).toContain("Deleted (1)");
    expect(page).toContain(PRACTICE_NAME);
    expect(page).toContain("Deleted ");
  });

  it("says when a deleted Practice is due to be purged", async () => {
    const app = newApp();
    await registerPractice(app, OWNER, PRACTICE_NAME);
    await app.fetch("/settings", post({ intent: "delete-practice" }));

    const deleted = app.database
      .select({ deletedAt: practice.deletedAt })
      .from(practice)
      .where(eq(practice.name, PRACTICE_NAME))
      .get();
    const due = new Date(
      (deleted?.deletedAt?.getTime() ?? 0) + GRACE_PERIOD_DAYS * DAY,
    );

    app.clearCookies();
    await signInAsAdmin(app);

    const page = await readable(await app.fetch("/admin"));

    expect(page).toContain(
      `purge due ${due.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}`,
    );
  });

  it("says so when the Grace Period has already run out", async () => {
    const app = newApp();
    await registerPractice(app, OWNER, PRACTICE_NAME);
    await app.fetch("/settings", post({ intent: "delete-practice" }));

    // Purge is #42 and does not exist, so a Practice deleted forty days ago
    // is still sitting in this list. The page has to be honest about it.
    app.database
      .update(practice)
      .set({ deletedAt: new Date(Date.now() - 40 * DAY) })
      .where(eq(practice.name, PRACTICE_NAME))
      .run();

    app.clearCookies();
    await signInAsAdmin(app);

    expect(await readable(await app.fetch("/admin"))).toContain(
      "purge was due",
    );
  });

  it("shows a deleted Practice's metadata and never its contents", async () => {
    const app = newApp();
    await registerPractice(app, OWNER, PRACTICE_NAME);

    const NOTE = "Waiting on the state medical board to call back";
    const CUSTOM_TASK = "Ask the landlord about the parking spaces";

    await app.fetch(
      "/tasks/foundation-planning?task=obtain-ein-employer-identification-number",
      post({
        intent: "note",
        task: "obtain-ein-employer-identification-number",
        note: NOTE,
      }),
    );
    await app.fetch(
      "/tasks/foundation-planning",
      post({ intent: "add-custom-task", title: CUSTOM_TASK }),
    );
    await app.fetch("/settings", post({ intent: "delete-practice" }));

    app.clearCookies();
    await signInAsAdmin(app);

    const page = await readable(await app.fetch("/admin"));

    // The metadata is there, so the Admin can answer *which practice is
    // this* when an Owner writes asking for it back.
    expect(page).toContain(PRACTICE_NAME);

    // And nothing the Practice wrote is, which is the Grace Period being a
    // boundary rather than a delay.
    expect(page).not.toContain(NOTE);
    expect(page).not.toContain(CUSTOM_TASK);
  });

  it("offers no bulk edit, no email export and no per-task status", async () => {
    const app = newApp();
    await registerPractice(app, OWNER, PRACTICE_NAME);
    app.clearCookies();
    await signInAsAdmin(app);

    const page = await markup(await app.fetch("/admin"));

    // Three absences the spec names, and the fourth that follows from them:
    // a list of fifty Practices is not where anybody's email address lives.
    expect(page.toLowerCase()).not.toContain("export");
    expect(page).not.toContain("<form");
    expect(page).not.toContain('type="checkbox"');
    expect(page).not.toContain(OWNER);
  });
});
