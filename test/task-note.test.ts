import { and, eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  customTask,
  globalTask,
  membership,
  phase,
  taskEntry,
  user,
} from "~/database/schema";
import { createTestApp, signInAs, type TestApp } from "./harness";

/**
 * Seam 1, on a Practice's own writing: the Note and the target date.
 *
 * A Note belongs to the Practice and not to whoever typed it, so what these
 * tests assert is what anyone in the Practice can see afterwards — the text
 * on the page, the row left behind, and the Note still being there once its
 * author's User is gone.
 *
 * The Note field is also the second place the Support View disclosure lands,
 * and the place it does the most work, so the quiet line under it is pinned
 * here rather than left to the privacy policy's test.
 */

const PHYSICIAN = "dr.reed@example.com";
const OTHER_PHYSICIAN = "dr.okafor@example.com";
const MEMBER = "nurse.hale@example.com";

const FOUNDATION = "/tasks/foundation-planning";

const EIN = "obtain-ein-employer-identification-number";
const REGISTER_NAME = "register-legal-business-name";

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

/** The Task Entry a Practice's writing lands on. */
function entryOf(app: TestApp, email: string, slug: string) {
  const row = app.database
    .select({ note: taskEntry.note, targetDate: taskEntry.targetDate })
    .from(taskEntry)
    .where(
      and(
        eq(taskEntry.practiceId, practiceIdOf(app, email)),
        eq(taskEntry.globalTaskId, globalTaskIdOf(app, slug)),
      ),
    )
    .get();
  if (!row) throw new Error(`No Task Entry for ${slug}`);
  return row;
}

/** What the browser posts when the physician presses Save under the Note. */
function save(
  app: TestApp,
  taskRef: string,
  written: { note?: string; targetDate?: string },
): Promise<Response> {
  return app.fetch(FOUNDATION, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      intent: "note",
      taskRef,
      note: written.note ?? "",
      targetDate: written.targetDate ?? "",
    }),
  });
}

function insertCustomTask(app: TestApp, email: string, title: string): number {
  const foundationPhase = app.database
    .select({ id: phase.id })
    .from(phase)
    .where(eq(phase.name, "Foundation & Planning"))
    .get();

  const inserted = app.database
    .insert(customTask)
    .values({
      practiceId: practiceIdOf(app, email),
      phaseId: foundationPhase!.id,
      title,
      body: "The one in Cincinnati, not the one here.",
    })
    .returning({ id: customTask.id })
    .get();

  return inserted.id;
}

describe("writing a Note", () => {
  it("keeps it on the Task, with the drawer still open", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await save(app, EIN, {
      note: "Accountant says file the SS-4 online: confirmation in 10 minutes.",
    });

    expect(entryOf(app, PHYSICIAN, EIN).note).toContain("SS-4");
    // The drawer stays open: writing a Note moves no card, and the
    // physician was reading the Task when they wrote it.
    expect(response.headers.get("Location")).toBe(`${FOUNDATION}?task=${EIN}`);

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);
    expect(open).toContain("confirmation in 10 minutes");
  });

  it("writes one on a Custom Task the same way", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    const id = insertCustomTask(app, PHYSICIAN, "Ask my accountant about S-Corp");

    await save(app, `custom-${id}`, { note: "He calls back Thursdays." });

    const row = app.database
      .select({ note: customTask.note })
      .from(customTask)
      .where(eq(customTask.id, id))
      .get();
    expect(row?.note).toBe("He calls back Thursdays.");
  });

  it("replaces what was there, and an empty box clears it", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await save(app, EIN, { note: "Licence 44-1029" });
    await save(app, EIN, { note: "Licence 44-1030" });
    const corrected = entryOf(app, PHYSICIAN, EIN).note;
    await save(app, EIN, { note: "   " });

    expect(corrected).toBe("Licence 44-1030");
    // Nothing written is nothing stored, rather than a row holding blanks.
    expect(entryOf(app, PHYSICIAN, EIN).note).toBeNull();
  });

  it("never reaches another Practice's Task Entry", async () => {
    const app = newApp();
    await signInAs(app, OTHER_PHYSICIAN);
    const theirs = insertCustomTask(app, OTHER_PHYSICIAN, "Okafor lease review");
    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    const response = await save(app, `custom-${theirs}`, { note: "Not mine" });

    expect(response.status).toBe(404);
    const row = app.database
      .select({ note: customTask.note })
      .from(customTask)
      .where(eq(customTask.id, theirs))
      .get();
    expect(row?.note).toBeNull();
  });

  it("is nobody else's to read", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await save(app, EIN, { note: "Bank login is in the safe" });
    app.clearCookies();
    await signInAs(app, OTHER_PHYSICIAN);

    const theirs = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(theirs).not.toContain("Bank login is in the safe");
  });

  it("sends a signed-out visitor to the sign-in page and writes nothing", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.clearCookies();

    const response = await save(app, EIN, { note: "Written by a stranger" });

    expect(response.headers.get("Location")).toBe("/sign-in");
    expect(entryOf(app, PHYSICIAN, EIN).note).toBeNull();
  });
});

