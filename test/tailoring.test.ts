import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  globalTask,
  membership,
  practice,
  taskEntry,
  user,
  type TaskStatus,
} from "~/database/schema";
import { createTestApp, signInAs, type TestApp } from "./harness";

/**
 * Seam 1, on the one screen that writes fourteen Statuses at once.
 *
 * The load-bearing assertion in this file is the last one in the first
 * describe: **the Tasks the Wizard set aside are still on the list
 * afterwards**. ADR-0002 accepts an unrecoverable loss — no provenance, no
 * record of what the Wizard touched — and the only thing that makes that
 * acceptable is that the physician can see the result and undo it by hand.
 * If Not Applicable ever goes back to collapsing out of view, this test
 * fails, and it should: the two decisions have to move together or not at
 * all.
 */

const PHYSICIAN = "dr.reed@example.com";
const SPOUSE = "sam.reed@example.com";

const WELCOME = "/welcome";
const PHYSICAL_SETUP = "/tasks/physical-setup";
const STAFFING = "/tasks/staffing-training";

/** The eight a mobile practice never does, and the six a solo one never does. */
const FIXED_OFFICE_TASKS = [
  "location-selection-research",
  "office-location-lease",
  "office-design-layout",
  "office-buildout",
  "office-furniture",
  "office-supplies",
  "signage-installation",
  "utilities-services-setup",
];

const EMPLOYMENT_TASKS = [
  "payroll-system-setup",
  "staff-hiring-plan",
  "employee-handbook",
  "hr-compliance-setup",
  "staff-training",
  "benefits-administration",
];

/** Bought by a mobile practice too, and so never set aside. */
const KEPT_BY_A_MOBILE_PRACTICE = [
  "medical-equipment-purchase",
  "medical-supplies-inventory",
  "point-of-care-testing-setup",
];

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

/** The page as a reader sees it, without React's interpolation markers. */
async function readable(response: Response): Promise<string> {
  return (await response.text()).replaceAll("<!-- -->", "");
}

async function page(app: TestApp, path: string): Promise<string> {
  return readable(await app.fetch(path));
}

/** Sign in as a brand-new Owner and stop where the Wizard is still owed. */
async function newOwner(app: TestApp, email = PHYSICIAN): Promise<void> {
  await signInAs(app, email, { tailoring: "owed" });
}

async function answer(
  app: TestApp,
  answers: Record<string, string>,
): Promise<Response> {
  return app.fetch(WELCOME, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(answers),
  });
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

function profileOf(app: TestApp, email: string) {
  const row = app.database
    .select({
      state: practice.state,
      fixedLocation: practice.fixedLocation,
      expectsEmployees: practice.expectsEmployees,
      settledAt: practice.tailoringSettledAt,
    })
    .from(practice)
    .where(eq(practice.id, practiceIdOf(app, email)))
    .get();
  if (!row) throw new Error(`${email} has no Practice`);
  return row;
}

/** The Statuses on a named set of Global Tasks, as rows rather than as a page. */
function statusesOf(
  app: TestApp,
  email: string,
  slugs: string[],
): TaskStatus[] {
  const ids = app.database
    .select({ id: globalTask.id })
    .from(globalTask)
    .where(inArray(globalTask.slug, slugs))
    .all()
    .map((row) => row.id);
  expect(ids).toHaveLength(slugs.length);

  return app.database
    .select({ status: taskEntry.status })
    .from(taskEntry)
    .where(
      and(
        eq(taskEntry.practiceId, practiceIdOf(app, email)),
        inArray(taskEntry.globalTaskId, ids),
      ),
    )
    .all()
    .map((row) => row.status);
}

function countOf(app: TestApp, email: string, status: TaskStatus): number {
  return app.database
    .select({ id: taskEntry.id })
    .from(taskEntry)
    .where(
      and(
        eq(taskEntry.practiceId, practiceIdOf(app, email)),
        eq(taskEntry.status, status),
      ),
    )
    .all().length;
}

