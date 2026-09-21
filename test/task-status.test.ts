import { and, eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  customTask,
  globalTask,
  membership,
  phase,
  taskEntry,
  user,
  type TaskStatus,
} from "~/database/schema";
import { createTestApp, signInAs, type TestApp } from "./harness";

/**
 * Seam 1, on the act the whole list is for: a physician sets a Status and
 * watches the card move.
 *
 * Every assertion here is what a physician can see — the card order out of
 * the rendered Phase, the progress line, the row left behind. There is no
 * unit test for the sort comparator and no component test for the drawer:
 * the sort is observable in the page, and pinning the markup would pin the
 * structure rather than the behaviour.
 *
 * The Status control is a plain form posting to the Phase's own action, so
 * these tests post exactly what a browser posts. That is the real path and
 * not an approximation of it — there is no client JS on it to skip.
 */

const PHYSICIAN = "dr.reed@example.com";
const OTHER_PHYSICIAN = "dr.okafor@example.com";

const FOUNDATION = "/tasks/foundation-planning";

/** Real Tasks from the real Task Library, which every test app is seeded with. */
const EIN = "obtain-ein-employer-identification-number";
const EIN_TITLE = "Obtain EIN";
const REGISTER_NAME = "register-legal-business-name";
const REGISTER_NAME_TITLE = "Register Legal Business Name";
const BRAINSTORM = "business-name-brainstorm-research";
const BRAINSTORM_TITLE = "Business Name Brainstorm";
const BUSINESS_STRUCTURE = "business-structure-decision";
const BUSINESS_STRUCTURE_TITLE = "Business Structure Decision";

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

function statusOf(app: TestApp, email: string, slug: string): TaskStatus {
  const row = app.database
    .select({ status: taskEntry.status })
    .from(taskEntry)
    .where(
      and(
        eq(taskEntry.practiceId, practiceIdOf(app, email)),
        eq(taskEntry.globalTaskId, globalTaskIdOf(app, slug)),
      ),
    )
    .get();
  if (!row) throw new Error(`No Task Entry for ${slug}`);
  return row.status;
}

/** What the browser posts when the physician presses one of the four buttons. */
function press(
  app: TestApp,
  phasePath: string,
  taskRef: string,
  status: string,
): Promise<Response> {
  return app.fetch(phasePath, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ taskRef, status }),
  });
}

/** The Admin Retires a Task. The admin panel is a later ticket; the row is not. */
function retire(app: TestApp, slug: string) {
  app.database
    .update(globalTask)
    .set({ retiredAt: new Date() })
    .where(eq(globalTask.slug, slug))
    .run();
}

/** Where each title sits on the page, in the order they were asked for. */
function positionsOf(rendered: string, titles: string[]): number[] {
  return titles.map((title) => {
    const at = rendered.indexOf(title);
    if (at === -1) throw new Error(`${title} is not on the page`);
    return at;
  });
}

function isAscending(positions: number[]): boolean {
  return positions.every(
    (at, index) => index === 0 || at > positions[index - 1]!,
  );
}

/**
 * One card's whole element, from its opening tag to its close.
 *
 * The colour of the left edge is a class the server put on the card — the
 * Status change is a form post and there is no client JS on this path — so
 * the rendered Phase is where it is read, the same way the landing flash is.
 */
function cardFor(rendered: string, phasePath: string, taskRef: string): string {
  const at = rendered.indexOf(`href="${phasePath}?task=${taskRef}"`);
  if (at === -1) throw new Error(`No card for ${taskRef}`);
  const opens = rendered.lastIndexOf("<a", at);
  const closes = rendered.indexOf("</a>", at);
  return rendered.slice(opens, closes + "</a>".length);
}

