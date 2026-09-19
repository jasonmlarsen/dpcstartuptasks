import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AppDatabase } from "../database/database";
import {
  globalTask,
  helpfulLink,
  phase,
  taskDependency,
} from "../database/schema";
import { parseCsv, type CsvRow } from "./csv";
import { slugify } from "./slug";

/**
 * Where the cleaned CSV lives.
 *
 * The Seed Script's default, and what the tests read: the guarantees below
 * are asserted against the real committed file, because the numbers in the
 * spec are measurements of it. Resolved against this module rather than the
 * working directory, so seeding from a checkout does not depend on where the
 * operator was standing.
 */
export const TASK_LIBRARY_CSV_PATH = fileURLToPath(
  new URL("../../docs/seed/task-library.csv", import.meta.url),
);

/**
 * A Seed refused or failed, and nothing was written.
 *
 * Every validation here is a hard error on purpose: the CSV is hand-
 * maintained, so validating it at Seed is not defensive programming, it is
 * load-bearing. A silent repair — a derived link label, a `-2` slug suffix —
 * would turn a duplicated row into content nobody notices for a year.
 */
export class SeedError extends Error {
  override name = "SeedError";
}

/** What a Seed put in the database, for the CLI to print. */
export interface SeedResult {
  phases: number;
  tasks: number;
  helpfulLinks: number;
  dependencies: number;
  /** The timestamp written to `published_at` on every row. */
  publishedAt: Date;
}

interface ParsedTask {
  title: string;
  slug: string;
  phaseName: string;
  body: string;
  stateSpecific: boolean;
  dependsOn: string | null;
  links: { label: string; url: string }[];
  /** The line it starts on in the CSV, so an error names a line a human can open. */
  line: number;
}

/**
 * Load the Task Library from the cleaned CSV into an empty database.
 *
 * Can only ever add: no delete path, no update path, and nothing here names
 * a Practice, a User or a Membership. That is the whole of what makes it safe
 * to point at production — the worst a mistake can do is refuse.
 *
 * A database that already holds Tasks is refused rather than merged. A
 * production copy pulled down for debugging has 98 `global_task` rows, so the
 * refusal covers that case without the script having to know which
 * environment it is in.
 */
export function seed(database: AppDatabase, csvPath: string): SeedResult {
  refuseIfPopulated(database);

  const tasks = readTasks(csvPath);
  refuseSlugCollisions(tasks);
  const byTitle = indexByTitle(tasks);
  validateDependencies(tasks, byTitle);

  // One timestamp for all 98 rows, truncated to the second the column stores,
  // so what the caller is told matches what it could read back.
  const publishedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const phaseNames = orderedPhaseNames(tasks);

  database.transaction((tx) => {
    const phaseIds = new Map<string, number>();
    phaseNames.forEach((name, index) => {
      const row = tx
        .insert(phase)
        .values({ name, position: index + 1 })
        .returning({ id: phase.id })
        .get();
      phaseIds.set(name, row.id);
    });

    const positions = new Map<string, number>();
    const taskIds = new Map<string, number>();

    for (const task of tasks) {
      const position = (positions.get(task.phaseName) ?? 0) + 1;
      positions.set(task.phaseName, position);

      const row = tx
        .insert(globalTask)
        .values({
          slug: task.slug,
          title: task.title,
          phaseId: phaseIds.get(task.phaseName)!,
          body: task.body,
          stateSpecific: task.stateSpecific,
          position,
          // Never null. Null means Draft, means no Task Entries, means every
          // Practice opens an empty list.
          publishedAt,
        })
        .returning({ id: globalTask.id })
        .get();
      taskIds.set(task.slug, row.id);

      task.links.forEach((link, index) => {
        tx.insert(helpfulLink)
          .values({
            globalTaskId: row.id,
            label: link.label,
            url: link.url,
            position: index + 1,
          })
          .run();
      });
    }

    for (const task of tasks) {
      if (task.dependsOn === null) continue;
      tx.insert(taskDependency)
        .values({
          globalTaskId: taskIds.get(task.slug)!,
          dependsOnTaskId: taskIds.get(byTitle.get(task.dependsOn)!.slug)!,
        })
        .run();
    }
  });

  return {
    phases: phaseNames.length,
    tasks: tasks.length,
    helpfulLinks: tasks.reduce((total, task) => total + task.links.length, 0),
    dependencies: tasks.filter((task) => task.dependsOn !== null).length,
    publishedAt,
  };
}

function refuseIfPopulated(database: AppDatabase) {
  const existing = database.select({ id: globalTask.id }).from(globalTask).get();
  if (existing) {
    throw new SeedError(
      "This database already holds Tasks, so it will not be seeded. " +
        "A Seed only ever adds; discard the file and seed a fresh one.",
    );
  }
}

function readTasks(csvPath: string): ParsedTask[] {
  let text: string;
  try {
    text = readFileSync(csvPath, "utf8");
  } catch {
    throw new SeedError(`No CSV to seed from at ${csvPath}`);
  }

  const rows = parseCsv(text);
  if (rows.length === 0) throw new SeedError(`${csvPath} holds no Tasks`);

  return rows.map(parseTask);
}

