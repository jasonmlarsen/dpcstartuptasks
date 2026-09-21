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
import { destinationOf } from "~/lib/link-destination";
import {
  bodyAsPlainText,
  renderGlobalBody,
  renderPracticeBody,
} from "~/lib/markdown";
import { slugify } from "~/lib/slug";
import type { CurrentPractice } from "./practice";
import { customRef } from "./task-ref";

/**
 * The journey map: one Phase in view, and the Task the physician opened.
 *
 * Everything the screen renders comes out of the one call at the bottom of
 * this file. That is ADR-0003's merge point — the Global Tasks a Practice has
 * a Task Entry for and the Custom Tasks it wrote itself are two tables until
 * here, and one list afterwards — and this file is deliberately the only
 * place the two are brought together, because the ADR's cheap-merge argument
 * rests on there being exactly one such read path.
 *
 * Whole-list progress is the second merge in this file, and ADR-0003 names
 * that moment: "If a screen ever needs all 98 Tasks at once … the merge has
 * to be written a second time. That is the point at which this decision is
 * worth re-examining, and the only one." It is written here rather than
 * anywhere else so the re-examination has one place to happen, and it counts
 * two statuses rather than building 98 cards — it needs the tally, not the
 * list. Re-open the ADR if a third caller appears, or if this one ever needs
 * the Tasks themselves.
 *
 * Like `practice.ts`, nothing here takes a Practice id from a caller: a
 * `CurrentPractice` is what `practiceFor` handed back for the signed-in User,
 * so no value a request carries can point one physician at another's list.
 */

/**
 * One Phase on the rail, as a station. Ten of the eleven are reachable, not
 * on screen.
 *
 * It carries its own progress because that is the one thing the rail exists
 * to say: eleven Phases is a number a physician can hold, and a terrain with
 * no *behind you* on it is a list of links rather than a map.
 */
export interface RailPhase {
  /**
   * Its place in the list, one-based. Derived from position and never part
   * of the name (CONTEXT.md), which is why it is a number here rather than
   * something the screen reads off the front of a string.
   */
  number: number;
  name: string;
  slug: string;
  inView: boolean;
  /** Counted exactly as the progress lines count — see `Progress`. */
  progress: Progress;
  /**
   * Every Task this Phase still asks for is done, so the station shows a
   * check in place of its number.
   *
   * True as well for a Phase with nothing countable left in it at all, which
   * is a Practice that set the whole Phase aside. There is no work there and
   * there never will be, and a permanently unfinished station would be the
   * list accusing a Practice of a decision it made on purpose (ADR-0002).
   */
  complete: boolean;
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
  /**
   * A Retired Task the Practice had already touched, which renders exactly
   * as a Not Applicable one does and is labelled `No longer required`. It
   * carries no Status control: un-retiring is the Admin's act.
   */
  retired: boolean;
  /**
   * The `Varies by state` pill, and null for a Task that does not. It is a
   * string rather than a flag because it names the Practice's state when the
   * Practice told the Tailoring Wizard one — a warning becomes a pointer.
   * That is the whole of what a stored state buys inside the app, and it is
   * not the beginning of per-state content.
   */
  stateNote: string | null;
  /**
   * The target date as a physician reads it, and null when there is none —
   * or when the Task is set aside, which dims to its title alone. A date on
   * a card is the only place a deadline is visible without opening the
   * drawer, which is the whole reason a date is worth setting.
   */
  targetDate: string | null;
  /**
   * Newly Added: published after this Practice already existed, and not yet
   * opened by anyone in it. Tasks present at creation are never flagged, and
   * the flag is cleared by opening the drawer — see `newly-added.ts`.
   */
  newlyAdded: boolean;
  open: boolean;
  /** The card that just moved, which flashes where it landed for 900ms. */
  landed: boolean;
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
  /** Retired, so the drawer reads `No longer required` and offers no control. */
  retired: boolean;
  /**
   * A Task this Practice wrote for itself, which is the one thing on the
   * list it may delete outright. Nothing else in the drawer turns on it:
   * a Custom Task carries Status, Note and target date exactly as a Global
   * Task does, and the two are deliberately not told apart on the card.
   */
  custom: boolean;
  /** The Practice's own writing, exactly as it was typed, for the edit box. */
  note: string;
  /**
   * The same Note rendered, and null when there is none. Sanitized HTML,
   * from the parser that will not emit HTML — see `app/lib/markdown.ts`.
   */
  noteHtml: string | null;
  /** The target date as `yyyy-mm-dd`, which is what the date field takes back. */
  targetDateValue: string | null;
  /** The same date as a physician reads it. */
  targetDate: string | null;
  helpfulLinks: HelpfulLinkView[];
  dependencies: DependencyAdvice[];
}

