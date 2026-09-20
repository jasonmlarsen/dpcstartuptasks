import { and, asc, eq, not, sql } from "drizzle-orm";

import type { AppDatabase, AppWriter } from "~/database/database";
import {
  globalTask,
  helpfulLink,
  phase,
  practice,
  taskDependency,
  taskEntry,
} from "~/database/schema";
import { destinationOf } from "~/lib/link-destination";
import { toTheSecond } from "~/lib/plain-date";
import { slugify } from "~/lib/slug";
import { didSomething } from "~/practice/task-entry-work";

/**
 * The live Task Library, and the four acts the Admin performs on it.
 *
 * This is the thing the whole product is built to allow: a Body fix typed
 * this morning is on every Practice's list this morning, with no deploy and
 * no re-download. That falls out of the shape rather than being arranged —
 * a Practice reads a Global Task through its Task Entry, so an `UPDATE` on
 * the row *is* the delivery, and the only question left is who may type it.
 *
 * What is therefore **not** here: a revision table, a scheduled publish, a
 * diff, a preview and a draft-of-a-live-Task. `published_at` and
 * `retired_at` are the whole state model, and each is a nullable timestamp
 * rather than a status column for the same reason: the state *is* the fact
 * of the moment it happened, and there is no third value for a column to
 * hold. Un-retiring is then the same backfill as publishing, which is what
 * makes retire-and-replace a safe editing move instead of a migration.
 *
 * The two writes that reach outside `global_task` are Publish and Retire,
 * and they are opposites of each other:
 *
 * - **Publish** adds a Task Entry to every Practice, flagged Newly Added.
 * - **Retire** hard-deletes the Entries of Practices that did nothing with
 *   the Task and keeps the rest, which then read `No longer required`.
 *
 * Unlike everything in `app/practice`, the functions here take ids from the
 * caller. That is not the tenancy hole it would be there: nothing in this
 * file reads or writes a Practice's own writing, and the guard on all of it
 * is `requireAdmin` on the route — the same arrangement `practices-
 * dashboard.ts` makes, and the reason both live in `app/admin`.
 */

/** Where a Global Task is in its life, derived from the two timestamps. */
export type TaskState = "draft" | "published" | "retired";

/** One Global Task as the Library index lists it. */
export interface GlobalTaskSummary {
  id: number;
  title: string;
  slug: string;
  state: TaskState;
}

/** One Phase, and the Tasks in it — Drafts and Retired ones included. */
export interface LibraryPhase {
  id: number;
  name: string;
  position: number;
  tasks: GlobalTaskSummary[];
}

/**
 * The whole Library, Phase by Phase.
 *
 * Ninety-eight Tasks on one page rather than a Phase at a time: the
 * physician's screen loads one Phase because ninety-eight is a wall, and
 * the Admin's is the opposite problem — the reason to open this page is
 * usually to find the one Task a Feedback was about.
 */
export function taskLibrary(database: AppDatabase): LibraryPhase[] {
  const rows = database
    .select({
      phaseId: phase.id,
      phaseName: phase.name,
      phasePosition: phase.position,
      id: globalTask.id,
      title: globalTask.title,
      slug: globalTask.slug,
      publishedAt: globalTask.publishedAt,
      retiredAt: globalTask.retiredAt,
      position: globalTask.position,
    })
    .from(phase)
    .leftJoin(globalTask, eq(globalTask.phaseId, phase.id))
    .orderBy(asc(phase.position), asc(globalTask.position))
    .all();

  const phases = new Map<number, LibraryPhase>();

  for (const row of rows) {
    const found = phases.get(row.phaseId) ?? {
      id: row.phaseId,
      name: row.phaseName,
      position: row.phasePosition,
      tasks: [],
    };
    phases.set(row.phaseId, found);

    // A Phase with no Tasks in it is a real state — one has just been added,
    // or one has just had its Tasks reassigned — and the left join says so
    // with a null id rather than by leaving the Phase off the page.
    if (row.id === null) continue;

    found.tasks.push({
      id: row.id,
      title: row.title!,
      slug: row.slug!,
      state: stateOf({ publishedAt: row.publishedAt, retiredAt: row.retiredAt }),
    });
  }

  return [...phases.values()];
}