function parseTask({ values: row, line }: CsvRow): ParsedTask {
  const title = required(row, "title", line);
  const phaseName = required(row, "phase", line);
  const body = required(row, "body", line);

  const slug = slugify(title);
  if (slug === "") {
    throw new SeedError(`Line ${line}: "${title}" produces an empty slug`);
  }

  const stateSpecific = readYesNo(row["state_specific"] ?? "", line);
  const dependsOn = (row["depends_on"] ?? "").trim() || null;

  return {
    title,
    slug,
    phaseName,
    body,
    stateSpecific,
    dependsOn,
    links: readLinks(row["helpful_links"] ?? "", title, line),
    line,
  };
}

function required(
  row: Record<string, string>,
  column: string,
  line: number,
): string {
  const value = (row[column] ?? "").trim();
  if (value === "") throw new SeedError(`Line ${line}: ${column} is blank`);
  return value;
}

function readYesNo(value: string, line: number): boolean {
  const normalised = value.trim();
  if (normalised === "Yes") return true;
  if (normalised === "No") return false;
  throw new SeedError(
    `Line ${line}: state_specific must be Yes or No, not "${normalised}"`,
  );
}

/**
 * Read the ordered Helpful Links, refusing a blank label.
 *
 * There is no derivation path, deliberately: a label derived from the domain
 * renders as "IRS" above "irs.gov" — a title that is literally its own
 * subtitle. The label is hand-written in the CSV or the Task has no link.
 */
function readLinks(
  value: string,
  title: string,
  line: number,
): { label: string; url: string }[] {
  const raw = value.trim();
  if (raw === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SeedError(
      `Line ${line}: "${title}" has a helpful_links value that is not JSON`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new SeedError(
      `Line ${line}: "${title}" has a helpful_links value that is not a list`,
    );
  }

  return parsed.map((entry) => {
    const link = entry as { label?: unknown; url?: unknown };
    const label = typeof link.label === "string" ? link.label.trim() : "";
    const url = typeof link.url === "string" ? link.url.trim() : "";

    if (label === "") {
      throw new SeedError(
        `Line ${line}: a Helpful Link on "${title}" has a blank label. ` +
          "The label is what a physician reads, and a bare URL is a bug.",
      );
    }
    if (url === "") {
      throw new SeedError(
        `Line ${line}: the Helpful Link "${label}" on "${title}" has no URL`,
      );
    }
    return { label, url };
  });
}

/**
 * Refuse two titles that slug the same.
 *
 * Never a silent `-2` suffix: in a hand-cleaned 98-row file, two titles
 * colliding almost certainly means a duplicated row, and `domain-name-2` is
 * how that goes unnoticed for a year.
 */
function refuseSlugCollisions(tasks: ParsedTask[]) {
  const bySlug = new Map<string, ParsedTask>();

  for (const task of tasks) {
    const clash = bySlug.get(task.slug);
    if (clash) {
      throw new SeedError(
        `Line ${task.line}: "${task.title}" and "${clash.title}" ` +
          `(line ${clash.line}) both slug to "${task.slug}"`,
      );
    }
    bySlug.set(task.slug, task);
  }
}

/** Index by the title, which is how `depends_on` names a Task. */
function indexByTitle(tasks: ParsedTask[]): Map<string, ParsedTask> {
  return new Map(tasks.map((task) => [task.title, task]));
}

/**
 * Refuse a dangling target and refuse a cycle, before anything is written.
 *
 * Cross-Phase edges are fine — 19 of the seeded 60 cross a boundary, and a
 * Dependency is advice that nothing enforces, so a Phase reorder breaks no
 * invariant. A cycle is not fine: it is advice that cannot be followed, and
 * the admin panel's picker rejects one for the same reason.
 */
function validateDependencies(
  tasks: ParsedTask[],
  byTitle: Map<string, ParsedTask>,
) {
  for (const task of tasks) {
    if (task.dependsOn === null) continue;
    if (!byTitle.has(task.dependsOn)) {
      throw new SeedError(
        `Line ${task.line}: "${task.title}" depends on "${task.dependsOn}", ` +
          "which is not a Task in this file",
      );
    }
    if (task.dependsOn === task.title) {
      throw new SeedError(
        `Line ${task.line}: "${task.title}" depends on itself`,
      );
    }
  }

  // Each Task has at most one predecessor here, so a cycle is found by
  // walking forward from every Task until the trail repeats.
  const settled = new Set<string>();
  for (const start of tasks) {
    if (settled.has(start.title)) continue;

    const trail: string[] = [];
    const seen = new Set<string>();
    let current: ParsedTask | undefined = start;

    while (current && !settled.has(current.title)) {
      if (seen.has(current.title)) {
        const loop = trail.slice(trail.indexOf(current.title));
        throw new SeedError(
          `These Tasks depend on each other in a loop: ` +
            `${[...loop, current.title].join(" → ")}`,
        );
      }
      seen.add(current.title);
      trail.push(current.title);
      current = current.dependsOn ? byTitle.get(current.dependsOn) : undefined;
    }

    for (const title of trail) settled.add(title);
  }
}

/** Phase order is first appearance in the file; there is no column for it. */
function orderedPhaseNames(tasks: ParsedTask[]): string[] {
  const names: string[] = [];
  for (const task of tasks) {
    if (!names.includes(task.phaseName)) names.push(task.phaseName);
  }
  return names;
}
