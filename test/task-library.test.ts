import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  globalTask,
  helpfulLink,
  membership,
  phase,
  taskEntry,
  user,
} from "~/database/schema";
import {
  createTestApp,
  promoteToAdmin,
  signInAs,
  type TestApp,
} from "./harness";

/**
 * Seam 1, on the thing the whole product is built to allow: a Body fix typed
 * today reaching every Practice already in flight, with no deploy and no
 * re-download.
 *
 * Both sides of every act are asserted here, because either half alone is
 * the feature failing quietly. The Admin presses Publish and sees the Task
 * in the Library; the physician's list is the other half, and it is the one
 * that matters — a publish that leaves a Practice without a Task Entry is a
 * backfill bug, and the only place it shows is on somebody's Phase.
 *
 * Draft invisibility is asserted as an absence of rows and not only as an
 * absence of markup: a Draft is *not merely hidden*, so the assertion that
 * carries the meaning is that no Practice has an Entry for it.
 */

const ADMIN = "operator@directcaretools.com";
const PHYSICIAN = "dr.reed@example.com";
const OTHER_PHYSICIAN = "dr.okafor@example.com";

const FOUNDATION = "Foundation & Planning";
const FOUNDATION_LIST = "/tasks/foundation-planning";

/** A real Task from the real Task Library every test app is seeded with. */
const EIN = "obtain-ein-employer-identification-number";
const EIN_TITLE = "Obtain EIN (Employer Identification Number)";

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

async function readable(response: Response): Promise<string> {
  return (await response.text()).replaceAll("<!-- -->", "");
}

