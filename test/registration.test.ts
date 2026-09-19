import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import { EMAIL_CONSENT_VERSION, EMAIL_CONSENT_WORDING } from "~/consent/email-consent";
import {
  globalTask,
  membership,
  practice,
  taskEntry,
  user,
} from "~/database/schema";
import { createTestApp, type TestApp } from "./harness";

/**
 * Seam 1, on the moment an address becomes a Practice.
 *
 * Everything here is asserted the way a physician would meet it — the form
 * they fill in, the page they land on, and the rows that exist afterwards.
 * The rows are fair game at this seam and load-bearing at it: the whole of
 * ADR-0003 is a claim about which rows exist when, and a claim about rows is
 * only pinned by counting them.
 */

const PHYSICIAN = "dr.reed@example.com";
const OTHER_PHYSICIAN = "dr.okafor@example.com";

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

/**
 * Sign in the way a physician does: the registration form, the email, the
 * Continue Screen. There is no shortcut here on purpose — a fixture that
 * inserted a Practice directly would test a path nobody walks.
 */
async function signIn(
  app: TestApp,
  email: string,
  options: { emailConsent?: boolean } = {},
) {
  const { emailConsent = true } = options;

  const body = new URLSearchParams({ email });
  // An unticked checkbox is absent from the submission, which is how a
  // browser posts one and how a physician declines.
  if (emailConsent) body.set("emailConsent", "on");

  await app.fetch("/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const [link] = app.emailSender.linksTo(email);
  expect(link, "no Sign-in Link was mailed").toBeDefined();
  const token = new URL(link!).searchParams.get("token") ?? "";

  return app.fetch("/continue", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
}

/** The page as a reader sees it, without React's interpolation markers. */
async function readable(response: Response): Promise<string> {
  return (await response.text()).replaceAll("<!-- -->", "");
}

function userOf(app: TestApp, email: string) {
  return app.database.select().from(user).where(eq(user.email, email)).get();
}

function practiceOf(app: TestApp, email: string) {
  const row = app.database
    .select({ practiceId: membership.practiceId, role: membership.role })
    .from(membership)
    .innerJoin(user, eq(membership.userId, user.id))
    .where(eq(user.email, email))
    .get();
  expect(row, `${email} has no Membership`).toBeDefined();
  return row!;
}

function entriesOf(app: TestApp, email: string) {
  return app.database
    .select()
    .from(taskEntry)
    .where(eq(taskEntry.practiceId, practiceOf(app, email).practiceId))
    .all();
}

describe("the first time an address signs in", () => {
  it("creates a Practice, an Owner Membership and a Task Entry for every Task", async () => {
    const app = newApp();

    await signIn(app, PHYSICIAN);

    expect(app.database.select().from(practice).all()).toHaveLength(1);

    const theirs = practiceOf(app, PHYSICIAN);
    expect(theirs.role).toBe("owner");

    // Every Published Global Task, and nothing else. Read off the library
    // rather than written down, so the number stays true when the CSV grows.
    const tasks = app.database.select().from(globalTask).all();
    expect(tasks).toHaveLength(98);
    expect(entriesOf(app, PHYSICIAN)).toHaveLength(tasks.length);
  });

  it("gives every Entry a Status, and no Entry a Newly Added flag", async () => {
    const app = newApp();
    await signIn(app, PHYSICIAN);

    for (const entry of entriesOf(app, PHYSICIAN)) {
      expect(entry.status).toBe("not_started");
      expect(entry.note).toBeNull();
      expect(entry.targetDate).toBeNull();
      // Tasks present when the Practice was created are never Newly Added, so
      // a brand-new Practice does not open to ninety-eight New pills.
      expect(entry.announcedAt).toBeNull();
    }
  });

  it("lands on a page that says the list is there", async () => {
    const app = newApp();

    const continued = await signIn(app, PHYSICIAN);
    expect(continued.headers.get("Location")).toBe("/");

    const home = await readable(await app.fetch("/"));
    expect(home).toContain(`Signed in as ${PHYSICIAN}`);
    expect(home).toContain("98 tasks");
    expect(home).toContain("11 phases");
  });

  it("does not create a second Practice when the same physician signs in again", async () => {
    const app = newApp();

    await signIn(app, PHYSICIAN);
    const first = practiceOf(app, PHYSICIAN).practiceId;
    app.clearCookies();

    await signIn(app, PHYSICIAN);

    expect(app.database.select().from(user).all()).toHaveLength(1);
    expect(app.database.select().from(practice).all()).toHaveLength(1);
    expect(app.database.select().from(membership).all()).toHaveLength(1);
    expect(practiceOf(app, PHYSICIAN).practiceId).toBe(first);
    expect(entriesOf(app, PHYSICIAN)).toHaveLength(98);
  });
});

describe("what one Practice can see of another", () => {
  it("shows a physician their own Practice and nothing of anyone else's", async () => {
    const app = newApp();

    await signIn(app, OTHER_PHYSICIAN);
    const theirs = practiceOf(app, OTHER_PHYSICIAN);
    app.database
      .update(practice)
      .set({ name: "Okafor Family Direct Care" })
      .where(eq(practice.id, theirs.practiceId))
      .run();
    app.clearCookies();

    await signIn(app, PHYSICIAN);
    const home = await readable(await app.fetch("/"));

    expect(home).toContain(`Signed in as ${PHYSICIAN}`);
    expect(home).not.toContain("Okafor");
    expect(home).not.toContain(OTHER_PHYSICIAN);
  });

  it("cannot be pointed at another Practice by asking for one", async () => {
    const app = newApp();

    await signIn(app, OTHER_PHYSICIAN);
    const others = practiceOf(app, OTHER_PHYSICIAN);
    app.database
      .update(practice)
      .set({ name: "Okafor Family Direct Care" })
      .where(eq(practice.id, others.practiceId))
      .run();
    app.clearCookies();

    await signIn(app, PHYSICIAN);

    // The Practice is derived from the session and never from the request, so
    // there is no id to tamper with. This is what that looks like from outside.
    const home = await readable(
      await app.fetch(`/?practice=${others.practiceId}`),
    );
    expect(home).not.toContain("Okafor");
  });

  it("keeps every Task Entry inside the Practice it was created for", async () => {
    const app = newApp();

    await signIn(app, PHYSICIAN);
    app.clearCookies();
    await signIn(app, OTHER_PHYSICIAN);

    const mine = practiceOf(app, PHYSICIAN).practiceId;
    const theirs = practiceOf(app, OTHER_PHYSICIAN).practiceId;
    expect(mine).not.toBe(theirs);

    expect(app.database.select().from(taskEntry).all()).toHaveLength(196);
    for (const entry of entriesOf(app, PHYSICIAN)) {
      expect(entry.practiceId).toBe(mine);
    }
  });
});

describe("the Email Consent checkbox on the registration form", () => {
  it("is ticked by default, and asks in the owner's own words", async () => {
    const app = newApp();
    const form = await readable(await app.fetch("/sign-in"));

    // React orders attributes as it pleases, so the box is found and then
    // read, rather than matched against one particular spelling of the tag.
    const box = form.match(/<input[^>]*name="emailConsent"[^>]*>/)?.[0];
    expect(box, "the registration form has no Email Consent checkbox").toBeDefined();
    expect(box).toContain('type="checkbox"');
    expect(box).toContain("checked");

    expect(form).toContain(EMAIL_CONSENT_WORDING);
  });

  it("records an act — when it was given, and which wording was agreed to", async () => {
    const app = newApp();
    const before = new Date();

    await signIn(app, PHYSICIAN, { emailConsent: true });

    const row = userOf(app, PHYSICIAN);

    expect(row?.emailConsentVersion).toBe(EMAIL_CONSENT_VERSION);
    expect(row?.emailConsentGrantedAt?.getTime()).toBeGreaterThanOrEqual(
      Math.floor(before.getTime() / 1000) * 1000,
    );
  });

  it("costs a physician nothing to decline", async () => {
    const app = newApp();

    const declined = await signIn(app, PHYSICIAN, { emailConsent: false });

    // The same door, the same Practice, the same list. Consent is a nudge and
    // never a gate: Launch Tasks is free and stays usable either way.
    expect(declined.headers.get("Location")).toBe("/");
    expect(entriesOf(app, PHYSICIAN)).toHaveLength(98);

    const row = userOf(app, PHYSICIAN);
    expect(row?.emailConsentGrantedAt).toBeNull();
    expect(row?.emailConsentVersion).toBeNull();
  });

  it("answers the registration form identically either way", async () => {
    const app = newApp();

    const ticked = await app.fetch("/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: PHYSICIAN, emailConsent: "on" }),
    });
    const unticked = await app.fetch("/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: OTHER_PHYSICIAN }),
    });

    expect(unticked.status).toBe(ticked.status);
    expect(unticked.headers.get("Location")).toBe(
      ticked.headers.get("Location"),
    );
  });

  it("never rewrites an act once it has been recorded", async () => {
    const app = newApp();

    await signIn(app, PHYSICIAN, { emailConsent: true });
    const first = userOf(app, PHYSICIAN);
    app.clearCookies();

    // Signing in again, having unticked the box. There is no in-app
    // withdrawal: consent is append-only, and the recorded act is what it was.
    await signIn(app, PHYSICIAN, { emailConsent: false });

    const after = userOf(app, PHYSICIAN);
    expect(after?.emailConsentGrantedAt?.getTime()).toBe(
      first?.emailConsentGrantedAt?.getTime(),
    );
    expect(after?.emailConsentVersion).toBe(first?.emailConsentVersion);
  });
});