export function stateOf(task: {
  publishedAt: Date | null;
  retiredAt: Date | null;
}): TaskState {
  if (task.publishedAt === null) return "draft";
  return task.retiredAt === null ? "published" : "retired";
}

/** A Helpful Link on the edit screen, with the domain derived as it is typed. */
export interface EditableLink {
  id: number;
  label: string;
  url: string;
  /** Null when the URL is not one a browser should follow — see the drawer. */
  domain: string | null;
  first: boolean;
  last: boolean;
}

/** A Task the picker may point at, always carrying the Phase it lives in. */
export interface DependencyCandidate {
  id: number;
  title: string;
  phaseName: string;
}

/** Everything the Task edit screen renders. */
export interface EditableTask {
  id: number;
  /** Frozen at creation and never edited, because addresses carry it. */
  slug: string;
  title: string;
  body: string;
  phaseId: number;
  stateSpecific: boolean;
  state: TaskState;
  links: EditableLink[];
  /** The Tasks this one usually comes after. */
  dependsOn: DependencyCandidate[];
  /** Every other Task, for the picker. */
  candidates: DependencyCandidate[];
  phases: { id: number; name: string }[];
  /**
   * How many Practices hold an Entry for this Task, and how many of them
   * have done something with it. The Retire button says both out loud,
   * because Retire is the one act here whose cost is measured in other
   * people's work.
   */
  practicesHolding: number;
  practicesThatDidSomething: number;
}

export function taskForEditing(
  database: AppDatabase,
  taskId: number,
): EditableTask | null {
  const task = database
    .select()
    .from(globalTask)
    .where(eq(globalTask.id, taskId))
    .get();
  if (!task) return null;

  const links = database
    .select()
    .from(helpfulLink)
    .where(eq(helpfulLink.globalTaskId, taskId))
    .orderBy(asc(helpfulLink.position))
    .all();

  const everyTask = database
    .select({
      id: globalTask.id,
      title: globalTask.title,
      phaseName: phase.name,
      phasePosition: phase.position,
      position: globalTask.position,
    })
    .from(globalTask)
    .innerJoin(phase, eq(globalTask.phaseId, phase.id))
    .orderBy(asc(phase.position), asc(globalTask.position))
    .all();

  const dependsOnIds = new Set(
    database
      .select({ id: taskDependency.dependsOnTaskId })
      .from(taskDependency)
      .where(eq(taskDependency.globalTaskId, taskId))
      .all()
      .map((row) => row.id),
  );

  return {
    id: task.id,
    slug: task.slug,
    title: task.title,
    body: task.body,
    phaseId: task.phaseId,
    stateSpecific: task.stateSpecific,
    state: stateOf(task),
    links: links.map((link, index) => ({
      id: link.id,
      label: link.label,
      url: link.url,
      domain: destinationOf(link.url).domain,
      first: index === 0,
      last: index === links.length - 1,
    })),
    dependsOn: everyTask
      .filter((row) => dependsOnIds.has(row.id))
      .map(asCandidate),
    // Every Task but this one, including a Draft and a Retired one: an edge
    // is advice about the Library's own shape, and a Task being withdrawn
    // from lists does not stop it being the thing you do first.
    candidates: everyTask
      .filter((row) => row.id !== taskId && !dependsOnIds.has(row.id))
      .map(asCandidate),
    phases: database
      .select({ id: phase.id, name: phase.name })
      .from(phase)
      .orderBy(asc(phase.position))
      .all(),
    practicesHolding: countEntries(database, taskId, null),
    practicesThatDidSomething: countEntries(database, taskId, "touched"),
  };
}

function asCandidate(row: {
  id: number;
  title: string;
  phaseName: string;
}): DependencyCandidate {
  return { id: row.id, title: row.title, phaseName: row.phaseName };
}

function countEntries(
  database: AppWriter,
  taskId: number,
  only: "touched" | null,
): number {
  const rows = database
    .select({ count: sql<number>`count(*)` })
    .from(taskEntry)
    .where(
      only === "touched"
        ? and(eq(taskEntry.globalTaskId, taskId), didSomething())
        : eq(taskEntry.globalTaskId, taskId),
    )
    .get();

  return rows?.count ?? 0;
}

