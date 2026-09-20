import { and, eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  customTask,
  globalTask,
  helpfulLink,
  membership,
  phase,
  taskEntry,
  user,
  type TaskStatus,
} from "~/database/schema";
import { createTestApp, signInAs, type TestApp } from "./harness";

/**
 * Seam 1, on the screen the whole product is: one Phase of the list, and the
 * Task whose drawer is open.
 *
 * Everything here is asserted as a physician meets it — the page they get
 * back, the order the cards come out in, the sentence under a link. There are
 * no component tests for the drawer and no unit test for the sort, on
 * purpose: both are observable in the rendered Phase, and a test of the
 * markup would pin the structure rather than the behaviour.
 *
 * The Admin's edits are made by writing the row the admin panel will write
 * when it exists. Editing a Global Task reaches Practices on save, so a test
 * that changes a Body and re-reads the page is exercising the real path.
 */

const PHYSICIAN = "dr.reed@example.com";
const OTHER_PHYSICIAN = "dr.okafor@example.com";

const FOUNDATION = "/tasks/foundation-planning";
const CREDENTIALING = "/tasks/credentialing-compliance";

/** Real Tasks from the real Task Library, which every test app is seeded with. */
const EIN = "obtain-ein-employer-identification-number";
const REGISTER_NAME = "register-legal-business-name";
const BUSINESS_STRUCTURE = "business-structure-decision";
const BUSINESS_LICENCE = "obtain-business-license";

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

/** The Admin edits a Body. It reaches every Practice on save. */
function rewriteBody(app: TestApp, slug: string, body: string) {
  app.database
    .update(globalTask)
    .set({ body })
    .where(eq(globalTask.slug, slug))
    .run();
}

/** The Practice sets a Status. The control is the next ticket; the row is not. */
function setStatus(
  app: TestApp,
  email: string,
  slug: string,
  status: TaskStatus,
) {
  app.database
    .update(taskEntry)
    .set({ status })
    .where(
      and(
        eq(taskEntry.practiceId, practiceIdOf(app, email)),
        eq(taskEntry.globalTaskId, globalTaskIdOf(app, slug)),
      ),
    )
    .run();
}

describe("landing on the journey map", () => {
  it("opens the first Phase when the physician has not named one", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await app.fetch("/tasks");

    expect(response.headers.get("Location")).toBe(FOUNDATION);
  });

  it("puts one Phase's Tasks on screen and no other Phase's", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const foundation = await page(app, FOUNDATION);

    expect(foundation).toContain("Obtain EIN");
    expect(foundation).toContain("Business Structure Decision");
    // A Task from Phase 2 is one press away and is not on this page. That is
    // the whole argument of the screen: eight Tasks, never ninety-eight.
    expect(foundation).not.toContain("Obtain Business License");
  });

  it("carries every Phase on the rail, reachable without being on screen", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const foundation = await page(app, FOUNDATION);

    const phases = app.database.select({ name: phase.name }).from(phase).all();
    expect(phases).toHaveLength(11);
    for (const { name } of phases) {
      expect(foundation).toContain(name.replace("&", "&amp;"));
    }
    expect(foundation).toContain(`href="${CREDENTIALING}"`);
  });

  it("sends a signed-out visitor to the sign-in page", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.clearCookies();

    const response = await app.fetch(FOUNDATION);

    expect(response.headers.get("Location")).toBe("/sign-in");
  });

  it("has nothing to show for a Phase that does not exist", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await app.fetch("/tasks/phase-twelve-post-launch");

    expect(response.status).toBe(404);
  });
});

describe("a collapsed Task card", () => {
  it("shows the title and the Body as prose, with the markup thrown away", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    rewriteBody(app, EIN, "**Free** from the IRS. Never buy one.");

    const foundation = await page(app, FOUNDATION);

    expect(foundation).toContain("Free from the IRS. Never buy one.");
    expect(foundation).not.toContain("**Free**");
  });

  it("keeps the Helpful Links for the drawer rather than the card", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const closed = await page(app, FOUNDATION);
    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(closed).not.toContain("Apply for an EIN online (IRS)");
    expect(open).toContain("Apply for an EIN online (IRS)");
  });

  it("marks a Task that Varies by state on the row itself", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const foundation = await page(app, FOUNDATION);

    // Business Structure Decision is state-specific in the Library; Join DPC
    // Alliance is not, which is what makes the pill mean anything.
    expect(foundation).toContain("Varies by state");
    expect(foundation.indexOf("Varies by state")).toBeGreaterThan(
      foundation.indexOf("Business Structure Decision"),
    );
  });
});