/** The same again as plain words, for reading a sentence off the page. */
async function words(response: Response): Promise<string> {
  return (await readable(response))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function page(app: TestApp, path: string): Promise<string> {
  return readable(await app.fetch(path));
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

function phaseIdOf(app: TestApp, name: string): number {
  const row = app.database
    .select({ id: phase.id })
    .from(phase)
    .where(eq(phase.name, name))
    .get();
  if (!row) throw new Error(`No Phase named ${name}`);
  return row.id;
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

function entriesFor(app: TestApp, taskId: number) {
  return app.database
    .select({
      practiceId: taskEntry.practiceId,
      status: taskEntry.status,
      announcedAt: taskEntry.announcedAt,
      acknowledgedAt: taskEntry.acknowledgedAt,
    })
    .from(taskEntry)
    .where(eq(taskEntry.globalTaskId, taskId))
    .all();
}

/** Write a Draft the way the Admin does, and hand back its edit screen. */
async function writeDraft(
  app: TestApp,
  title: string,
  phaseName = FOUNDATION,
): Promise<string> {
  const response = await app.fetch(
    "/admin/library",
    post({
      intent: "new-task",
      title,
      phaseId: String(phaseIdOf(app, phaseName)),
    }),
  );

  const editing = response.headers.get("Location");
  if (!editing) {
    throw new Error(`Writing "${title}" did not land on an edit screen`);
  }
  return editing;
}

/** The Admin's Save, which is the publish gate for an edit. */
function save(
  app: TestApp,
  editing: string,
  edit: { title: string; body: string; phaseName?: string; stateSpecific?: boolean },
): Promise<Response> {
  const fields: Record<string, string> = {
    intent: "save",
    title: edit.title,
    body: edit.body,
    phaseId: String(phaseIdOf(app, edit.phaseName ?? FOUNDATION)),
  };
  if (edit.stateSpecific) fields.stateSpecific = "on";

  return app.fetch(editing, post(fields));
}

describe("a Draft exists for nobody", () => {
  it("gives no Practice a Task Entry", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.clearCookies();
    await signInAsAdmin(app);

    await writeDraft(app, "Check the county sign ordinance");

    const draft = app.database
      .select({ id: globalTask.id, publishedAt: globalTask.publishedAt })
      .from(globalTask)
      .where(eq(globalTask.title, "Check the county sign ordinance"))
      .get();

    expect(draft?.publishedAt).toBeNull();
    // Not merely hidden: there is no row anywhere pointing at it.
    expect(entriesFor(app, draft!.id)).toHaveLength(0);
  });

  it("is not on a physician's list", async () => {
    const app = newApp();
    await signInAsAdmin(app);
    await writeDraft(app, "Check the county sign ordinance");

    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    expect(await page(app, FOUNDATION_LIST)).not.toContain(
      "Check the county sign ordinance",
    );
  });

  it("is on the Admin's Library, said to be a Draft", async () => {
    const app = newApp();
    await signInAsAdmin(app);
    await writeDraft(app, "Check the county sign ordinance");

    const library = await words(await app.fetch("/admin/library"));

    expect(library).toContain("Check the county sign ordinance");
    expect(library).toContain("Draft");
  });
});

describe("publishing is the deliberate act", () => {
  it("gives every existing Practice a Task Entry", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.clearCookies();
    await signInAs(app, OTHER_PHYSICIAN);
    app.clearCookies();
    await signInAsAdmin(app);

    const editing = await writeDraft(app, "Check the county sign ordinance");
    await save(app, editing, {
      title: "Check the county sign ordinance",
      body: "Some counties limit the size of a sign on a leased suite.",
    });
    await app.fetch(editing, post({ intent: "publish" }));

    const taskId = taskIdOf(app, "check-the-county-sign-ordinance");
    const entries = entriesFor(app, taskId);

    // Three Practices: two physicians, and the Admin's own — they signed in
    // the way everyone does, so they have one.
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.practiceId)).toContain(
      practiceIdOf(app, PHYSICIAN),
    );
  });

  it("puts the Task on a list already in flight, flagged Newly added", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.clearCookies();
    await signInAsAdmin(app);

    const editing = await writeDraft(app, "Check the county sign ordinance");
    await save(app, editing, {
      title: "Check the county sign ordinance",
      body: "Some counties limit the size of a sign on a leased suite.",
    });
    await app.fetch(editing, post({ intent: "publish" }));

    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    const list = await words(await app.fetch(FOUNDATION_LIST));
    expect(list).toContain("Check the county sign ordinance");
    expect(list).toContain("Newly added");
  });

  it("flags it to nobody who was not there yet", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const editing = await writeDraft(app, "Check the county sign ordinance");
    await save(app, editing, {
      title: "Check the county sign ordinance",
      body: "Some counties limit the size of a sign on a leased suite.",
    });
    await app.fetch(editing, post({ intent: "publish" }));

    // Registered after the publish, so the Task was simply there.
    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    const taskId = taskIdOf(app, "check-the-county-sign-ordinance");
    const theirs = entriesFor(app, taskId).find(
      (entry) => entry.practiceId === practiceIdOf(app, PHYSICIAN),
    );

    expect(theirs?.announcedAt).toBeNull();
    expect(await words(await app.fetch(FOUNDATION_LIST))).not.toContain(
      "Newly added",
    );
  });

  it("leaves the ninety-eight Tasks a new Practice was born with unflagged", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    expect(await words(await app.fetch(FOUNDATION_LIST))).not.toContain(
      "Newly added",
    );
  });
});