/** What the Admin's Write button did. */
export type DraftWritten =
  | { outcome: "written"; taskId: number }
  | { outcome: "no-title" }
  | { outcome: "no-phase" }
  /** Two titles slug the same, which at Seed is a hard error and here is a message. */
  | { outcome: "slug-taken"; slug: string };

/**
 * Write a new Task as a Draft: `published_at` null, and no Entry anywhere.
 *
 * A title and a Phase, and nothing else — the Body is typed on the edit
 * screen, which is where it will be typed again every time it is fixed. A
 * Draft with an empty Body is fine precisely because it exists for nobody.
 *
 * The slug is derived here, once, and frozen forever: the edit screen has no
 * field for it, and a Title edit never touches it. A collision is refused
 * rather than suffixed, for the Seed Script's reason — `domain-name-2` is
 * how a duplicated Task goes unnoticed for a year.
 */
export function writeDraft(
  database: AppDatabase,
  written: { title: string; phaseId: number },
): DraftWritten {
  const title = written.title.trim();
  if (title === "") return { outcome: "no-title" };

  const slug = slugify(title);
  if (slug === "") return { outcome: "no-title" };

  const target = database
    .select({ id: phase.id })
    .from(phase)
    .where(eq(phase.id, written.phaseId))
    .get();
  if (!target) return { outcome: "no-phase" };

  const clash = database
    .select({ id: globalTask.id })
    .from(globalTask)
    .where(eq(globalTask.slug, slug))
    .get();
  if (clash) return { outcome: "slug-taken", slug };

  const created = database
    .insert(globalTask)
    .values({
      slug,
      title,
      phaseId: target.id,
      body: "",
      position: nextPosition(database, target.id),
      // Null. The whole of what makes this a Draft.
      publishedAt: null,
    })
    .returning({ id: globalTask.id })
    .get();

  return { outcome: "written", taskId: created.id };
}

/** Last in its Phase, which is where a Task the Admin just wrote belongs. */
function nextPosition(database: AppWriter, phaseId: number): number {
  const last = database
    .select({ position: globalTask.position })
    .from(globalTask)
    .where(eq(globalTask.phaseId, phaseId))
    .orderBy(sql`${globalTask.position} desc`)
    .get();

  return (last?.position ?? 0) + 1;
}

export type TaskSaved =
  | { outcome: "saved" }
  | { outcome: "no-title" }
  | { outcome: "no-phase" }
  | { outcome: "no-task" };

/**
 * Save an edit, which for a live Task is the moment it reaches everyone.
 *
 * There is no autosave and there must never be one: the Save button *is* the
 * publish gate for an edit, and a keystroke-level save would broadcast a
 * half-typed sentence to fifty Practices. One column, no revision table, and
 * no scheduled publish — the Admin proof-reads before pressing, exactly as
 * they would before pressing Publish.
 *
 * The slug is not a parameter. Editing a Title fixes the words a physician
 * reads; it never moves the address their bookmark carries, and the Feedback
 * that named this Task keeps naming it.
 */
export function saveTask(
  database: AppDatabase,
  taskId: number,
  edit: {
    title: string;
    body: string;
    phaseId: number;
    stateSpecific: boolean;
  },
): TaskSaved {
  const title = edit.title.trim();
  if (title === "") return { outcome: "no-title" };

  const existing = database
    .select({ phaseId: globalTask.phaseId })
    .from(globalTask)
    .where(eq(globalTask.id, taskId))
    .get();
  if (!existing) return { outcome: "no-task" };

  const target = database
    .select({ id: phase.id })
    .from(phase)
    .where(eq(phase.id, edit.phaseId))
    .get();
  if (!target) return { outcome: "no-phase" };

  database
    .update(globalTask)
    .set({
      title,
      body: edit.body,
      phaseId: target.id,
      stateSpecific: edit.stateSpecific,
      // A Task moved to another Phase goes to the end of it. Its old
      // position means nothing there, and leaving it would interleave the
      // moved Task into the middle of an order somebody else chose.
      ...(target.id === existing.phaseId
        ? {}
        : { position: nextPosition(database, target.id) }),
    })
    .where(eq(globalTask.id, taskId))
    .run();

  return { outcome: "saved" };
}

