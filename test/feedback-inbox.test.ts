import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import { feedback, globalTask } from "~/database/schema";
import {
  createTestApp,
  promoteToAdmin,
  signInAs,
  type TestApp,
} from "./harness";

/**
 * Seam 1, on the Admin's two doors onto Feedback.
 *
 * The queue is the point of the section: what a physician sent this morning
 * and nobody has finished with is what the page opens on, and an archive
 * that buried it under six months of Done rows would be the feature
 * failing. So the load-bearing assertions here are about what is *not* on
 * the default view, and about the absences the vocabulary was chosen for —
 * no Dismissed, no delete, no reply box, no kind.
 *
 * The second door is the Task edit screen, and the reason it exists is
 * arithmetic the Admin should never have to do by hand: three complaints
 * about one Body mean that Body needs rewriting, and they are only
 * obviously three if they are counted in one place.
 */

const ADMIN = "operator@directcaretools.com";
const PHYSICIAN = "dr.reed@example.com";
const OTHER_PHYSICIAN = "dr.okafor@example.com";

const FOUNDATION = "/tasks/foundation-planning";
const EIN = "obtain-ein-employer-identification-number";
const EIN_TITLE = "Obtain EIN";
const LICENSE = "obtain-state-medical-license";

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

/** The page as plain words, for reading a sentence off it. */
async function words(response: Response): Promise<string> {
  return (await response.text())
    .replaceAll("<!-- -->", "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function markup(app: TestApp, path: string): Promise<string> {
  return (await app.fetch(path)).text();
}

async function page(app: TestApp, path: string): Promise<string> {
  return words(await app.fetch(path));
}

function post(body: Record<string, string>): RequestInit {
  return {
    method: "post",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  };
}

/** Sign in the way everyone does, then run the statement the operator runs. */
async function signInAsAdmin(app: TestApp): Promise<void> {
  await signInAs(app, ADMIN);
  promoteToAdmin(app, ADMIN);
}

/** Send one Feedback as a physician, through the real box. */
async function send(
  app: TestApp,
  written: { text: string; from?: string; task?: string },
): Promise<void> {
  await app.fetch(
    "/feedback",
    post({
      text: written.text,
      from: written.from ?? FOUNDATION,
      task: written.task ?? "",
    }),
  );
}

function taskIdOf(app: TestApp, slug: string): number {
  const row = app.database
    .select({ id: globalTask.id })
    .from(globalTask)
    .where(eq(globalTask.slug, slug))
    .get();
  if (!row) throw new Error(`No Global Task with the slug ${slug}`);
  return row.id;
}

function idOfFeedbackSaying(app: TestApp, text: string): number {
  const row = app.database
    .select({ id: feedback.id })
    .from(feedback)
    .where(eq(feedback.text, text))
    .get();
  if (!row) throw new Error(`No Feedback saying ${text}`);
  return row.id;
}

function rowSaying(app: TestApp, text: string) {
  const row = app.database
    .select()
    .from(feedback)
    .where(eq(feedback.text, text))
    .get();
  if (!row) throw new Error(`No Feedback saying ${text}`);
  return row;
}

/** Press Done on a Feedback from the inbox. */
async function pressDone(
  app: TestApp,
  id: number,
  note = "",
): Promise<Response> {
  return app.fetch(
    "/admin/feedback",
    post({ intent: "feedback-done", feedbackId: String(id), doneNote: note }),
  );
}

describe("the Feedback section", () => {
  it("opens on New only, newest first", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });
    await send(app, { text: "This phase is in the wrong order." });
    app.clearCookies();
    await signInAsAdmin(app);

    const inbox = await page(app, "/admin/feedback");

    expect(inbox).toContain("The SS-4 link goes to the wrong form.");
    expect(inbox).toContain("This phase is in the wrong order.");
    expect(inbox.indexOf("This phase is in the wrong order.")).toBeLessThan(
      inbox.indexOf("The SS-4 link goes to the wrong form."),
    );
  });

  it("carries the address to write back to, and no way to reply in the product", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });
    app.clearCookies();
    await signInAsAdmin(app);

    const inbox = await markup(app, "/admin/feedback");

    expect(inbox).toContain(PHYSICIAN);
    expect(await words(new Response(inbox))).not.toContain("Reply");
  });

  it("carries the page it was sent from, as a link the Admin can follow", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, {
      text: "The SS-4 link goes to the wrong form.",
      from: `${FOUNDATION}?task=${EIN}`,
      task: EIN,
    });
    app.clearCookies();
    await signInAsAdmin(app);

    expect(await markup(app, "/admin/feedback")).toContain(
      `${FOUNDATION}?task=${EIN}`,
    );
  });

  it("keeps listing a Feedback whose author has since gone", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "This phase is in the wrong order." });
    app.database
      .update(feedback)
      .set({ authorUserId: null })
      .where(eq(feedback.text, "This phase is in the wrong order."))
      .run();
    app.clearCookies();
    await signInAsAdmin(app);

    const inbox = await page(app, "/admin/feedback");

    expect(inbox).toContain("This phase is in the wrong order.");
    expect(inbox).toContain("no address");
  });

  it("has no kind to filter by, because there is no kind", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const inbox = await markup(app, "/admin/feedback");

    expect(inbox).not.toContain("<select");
    expect((await words(new Response(inbox))).toLowerCase()).not.toContain(
      "category",
    );
  });

  it("offers no delete and no dismiss", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });
    app.clearCookies();
    await signInAsAdmin(app);

    const inbox = await page(app, "/admin/feedback");

    expect(inbox).not.toContain("Delete");
    expect(inbox).not.toContain("Dismiss");
  });

  it("is a 404 for a physician, POST as well as GET", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });
    const id = idOfFeedbackSaying(app, "The SS-4 link goes to the wrong form.");

    const response = await pressDone(app, id, "Fixed.");

    expect(response.status).toBe(404);
    expect(rowSaying(app, "The SS-4 link goes to the wrong form.").doneAt).toBeNull();
  });
});

