import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import {
  customTask,
  globalTask,
  helpfulLink,
  phase,
  taskDependency,
  taskEntry,
  type TaskStatus,
} from "~/database/schema";
import {
  bodyAsPlainText,
  renderGlobalBody,
  renderPracticeBody,
} from "~/lib/markdown";
import { slugify } from "~/lib/slug";
import type { CurrentPractice } from "./practice";

/**
 * The journey map: one Phase in view, and the Task the physician opened.
 *
 * Everything the screen renders comes out of the one call at the bottom of
 * this file. That is ADR-0003's merge point — the Global Tasks a Practice has
 * a Task Entry for and the Custom Tasks it wrote itself are two tables until
 * here, and one list afterwards — and it is deliberately the only place the
 * two are brought together, because the ADR's cheap-merge argument rests on
 * there being exactly one such read path.
 *
 * Like `practice.ts`, nothing here takes a Practice id from a caller: a
 * `CurrentPractice` is what `practiceFor` handed back for the signed-in User,
 * so no value a request carries can point one physician at another's list.
 */

/** One Phase on the rail. Ten of the eleven are reachable, not on screen. */
export interface RailPhase {
  name: string;
  slug: string;
  inView: boolean;
}

/** A collapsed Task card: its title, and two lines of its Body. */
export interface JourneyCard {
  /** What `?task=` carries to open this one. */
  ref: string;
  title: string;
  /**
   * The Body as prose, clamped to two lines in CSS rather than here — and
   * null for a Task set aside, which dims to its title alone. The snippet is
   * dropped rather than hidden, so a Not Applicable Body is not sitting in
   * the page for a physician to find in the source of a shared screen.
   */
  snippet: string | null;
  status: TaskStatus;
  variesByState: boolean;
  open: boolean;
}

/**
 * A Helpful Link as the drawer renders it: the label a physician reads, and
 * the domain it goes to beneath it.
 *
 * `href` is null when the URL is missing or is not one a browser should
 * follow. The drawer renders `no link set` for those and does not make them
 * clickable — a content gap that is visible beats a link that breaks.
 */
export interface HelpfulLinkView {
  label: string;
  href: string | null;
  domain: string | null;
}

/**
 * A Dependency, as advice. Never a lock: it is rendered only while the Task
 * it names is still outstanding, and it stops the physician from nothing.
 */
export interface DependencyAdvice {
  title: string;
  /** The target's Phase, named only when it is not the Phase in view. */
  otherPhaseName: string | null;
}

/** A Task with its drawer open. */
export interface OpenTaskView {
  ref: string;
  title: string;
  /** Sanitized HTML, not Markdown. See `app/lib/markdown.ts`. */
  bodyHtml: string;
  status: TaskStatus;
  helpfulLinks: HelpfulLinkView[];
  dependencies: DependencyAdvice[];
}

export interface JourneyMap {
  rail: RailPhase[];
  phaseName: string;
  phaseSlug: string;
  cards: JourneyCard[];
  /** Null when nothing is open, and when `?task=` names nothing this Practice has. */
  openTask: OpenTaskView | null;
}

/**
 * Where a Task sits within its Phase.
 *
 * In progress first, because it is what the physician is holding; Not
 * Applicable last, where it sinks and dims rather than disappearing. That
 * last position is load-bearing for ADR-0002: the Tailoring Wizard records
 * nothing about what it set aside, and what makes that safe is that the
 * Tasks it touched are still on the screen.
 */
const STATUS_ORDER: Record<TaskStatus, number> = {
  in_progress: 0,
  not_started: 1,
  done: 2,
  not_applicable: 3,
};

/**
 * The Phase a physician lands on when they have not named one.
 *
 * Null on a database with no Phases at all, which means an unseeded one:
 * there is no list to land on, and the caller answers 404 rather than
 * sending anyone to an address that matches no route.
 */
export function firstPhaseSlug(database: AppDatabase): string | null {
  const first = database
    .select({ name: phase.name })
    .from(phase)
    .orderBy(asc(phase.position))
    .get();

  return first ? slugify(first.name) : null;
}

/**
 * Read one Phase of a Practice's list, with the opened Task if there is one.
 *
 * Returns null when `phaseSlug` names no Phase. A `taskRef` that names
 * nothing is not an error in the same way — the Phase still renders, with the
 * drawer closed, because a stale link in a bookmark should land the physician
 * on their list rather than on a 404.
 */
