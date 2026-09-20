import { and, eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import { customTask, globalTask, membership, taskEntry, user } from "~/database/schema";
import { createTestApp, signInAs, type TestApp } from "./harness";

/**
 * Seam 1, on the Tasks a Practice writes for itself.
 *
 * A Custom Task is the one piece of content a physician authors, and the one
 * row in the product a Practice may destroy outright — so what these tests
 * assert is what the physician can see afterwards: the card on the Phase,
 * where it sits among the Library's Tasks, and whether the row is still
 * there. Nothing here reaches past the request.
 */

const PHYSICIAN = "dr.reed@example.com";
const OTHER_PHYSICIAN = "dr.okafor@example.com";

const FOUNDATION = "/tasks/foundation-planning";
const CREDENTIALING = "/tasks/credentialing-compliance";

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

function post(
  app: TestApp,
  phasePath: string,
  fields: Record<string, string>,
): Promise<Response> {
  return app.fetch(phasePath, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

/** Add a Custom Task the way the form on the Phase does. */
function add(
  app: TestApp,
  phasePath: string,
  title: string,
  body = "The one in Cincinnati, not the one here.",
): Promise<Response> {
  return post(app, phasePath, { intent: "add-task", title, body });
}

/** The Custom Tasks a Practice holds, oldest first. */
function customTasksOf(app: TestApp, email: string) {
  return app.database
    .select({
      id: customTask.id,
      title: customTask.title,
      body: customTask.body,
      status: customTask.status,
      note: customTask.note,
      targetDate: customTask.targetDate,
    })
    .from(customTask)
    .where(eq(customTask.practiceId, practiceIdOf(app, email)))
    .all();
}

/** The one Custom Task a test just added. */
function onlyCustomTask(app: TestApp, email: string) {
  const rows = customTasksOf(app, email);
  if (rows.length !== 1) {
    throw new Error(`Expected one Custom Task, found ${rows.length}`);
  }
  return rows[0];
}

describe("adding a Task of your own", () => {
  it("puts it in the Phase it was written on, alongside the Library's Tasks", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await add(app, FOUNDATION, "Ask my accountant about S-Corp");
    const added = onlyCustomTask(app, PHYSICIAN);

    // The answer to the press is the list, with the new card flashing where
    // it landed — the same answer a Status change gets.
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${FOUNDATION}?moved=custom-${added.id}`,
    );

    const foundation = await page(app, FOUNDATION);
    expect(foundation).toContain("Ask my accountant about S-Corp");
    expect(added.status).toBe("not_started");
  });

  it("puts it in the Phase in view and no other", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await add(app, CREDENTIALING, "Chase the hospital privileges form");

    const credentialing = await page(app, CREDENTIALING);
    const foundation = await page(app, FOUNDATION);

    expect(credentialing).toContain("Chase the hospital privileges form");
    expect(foundation).not.toContain("Chase the hospital privileges form");
  });

  it("refuses a Task with no title, and writes nothing", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await add(app, FOUNDATION, "   ", "A body and no title");

    expect(response.status).toBe(400);
    expect(customTasksOf(app, PHYSICIAN)).toHaveLength(0);
  });

  it("takes a Task with a title and no body at all", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await add(app, FOUNDATION, "Call the landlord back", "");

    const foundation = await page(app, FOUNDATION);
    expect(onlyCustomTask(app, PHYSICIAN).body).toBe("");
    expect(foundation).toContain("Call the landlord back");
  });

  it("shows it to nobody else", async () => {
    const app = newApp();
    await signInAs(app, OTHER_PHYSICIAN);
    await add(app, FOUNDATION, "Okafor lease review");
    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    const foundation = await page(app, FOUNDATION);

    expect(foundation).not.toContain("Okafor");
    expect(customTasksOf(app, PHYSICIAN)).toHaveLength(0);
  });

  it("sends a signed-out visitor to the door rather than writing anything", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    const practiceId = practiceIdOf(app, PHYSICIAN);
    app.clearCookies();

    const response = await add(app, FOUNDATION, "Not mine to add");

    expect(response.headers.get("Location")).toBe("/sign-in");
    expect(
      app.database
        .select({ id: customTask.id })
        .from(customTask)
        .where(eq(customTask.practiceId, practiceId))
        .all(),
    ).toHaveLength(0);
  });

  it("renders the body a physician typed with raw HTML off at the parser", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await add(
      app,
      FOUNDATION,
      "Ask about S-Corp",
      "Call them <script>alert(1)</script> about <b>this</b>",
    );
    const added = onlyCustomTask(app, PHYSICIAN);

    const open = await page(app, `${FOUNDATION}?task=custom-${added.id}`);

    expect(open).toContain("&lt;b&gt;this&lt;/b&gt;");
    expect(open).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(open).not.toContain("<script>alert");
  });

  it("carries a Status, a Note and a target date exactly as a Global Task does", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await add(app, FOUNDATION, "Ask my accountant about S-Corp");
    const ref = `custom-${onlyCustomTask(app, PHYSICIAN).id}`;

    await post(app, FOUNDATION, { taskRef: ref, status: "in_progress" });
    await post(app, FOUNDATION, {
      intent: "note",
      taskRef: ref,
      note: "He calls back Thursdays.",
      targetDate: "2026-01-06",
    });

    const written = onlyCustomTask(app, PHYSICIAN);
    expect(written.status).toBe("in_progress");
    expect(written.note).toBe("He calls back Thursdays.");
    expect(written.targetDate).toEqual(new Date("2026-01-06T00:00:00.000Z"));

    const open = await page(app, `${FOUNDATION}?task=${ref}`);
    expect(open).toContain("He calls back Thursdays.");
    expect(open).toContain("January 6, 2026");
  });

  it("offers no Helpful Links and no Dependencies, because it has none", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await add(app, FOUNDATION, "Ask my accountant about S-Corp");
    const ref = `custom-${onlyCustomTask(app, PHYSICIAN).id}`;

    const open = await page(app, `${FOUNDATION}?task=${ref}`);

    // Structurally lighter by schema (ADR-0003): there is nowhere for a link
    // or a dependency to be stored, so there is nothing to render.
    expect(open).not.toContain("Helpful links");
    expect(open).not.toContain("usually after");
  });
});

describe("where a Practice's own Tasks sit in the list", () => {
  it("queues them behind the Library's Tasks, in the order they were written", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await add(app, FOUNDATION, "First thing I thought of");
    await add(app, FOUNDATION, "Second thing I thought of");

    const foundation = await page(app, FOUNDATION);

    expect(foundation.indexOf("First thing I thought of")).toBeGreaterThan(
      foundation.indexOf("Join DPC Alliance"),
    );
    expect(foundation.indexOf("Second thing I thought of")).toBeGreaterThan(
      foundation.indexOf("First thing I thought of"),
    );
  });

  it("sorts them by Status first, like every other Task", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await add(app, FOUNDATION, "First thing I thought of");
    await add(app, FOUNDATION, "Second thing I thought of");
    const second = customTasksOf(app, PHYSICIAN)[1];

    await post(app, FOUNDATION, {
      taskRef: `custom-${second.id}`,
      status: "in_progress",
    });
    const foundation = await page(app, FOUNDATION);

    // In progress is what the physician is holding, so it rises above the
    // Library's untouched Tasks as well as above the Task written before it.
    expect(foundation.indexOf("Second thing I thought of")).toBeLessThan(
      foundation.indexOf("Join DPC Alliance"),
    );
    expect(foundation.indexOf("Second thing I thought of")).toBeLessThan(
      foundation.indexOf("First thing I thought of"),
    );
  });
});

describe("deleting a Task of your own", () => {
  it("destroys the row outright — the one delete that is not a soft one", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await add(app, FOUNDATION, "Ask my accountant about S-Corp");
    const ref = `custom-${onlyCustomTask(app, PHYSICIAN).id}`;

    const response = await post(app, FOUNDATION, {
      intent: "delete-task",
      taskRef: ref,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(FOUNDATION);
    expect(customTasksOf(app, PHYSICIAN)).toHaveLength(0);

    const foundation = await page(app, FOUNDATION);
    expect(foundation).not.toContain("Ask my accountant about S-Corp");
  });

  it("asks before it does it, from the drawer", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await add(app, FOUNDATION, "Ask my accountant about S-Corp");
    const ref = `custom-${onlyCustomTask(app, PHYSICIAN).id}`;

    const open = await page(app, `${FOUNDATION}?task=${ref}`);
    const asking = await page(app, `${FOUNDATION}?task=${ref}&confirm=delete`);

    expect(open).toContain("Delete this task");
    expect(asking).toContain("This cannot be undone");
    expect(customTasksOf(app, PHYSICIAN)).toHaveLength(1);
  });

  it("never offers the delete on a Global Task", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).toContain("Obtain EIN");
    expect(open).not.toContain("Delete this task");
  });

  it("refuses a Global Task, whatever a hand-written post says", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await post(app, FOUNDATION, {
      intent: "delete-task",
      taskRef: EIN,
    });

    expect(response.status).toBe(404);
    expect(
      app.database
        .select({ id: taskEntry.id })
        .from(taskEntry)
        .innerJoin(globalTask, eq(taskEntry.globalTaskId, globalTask.id))
        .where(
          and(
            eq(taskEntry.practiceId, practiceIdOf(app, PHYSICIAN)),
            eq(globalTask.slug, EIN),
          ),
        )
        .all(),
    ).toHaveLength(1);
  });

  it("refuses another Practice's Custom Task", async () => {
    const app = newApp();
    await signInAs(app, OTHER_PHYSICIAN);
    await add(app, FOUNDATION, "Okafor lease review");
    const theirs = onlyCustomTask(app, OTHER_PHYSICIAN);
    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    const response = await post(app, FOUNDATION, {
      intent: "delete-task",
      taskRef: `custom-${theirs.id}`,
    });

    expect(response.status).toBe(404);
    expect(customTasksOf(app, OTHER_PHYSICIAN)).toHaveLength(1);
  });
});
