import { asc } from "drizzle-orm";

import type { AppDatabase } from "../database/database";
import {
  globalTask,
  helpfulLink,
  phase,
  taskDependency,
} from "../database/schema";
import { stateOf } from "../admin/task-library";

/**
 * Write the live Task Library back out as the cleaned CSV.
 *
 * The other half of the Seed, and it exists for exactly one window: before
 * launch, when the content pass is done in the admin panel against a
 * development database and production does not exist yet. The admin panel is
 * the editor — a Body is proof-read where a physician will read it, not
 * inside a quoted CSV cell — but `docs/seed/task-library.csv` is still the
 * artifact production is built from, so the pass has to end back in the file.
 *
 * After launch this is a reporting tool and nothing more. A live database
 * holds Task Entries, and `seed()` refuses a populated database, so there is
 * no path by which an export re-enters production. That asymmetry is the
 * point: the dangerous direction stays impossible.
 *
 * Round-tripping is the whole contract — exporting a freshly seeded database
 * reproduces the committed file byte for byte, and `test/export.test.ts`
 * asserts it. Anything an export cannot represent is therefore a refusal
 * rather than a quiet omission: a silent drop here is a Task that disappears
 * from production and is noticed by nobody until a physician asks where it
 * went.
 */

/** An export refused, and nothing was written. */
export class ExportError extends Error {
  override name = "ExportError";
}

/** What an export produced, for the CLI to print. */
export interface ExportResult {
  /** The CSV text, ending in a newline. */
  csv: string;
  phases: number;
  tasks: number;
  helpfulLinks: number;
  dependencies: number;
  /**
   * The titles left out, and why.
   *
   * Never silent: the CSV has no state column — `seed()` publishes
   * everything it reads — so Draft and Retired are the two states that
   * cannot survive the trip, and Retire is how an Admin deletes during a
   * content pass. The operator is told which rows they just dropped.
   */
  skipped: { title: string; state: "draft" | "retired" }[];
}

/** The header the Seed reads, and the order the columns are written in. */
const COLUMNS = [
  "phase",
  "title",
  "body",
  "state_specific",
  "depends_on",
  "helpful_links",
] as const;

/** Export the Published Task Library as CSV text. */
export function exportTaskLibrary(database: AppDatabase): ExportResult {
  const phases = database
    .select()
    .from(phase)
    .orderBy(asc(phase.position))
    .all();

  // Ordered by the Phase's position and never by its id: the two coincide in
  // a freshly seeded database, and stop coinciding the moment an Admin
  // reorders the Phase rail.
  const phasePositions = new Map(phases.map((row) => [row.id, row.position]));
  const tasks = database
    .select()
    .from(globalTask)
    .all()
    .sort(
      (left, right) =>
        phasePositions.get(left.phaseId)! - phasePositions.get(right.phaseId)! ||
        left.position - right.position,
    );

  const skipped: ExportResult["skipped"] = [];
  const published = [];
  for (const task of tasks) {
    const state = stateOf(task);
    if (state === "published") published.push(task);
    else skipped.push({ title: task.title, state });
  }

  if (published.length === 0) {
    throw new ExportError(
      "This database holds no Published Tasks, so there is nothing to " +
        "export. A CSV of nothing would seed a Practice an empty list.",
    );
  }

  const titles = new Map(published.map((task) => [task.id, task.title]));
  const dependsOn = readDependencies(database, titles);
  const links = readLinks(database);
  const phaseNames = new Map(phases.map((row) => [row.id, row.name]));

  // Phase order is first appearance in the file, and the rows below are
  // already in Phase position order, so writing them in order is what
  // encodes it. A Phase whose every Task is Draft or Retired simply never
  // appears — there is no Phase row in the CSV to leave behind.
  const rows = published.map((task) => [
    phaseNames.get(task.phaseId)!,
    task.title,
    task.body,
    task.stateSpecific ? "Yes" : "No",
    dependsOn.get(task.id) ?? "",
    links.has(task.id) ? JSON.stringify(links.get(task.id)) : "",
  ]);

  const csv = [COLUMNS, ...rows]
    .map((cells) => cells.map(quote).join(","))
    .join("\n")
    // The committed file ends in a newline, and a file that does not is a
    // one-line diff on every export that follows.
    .concat("\n");

  return {
    csv,
    phases: new Set(published.map((task) => task.phaseId)).size,
    tasks: published.length,
    helpfulLinks: [...links.values()].reduce(
      (total, list) => total + list.length,
      0,
    ),
    dependencies: dependsOn.size,
    skipped,
  };
}

/**
 * The one predecessor per Task, as a title.
 *
 * The asymmetry the export has to police: `addDependency` lets an Admin give
 * a Task several predecessors, and `depends_on` holds exactly one. Keeping
 * the first would be a choice made by row order in a join, so a second edge
 * is refused and both are named — the Admin picked them and is the only one
 * who can say which survives.
 */
function readDependencies(
  database: AppDatabase,
  titles: Map<number, string>,
): Map<number, string> {
  const edges = database
    .select()
    .from(taskDependency)
    .orderBy(asc(taskDependency.globalTaskId))
    .all();

  const dependsOn = new Map<number, string>();

  for (const edge of edges) {
    const title = titles.get(edge.globalTaskId);
    // An edge hanging off a Draft or Retired Task goes wherever that Task
    // went: it is not in the file, so neither is its advice.
    if (title === undefined) continue;

    const predecessor = titles.get(edge.dependsOnTaskId);
    if (predecessor === undefined) {
      throw new ExportError(
        `"${title}" depends on a Task that is not Published, so the CSV ` +
          "would name a row that is not in it. Publish it, or drop the " +
          "Dependency.",
      );
    }

    const already = dependsOn.get(edge.globalTaskId);
    if (already !== undefined) {
      throw new ExportError(
        `"${title}" depends on both "${already}" and "${predecessor}", and ` +
          "the CSV holds one predecessor per Task. Remove one in the admin " +
          "panel and export again.",
      );
    }

    dependsOn.set(edge.globalTaskId, predecessor);
  }

  return dependsOn;
}

/** The ordered Helpful Links, by Task id. */
function readLinks(
  database: AppDatabase,
): Map<number, { label: string; url: string }[]> {
  const rows = database
    .select()
    .from(helpfulLink)
    .orderBy(asc(helpfulLink.globalTaskId), asc(helpfulLink.position))
    .all();

  const byTask = new Map<number, { label: string; url: string }[]>();
  for (const row of rows) {
    const list = byTask.get(row.globalTaskId) ?? [];
    list.push({ label: row.label, url: row.url });
    byTask.set(row.globalTaskId, list);
  }
  return byTask;
}

/**
 * Quote a cell only when it needs it.
 *
 * Minimal quoting, because the committed file is minimally quoted and a diff
 * of a content pass should show the sentences that changed rather than
 * ninety-eight rows growing quotation marks.
 */
function quote(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