describe("the Tailoring Wizard", () => {
  it("meets a new Owner in front of the list, and asks three questions", async () => {
    const app = newApp();
    await newOwner(app);

    const sentAway = await app.fetch("/tasks");
    expect(sentAway.status).toBe(302);
    expect(sentAway.headers.get("Location")).toBe(WELCOME);

    const screen = await page(app, WELCOME);
    expect(screen).toContain("Will you see patients at a fixed office location?");
    expect(screen).toContain(
      "Do you expect to hire any employees within your first 6 months?",
    );
    expect(screen).toContain("Which state will you practise in?");
    expect(screen).toContain("Skip — just show me all available tasks");
  });

  // Wording is part of the decision: a physician whose spouse is a Member
  // must not read a question about W-2s as being about them.
  it("asks about hiring in plain English, and never says W-2", async () => {
    const app = newApp();
    await newOwner(app);

    expect(await page(app, WELCOME)).not.toContain("W-2");
  });

  it("sets the eight fixed-office Tasks aside for a mobile practice", async () => {
    const app = newApp();
    await newOwner(app);

    await answer(app, { fixedLocation: "no", expectsEmployees: "yes" });

    expect(statusesOf(app, PHYSICIAN, FIXED_OFFICE_TASKS)).toEqual(
      Array(8).fill("not_applicable"),
    );
    // A mobile practice still buys equipment, supplies and its testing kit.
    expect(statusesOf(app, PHYSICIAN, KEPT_BY_A_MOBILE_PRACTICE)).toEqual(
      Array(3).fill("not_started"),
    );
    expect(countOf(app, PHYSICIAN, "not_applicable")).toBe(8);
  });

  it("sets the six employment Tasks aside for a practice hiring nobody", async () => {
    const app = newApp();
    await newOwner(app);

    await answer(app, { fixedLocation: "yes", expectsEmployees: "no" });

    expect(statusesOf(app, PHYSICIAN, EMPLOYMENT_TASKS)).toEqual(
      Array(6).fill("not_applicable"),
    );
    expect(countOf(app, PHYSICIAN, "not_applicable")).toBe(6);
  });

  it("sets nothing aside for a practice with an office and staff coming", async () => {
    const app = newApp();
    await newOwner(app);

    await answer(app, {
      fixedLocation: "yes",
      expectsEmployees: "yes",
      state: "Ohio",
    });

    expect(countOf(app, PHYSICIAN, "not_applicable")).toBe(0);
  });

  // The state question retires nothing at all, and is asked anyway.
  it("sets nothing aside for the state question", async () => {
    const app = newApp();
    await newOwner(app);

    await answer(app, { state: "Ohio" });

    expect(countOf(app, PHYSICIAN, "not_applicable")).toBe(0);
    expect(profileOf(app, PHYSICIAN).state).toBe("Ohio");
  });

  // ADR-0002's accepted loss, made honest. The Wizard records nothing about
  // what it touched, and this is what stands in for that record: the Tasks
  // are on the list, in front of the physician, with their Status control.
  it("leaves the Tasks it set aside visible on the list afterwards", async () => {
    const app = newApp();
    await newOwner(app);

    await answer(app, { fixedLocation: "no", expectsEmployees: "no" });

    const physicalSetup = await page(app, PHYSICAL_SETUP);
    expect(physicalSetup).toContain("Office Buildout");
    expect(physicalSetup).toContain("Not applicable");

    // Still a row of its own, and the drawer behind it still carries the
    // Status control that brings it back. That control *is* the undo this
    // Wizard records nothing to provide.
    const drawer = await page(app, `${PHYSICAL_SETUP}?task=office-buildout`);
    expect(drawer).toContain('value="not_started"');

    const staffing = await page(app, STAFFING);
    expect(staffing).toContain("Employee Handbook");
    expect(staffing).toContain("Not applicable");

    // And the sink is real: the set-aside Task is below one that is not.
    expect(physicalSetup.indexOf("Office Buildout")).toBeGreaterThan(
      physicalSetup.indexOf("Medical Equipment Purchase"),
    );
  });

  it("keeps the Practice Profile, and displays none of it", async () => {
    const app = newApp();
    await newOwner(app);

    await answer(app, {
      fixedLocation: "no",
      expectsEmployees: "no",
      state: "Ohio",
    });

    const profile = profileOf(app, PHYSICIAN);
    expect(profile.state).toBe("Ohio");
    expect(profile.fixedLocation).toBe(false);
    expect(profile.expectsEmployees).toBe(false);

    // The two booleans have no reader in v1 and nothing renders them.
    const physicalSetup = await page(app, PHYSICAL_SETUP);
    expect(physicalSetup).not.toContain("fixed office");
    expect(physicalSetup).not.toContain("employees");
  });

  // The one live reader of the Practice Profile: a warning becomes a pointer.
  it("names the state on a Task that varies by state", async () => {
    const app = newApp();
    await newOwner(app);

    await answer(app, { state: "Ohio" });

    expect(await page(app, "/tasks/credentialing-compliance")).toContain(
      "Varies by state — check Ohio's rules",
    );
  });
});