describe("setting a Status", () => {
  it("writes the Status and puts the physician back on the Phase", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await press(app, FOUNDATION, EIN, "in_progress");

    expect(statusOf(app, PHYSICIAN, EIN)).toBe("in_progress");
    // Back on the list rather than in the drawer: the card has moved, and
    // the move is the answer to the press.
    expect(response.headers.get("Location")).toBe(
      `${FOUNDATION}?moved=${EIN}`,
    );
  });

  it("offers all four Statuses in the drawer", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    expect(open).toContain('value="not_started"');
    expect(open).toContain('value="in_progress"');
    expect(open).toContain('value="done"');
    expect(open).toContain('value="not_applicable"');
  });

  it("changes a Custom Task's Status the same way", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    const id = insertCustomTask(app, PHYSICIAN, "Ask my accountant about S-Corp");

    await press(app, FOUNDATION, `custom-${id}`, "done");

    const row = app.database
      .select({ status: customTask.status })
      .from(customTask)
      .where(eq(customTask.id, id))
      .get();
    expect(row?.status).toBe("done");
  });

  it("refuses a Status that is not one of the four", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const response = await press(app, FOUNDATION, EIN, "nearly_done");

    expect(response.status).toBe(400);
    expect(statusOf(app, PHYSICIAN, EIN)).toBe("not_started");
  });

  it("sends a signed-out visitor to the sign-in page and writes nothing", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    app.clearCookies();

    const response = await press(app, FOUNDATION, EIN, "done");

    expect(response.headers.get("Location")).toBe("/sign-in");
    expect(statusOf(app, PHYSICIAN, EIN)).toBe("not_started");
  });

  it("never touches another Practice's Custom Task", async () => {
    const app = newApp();
    await signInAs(app, OTHER_PHYSICIAN);
    const theirs = insertCustomTask(app, OTHER_PHYSICIAN, "Okafor lease review");
    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    const response = await press(app, FOUNDATION, `custom-${theirs}`, "done");

    expect(response.status).toBe(404);
    const row = app.database
      .select({ status: customTask.status })
      .from(customTask)
      .where(eq(customTask.id, theirs))
      .get();
    expect(row?.status).toBe("not_started");
  });
});

describe("the card that just moved", () => {
  it("re-sorts the Phase live, In progress first", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    // Business Structure Decision sits third in the Library's order. One
    // press should put it above the two Tasks that were above it.
    await press(app, FOUNDATION, BUSINESS_STRUCTURE, "in_progress");
    const foundation = await page(app, FOUNDATION);

    expect(
      isAscending(
        positionsOf(foundation, [
          BUSINESS_STRUCTURE_TITLE,
          BRAINSTORM_TITLE,
          REGISTER_NAME_TITLE,
        ]),
      ),
    ).toBe(true);
  });

  it("sinks a Done Task below the ones still outstanding", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await press(app, FOUNDATION, BRAINSTORM, "done");
    const foundation = await page(app, FOUNDATION);

    expect(
      isAscending(
        positionsOf(foundation, [REGISTER_NAME_TITLE, BRAINSTORM_TITLE]),
      ),
    ).toBe(true);
  });

  it("flashes where it landed, and only there", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const moved = await press(app, FOUNDATION, EIN, "in_progress");
    const landed = await page(app, moved.headers.get("Location")!);

    // One card flashes: the one the physician just touched, so it is never
    // lost in a list that re-sorted itself underneath them. In progress
    // sorts to the top, so the flash is on the first card and on no other.
    expect(landed.match(/task-landed/g)).toHaveLength(1);
    expect(
      isAscending(positionsOf(landed, ["task-landed", EIN_TITLE, BRAINSTORM_TITLE])),
    ).toBe(true);
  });

  it("flashes nothing on a Phase nobody just changed", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const foundation = await page(app, FOUNDATION);

    expect(foundation).not.toContain("task-landed");
  });
});

describe("Not Applicable", () => {
  it("sinks to the bottom of the Phase and dims to its title alone", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await press(app, FOUNDATION, REGISTER_NAME, "not_applicable");
    const foundation = await page(app, FOUNDATION);

    // ADR-0002 rests on this: the Tailoring Wizard records nothing about
    // what it set aside, and what makes that safe is that the Task is still
    // on the screen, readable and one press from coming back.
    expect(foundation).toContain(REGISTER_NAME_TITLE);
    expect(foundation).toContain("Not applicable");
    expect(foundation).not.toContain(
      "File Articles of Organization/Incorporation with State.",
    );
    expect(
      isAscending(
        positionsOf(foundation, [BRAINSTORM_TITLE, REGISTER_NAME_TITLE]),
      ),
    ).toBe(true);
  });

  it("is one press from undone", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await press(app, FOUNDATION, REGISTER_NAME, "not_applicable");

    const open = await page(app, `${FOUNDATION}?task=${REGISTER_NAME}`);
    await press(app, FOUNDATION, REGISTER_NAME, "not_started");

    expect(open).toContain('value="not_started"');
    expect(statusOf(app, PHYSICIAN, REGISTER_NAME)).toBe("not_started");
  });
});


