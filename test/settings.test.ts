import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  EMAIL_CONSENT_VERSION,
  EMAIL_CONSENT_WORDING,
} from "~/consent/email-consent";
import { GRACE_PERIOD_DAYS } from "~/practice/deletion";
import {
  customTask,
  invite,
  membership,
  practice,
  taskEntry,
  user,
} from "~/database/schema";
import { createTestApp, signInAs, type TestApp } from "./harness";

/**
 * Seam 1, on the settings page and on what deleting a Practice does.
 *
 * Two things are under test here and they are not the same kind of thing.
 * The first is a screen: five plain sections in one order, with the fields
 * that are editable editable and the one that never is — the email address —
 * absent from every form. The second is the Grace Period, which is the only
 * promise in the product that would be a lie if the code drifted: the
 * confirmation says the practice is permanently deleted after thirty days,
 * so the tests that matter most are the ones asserting that **nothing was
 * destroyed** and that everyone in it is nonetheless locked out.
 *
 * Purge is a later ticket (#42) and nothing here asserts anything about day
 * 30 beyond the Practice still being unreachable on day 29.
 */

const OWNER = "dr.reed@example.com";
const SPOUSE = "jamie.reed@example.com";
const OWNER_NAME = "Dr Alex Reed";
const PRACTICE_NAME = "Reed Direct Care";

const FOUNDATION = "/tasks/foundation-planning";
const EIN = "obtain-ein-employer-identification-number";

const DAY = 24 * 60 * 60 * 1000;

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

/** The page as a reader sees it, without React's interpolation markers. */
async function readable(response: Response): Promise<string> {
  return (await response.text()).replaceAll("<!-- -->", "");
}

function post(body: Record<string, string>): RequestInit {
  return {
    method: "post",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  };
}

/**
 * One section of the page, by its heading.
 *
 * Assertions about *what a section says* have to be scoped to it, because
 * the whole point of this screen is that five sections sit on one scroll:
 * `toContain` against the whole page would let the Danger Zone's copy pass
 * a test about Your account.
 */
function section(page: string, heading: string): string {
  const headings = [
    "Practice",
    "People",
    "Email from us",
    "Your account",
    "Danger Zone",
  ];
  const start = page.indexOf(`>${heading}<`);
  expect(start, `no ${heading} section`).toBeGreaterThan(-1);

  const next = headings
    .map((other) => page.indexOf(`>${other}<`, start + 1))
    .filter((at) => at > start);

  return page.slice(start, next.length > 0 ? Math.min(...next) : undefined);
}

async function settingsPage(app: TestApp, query = ""): Promise<string> {
  return readable(await app.fetch(`/settings${query}`));
}

function practiceRow(app: TestApp) {
  const row = app.database.select().from(practice).get();
  if (!row) throw new Error("No Practice");
  return row;
}

function userRow(app: TestApp, email: string) {
  return app.database.select().from(user).where(eq(user.email, email)).get();
}

/** The token out of the most recent email to an address. */
function tokenIn(app: TestApp, email: string): string {
  const link = app.emailSender.linksTo(email).at(-1);
  if (!link) throw new Error(`Nothing was mailed to ${email}`);
  return new URL(link).searchParams.get("token") ?? "";
}

/** Sign in an Owner and put a Member alongside them. */
async function practiceOfTwo(app: TestApp): Promise<Map<string, string>> {
  await signInAs(app, OWNER);
  await app.fetch(
    "/settings",
    post({
      intent: "invite",
      email: SPOUSE,
      yourName: OWNER_NAME,
      practiceName: PRACTICE_NAME,
    }),
  );

  const inviteToken = tokenIn(app, SPOUSE);
  app.clearCookies();
  await app.fetch("/invite", post({ token: inviteToken, name: "Jamie Reed" }));
  await app.fetch("/continue", post({ token: tokenIn(app, SPOUSE) }));

  return new Map(app.cookies);
}

function signInAgainAs(app: TestApp, email: string) {
  app.clearCookies();
  return signInAs(app, email);
}