export type PublishOutcome =
  | { outcome: "published"; practices: number }
  | { outcome: "already" }
  | { outcome: "no-task" };

/**
 * Publish: the deliberate act that gives every Practice a Task Entry.
 *
 * Publishing and un-retiring are the same backfill called twice, which is
 * the point of `retired_at` being nullable rather than a state a Task cannot
 * come back from: retire-and-replace is then an ordinary editing move rather
 * than something that needs a migration to undo.
 *
 * Every Practice, including one in its Grace Period. A deleted Practice is
 * unreachable but not destroyed, and the Admin can restore it — restoring it
 * to a list missing every Task published in those thirty days would be a
 * quiet second cost of the Grace Period that nobody agreed to.
 */
export function publishTask(
  database: AppDatabase,
  taskId: number,
): PublishOutcome {
  const task = database
    .select({ publishedAt: globalTask.publishedAt })
    .from(globalTask)
    .where(eq(globalTask.id, taskId))
    .get();
  if (!task) return { outcome: "no-task" };
  if (task.publishedAt !== null) return { outcome: "already" };

  return database.transaction((tx) => {
    const at = toTheSecond(new Date());
    tx.update(globalTask)
      .set({ publishedAt: at })
      .where(eq(globalTask.id, taskId))
      .run();

    return { outcome: "published" as const, practices: backfill(tx, taskId, at) };
  });
}

export type RetireOutcome =
  | { outcome: "retired"; kept: number; dropped: number }
  | { outcome: "not-published" }
  | { outcome: "no-task" };

/**
 * Retire: withdraw a Task from the Library without deleting it.
 *
 * Two different things happen to two kinds of Practice, and that asymmetry
 * is the whole design. A Practice that never touched the Task loses its
 * Entry outright, so a correction to the Library leaves no debris on a list.
 * A Practice that did something keeps everything it wrote, and the Task sits
 * on its list marked `No longer required`, counting neither way — work a
 * physician actually did is never erased from under them.
 *
 * No banner and no email. A withdrawn Task is the Admin tidying the Library,
 * and mailing fifty physicians about a row they may never have read would
 * make an editorial correction into an event.
 */
export function retireTask(
  database: AppDatabase,
  taskId: number,
): RetireOutcome {
  const task = database
    .select({
      publishedAt: globalTask.publishedAt,
      retiredAt: globalTask.retiredAt,
    })
    .from(globalTask)
    .where(eq(globalTask.id, taskId))
    .get();
  if (!task) return { outcome: "no-task" };
  if (stateOf(task) !== "published") return { outcome: "not-published" };

  return database.transaction((tx) => {
    tx.update(globalTask)
      .set({ retiredAt: toTheSecond(new Date()) })
      .where(eq(globalTask.id, taskId))
      .run();

    const dropped = tx
      .delete(taskEntry)
      .where(
        and(
          eq(taskEntry.globalTaskId, taskId),
          // The Entries of Practices that did nothing, and only those —
          // the negation of the one predicate, rather than a second spelling
          // of it, because the count and the delete must never disagree.
          not(didSomething()),
        ),
      )
      .returning({ id: taskEntry.id })
      .all().length;

    return {
      outcome: "retired" as const,
      kept: countEntries(tx, taskId, null),
      dropped,
    };
  });
}

export type UnretireOutcome =
  | { outcome: "unretired"; restored: number }
  | { outcome: "not-retired" }
  | { outcome: "no-task" };

/**
 * Un-retire: the same backfill as publishing, aimed at the Entries Retire
 * dropped.
 *
 * A Practice that kept its Entry keeps its Status, its Note and its date,
 * and is told nothing — nothing about its list changed except that a line
 * saying `No longer required` went away. A Practice that lost its Entry gets
 * a new one, flagged Newly Added, because from where it is sitting the Task
 * has just appeared.
 */