describe("Newly added is cleared by opening the drawer", () => {
  async function publishInto(app: TestApp): Promise<void> {
    await signInAsAdmin(app);
    const editing = await writeDraft(app, "Check the county sign ordinance");
    await save(app, editing, {
      title: "Check the county sign ordinance",
      body: "Some counties limit the size of a sign on a leased suite.",
    });
    await app.fetch(editing, post({ intent: "publish" }));
    app.clearCookies();
  }

  it("is not cleared by viewing the Phase", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.clearCookies();
    await publishInto(app);
    await signInAs(app, PHYSICIAN);

    await app.fetch(FOUNDATION_LIST);
    await app.fetch(FOUNDATION_LIST);

    const entry = entriesFor(app, taskIdOf(app, "check-the-county-sign-ordinance"))
      .find((row) => row.practiceId === practiceIdOf(app, PHYSICIAN));

    expect(entry?.acknowledgedAt).toBeNull();
    expect(await words(await app.fetch(FOUNDATION_LIST))).toContain(
      "Newly added",
    );
  });

  it("is cleared by opening the Task, and stays cleared", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.clearCookies();
    await publishInto(app);
    await signInAs(app, PHYSICIAN);

    await app.fetch(
      `${FOUNDATION_LIST}?task=check-the-county-sign-ordinance`,
    );

    const entry = entriesFor(app, taskIdOf(app, "check-the-county-sign-ordinance"))
      .find((row) => row.practiceId === practiceIdOf(app, PHYSICIAN));

    expect(entry?.announcedAt).not.toBeNull();
    expect(entry?.acknowledgedAt).not.toBeNull();
    expect(await words(await app.fetch(FOUNDATION_LIST))).not.toContain(
      "Newly added",
    );
  });

  it("is one Practice's reading and never another's", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.clearCookies();
    await signInAs(app, OTHER_PHYSICIAN);
    app.clearCookies();
    await publishInto(app);

    await signInAs(app, PHYSICIAN);
    await app.fetch(`${FOUNDATION_LIST}?task=check-the-county-sign-ordinance`);
    app.clearCookies();

    await signInAs(app, OTHER_PHYSICIAN);
    expect(await words(await app.fetch(FOUNDATION_LIST))).toContain(
      "Newly added",
    );
  });
});

describe("editing a live Task reaches every Practice on save", () => {
  it("changes nothing until Save is pressed", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.clearCookies();
    await signInAsAdmin(app);

    // Merely opening the edit screen is not an edit: there is no autosave,
    // so reading a Task can never broadcast a half-typed sentence.
    await app.fetch(`/admin/library/tasks/${taskIdOf(app, EIN)}`);

    const body = app.database
      .select({ body: globalTask.body })
      .from(globalTask)
      .where(eq(globalTask.slug, EIN))
      .get();

    expect(body?.body).not.toBe("");
  });

  it("reaches a Practice already in flight the moment it is saved", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.clearCookies();
    await signInAsAdmin(app);

    await save(app, `/admin/library/tasks/${taskIdOf(app, EIN)}`, {
      title: EIN_TITLE,
      body: "Apply on the IRS site. It is free, and it takes ten minutes.",
    });

    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    expect(await page(app, `${FOUNDATION_LIST}?task=${EIN}`)).toContain(
      "It is free, and it takes ten minutes.",
    );
  });

  it("never renames the slug a physician's address carries", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    await save(app, `/admin/library/tasks/${taskIdOf(app, EIN)}`, {
      title: "Obtain an EIN from the IRS",
      body: "Apply on the IRS site.",
    });

    const row = app.database
      .select({ slug: globalTask.slug, title: globalTask.title })
      .from(globalTask)
      .where(eq(globalTask.id, taskIdOf(app, EIN)))
      .get();

    expect(row?.title).toBe("Obtain an EIN from the IRS");
    expect(row?.slug).toBe(EIN);
  });
});