export function journeyMap(
  database: AppDatabase,
  practice: CurrentPractice,
  view: { phaseSlug: string; taskRef: string | null },
): JourneyMap | null {
  const phases = database
    .select({ id: phase.id, name: phase.name })
    .from(phase)
    .orderBy(asc(phase.position))
    .all();

  const inView = phases.find((row) => slugify(row.name) === view.phaseSlug);
  if (!inView) return null;

  const globals = readGlobalTasks(database, practice, inView.id);
  const customs = readCustomTasks(database, practice, inView.id);

  const cards = [...globals, ...customs].sort(byStatusThenLibraryOrder);

  return {
    rail: phases.map((row) => ({
      name: row.name,
      slug: slugify(row.name),
      inView: row.id === inView.id,
    })),
    phaseName: inView.name,
    phaseSlug: slugify(inView.name),
    cards: cards.map((task) => ({
      ref: task.ref,
      title: task.title,
      snippet:
        task.status === "not_applicable" ? null : bodyAsPlainText(task.body),
      status: task.status,
      variesByState: task.kind === "global" && task.stateSpecific,
      open: task.ref === view.taskRef,
    })),
    openTask: view.taskRef
      ? openTask(database, practice, cards, view.taskRef, inView.name)
      : null,
  };
}

/**
 * A Task of either kind, before it becomes a card.
 *
 * A union rather than one shape with nulls in it, because the two kinds
 * genuinely differ (ADR-0003): a Global Task carries an editorial `position`
 * within its Phase, Helpful Links, Dependencies and the state flag, and a
 * Custom Task carries none of those and orders by age instead. Flattening
 * them would mean inventing a `position` for a Custom Task, and an invented
 * value is one the sort would then be quietly reading.
 */
type MergedTask = MergedGlobalTask | MergedCustomTask;

interface MergedTaskShared {
  /** What `?task=` carries to open this one. */
  ref: string;
  title: string;
  body: string;
  status: TaskStatus;
}

interface MergedGlobalTask extends MergedTaskShared {
  kind: "global";
  globalTaskId: number;
  stateSpecific: boolean;
  /** Its editorial place inside the Phase, stored rather than derived. */
  position: number;
}

interface MergedCustomTask extends MergedTaskShared {
  kind: "custom";
  createdAt: Date;
}

function readGlobalTasks(
  database: AppDatabase,
  practice: CurrentPractice,
  phaseId: number,
): MergedGlobalTask[] {
  return database
    .select({
      id: globalTask.id,
      slug: globalTask.slug,
      title: globalTask.title,
      body: globalTask.body,
      stateSpecific: globalTask.stateSpecific,
      position: globalTask.position,
      status: taskEntry.status,
    })
    .from(taskEntry)
    .innerJoin(globalTask, eq(taskEntry.globalTaskId, globalTask.id))
    .where(
      and(
        eq(taskEntry.practiceId, practice.id),
        eq(globalTask.phaseId, phaseId),
        // A Draft has no Task Entry at all, so this only ever excludes a row
        // that should not have had one. Cheap, and it fails closed.
        isNotNull(globalTask.publishedAt),
      ),
    )
    .all()
    .map((row) => ({
      kind: "global" as const,
      ref: row.slug,
      globalTaskId: row.id,
      title: row.title,
      body: row.body,
      status: row.status,
      stateSpecific: row.stateSpecific,
      position: row.position,
    }));
}

function readCustomTasks(
  database: AppDatabase,
  practice: CurrentPractice,
  phaseId: number,
): MergedCustomTask[] {
  return database
    .select({
      id: customTask.id,
      title: customTask.title,
      body: customTask.body,
      status: customTask.status,
      createdAt: customTask.createdAt,
    })
    .from(customTask)
    .where(
      and(
        eq(customTask.practiceId, practice.id),
        eq(customTask.phaseId, phaseId),
      ),
    )
    .all()
    .map((row) => ({
      kind: "custom" as const,
      ref: customRef(row.id),
      title: row.title,
      body: row.body,
      status: row.status,
      createdAt: row.createdAt,
    }));
}

/**
 * A Custom Task's `?task=` value.
 *
 * Prefixed rather than bare, and resolved after the Global slugs, so the two
 * kinds share one query parameter without a Custom Task ever being able to
 * shadow a Task in the Library.
 */
function customRef(id: number): string {
  return `custom-${id}`;
}

/**
 * Status first, and then the Library's own order.
 *
 * Within a bucket the Task Library's editorial sequence holds, and a
 * Practice's own Tasks queue behind it by age — a manual order cannot
 * coexist with a list that re-sorts itself the moment a Status changes.
 */