/**
 * How far a Practice has got, over some set of its Tasks.
 *
 * Not Applicable and `No longer required` are in neither number: a Task a
 * Practice will never do is not work outstanding, and counting it would make
 * an honestly finished list read as unfinished.
 */
export interface Progress {
  done: number;
  total: number;
}

export interface JourneyMap {
  rail: RailPhase[];
  phaseName: string;
  phaseSlug: string;
  cards: JourneyCard[];
  /** The Phase in view, which is the work in front of the physician. */
  phaseProgress: Progress;
  /** The whole list, which is the question they actually asked. */
  listProgress: Progress;
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
  view: { phaseSlug: string; taskRef: string | null; movedRef?: string | null },
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

  const progress = progressTally(database, practice);

  return {
    rail: phases.map((row, index) => {
      const tally = progress.byPhase.get(row.id) ?? nothingAsked();
      return {
        number: index + 1,
        name: row.name,
        slug: slugify(row.name),
        inView: row.id === inView.id,
        progress: tally,
        complete: tally.done === tally.total,
      };
    }),
    phaseName: inView.name,
    phaseSlug: slugify(inView.name),
    cards: cards.map((task) => ({
      ref: task.ref,
      title: task.title,
      snippet: setAside(task) ? null : bodyAsPlainText(task.body),
      status: task.status,
      retired: isRetired(task),
      stateNote:
        task.kind === "global" && task.stateSpecific
          ? stateNoteFor(practice.state)
          : null,
      targetDate:
        setAside(task) ? null : asWording(task.targetDate),
      // Never on a card that is set aside: a Task nobody opened cannot
      // be Not Applicable, and a Retired one is not news.
      newlyAdded: !setAside(task) && isNewlyAdded(task),
      open: task.ref === view.taskRef,
      landed: task.ref === view.movedRef,
    })),
    // The Phase in view reads its own line off the same tally the rail
    // does, rather than counting the cards a second time: two counts of the
    // one number is two places for the rule about Not Applicable to drift.
    phaseProgress: progress.byPhase.get(inView.id) ?? nothingAsked(),
    listProgress: progress.whole,
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
  /**
   * The Practice's own writing, and the day it is aiming at. Both kinds of
   * Task carry them — a Global Task on its Task Entry, a Custom Task on
   * itself — because a Note belongs to the Practice and a Practice does not
   * think of its own Tasks as a different kind of thing.
   */
  note: string | null;
  targetDate: Date | null;
}

interface MergedGlobalTask extends MergedTaskShared {
  kind: "global";
  globalTaskId: number;
  stateSpecific: boolean;
  /** Its editorial place inside the Phase, stored rather than derived. */
  position: number;
  /** Set once the Admin has Retired it. Null for every live Task. */
  retiredAt: Date | null;
  /** The two halves of Newly Added, kept apart until the predicate below. */
  announcedAt: Date | null;
  acknowledgedAt: Date | null;
}

interface MergedCustomTask extends MergedTaskShared {
  kind: "custom";
  id: number;
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
      retiredAt: globalTask.retiredAt,
      status: taskEntry.status,
      note: taskEntry.note,
      targetDate: taskEntry.targetDate,
      announcedAt: taskEntry.announcedAt,
      acknowledgedAt: taskEntry.acknowledgedAt,
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
      note: row.note,
      targetDate: row.targetDate,
      stateSpecific: row.stateSpecific,
      position: row.position,
      retiredAt: row.retiredAt,
      announcedAt: row.announcedAt,
      acknowledgedAt: row.acknowledgedAt,
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
      note: customTask.note,
      targetDate: customTask.targetDate,
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
      id: row.id,
      ref: customRef(row.id),
      title: row.title,
      body: row.body,
      status: row.status,
      note: row.note,
      targetDate: row.targetDate,
      createdAt: row.createdAt,
    }));
}