describe("Retiring, which is never a delete", () => {
  /** A Practice that did the work, and one that never touched the Task. */
  async function twoPractices(app: TestApp): Promise<void> {
    await signInAs(app, PHYSICIAN);
    await app.fetch(
      FOUNDATION_LIST,
      post({ taskRef: EIN, status: "done" }),
    );
    app.clearCookies();
    await signInAs(app, OTHER_PHYSICIAN);
    app.clearCookies();
  }

  it("keeps the Entry of a Practice that did the work, and drops the rest", async () => {
    const app = newApp();
    await twoPractices(app);
    await signInAsAdmin(app);

    await app.fetch(
      `/admin/library/tasks/${taskIdOf(app, EIN)}`,
      post({ intent: "retire" }),
    );

    const entries = entriesFor(app, taskIdOf(app, EIN));
    const kept = entries.map((entry) => entry.practiceId);

    expect(kept).toEqual([practiceIdOf(app, PHYSICIAN)]);
    expect(entries[0]?.status).toBe("done");
  });

  it("simply disappears for a Practice that never touched it", async () => {
    const app = newApp();
    await twoPractices(app);
    await signInAsAdmin(app);
    await app.fetch(
      `/admin/library/tasks/${taskIdOf(app, EIN)}`,
      post({ intent: "retire" }),
    );

    app.clearCookies();
    await signInAs(app, OTHER_PHYSICIAN);

    expect(await page(app, FOUNDATION_LIST)).not.toContain(EIN_TITLE);
  });

  it("stays, marked No longer required, for the Practice that did", async () => {
    const app = newApp();
    await twoPractices(app);
    await signInAsAdmin(app);
    await app.fetch(
      `/admin/library/tasks/${taskIdOf(app, EIN)}`,
      post({ intent: "retire" }),
    );

    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    const list = await words(await app.fetch(FOUNDATION_LIST));
    expect(list).toContain(EIN_TITLE);
    expect(list).toContain("No longer required");
  });

  it("un-retires by the same backfill as publishing", async () => {
    const app = newApp();
    await twoPractices(app);
    await signInAsAdmin(app);

    const editing = `/admin/library/tasks/${taskIdOf(app, EIN)}`;
    await app.fetch(editing, post({ intent: "retire" }));
    await app.fetch(editing, post({ intent: "unretire" }));

    const entries = entriesFor(app, taskIdOf(app, EIN));

    // Everyone has an Entry again, and the Practice that lost theirs is told
    // about the Task the way any Practice is told about a new one.
    expect(entries).toHaveLength(3);
    const returned = entries.find(
      (entry) => entry.practiceId === practiceIdOf(app, OTHER_PHYSICIAN),
    );
    expect(returned?.announcedAt).not.toBeNull();
    expect(returned?.acknowledgedAt).toBeNull();

    const kept = entries.find(
      (entry) => entry.practiceId === practiceIdOf(app, PHYSICIAN),
    );
    expect(kept?.status).toBe("done");
    expect(kept?.announcedAt).toBeNull();
  });

  it("sends no banner and no email", async () => {
    const app = newApp();
    await twoPractices(app);
    await signInAsAdmin(app);

    const before = app.emailSender.sent.length;
    await app.fetch(
      `/admin/library/tasks/${taskIdOf(app, EIN)}`,
      post({ intent: "retire" }),
    );

    expect(app.emailSender.sent).toHaveLength(before);
  });
});