/**
 * Colour on the card, and nothing else moved: a physician scanning thirteen
 * Tasks should see where the work stands without reading a word of it.
 *
 * The Status control stays in the drawer, the sort is unchanged, and the
 * progress line counts what it counted before — the assertions for all
 * three live in the describes above and below this one.
 */
describe("the colour on a card's left edge", () => {
  it("leaves a Task nobody has started in quiet grey", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const card = cardFor(await page(app, FOUNDATION), FOUNDATION, EIN);

    expect(card).toContain("border-l-gray-200");
    expect(card).toContain(EIN_TITLE);
  });

  it("turns blue while a Task is in progress", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await press(app, FOUNDATION, EIN, "in_progress");

    const card = cardFor(await page(app, FOUNDATION), FOUNDATION, EIN);

    expect(card).toContain("border-l-primary");
    expect(card).not.toContain("border-l-gray-200");
    expect(card).toContain("In progress");
  });

  it("turns green once a Task is done", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await press(app, FOUNDATION, EIN, "done");

    const card = cardFor(await page(app, FOUNDATION), FOUNDATION, EIN);

    expect(card).toContain("border-l-success");
    expect(card).not.toContain("border-l-primary");
    expect(card).toContain("Done");
  });

  it("keeps Not Applicable grey, dimmed and down to its title", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await press(app, FOUNDATION, REGISTER_NAME, "not_applicable");

    const card = cardFor(await page(app, FOUNDATION), FOUNDATION, REGISTER_NAME);

    // Colour is added to a card here; what a set-aside card shows is not
    // touched. ADR-0002 rests on the dimming and the title-only rendering.
    expect(card).toContain("border-l-gray-200");
    expect(card).toContain("opacity-60");
    expect(card).toContain("Not applicable");
  });

  it("keeps `No longer required` grey, whatever the Practice last said", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await press(app, FOUNDATION, REGISTER_NAME, "done");
    retire(app, REGISTER_NAME);

    const card = cardFor(await page(app, FOUNDATION), FOUNDATION, REGISTER_NAME);

    // `No longer required` outranks the Status on the row, so it outranks
    // it on the edge too: a green edge would still be asking for the work.
    expect(card).toContain("border-l-gray-200");
    expect(card).not.toContain("border-l-success");
    expect(card).toContain("opacity-60");
    expect(card).toContain("No longer required");
  });

  it("still tells the card in view in the drawer from the rest", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await press(app, FOUNDATION, EIN, "done");

    const open = await page(app, `${FOUNDATION}?task=${EIN}`);

    // The edge says Done and the three other sides say *this is the one you
    // are looking at*, so the two never have to share a colour and neither
    // can overwrite the other.
    const inView = cardFor(open, FOUNDATION, EIN);
    expect(inView).toContain("border-t-primary");
    expect(inView).toContain("border-l-success");
    expect(cardFor(open, FOUNDATION, BRAINSTORM)).not.toContain(
      "border-t-primary",
    );
  });

  it("still flashes on the card that just landed", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const moved = await press(app, FOUNDATION, EIN, "in_progress");
    const landed = await page(app, moved.headers.get("Location")!);

    const card = cardFor(landed, FOUNDATION, EIN);
    expect(card).toContain("task-landed");
    expect(card).toContain("border-l-primary");
  });
});