describe("the settings page", () => {
  it("is one page of five plain sections, with nothing to navigate", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    const page = await settingsPage(app);

    const order = [
      "Practice",
      "People",
      "Email from us",
      "Your account",
      "Danger Zone",
    ].map((heading) => page.indexOf(`>${heading}<`));

    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // The vocabulary this screen is most likely to drift into, and the
    // shape that pulls it there. `CONTEXT.md` avoids all three.
    expect(page).not.toContain("Seats");
    expect(page).not.toContain("<table");
  });

  it("lets the Practice's two names be edited, and shows its state", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    await app.fetch(
      "/settings",
      post({
        intent: "practice",
        displayName: OWNER_NAME,
        practiceName: PRACTICE_NAME,
        state: "Ohio",
      }),
    );

    expect(practiceRow(app).name).toBe(PRACTICE_NAME);
    expect(practiceRow(app).state).toBe("Ohio");
    expect(userRow(app, OWNER)?.name).toBe(OWNER_NAME);

    const page = section(await settingsPage(app), "Practice");
    expect(page).toContain(PRACTICE_NAME);
    expect(page).toContain(OWNER_NAME);
    expect(page).toContain("Ohio");
  });

  it("never displays the two Practice Profile booleans", async () => {
    const app = newApp();
    await signInAs(app, OWNER, { tailoring: "owed" });

    // Answered, so both booleans are stored and both have nothing to say:
    // nothing re-reads them, so showing them would promise a re-tailoring
    // that does not exist (ADR-0002).
    await app.fetch(
      "/welcome",
      post({ fixedLocation: "no", expectsEmployees: "no", state: "Ohio" }),
    );

    const page = section(await settingsPage(app), "Practice");
    expect(page).not.toContain("employees");
    expect(page).not.toContain("office");
  });

  it("shows the email address in Your account and offers no way to change it", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    const account = section(await settingsPage(app), "Your account");

    expect(account).toContain(OWNER);
    // Not a disabled field or a readonly one: there is no field at all. The
    // only form in this section is the one that signs you out.
    expect(account).not.toMatch(/<input[^>]*type="(text|email)"/);
    expect(account).not.toContain('name="email"');
  });
});

describe("Email from us", () => {
  it("states the act and its date, and never claims a subscription state", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    const said = section(await settingsPage(app), "Email from us");

    const today = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    expect(said).toContain(`You said yes to our email on ${today}`);

    // The app never reads Kit from a loader, so it cannot know whether
    // anybody is subscribed — and must not sound as though it does.
    expect(said).not.toContain("You are subscribed");
    expect(said).not.toContain("Unsubscribe");
    expect(said).not.toContain("Subscribe");
  });

  it("gives a physician who declined a Subscribe button, and records the act", async () => {
    const app = newApp();
    await signInAs(app, OWNER, { emailConsent: false });

    const asked = section(await settingsPage(app), "Email from us");
    expect(asked).toContain("Subscribe");
    // The Consent Wording, and not a paraphrase of it: the version stamped
    // on the act below names a sentence, so it has to be the sentence they
    // were shown.
    expect(asked).toContain(EMAIL_CONSENT_WORDING);

    await app.fetch("/settings", post({ intent: "subscribe" }));

    const consented = userRow(app, OWNER);
    expect(consented?.emailConsentGrantedAt).not.toBeNull();
    expect(consented?.emailConsentVersion).toBe(EMAIL_CONSENT_VERSION);

    const after = section(await settingsPage(app), "Email from us");
    expect(after).toContain("You said yes to our email on");
    expect(after).not.toContain("Subscribe");
  });

  it("says the unsubscribe link works whatever this app does", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    const said = section(await settingsPage(app), "Email from us");

    // Leaving the newsletter is never entangled with leaving the product,
    // and the footer link is where withdrawal actually happens — this page
    // cannot record it and says so rather than implying otherwise.
    expect(said.toLowerCase()).toContain("unsubscribe link");
    expect(said).toContain("always works");
  });
});

describe("the Danger Zone", () => {
  it("offers the Owner delete behind two buttons and no typing test", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    const closed = section(await settingsPage(app), "Danger Zone");
    expect(closed).toContain("Delete this practice");
    expect(closed).not.toContain("Leave this practice");

    const asking = section(
      await settingsPage(app, "?confirm=delete"),
      "Danger Zone",
    );

    // The one sentence that would be a lie if it were left out: holding the
    // data for a month while saying it is gone is the false promise
    // available here, so the number is on the confirmation.
    expect(asking).toContain("permanently deleted after thirty days");
    expect(asking).toContain("Delete this practice");
    expect(asking).toContain("Nope — take me back");

    // No typing test. The act is recoverable for thirty days, and a typing
    // test on a recoverable act only teaches a physician to fear the app.
    expect(asking).not.toMatch(/<input[^>]*type="(text|email)"/);
    expect(asking).not.toContain("<textarea");

    // Asking is not doing.
    expect(practiceRow(app).deletedAt).toBeNull();
  });

  it("gives a Member Leave, and refuses them the delete", async () => {
    const app = newApp();
    await practiceOfTwo(app);

    const zone = section(await settingsPage(app), "Danger Zone");
    expect(zone).toContain("Leave this practice");
    expect(zone).not.toContain("Delete this practice");

    const refused = await app.fetch(
      "/settings",
      post({ intent: "delete-practice" }),
    );
    expect(refused.status).toBe(403);
    expect(practiceRow(app).deletedAt).toBeNull();
  });
});