describe("the quiet line under the Note field", () => {
  it("says the operator can read it, and implies no gate", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    // The disclosure lands twice — in the policy, and here, where someone
    // is about to type the thing they would regret. It is a sentence and
    // not an obligation: Support View is deliberately not consent-gated.
    expect(open).toContain(
      "Launch Tasks is run by one person. To help you when something goes wrong, that person can sign in to your practice and see it exactly as you do — including this note.",
    );
    expect(open).not.toMatch(/\ballow\b|\bconsent\b|\bpermission\b/i);
  });

  it("never calls a Note private", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await save(app, EIN, { note: "Licence 44-1029" });

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    // `Private Note` was dropped rather than left standing as a promise the
    // product no longer keeps (ADR-0001).
    expect(open).not.toMatch(/private/i);
  });
});

describe("HTML in a Note", () => {
  it("comes back as the text the physician typed", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await save(app, EIN, {
      note: "Call the <b>bank</b> *today*\n\n<script>alert('x')</script>",
    });
    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    // Raw HTML is disabled at the parser, not merely sanitized after the
    // fact: the markup never becomes markup, inline or as a block of its
    // own, so widening the allowlist could not let it back through.
    expect(open).not.toContain("<script>alert");
    expect(open).not.toContain("<b>bank</b>");
    expect(open).toContain("&lt;b&gt;bank&lt;/b&gt;");
    // Markdown still works, because that is what the field is for.
    expect(open).toContain("<em>today</em>");
  });

  it("stores what was typed, unmangled", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await save(app, EIN, { note: "<b>Call</b> the bank" });

    // Escaping is a rendering act. The physician's own words are kept as
    // they were written, so the edit box shows them back.
    expect(entryOf(app, PHYSICIAN, EIN).note).toBe("<b>Call</b> the bank");
  });
});

describe("a target date", () => {
  it("is set, shown on the card, and cleared again", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await save(app, EIN, { targetDate: "2026-03-14" });
    const dated = await page(app, FOUNDATION);
    const set = entryOf(app, PHYSICIAN, EIN).targetDate;
    await save(app, EIN, { targetDate: "" });

    expect(set?.toISOString()).toBe("2026-03-14T00:00:00.000Z");
    expect(dated).toContain("March 14, 2026");
    expect(entryOf(app, PHYSICIAN, EIN).targetDate).toBeNull();
  });

  it("goes on a Custom Task too", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    const id = insertCustomTask(app, PHYSICIAN, "Ask my accountant about S-Corp");

    await save(app, `custom-${id}`, { targetDate: "2026-01-06" });

    const row = app.database
      .select({ targetDate: customTask.targetDate })
      .from(customTask)
      .where(eq(customTask.id, id))
      .get();
    expect(row?.targetDate?.toISOString()).toBe("2026-01-06T00:00:00.000Z");
  });

  it("comes back in the date field, ready to be changed", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await save(app, EIN, { targetDate: "2026-03-14" });

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).toContain('value="2026-03-14"');
  });

  it("refuses something that is not a date, and writes neither field", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await save(app, EIN, {
      note: "Kept out of the database",
      targetDate: "next Tuesday",
    });

    expect(response.status).toBe(400);
    expect(entryOf(app, PHYSICIAN, EIN).note).toBeNull();
  });

  it("is saved alongside the Note in one press", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await save(app, EIN, { note: "Filed 6 Jan", targetDate: "2026-01-06" });

    const written = entryOf(app, PHYSICIAN, EIN);
    expect(written.note).toBe("Filed 6 Jan");
    expect(written.targetDate?.toISOString()).toBe("2026-01-06T00:00:00.000Z");
  });
});

describe("a Note belongs to the Practice", () => {
  it("stays when the Member who wrote it Leaves", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    const practiceId = practiceIdOf(app, PHYSICIAN);

    // A Member of the Owner's Practice. Invites are a later ticket; the
    // Membership is not, and it is what makes this Practice shared.
    await signInAs(app, MEMBER);
    app.database
      .update(membership)
      .set({ practiceId, role: "member" })
      .where(eq(membership.userId, userIdOf(app, MEMBER)))
      .run();
    await save(app, EIN, { note: "Rang the IRS: hold time 40 minutes" });

    // Leaving takes the Member's Membership and their User together. What
    // they wrote is not theirs to take with them.
    app.database.delete(user).where(eq(user.email, MEMBER)).run();
    app.clearCookies();
    await signInAs(app, PHYSICIAN);
    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).toContain("hold time 40 minutes");
  });
});

describe("a Retired Task", () => {
  it("still takes a Note, because a Note is the Practice's own writing", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.database
      .update(globalTask)
      .set({ retiredAt: new Date() })
      .where(eq(globalTask.slug, REGISTER_NAME))
      .run();

    const response = await save(app, REGISTER_NAME, {
      note: "We did this in 2024 anyway",
    });

    // Un-retiring is the Admin's act, which is why there is no Status
    // control on one. Writing down what the Practice did is not.
    expect(response.status).toBe(302);
    expect(entryOf(app, PHYSICIAN, REGISTER_NAME).note).toBe(
      "We did this in 2024 anyway",
    );
  });
});

function userIdOf(app: TestApp, email: string): string {
  const row = app.database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .get();
  if (!row) throw new Error(`No User for ${email}`);
  return row.id;
}