describe("New and Done", () => {
  it("takes a Feedback out of the queue and keeps the line that finished it", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });
    app.clearCookies();
    await signInAsAdmin(app);
    const id = idOfFeedbackSaying(app, "The SS-4 link goes to the wrong form.");

    await pressDone(app, id, "Pointed it at the current SS-4.");

    const row = rowSaying(app, "The SS-4 link goes to the wrong form.");
    expect(row.doneAt).not.toBeNull();
    expect(row.doneNote).toBe("Pointed it at the current SS-4.");

    expect(await page(app, "/admin/feedback")).not.toContain(
      "The SS-4 link goes to the wrong form.",
    );

    const done = await page(app, "/admin/feedback?show=done");
    expect(done).toContain("The SS-4 link goes to the wrong form.");
    expect(done).toContain("Pointed it at the current SS-4.");
  });

  it("takes a Done with no note at all, because disagreeing is a finished outcome", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "Rename every task to be shorter." });
    app.clearCookies();
    await signInAsAdmin(app);

    await pressDone(app, idOfFeedbackSaying(app, "Rename every task to be shorter."));

    const row = rowSaying(app, "Rename every task to be shorter.");
    expect(row.doneAt).not.toBeNull();
    expect(row.doneNote).toBeNull();
  });

  it("shows New and Done together on request, and never deletes either", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });
    await send(app, { text: "This phase is in the wrong order." });
    app.clearCookies();
    await signInAsAdmin(app);
    await pressDone(app, idOfFeedbackSaying(app, "The SS-4 link goes to the wrong form."));

    const all = await page(app, "/admin/feedback?show=all");

    expect(all).toContain("The SS-4 link goes to the wrong form.");
    expect(all).toContain("This phase is in the wrong order.");
    expect(app.database.select().from(feedback).all()).toHaveLength(2);
  });

  it("keeps the note to one line, whatever was pasted into it", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });
    app.clearCookies();
    await signInAsAdmin(app);

    await pressDone(
      app,
      idOfFeedbackSaying(app, "The SS-4 link goes to the wrong form."),
      "Fixed the link.\n\nAlso  reworded the paragraph.",
    );

    expect(rowSaying(app, "The SS-4 link goes to the wrong form.").doneNote).toBe(
      "Fixed the link. Also reworded the paragraph.",
    );
  });

  it("refuses a note that is not a line, and leaves the Feedback New", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });
    app.clearCookies();
    await signInAsAdmin(app);

    const response = await pressDone(
      app,
      idOfFeedbackSaying(app, "The SS-4 link goes to the wrong form."),
      "a".repeat(201),
    );

    expect(await words(response)).toContain("one line");
    expect(rowSaying(app, "The SS-4 link goes to the wrong form.").doneAt).toBeNull();
  });

  it("refuses to finish the same Feedback twice", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link goes to the wrong form." });
    app.clearCookies();
    await signInAsAdmin(app);
    const id = idOfFeedbackSaying(app, "The SS-4 link goes to the wrong form.");
    await pressDone(app, id, "Fixed the link.");

    await pressDone(app, id, "Fixed it again.");

    expect(rowSaying(app, "The SS-4 link goes to the wrong form.").doneNote).toBe(
      "Fixed the link.",
    );
  });
});