describe("a Phase cannot be deleted out from under its Tasks", () => {
  it("refuses while it still holds Tasks, retired ones included", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const response = await app.fetch(
      "/admin/library",
      post({
        intent: "delete-phase",
        phaseId: String(phaseIdOf(app, FOUNDATION)),
        reassignTo: "",
      }),
    );

    expect(await words(response)).toContain("reassign");
    expect(
      app.database.select({ id: phase.id }).from(phase).all(),
    ).toHaveLength(11);
  });

  it("deletes it once its Tasks are reassigned in the same dialog", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const editing = await writeDraft(app, "Check the county sign ordinance");
    await app.fetch("/admin/library", post({ intent: "add-phase", name: "Signage" }));

    await save(app, editing, {
      title: "Check the county sign ordinance",
      body: "Some counties limit the size of a sign.",
      phaseName: "Signage",
    });

    await app.fetch(
      "/admin/library",
      post({
        intent: "delete-phase",
        phaseId: String(phaseIdOf(app, "Signage")),
        reassignTo: String(phaseIdOf(app, FOUNDATION)),
      }),
    );

    expect(
      app.database
        .select({ id: phase.id })
        .from(phase)
        .where(eq(phase.name, "Signage"))
        .all(),
    ).toHaveLength(0);

    const moved = app.database
      .select({ phaseId: globalTask.phaseId })
      .from(globalTask)
      .where(eq(globalTask.slug, "check-the-county-sign-ordinance"))
      .get();
    expect(moved?.phaseId).toBe(phaseIdOf(app, FOUNDATION));
  });

  it("reorders with up and down, and breaks no Dependency", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const second = app.database
      .select({ id: phase.id, name: phase.name })
      .from(phase)
      .orderBy(phase.position)
      .all()[1]!;

    await app.fetch(
      "/admin/library",
      post({ intent: "move-phase", phaseId: String(second.id), direction: "up" }),
    );

    const order = app.database
      .select({ name: phase.name })
      .from(phase)
      .orderBy(phase.position)
      .all()
      .map((row) => row.name);

    expect(order[0]).toBe(second.name);

    // Nothing an edge points at moved, so nothing an edge says is now false.
    app.clearCookies();
    await signInAs(app, PHYSICIAN);
    expect((await app.fetch(FOUNDATION_LIST)).status).toBe(200);
  });
});

describe("Helpful Links", () => {
  async function draftWithLinks(app: TestApp): Promise<string> {
    const editing = await writeDraft(app, "Check the county sign ordinance");
    await app.fetch(
      editing,
      post({ intent: "add-link", label: "IRS EIN page", url: "https://www.irs.gov/ein" }),
    );
    await app.fetch(
      editing,
      post({ intent: "add-link", label: "County clerk", url: "https://example.gov/clerk" }),
    );
    return editing;
  }

  function linksOn(app: TestApp, slug: string) {
    return app.database
      .select({ label: helpfulLink.label, position: helpfulLink.position })
      .from(helpfulLink)
      .innerJoin(globalTask, eq(helpfulLink.globalTaskId, globalTask.id))
      .where(eq(globalTask.slug, slug))
      .orderBy(helpfulLink.position)
      .all()
      .map((row) => row.label);
  }

  it("refuses a link with no label, because a bare URL is a bug", async () => {
    const app = newApp();
    await signInAsAdmin(app);
    const editing = await writeDraft(app, "Check the county sign ordinance");

    const response = await app.fetch(
      editing,
      post({ intent: "add-link", label: "  ", url: "https://www.irs.gov/ein" }),
    );

    expect(await words(response)).toContain("label");
    expect(linksOn(app, "check-the-county-sign-ordinance")).toHaveLength(0);
  });

  it("shows the derived domain beside the label", async () => {
    const app = newApp();
    await signInAsAdmin(app);
    const editing = await draftWithLinks(app);

    expect(await words(await app.fetch(editing))).toContain("irs.gov");
  });

  it("reorders with up and down, and never with drag and drop", async () => {
    const app = newApp();
    await signInAsAdmin(app);
    const editing = await draftWithLinks(app);

    expect(linksOn(app, "check-the-county-sign-ordinance")).toEqual([
      "IRS EIN page",
      "County clerk",
    ]);

    const clerk = app.database
      .select({ id: helpfulLink.id })
      .from(helpfulLink)
      .where(eq(helpfulLink.label, "County clerk"))
      .get()!;

    await app.fetch(
      editing,
      post({ intent: "move-link", linkId: String(clerk.id), direction: "up" }),
    );

    expect(linksOn(app, "check-the-county-sign-ordinance")).toEqual([
      "County clerk",
      "IRS EIN page",
    ]);

    const screen = await readable(await app.fetch(editing));
    expect(screen).not.toContain("draggable");
  });

  it("removes one", async () => {
    const app = newApp();
    await signInAsAdmin(app);
    const editing = await draftWithLinks(app);

    const clerk = app.database
      .select({ id: helpfulLink.id })
      .from(helpfulLink)
      .where(eq(helpfulLink.label, "County clerk"))
      .get()!;

    await app.fetch(
      editing,
      post({ intent: "remove-link", linkId: String(clerk.id) }),
    );

    expect(linksOn(app, "check-the-county-sign-ordinance")).toEqual([
      "IRS EIN page",
    ]);
  });
});