/**
 * Status first, and then the Library's own order.
 *
 * Within a bucket the Task Library's editorial sequence holds, and a
 * Practice's own Tasks queue behind it by age — a manual order cannot
 * coexist with a list that re-sorts itself the moment a Status changes.
 */
function byStatusThenLibraryOrder(left: MergedTask, right: MergedTask): number {
  const byStatus = sortBucket(left) - sortBucket(right);
  if (byStatus !== 0) return byStatus;

  if (left.kind === "global" && right.kind === "global") {
    return left.position - right.position;
  }
  if (left.kind === "custom" && right.kind === "custom") {
    const byAge = left.createdAt.getTime() - right.createdAt.getTime();
    // `created_at` is whole seconds, so two Tasks written in the same one
    // tie. The id breaks it in the order they were written, which is the
    // order the physician typed them and the only one they would expect.
    return byAge !== 0 ? byAge : left.id - right.id;
  }
  return left.kind === "global" ? -1 : 1;
}

/**
 * Newly Added: announced to this Practice, and not yet opened by anyone in
 * it.
 *
 * A Custom Task can never be one — a Practice does not announce a Task to
 * itself — and neither can a Task the Practice was born with, whose
 * `announced_at` is null forever.
 */
function isNewlyAdded(task: MergedTask): boolean {
  return (
    task.kind === "global" &&
    task.announcedAt !== null &&
    task.acknowledgedAt === null
  );
}

/** A Retired Task: withdrawn from the Library, and kept because this Practice touched it. */
function isRetired(task: MergedTask): boolean {
  return task.kind === "global" && task.retiredAt !== null;
}

/**
 * A Task that is off this Practice's list, either way it got there.
 *
 * Not Applicable and `No longer required` render identically — dimmed to the
 * title alone, at the bottom of the Phase — and count neither way towards
 * progress. One predicate for both, taking the two fields rather than a
 * whole Task so that the Phase in view and the whole-list tally cannot spell
 * the rule out differently.
 */
function offTheList(task: { status: TaskStatus; retired: boolean }): boolean {
  return task.status === "not_applicable" || task.retired;
}

/** The same question, asked of a Task on its way to becoming a card. */
function setAside(task: MergedTask): boolean {
  return offTheList({ status: task.status, retired: isRetired(task) });
}

/**
 * Which of the four bands a Task sorts into within its Phase.
 *
 * Four, not five: a Retired Task sorts where a Not Applicable one does,
 * because it is *rendered exactly as a Not Applicable Task is* (CONTEXT.md)
 * and whatever Status the Practice last gave it has stopped being the thing
 * worth reading. A fifth band is the shape ADR-0002 rejected — "it adds a
 * fifth bucket to the list's sort order, a second thing that renders
 * differently" — and there is no reason to buy it back here.
 */
function sortBucket(task: MergedTask): number {
  return STATUS_ORDER[isRetired(task) ? "not_applicable" : task.status];
}