describe("opening a Task", () => {
  it("shows the full Body without leaving the Phase", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    // The list is still there underneath: the drawer is a panel over the
    // Phase, not a page the physician navigated to.
    expect(open).toContain("Join DPC Alliance");
    expect(open).toContain("Employer Identification Number from IRS");
    expect(open).toContain(`href="${FOUNDATION}"`);
  });

  it("renders the Body as Markdown", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    rewriteBody(app, EIN, "Do this:\n\n- Apply online\n- Keep the letter\n");

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).toContain("<li>Apply online</li>");
    expect(open).toContain("<li>Keep the letter</li>");
  });

  it("lets admin-authored HTML through, and sanitizes it", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    rewriteBody(
      app,
      EIN,
      '<p><strong>Free</strong> from the IRS.</p>\n' +
        '<script>alert("x")</script>\n' +
        '<a href="javascript:alert(1)">tap</a>\n' +
        '<img src="x" onerror="alert(1)">',
    );

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).toContain("<strong>Free</strong> from the IRS.");
    // Nothing of the three attacks survives anywhere on the page, the
    // serialized loader data included.
    expect(open).not.toContain("alert");
    expect(open).not.toContain("javascript:");
    expect(open).not.toContain("onerror");
  });

  it("gives a Helpful Link a readable label and the domain beneath it", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).toContain("Apply for an EIN online (IRS)");
    // The domain, not the URL, and `www.` is noise a physician did not ask for.
    expect(open).toContain(">irs.gov<");
  });

  it("says `no link set` for a link with no destination, and does not link it", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.database
      .insert(helpfulLink)
      .values({
        globalTaskId: globalTaskIdOf(app, EIN),
        label: "State filing portal",
        url: "",
        position: 2,
      })
      .run();

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).toContain("State filing portal");
    expect(open).toContain("no link set");
    expect(open).not.toContain('href=""');
  });

  it("stays on the list when the link names a Task that is not there", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await app.fetch(`${FOUNDATION}?task=no-such-task`);

    expect(response.status).toBe(200);
    expect(await readable(response)).toContain("Obtain EIN");
  });
});

describe("Dependencies, which are advice and never a lock", () => {
  it("says what a Task usually comes after while that Task is outstanding", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).toContain("usually after Register Legal Business Name");
  });

  it("names the target's Phase when it is a different one", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const open = await page(app, `${CREDENTIALING}?task=${BUSINESS_LICENCE}`);

    expect(open).toContain(
      "usually after Register Legal Business Name, in Foundation &amp; Planning",
    );
  });

  it("drops the advice once the Task it names is done", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    setStatus(app, PHYSICIAN, REGISTER_NAME, "done");

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).not.toContain("usually after");
  });

  it("drops the advice when the Task it names will never apply", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    setStatus(app, PHYSICIAN, REGISTER_NAME, "not_applicable");

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    // Waiting for something that is never coming is worse advice than none.
    expect(open).not.toContain("usually after");
  });

  it("locks nothing: an outstanding Dependency still opens and still reads", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).toContain("Employer Identification Number from IRS");
    expect(open).not.toMatch(/locked|blocked|unavailable/i);
  });
});

describe("where a Task sits in its Phase", () => {
  it("sorts In progress, then not started, then Done, then Not Applicable", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    setStatus(app, PHYSICIAN, BUSINESS_STRUCTURE, "done");
    setStatus(app, PHYSICIAN, REGISTER_NAME, "not_applicable");
    setStatus(app, PHYSICIAN, EIN, "in_progress");

    const foundation = await page(app, FOUNDATION);
    const order = [
      "Obtain EIN",
      "Business Name Brainstorm",
      "Business Structure Decision",
      "Register Legal Business Name",
    ].map((title) => foundation.indexOf(title));

    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(Math.min(...order)).toBeGreaterThan(0);
  });

  it("dims a Not Applicable Task to its title alone, and never hides it", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    setStatus(app, PHYSICIAN, REGISTER_NAME, "not_applicable");

    const foundation = await page(app, FOUNDATION);

    // ADR-0002 rests on this: the Tailoring Wizard records nothing about what
    // it set aside, and what makes that safe is that the Task is still here.
    expect(foundation).toContain("Register Legal Business Name");
    expect(foundation).toContain("Not applicable");
    expect(foundation).not.toContain(
      "File Articles of Organization/Incorporation with State.",
    );
  });
});

describe("a Practice's own Tasks on the same list", () => {
  it("shows a Custom Task in its Phase, behind the Library's Tasks", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    const id = insertCustomTask(app, PHYSICIAN, "Ask my accountant about S-Corp");

    const foundation = await page(app, FOUNDATION);
    const open = await page(app, `${FOUNDATION}?task=custom-${id}`);

    expect(foundation).toContain("Ask my accountant about S-Corp");
    expect(foundation.indexOf("Ask my accountant")).toBeGreaterThan(
      foundation.indexOf("Join DPC Alliance"),
    );
    expect(open).toContain("The one in Cincinnati, not the one here.");
  });

  it("never renders raw HTML a physician typed into a Custom Task", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    const id = insertCustomTask(app, PHYSICIAN, "Ask about <b>S-Corp</b>", {
      body: "Call them <script>alert(1)</script> about <b>this</b>",
    });

    const open = await page(app, `${FOUNDATION}?task=custom-${id}`);

    // Raw HTML is off at the parser for a Practice's own writing, so what
    // they typed is shown back to them as text, tags and all. The Admin's
    // Bodies are the only place markup passes through.
    expect(open).toContain("&lt;b&gt;this&lt;/b&gt;");
    expect(open).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(open).not.toContain("<script>alert");
  });

  it("never opens another Practice's Custom Task", async () => {
    const app = newApp();
    await signInAs(app, OTHER_PHYSICIAN);
    const theirs = insertCustomTask(app, OTHER_PHYSICIAN, "Okafor lease review");
    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    const open = await page(app, `${FOUNDATION}?task=custom-${theirs}`);

    expect(open).not.toContain("Okafor");
    expect(open).toContain("Obtain EIN");
  });
});

/** A Custom Task, written straight into the table the editor will write to. */
function insertCustomTask(
  app: TestApp,
  email: string,
  title: string,
  options: { body?: string } = {},
): number {
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
      body: options.body ?? "The one in Cincinnati, not the one here.",
    })
    .returning({ id: customTask.id })
    .get();

  return inserted.id;
}