export function unretireTask(
  database: AppDatabase,
  taskId: number,
): UnretireOutcome {
  const task = database
    .select({
      publishedAt: globalTask.publishedAt,
      retiredAt: globalTask.retiredAt,
    })
    .from(globalTask)
    .where(eq(globalTask.id, taskId))
    .get();
  if (!task) return { outcome: "no-task" };
  if (stateOf(task) !== "retired") return { outcome: "not-retired" };

  return database.transaction((tx) => {
    tx.update(globalTask)
      .set({ retiredAt: null })
      .where(eq(globalTask.id, taskId))
      .run();

    return {
      outcome: "unretired" as const,
      restored: backfill(tx, taskId, toTheSecond(new Date())),
    };
  });
}

/**
 * Give a Task Entry to every Practice that has not got one, flagged Newly
 * Added.
 *
 * The one place `announced_at` is ever written. Registration deliberately
 * leaves it null — a Task that was there when the Practice was created is
 * not new to it, which is what stops a brand-new Practice opening to
 * ninety-eight New pills — so *announced* means exactly one thing: this Task
 * arrived after you did.
 *
 * Insert-what-is-missing rather than insert-everything, because un-retiring
 * calls this with Entries already in place and those carry a physician's
 * work. The unique index on (practice, task) is the backstop; this is the
 * intent.
 */
function backfill(tx: AppWriter, taskId: number, at: Date): number {
  const holding = new Set(
    tx
      .select({ practiceId: taskEntry.practiceId })
      .from(taskEntry)
      .where(eq(taskEntry.globalTaskId, taskId))
      .all()
      .map((row) => row.practiceId),
  );

  const missing = tx
    .select({ id: practice.id })
    .from(practice)
    .all()
    .filter((row) => !holding.has(row.id));

  if (missing.length === 0) return 0;

  tx.insert(taskEntry)
    .values(
      missing.map((row) => ({
        practiceId: row.id,
        globalTaskId: taskId,
        announcedAt: at,
      })),
    )
    .run();

  return missing.length;
}

/** What adding a Helpful Link did. A blank label is the only refusal. */
export type LinkAdded =
  | { outcome: "added" }
  | { outcome: "no-label" }
  | { outcome: "no-url" }
  | { outcome: "no-task" };

/**
 * Add a Helpful Link to a Task.
 *
 * The label is required and there is no derivation path, deliberately: a
 * label derived from the domain renders as "IRS" above "irs.gov" — a title
 * that is literally its own subtitle. The Seed Script refuses a blank label
 * for the same reason, and the two refusals are the same rule.
 *
 * A URL that a browser should not follow is *not* refused here. The drawer
 * already renders `no link set` for one, and the edit screen shows the
 * derived domain live, so a half-typed link is visible to the Admin as a gap
 * rather than being rejected mid-thought.
 */
export function addHelpfulLink(
  database: AppDatabase,
  taskId: number,
  link: { label: string; url: string },
): LinkAdded {
  const label = link.label.trim();
  const url = link.url.trim();
  if (label === "") return { outcome: "no-label" };
  if (url === "") return { outcome: "no-url" };

  const task = database
    .select({ id: globalTask.id })
    .from(globalTask)
    .where(eq(globalTask.id, taskId))
    .get();
  if (!task) return { outcome: "no-task" };

  const last = database
    .select({ position: helpfulLink.position })
    .from(helpfulLink)
    .where(eq(helpfulLink.globalTaskId, taskId))
    .orderBy(sql`${helpfulLink.position} desc`)
    .get();

  database
    .insert(helpfulLink)
    .values({
      globalTaskId: taskId,
      label,
      url,
      position: (last?.position ?? 0) + 1,
    })
    .run();

  return { outcome: "added" };
}

export function removeHelpfulLink(
  database: AppDatabase,
  taskId: number,
  linkId: number,
): void {
  database
    .delete(helpfulLink)
    .where(
      and(eq(helpfulLink.id, linkId), eq(helpfulLink.globalTaskId, taskId)),
    )
    .run();
}

/**
 * Move a Helpful Link one place up or down.
 *
 * Up and down buttons, never drag-and-drop: a Task has at most ten links, a
 * drag needs a library and client JS, and neither is worth buying for a list
 * that short on a screen with one reader. Swapping two positions rather than
 * renumbering the list keeps the write to two rows.
 */