/**
 * A Phase that is asking nothing of this Practice, which is complete by the
 * same arithmetic as one that is finished — see `RailPhase.complete`.
 *
 * A new object each time rather than one shared constant: the tally below is
 * built by mutating in place, and a sentinel handed out eleven times is one
 * `+= 1` away from every empty Phase counting the same Tasks.
 */
function nothingAsked(): Progress {
  return { done: 0, total: 0 };
}

/** The whole list's tally, and the same tally cut by Phase. */
interface ProgressTally {
  whole: Progress;
  /** Keyed by Phase id. A Phase asking nothing is simply absent. */
  byPhase: Map<number, Progress>;
}

/**
 * The count over the whole list, cut eleven ways as well as summed.
 *
 * Read here rather than summed from eleven journey maps: the physician asked
 * one question — how far am I? — and it is one query over the Task Entries
 * and the Practice's own Tasks. A Retired Task whose Entry the Admin deleted
 * is not in it at all, and one the Practice had touched is in it and
 * uncounted, which are the same answer arrived at two ways.
 *
 * The per-Phase cut is the rail, and it comes out of these same rows rather
 * than eleven more queries. It is still the second merge ADR-0003 names, not
 * a third: the same two tables, read once, tallied twice.
 */
function progressTally(
  database: AppDatabase,
  practice: CurrentPractice,
): ProgressTally {
  const globals = database
    .select({
      phaseId: globalTask.phaseId,
      status: taskEntry.status,
      retiredAt: globalTask.retiredAt,
    })
    .from(taskEntry)
    .innerJoin(globalTask, eq(taskEntry.globalTaskId, globalTask.id))
    .where(
      and(
        eq(taskEntry.practiceId, practice.id),
        isNotNull(globalTask.publishedAt),
      ),
    )
    .all()
    .map((row) => ({
      phaseId: row.phaseId,
      status: row.status,
      retired: row.retiredAt !== null,
    }));

  const customs = database
    .select({ phaseId: customTask.phaseId, status: customTask.status })
    .from(customTask)
    .where(eq(customTask.practiceId, practice.id))
    .all()
    // A Custom Task belongs to the Practice that wrote it, and the Admin has
    // no reach into it: there is nobody who could Retire one.
    .map((row) => ({ phaseId: row.phaseId, status: row.status, retired: false }));

  const counted = [...globals, ...customs].filter((row) => !offTheList(row));

  const byPhase = new Map<number, Progress>();
  for (const row of counted) {
    const tally = byPhase.get(row.phaseId) ?? nothingAsked();
    tally.total += 1;
    if (row.status === "done") tally.done += 1;
    byPhase.set(row.phaseId, tally);
  }

  return {
    whole: {
      done: counted.filter((row) => row.status === "done").length,
      total: counted.length,
    },
    byPhase,
  };
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
    retired: isRetired(task),
    custom: task.kind === "custom",
    note: task.note ?? "",
    // A Note is a Practice's own writing, so it goes through the parser
    // that will not emit HTML whatever it is handed — never the Admin's.
    noteHtml: task.note ? renderPracticeBody(task.note) : null,
    targetDateValue: task.targetDate ? asDayValue(task.targetDate) : null,
    targetDate: asWording(task.targetDate),
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

/**
 * A target date as a physician reads it, and null when there is none.
 *
 * Spelled out rather than `03/14/2026`, because a physician glancing at a
 * card should not have to decide which number is the month, and fixed to
 * one locale and to UTC so that the day stored is the day shown wherever
 * the page was rendered.
 */
function asWording(day: Date | null): string | null {
  return day ? TARGET_DATE_WORDING.format(day) : null;
}

const TARGET_DATE_WORDING = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/** The same day as `yyyy-mm-dd`, which is what a date field takes back. */
function asDayValue(day: Date): string {
  return day.toISOString().slice(0, 10);
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

/** `Varies by state`, pointed at a state when the Practice named one. */
function stateNoteFor(state: string | null): string {
  return state ? `Varies by state — check ${state}'s rules` : "Varies by state";
}