describe("the Dependency picker", () => {
  const REGISTER_NAME = "register-legal-business-name";
  const REGISTER_NAME_TITLE = "Register Legal Business Name";
  const BANKING = "banking-setup";
  const BANKING_TITLE = "Banking Setup";

  it("names each candidate's Phase", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const screen = await words(
      await app.fetch(`/admin/library/tasks/${taskIdOf(app, EIN)}`),
    );

    // Every candidate carries the Phase it lives in, so advice pointing
    // across the list is followable before it is given.
    expect(screen).toContain(`${BANKING_TITLE} — Financial Infrastructure`);
  });

  it("accepts an edge that crosses a Phase", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const editing = `/admin/library/tasks/${taskIdOf(app, BANKING)}`;
    const response = await app.fetch(
      editing,
      post({
        intent: "add-dependency",
        dependsOnTaskId: String(taskIdOf(app, REGISTER_NAME)),
      }),
    );

    expect(await words(response)).not.toContain("loop");
    expect(await words(await app.fetch(editing))).toContain(
      `usually after ${REGISTER_NAME_TITLE}`,
    );
  });

  it("refuses a cycle by spelling the loop out in titles", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    // The seeded Library already says Banking Setup comes after Obtain EIN,
    // so the edge back the other way closes a loop.
    const response = await app.fetch(
      `/admin/library/tasks/${taskIdOf(app, EIN)}`,
      post({
        intent: "add-dependency",
        dependsOnTaskId: String(taskIdOf(app, BANKING)),
      }),
    );

    const said = await words(response);
    expect(said).toContain("loop");
    expect(said).toContain(EIN_TITLE);
    expect(said).toContain(BANKING_TITLE);
  });

  it("refuses a Task depending on itself", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const response = await app.fetch(
      `/admin/library/tasks/${taskIdOf(app, EIN)}`,
      post({
        intent: "add-dependency",
        dependsOnTaskId: String(taskIdOf(app, EIN)),
      }),
    );

    expect(await words(response)).toContain("itself");
  });

  it("removes one", async () => {
    const app = newApp();
    await signInAsAdmin(app);

    const editing = `/admin/library/tasks/${taskIdOf(app, EIN)}`;
    expect(await words(await app.fetch(editing))).toContain(
      `usually after ${REGISTER_NAME_TITLE}`,
    );

    await app.fetch(
      editing,
      post({
        intent: "remove-dependency",
        dependsOnTaskId: String(taskIdOf(app, REGISTER_NAME)),
      }),
    );

    expect(await words(await app.fetch(editing))).not.toContain(
      `usually after ${REGISTER_NAME_TITLE}`,
    );
  });
});

describe("who may edit the Task Library", () => {
  it("answers a physician the way an unserved address does", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const taskId = app.database
      .select({ id: globalTask.id })
      .from(globalTask)
      .where(isNull(globalTask.retiredAt))
      .get()!.id;

    for (const path of ["/admin/library", `/admin/library/tasks/${taskId}`]) {
      expect((await app.fetch(path)).status).toBe(404);
    }

    const refused = await app.fetch(
      `/admin/library/tasks/${taskId}`,
      post({ intent: "retire" }),
    );
    expect(refused.status).toBe(404);

    // And the row is untouched, because the guard is on the action too.
    const row = app.database
      .select({ retiredAt: globalTask.retiredAt })
      .from(globalTask)
      .where(eq(globalTask.id, taskId))
      .get();
    expect(row?.retiredAt).toBeNull();
  });
});