function byStatusThenLibraryOrder(left: MergedTask, right: MergedTask): number {
  const byStatus = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
  if (byStatus !== 0) return byStatus;

  if (left.kind === "global" && right.kind === "global") {
    return left.position - right.position;
  }
  if (left.kind === "custom" && right.kind === "custom") {
    return left.createdAt.getTime() - right.createdAt.getTime();
  }
  return left.kind === "global" ? -1 : 1;
}

/**
 * The opened Task, found among the Tasks of the Phase in view.
 *
 * Looking it up in the list the physician is already looking at is what makes
 * the drawer tenant-safe without a check: a `?task=` naming another
 * Practice's Custom Task is not in `cards`, so there is nothing to open.
 */
function openTask(
  database: AppDatabase,
  practice: CurrentPractice,
  cards: MergedTask[],
  taskRef: string,
  phaseInViewName: string,
): OpenTaskView | null {
  const task = cards.find((card) => card.ref === taskRef);
  if (!task) return null;

  return {
    ref: task.ref,
    title: task.title,
    // Whose words these are decides which parser reads them. A Global Task's
    // Body is the Admin's and may carry HTML; a Custom Task's is the
    // Practice's own writing, and never does.
    bodyHtml:
      task.kind === "global"
        ? renderGlobalBody(task.body)
        : renderPracticeBody(task.body),
    status: task.status,
    // A Custom Task has neither, and never will without a schema change:
    // Helpful Links and Dependencies are editorial acts, and a physician is
    // not an editor (ADR-0003).
    helpfulLinks:
      task.kind === "global"
        ? readHelpfulLinks(database, task.globalTaskId)
        : [],
    dependencies:
      task.kind === "global"
        ? readDependencies(database, practice, task.globalTaskId, phaseInViewName)
        : [],
  };
}

function readHelpfulLinks(
  database: AppDatabase,
  globalTaskId: number,
): HelpfulLinkView[] {
  return database
    .select({ label: helpfulLink.label, url: helpfulLink.url })
    .from(helpfulLink)
    .where(eq(helpfulLink.globalTaskId, globalTaskId))
    .orderBy(asc(helpfulLink.position))
    .all()
    .map((row) => ({ label: row.label, ...destinationOf(row.url) }));
}

/**
 * Where a Helpful Link goes, and what to say beneath its label.
 *
 * A URL that is missing, unparseable, or not something a browser should
 * navigate to gets no `href` at all. The Seed refuses a blank URL, so this
 * covers the admin panel and nothing else — which is exactly the case that
 * needs covering, since a half-typed link should read as a gap in the
 * content rather than as a broken promise.
 */
function destinationOf(url: string): { href: string | null; domain: string | null } {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { href: null, domain: null };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { href: null, domain: null };
  }

  return {
    href: parsed.href,
    domain: parsed.hostname.replace(/^www\./, ""),
  };
}

/**
 * The Dependencies still worth mentioning.
 *
 * Only the unsatisfied ones are returned, so the advice disappears the moment
 * it stops being useful. Done is satisfied for the obvious reason; Not
 * Applicable is satisfied because a Task this Practice will never do cannot
 * be something to do first, and leaving the advice up would be telling a
 * physician to wait for something that is never coming.
 */
function readDependencies(
  database: AppDatabase,
  practice: CurrentPractice,
  globalTaskId: number,
  phaseInViewName: string,
): DependencyAdvice[] {
  const targetIds = database
    .select({ id: taskDependency.dependsOnTaskId })
    .from(taskDependency)
    .where(eq(taskDependency.globalTaskId, globalTaskId))
    .all()
    .map((row) => row.id);

  if (targetIds.length === 0) return [];

  return database
    .select({
      title: globalTask.title,
      phaseName: phase.name,
      status: taskEntry.status,
    })
    .from(taskEntry)
    .innerJoin(globalTask, eq(taskEntry.globalTaskId, globalTask.id))
    .innerJoin(phase, eq(globalTask.phaseId, phase.id))
    .where(
      and(
        eq(taskEntry.practiceId, practice.id),
        inArray(taskEntry.globalTaskId, targetIds),
      ),
    )
    .all()
    .filter(
      (row) => row.status !== "done" && row.status !== "not_applicable",
    )
    .map((row) => ({
      title: row.title,
      otherPhaseName:
        row.phaseName === phaseInViewName ? null : row.phaseName,
    }));
}