describe("grouping by Task", () => {
  it("counts three complaints about one Body as three", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link is wrong.", task: EIN });
    await send(app, { text: "This body says nothing about a sole proprietor.", task: EIN });
    await send(app, { text: "The EIN section contradicts itself.", task: EIN });
    await send(app, { text: "The license fee is out of date.", task: LICENSE });
    app.clearCookies();
    await signInAsAdmin(app);

    const grouped = await page(app, "/admin/feedback?group=task");

    expect(grouped).toContain(EIN_TITLE);
    expect(grouped).toContain("3 pieces of feedback");
    // The Body complained about three times comes first: that is the whole
    // reason to group.
    expect(grouped.indexOf(EIN_TITLE)).toBeLessThan(
      grouped.indexOf("The license fee is out of date."),
    );
  });

  it("counts what a Body has drawn in total, not only what is unfinished", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link is wrong.", task: EIN });
    await send(app, { text: "The EIN body contradicts itself.", task: EIN });
    await send(app, { text: "The EIN body is too long.", task: EIN });
    app.clearCookies();
    await signInAsAdmin(app);
    await pressDone(app, idOfFeedbackSaying(app, "The SS-4 link is wrong."), "Fixed.");
    await pressDone(
      app,
      idOfFeedbackSaying(app, "The EIN body contradicts itself."),
      "Rewrote it.",
    );

    const grouped = await page(app, "/admin/feedback?group=task");

    // A Body complained about three times is a Body to rewrite even once two
    // of the three are finished, so the weight of the group never shrinks.
    expect(grouped).toContain("1 of 3 pieces of feedback in view");
  });

  it("puts the most complained-about Body first however the page is filtered", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link is wrong.", task: EIN });
    await send(app, { text: "The EIN body contradicts itself.", task: EIN });
    await send(app, { text: "The license fee is out of date.", task: LICENSE });
    app.clearCookies();
    await signInAsAdmin(app);
    await pressDone(app, idOfFeedbackSaying(app, "The SS-4 link is wrong."), "Fixed.");

    const grouped = await page(app, "/admin/feedback?group=task");

    expect(grouped.indexOf(EIN_TITLE)).toBeLessThan(
      grouped.indexOf("The license fee is out of date."),
    );
  });

  it("links a group to the screen where the fix is typed", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link is wrong.", task: EIN });
    app.clearCookies();
    await signInAsAdmin(app);

    expect(await markup(app, "/admin/feedback?group=task")).toContain(
      `/admin/library/tasks/${taskIdOf(app, EIN)}`,
    );
  });

  it("gathers the Feedback about no library task of its own", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The phase rail scrolls oddly.", from: "/settings" });
    app.clearCookies();
    await signInAsAdmin(app);

    const grouped = await page(app, "/admin/feedback?group=task");

    expect(grouped).toContain("Not about a task in the library");
    expect(grouped).toContain("The phase rail scrolls oddly.");
  });

  it("groups by the Task and not by the title it was sent with", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link is wrong.", task: EIN });
    app.database
      .update(globalTask)
      .set({ title: "Get your EIN from the IRS" })
      .where(eq(globalTask.slug, EIN))
      .run();
    await send(app, { text: "Still wrong after the rename.", task: EIN });
    app.clearCookies();
    await signInAsAdmin(app);

    const grouped = await page(app, "/admin/feedback?group=task");

    // One group, headed by the title as the Library reads now — which is
    // often the very fix the feedback asked for.
    expect(grouped).toContain("Get your EIN from the IRS");
    expect(grouped).toContain("2 pieces of feedback");
    expect(grouped).not.toContain(EIN_TITLE);
  });
});

describe("Feedback on the Task edit screen", () => {
  it("shows the complaint where the fix is typed", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link is wrong.", task: EIN });
    await send(app, { text: "The license fee is out of date.", task: LICENSE });
    app.clearCookies();
    await signInAsAdmin(app);

    const edit = await page(app, `/admin/library/tasks/${taskIdOf(app, EIN)}`);

    expect(edit).toContain("The SS-4 link is wrong.");
    expect(edit).not.toContain("The license fee is out of date.");
  });

  it("says so plainly when a Task has none", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const edit = await page(app, `/admin/library/tasks/${taskIdOf(app, EIN)}`);

    expect(edit).toContain("No feedback");
  });

  it("finishes one from there, without leaving the Body", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link is wrong.", task: EIN });
    app.clearCookies();
    await signInAsAdmin(app);
    const here = `/admin/library/tasks/${taskIdOf(app, EIN)}`;

    const response = await app.fetch(
      here,
      post({
        intent: "feedback-done",
        feedbackId: String(idOfFeedbackSaying(app, "The SS-4 link is wrong.")),
        doneNote: "Rewrote the paragraph.",
      }),
    );

    expect(response.headers.get("Location")).toBe(here);
    const row = rowSaying(app, "The SS-4 link is wrong.");
    expect(row.doneAt).not.toBeNull();
    expect(row.doneNote).toBe("Rewrote the paragraph.");
  });

  it("keeps a finished one on the screen, with the line that finished it", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link is wrong.", task: EIN });
    app.clearCookies();
    await signInAsAdmin(app);
    await pressDone(
      app,
      idOfFeedbackSaying(app, "The SS-4 link is wrong."),
      "Rewrote the paragraph.",
    );

    const edit = await page(app, `/admin/library/tasks/${taskIdOf(app, EIN)}`);

    expect(edit).toContain("The SS-4 link is wrong.");
    expect(edit).toContain("Rewrote the paragraph.");
  });

  it("shows Feedback from every Practice that sent some about the Task", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await send(app, { text: "The SS-4 link is wrong.", task: EIN });
    app.clearCookies();
    await signInAs(app, OTHER_PHYSICIAN);
    await send(app, { text: "The EIN body is too long.", task: EIN });
    app.clearCookies();
    await signInAsAdmin(app);

    const edit = await page(app, `/admin/library/tasks/${taskIdOf(app, EIN)}`);

    expect(edit).toContain("The SS-4 link is wrong.");
    expect(edit).toContain("The EIN body is too long.");
  });
});