describe("a Retired Task, for a Practice that had already touched it", () => {
  it("reads `No longer required`, dimmed to its title and sunk to the bottom", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await press(app, FOUNDATION, REGISTER_NAME, "done");
    retire(app, REGISTER_NAME);

    const foundation = await page(app, FOUNDATION);

    expect(foundation).toContain("No longer required");
    expect(foundation).toContain(REGISTER_NAME_TITLE);
    expect(foundation).not.toContain(
      "File Articles of Organization/Incorporation with State.",
    );
    expect(
      isAscending(
        positionsOf(foundation, [BRAINSTORM_TITLE, REGISTER_NAME_TITLE]),
      ),
    ).toBe(true);
  });

  it("sorts where a Not Applicable Task does, and by the Library's order within that", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await press(app, FOUNDATION, REGISTER_NAME, "not_applicable");
    retire(app, BUSINESS_STRUCTURE);

    const foundation = await page(app, FOUNDATION);

    // Four buckets, not five: a Retired Task is rendered exactly as a Not
    // Applicable one is, so it shares the band and the Library's order
    // decides between them — Business Structure Decision sits above
    // Register Legal Business Name in the Library, and still does here.
    expect(
      isAscending(
        positionsOf(foundation, [
          BRAINSTORM_TITLE,
          BUSINESS_STRUCTURE_TITLE,
          REGISTER_NAME_TITLE,
        ]),
      ),
    ).toBe(true);
  });

  it("has no Status control, in the drawer or out of it", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    retire(app, REGISTER_NAME);

    const open = await page(app, `${FOUNDATION}?task=${REGISTER_NAME}`);
    const response = await press(app, FOUNDATION, REGISTER_NAME, "done");

    expect(open).toContain("No longer required");
    expect(open).not.toContain('value="not_applicable"');
    // Un-retiring is the Admin's act, so there is nothing here for a
    // Practice to press and nothing a hand-written post can reach either.
    expect(response.status).toBe(404);
    expect(statusOf(app, PHYSICIAN, REGISTER_NAME)).toBe("not_started");
  });
});

describe("progress", () => {
  it("counts the Phase in view and the whole list", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const before = await page(app, FOUNDATION);
    await press(app, FOUNDATION, EIN, "done");
    const after = await page(app, FOUNDATION);

    expect(before).toContain("0 of 8 done in this phase");
    expect(before).toContain("0 of 98 done overall");
    expect(after).toContain("1 of 8 done in this phase");
    expect(after).toContain("1 of 98 done overall");
  });

  it("counts Not Applicable neither way, so an honestly finished list reads finished", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    await press(app, FOUNDATION, EIN, "not_applicable");
    const foundation = await page(app, FOUNDATION);

    expect(foundation).toContain("0 of 7 done in this phase");
    expect(foundation).toContain("0 of 97 done overall");
  });

  it("counts `No longer required` neither way either", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    await press(app, FOUNDATION, EIN, "done");
    retire(app, EIN);

    const foundation = await page(app, FOUNDATION);

    // The work was done and is no longer asked for. Leaving it in the
    // denominator would make a finished list read as unfinished; leaving it
    // in the numerator would flatter it.
    expect(foundation).toContain("0 of 7 done in this phase");
    expect(foundation).toContain("0 of 97 done overall");
  });

  it("counts a Practice's own Tasks alongside the Library's", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);
    const id = insertCustomTask(app, PHYSICIAN, "Ask my accountant about S-Corp");

    const added = await page(app, FOUNDATION);
    await press(app, FOUNDATION, `custom-${id}`, "done");
    const done = await page(app, FOUNDATION);

    expect(added).toContain("0 of 9 done in this phase");
    expect(added).toContain("0 of 99 done overall");
    expect(done).toContain("1 of 9 done in this phase");
    expect(done).toContain("1 of 99 done overall");
  });

  it("counts only the Practice's own progress", async () => {
    const app = newApp();
    await signInAs(app, OTHER_PHYSICIAN);
    await press(app, FOUNDATION, EIN, "done");
    app.clearCookies();
    await signInAs(app, PHYSICIAN);

    const foundation = await page(app, FOUNDATION);

    expect(foundation).toContain("0 of 8 done in this phase");
    expect(foundation).toContain("0 of 98 done overall");
  });
});

/** A Custom Task, written straight into the table the editor will write to. */
function insertCustomTask(
  app: TestApp,
  email: string,
  title: string,
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
      body: "The one in Cincinnati, not the one here.",
    })
    .returning({ id: customTask.id })
    .get();

  return inserted.id;
}