describe("deleting a Practice", () => {
  it("starts the Grace Period and signs out everyone in it", async () => {
    const app = newApp();
    const theirSession = await practiceOfTwo(app);
    await signInAgainAs(app, OWNER);

    const deleted = await app.fetch(
      "/settings",
      post({ intent: "delete-practice" }),
    );
    expect(deleted.headers.get("Location")).toBe("/?deleted=1");
    expect(practiceRow(app).deletedAt).not.toBeNull();

    // The Owner's own session went with it: there is no list left to read.
    expect((await app.fetch("/settings")).headers.get("Location")).toBe(
      "/sign-in",
    );

    // And the Member's, down the same revocation path — they are not left
    // looking at a list that no longer exists.
    app.clearCookies();
    for (const [name, value] of theirSession) app.cookies.set(name, value);
    expect((await app.fetch("/tasks")).headers.get("Location")).toBe("/sign-in");
  });

  it("destroys nothing at all", async () => {
    const app = newApp();
    await practiceOfTwo(app);
    await app.fetch(
      FOUNDATION,
      post({ intent: "note", taskRef: EIN, note: "Filed it on Tuesday" }),
    );
    await app.fetch(
      FOUNDATION,
      post({ intent: "add-task", title: "Call the landlord back", body: "" }),
    );

    await signInAgainAs(app, OWNER);
    await app.fetch("/settings", post({ intent: "delete-practice" }));

    // Everything a Purge would take is still here, because a Purge is what
    // takes it and that is thirty days away (#42).
    expect(app.database.select().from(practice).all()).toHaveLength(1);
    expect(app.database.select().from(membership).all()).toHaveLength(2);
    expect(app.database.select().from(customTask).all()).toHaveLength(1);
    expect(userRow(app, OWNER)).toBeDefined();
    expect(userRow(app, SPOUSE)).toBeDefined();

    const notes = app.database
      .select({ note: taskEntry.note })
      .from(taskEntry)
      .where(eq(taskEntry.note, "Filed it on Tuesday"))
      .all();
    expect(notes).toHaveLength(1);
  });

  it("is unreachable to everyone in it for the whole Grace Period", async () => {
    const app = newApp();
    await practiceOfTwo(app);
    await signInAgainAs(app, OWNER);
    await app.fetch("/settings", post({ intent: "delete-practice" }));

    // Day 29: still inside the window, and still gone as far as anyone in
    // it can tell. Signing in again is allowed — the door never says
    // anything about an address — and it leads nowhere.
    app.database
      .update(practice)
      .set({ deletedAt: new Date(Date.now() - (GRACE_PERIOD_DAYS - 1) * DAY) })
      .run();

    for (const email of [OWNER, SPOUSE]) {
      await signInAgainAs(app, email);
      expect((await app.fetch("/tasks")).headers.get("Location")).toBe("/");
      expect((await app.fetch("/settings")).headers.get("Location")).toBe("/");
      expect(await readable(await app.fetch("/"))).toContain(
        "Your practice has been deleted",
      );
    }

    // And nobody was quietly handed a fresh Practice to make up for it.
    expect(app.database.select().from(practice).all()).toHaveLength(1);
    expect(app.database.select().from(membership).all()).toHaveLength(2);
  });

  it("says what was done, and that it can still be undone", async () => {
    const app = newApp();
    await signInAs(app, OWNER);
    await app.fetch("/settings", post({ intent: "delete-practice" }));

    const goodbye = await readable(await app.fetch("/?deleted=1"));
    expect(goodbye).toContain("thirty days");
  });

  it("stops an outstanding Invite from letting anyone in", async () => {
    const app = newApp();
    await signInAs(app, OWNER);
    await app.fetch(
      "/settings",
      post({
        intent: "invite",
        email: SPOUSE,
        yourName: OWNER_NAME,
        practiceName: PRACTICE_NAME,
      }),
    );
    const inviteToken = tokenIn(app, SPOUSE);

    await app.fetch("/settings", post({ intent: "delete-practice" }));

    // The Invite row is untouched, like everything else — but the offer it
    // carries is an offer of a place in a Practice that has been deleted.
    expect(app.database.select().from(invite).all()).toHaveLength(1);

    app.clearCookies();
    expect(await readable(await app.fetch(`/invite?token=${inviteToken}`))).toContain(
      "This invitation was withdrawn",
    );

    await signInAs(app, SPOUSE);
    const theirs = app.database
      .select({ practiceId: membership.practiceId })
      .from(membership)
      .innerJoin(user, eq(membership.userId, user.id))
      .where(eq(user.email, SPOUSE))
      .all();
    expect(theirs).toHaveLength(1);
    expect(theirs[0].practiceId).not.toBe(practiceRow(app).id);
  });
});