export function moveHelpfulLink(
  database: AppDatabase,
  taskId: number,
  move: { linkId: number; direction: "up" | "down" },
): void {
  const links = database
    .select({ id: helpfulLink.id, position: helpfulLink.position })
    .from(helpfulLink)
    .where(eq(helpfulLink.globalTaskId, taskId))
    .orderBy(asc(helpfulLink.position))
    .all();

  const index = links.findIndex((link) => link.id === move.linkId);
  if (index === -1) return;

  const swapWith = move.direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= links.length) return;

  const here = links[index]!;
  const there = links[swapWith]!;

  database.transaction((tx) => {
    tx.update(helpfulLink)
      .set({ position: there.position })
      .where(eq(helpfulLink.id, here.id))
      .run();
    tx.update(helpfulLink)
      .set({ position: here.position })
      .where(eq(helpfulLink.id, there.id))
      .run();
  });
}

/** What the Dependency picker did, and what it refused. */
export type DependencyAdded =
  | { outcome: "added" }
  | { outcome: "itself" }
  /** The loop, in titles, from the Task the Admin is editing back to itself. */
  | { outcome: "cycle"; loop: string[] }
  | { outcome: "no-task" };

/**
 * Point one Task at another: *usually after X*.
 *
 * Advice, never enforcement — nothing reads these edges to decide what a
 * physician may do, which is why a cross-Phase edge is accepted and why
 * reordering the Phase rail breaks no invariant. Twenty of the sixty seeded
 * edges already cross a boundary.
 *
 * A cycle is the one refusal, and it is refused by spelling the loop out in
 * titles rather than by saying *cycle detected*: the Admin is holding a
 * picker with ninety-eight names in it, and the rejection has to name the
 * three rows that are actually the problem to be actionable.
 */
export function addDependency(
  database: AppDatabase,
  taskId: number,
  dependsOnTaskId: number,
): DependencyAdded {
  if (taskId === dependsOnTaskId) return { outcome: "itself" };

  const titles = new Map(
    database
      .select({ id: globalTask.id, title: globalTask.title })
      .from(globalTask)
      .all()
      .map((row) => [row.id, row.title] as const),
  );
  if (!titles.has(taskId) || !titles.has(dependsOnTaskId)) {
    return { outcome: "no-task" };
  }

  const loop = trailBackTo(database, dependsOnTaskId, taskId);
  if (loop) {
    return {
      outcome: "cycle",
      loop: [taskId, ...loop].map((id) => titles.get(id)!),
    };
  }

  database
    .insert(taskDependency)
    .values({ globalTaskId: taskId, dependsOnTaskId })
    .onConflictDoNothing()
    .run();

  return { outcome: "added" };
}

export function removeDependency(
  database: AppDatabase,
  taskId: number,
  dependsOnTaskId: number,
): void {
  database
    .delete(taskDependency)
    .where(
      and(
        eq(taskDependency.globalTaskId, taskId),
        eq(taskDependency.dependsOnTaskId, dependsOnTaskId),
      ),
    )
    .run();
}

/**
 * Walk the edges forward from `from`, looking for `target`.
 *
 * Returns the trail that reaches it — which is the loop the proposed edge
 * would close, ready to be read out in titles — or null when there is none.
 * Unlike the Seed Script's walk, a Task here may have any number of
 * predecessors, so this is a depth-first search rather than following a
 * single chain.
 */
function trailBackTo(
  database: AppDatabase,
  from: number,
  target: number,
): number[] | null {
  const edges = new Map<number, number[]>();
  for (const edge of database.select().from(taskDependency).all()) {
    const found = edges.get(edge.globalTaskId) ?? [];
    found.push(edge.dependsOnTaskId);
    edges.set(edge.globalTaskId, found);
  }

  const seen = new Set<number>();

  function walk(at: number, trail: number[]): number[] | null {
    if (at === target) return trail;
    if (seen.has(at)) return null;
    seen.add(at);

    for (const next of edges.get(at) ?? []) {
      const found = walk(next, [...trail, next]);
      if (found) return found;
    }
    return null;
  }

  return walk(from, [from]);
}