describe("the Tailoring Wizard, once and once only", () => {
  it("is gone for good once it has been answered", async () => {
    const app = newApp();
    await newOwner(app);

    const answered = await answer(app, { fixedLocation: "no" });
    expect(answered.status).toBe(302);
    expect(answered.headers.get("Location")).toBe("/tasks");

    expect(profileOf(app, PHYSICIAN).settledAt).not.toBeNull();

    const returning = await app.fetch(WELCOME);
    expect(returning.status).toBe(302);
    expect(returning.headers.get("Location")).toBe("/tasks");

    const list = await app.fetch("/tasks");
    expect(list.headers.get("Location")).toBe("/tasks/foundation-planning");
  });

  it("is gone for good once it has been skipped, with nothing set aside", async () => {
    const app = newApp();
    await newOwner(app);

    const skipped = await answer(app, { intent: "skip" });
    expect(skipped.headers.get("Location")).toBe("/tasks");

    const profile = profileOf(app, PHYSICIAN);
    expect(profile.settledAt).not.toBeNull();
    expect(profile.state).toBeNull();
    expect(profile.fixedLocation).toBeNull();
    expect(countOf(app, PHYSICIAN, "not_applicable")).toBe(0);

    // A skipper sees all 98 Tasks and never sees this screen again.
    expect(countOf(app, PHYSICIAN, "not_started")).toBe(98);
    expect((await app.fetch(WELCOME)).headers.get("Location")).toBe("/tasks");
  });

  // Closing the tab is not an answer.
  it("is still owed to an Owner who read it and went away", async () => {
    const app = newApp();
    await newOwner(app);

    expect((await app.fetch(WELCOME)).status).toBe(200);

    app.clearCookies();
    await signInAs(app, PHYSICIAN, { tailoring: "owed" });

    expect((await app.fetch("/tasks")).headers.get("Location")).toBe(WELCOME);
  });

  // The one path by which this design could destroy real work.
  it("is never shown to a Member", async () => {
    const app = newApp();
    await newOwner(app);
    await answer(app, { fixedLocation: "yes", expectsEmployees: "yes" });

    await joinAsMember(app, SPOUSE, practiceIdOf(app, PHYSICIAN));

    const list = await app.fetch("/tasks");
    expect(list.headers.get("Location")).toBe("/tasks/foundation-planning");

    const wizard = await app.fetch(WELCOME);
    expect(wizard.headers.get("Location")).toBe("/tasks");

    // And a hand-written post of the form does nothing to the Owner's list.
    await answer(app, { fixedLocation: "no", expectsEmployees: "no" });
    expect(countOf(app, PHYSICIAN, "not_applicable")).toBe(0);
  });

  // Belt and braces alongside the flag: a list with work on it is not an
  // untouched one, whatever the Practice column says.
  it("is not owed to a Practice that has already moved a Status", async () => {
    const app = newApp();
    await newOwner(app);

    app.database
      .update(taskEntry)
      .set({ status: "done" })
      .where(eq(taskEntry.practiceId, practiceIdOf(app, PHYSICIAN)))
      .run();

    expect((await app.fetch(WELCOME)).headers.get("Location")).toBe("/tasks");
  });
});

/**
 * Join an existing Practice as a Member.
 *
 * Invites are a later ticket, so this moves a Membership across by hand and
 * takes the now-empty Practice with it. Everything it fakes is the Invite;
 * what it produces — a signed-in User whose Membership says `member` — is
 * exactly what accepting one will produce.
 */
async function joinAsMember(
  app: TestApp,
  email: string,
  practiceId: number,
): Promise<void> {
  app.clearCookies();
  await signInAs(app, email, { tailoring: "owed" });

  const joiner = app.database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .get();
  if (!joiner) throw new Error(`${email} never registered`);

  const ownPractice = practiceIdOf(app, email);

  app.database
    .update(membership)
    .set({ practiceId, role: "member" })
    .where(eq(membership.userId, joiner.id))
    .run();

  // The Practice registration made for them goes with it, Task Entries and
  // all, so nothing in this test is looking at a list nobody owns.
  app.database.delete(practice).where(eq(practice.id, ownPractice)).run();
}
