import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { expect, onTestFinished, test } from "vitest";

import { createDatabase, type AppDatabase } from "~/database/database";
import {
  globalTask,
  helpfulLink,
  phase,
  taskDependency,
} from "~/database/schema";
import { seed, SeedError, TASK_LIBRARY_CSV_PATH } from "~/seed/seed";

/**
 * Seam 4: the Seed Script, asserted directly.
 *
 * The Seed is the one piece of this system with no user at all, so there is no
 * request to hang its guarantees on. These run against the **real committed
 * CSV**, never a fixture: the 98 Tasks and 11 Phases in the spec are
 * measurements of that file, and this is what keeps them true. Only the tests
 * for malformed input write a CSV of their own, because the real file is
 * well-formed by construction and a broken one has to be built to be seen.
 */

function freshDatabase(): AppDatabase {
  const directory = mkdtempSync(join(tmpdir(), "launch-tasks-seed-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return createDatabase(join(directory, "test.sqlite"));
}

/** A CSV written for this test alone, for the cases the real file cannot show. */
function csvFile(body: string): string {
  const directory = mkdtempSync(join(tmpdir(), "launch-tasks-csv-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "tasks.csv");
  writeFileSync(path, body);
  return path;
}

const HEADER = "phase,title,body,state_specific,depends_on,helpful_links";

test("the real cleaned CSV seeds 98 Tasks across 11 Phases", () => {
  const database = freshDatabase();

  const result = seed(database, TASK_LIBRARY_CSV_PATH);

  expect(result).toMatchObject({ tasks: 98, phases: 11 });
  expect(database.select().from(globalTask).all()).toHaveLength(98);
  expect(database.select().from(phase).all()).toHaveLength(11);
});

test("Phases carry a name with no ordinal in it, and a position", () => {
  const database = freshDatabase();

  seed(database, TASK_LIBRARY_CSV_PATH);

  const phases = database.select().from(phase).all();
  expect(phases.map((row) => row.position)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
  ]);
  expect(phases[0]).toMatchObject({ name: "Foundation & Planning", position: 1 });
  expect(phases[10]).toMatchObject({ name: "Launch", position: 11 });
  for (const row of phases) {
    expect(row.name).not.toMatch(/^Phase \d/);
  }
});

test("every seeded Task is Published, so no Practice opens an empty list", () => {
  const database = freshDatabase();

  const result = seed(database, TASK_LIBRARY_CSV_PATH);

  const tasks = database.select().from(globalTask).all();
  for (const task of tasks) {
    expect(task.publishedAt).toBeInstanceOf(Date);
  }
  expect(
    tasks.every(
      (task) => task.publishedAt?.getTime() === result.publishedAt.getTime(),
    ),
  ).toBe(true);
});

test("a Task carries its slug, position within the Phase, and state flag", () => {
  const database = freshDatabase();

  seed(database, TASK_LIBRARY_CSV_PATH);

  const first = database
    .select()
    .from(globalTask)
    .where(eq(globalTask.slug, "business-name-brainstorm-research"))
    .get();
  expect(first).toMatchObject({
    title: "Business Name Brainstorm & Research",
    position: 1,
    stateSpecific: false,
  });

  // Every Phase numbers its own Tasks from 1.
  const positions = new Map<number, number[]>();
  for (const task of database.select().from(globalTask).all()) {
    positions.set(task.phaseId, [
      ...(positions.get(task.phaseId) ?? []),
      task.position,
    ]);
  }
  for (const [, values] of positions) {
    expect([...values].sort((a, b) => a - b)).toEqual(
      values.map((_, index) => index + 1),
    );
  }

  // The hand wart from the cleaned file: no stray `-s-` in the slug.
  const slugs = database.select({ slug: globalTask.slug }).from(globalTask).all();
  expect(slugs.map((row) => row.slug)).toContain(
    "file-trade-names-dba-doing-business-as-names-if-necessary",
  );
  expect(new Set(slugs.map((row) => row.slug)).size).toBe(98);
});

test("the eleven state-specific Tasks keep their flag", () => {
  const database = freshDatabase();

  seed(database, TASK_LIBRARY_CSV_PATH);

  const flagged = database
    .select()
    .from(globalTask)
    .where(eq(globalTask.stateSpecific, true))
    .all();
  expect(flagged).toHaveLength(11);
});

test("the five Helpful Links seed in order, each with its label", () => {
  const database = freshDatabase();

  const result = seed(database, TASK_LIBRARY_CSV_PATH);

  expect(result.helpfulLinks).toBe(5);

  const ein = database
    .select()
    .from(helpfulLink)
    .innerJoin(globalTask, eq(helpfulLink.globalTaskId, globalTask.id))
    .where(eq(globalTask.slug, "obtain-ein-employer-identification-number"))
    .all();
  expect(ein).toHaveLength(1);
  expect(ein[0]?.helpful_link).toMatchObject({
    label: "Apply for an EIN online (IRS)",
    position: 1,
  });
  expect(ein[0]?.helpful_link.url).toContain("irs.gov");
});

test("SEO Setup seeds with no Helpful Link, because the placeholder was cut", () => {
  const database = freshDatabase();

  seed(database, TASK_LIBRARY_CSV_PATH);

  const links = database
    .select()
    .from(helpfulLink)
    .innerJoin(globalTask, eq(helpfulLink.globalTaskId, globalTask.id))
    .where(eq(globalTask.slug, "seo-setup"))
    .all();
  expect(links).toEqual([]);

  // And the placeholder is not hiding anywhere else in the file either.
  expect(readFileSync(TASK_LIBRARY_CSV_PATH, "utf8")).not.toContain(
    "PUT LINK TO ARTICLE HERE",
  );
});

test("the surviving dependency edges seed verbatim, cross-Phase ones included", () => {
  const database = freshDatabase();

  // The original file carries 68 single edges. Seven have a cut Phase 12 Task
  // as their source and one is Website Hosting's duplicate of Website
  // Maintenance's, so 60 survive the cleanup — the same edges, minus the rows
  // that no longer exist.
  const result = seed(database, TASK_LIBRARY_CSV_PATH);

  expect(result.dependencies).toBe(60);
  expect(database.select().from(taskDependency).all()).toHaveLength(60);

  const edges = database
    .select({
      task: globalTask.slug,
      taskPhase: globalTask.phaseId,
      dependsOn: taskDependency.dependsOnTaskId,
    })
    .from(taskDependency)
    .innerJoin(globalTask, eq(taskDependency.globalTaskId, globalTask.id))
    .all();

  const phaseOf = new Map(
    database
      .select({ id: globalTask.id, phaseId: globalTask.phaseId })
      .from(globalTask)
      .all()
      .map((row) => [row.id, row.phaseId]),
  );
  const crossing = edges.filter(
    (edge) => phaseOf.get(edge.dependsOn) !== edge.taskPhase,
  );
  expect(crossing).toHaveLength(19);
});

test("seeding a database that already holds Tasks is refused", () => {
  const database = freshDatabase();
  seed(database, TASK_LIBRARY_CSV_PATH);

  expect(() => seed(database, TASK_LIBRARY_CSV_PATH)).toThrow(SeedError);
  expect(() => seed(database, TASK_LIBRARY_CSV_PATH)).toThrow(
    /already holds Tasks/,
  );

  // Refused means nothing happened, not half a second Task Library.
  expect(database.select().from(globalTask).all()).toHaveLength(98);
  expect(database.select().from(phase).all()).toHaveLength(11);
});

test("two titles that slug the same are a hard error, never a silent -2", () => {
  const database = freshDatabase();
  const path = csvFile(
    `${HEADER}\n` +
      "Foundation & Planning,Domain Name,Pick one.,No,,\n" +
      "Foundation & Planning,Domain name!,Pick another.,No,,\n",
  );

  expect(() => seed(database, path)).toThrow(/both slug to "domain-name"/);
  expect(database.select().from(globalTask).all()).toEqual([]);
});

test("a blank Helpful Link label is a hard error — there is no derivation path", () => {
  const database = freshDatabase();
  const path = csvFile(
    `${HEADER}\n` +
      'Foundation & Planning,Obtain EIN,Get one.,No,,"[{""label"":"""",""url"":""https://irs.gov""}]"\n',
  );

  expect(() => seed(database, path)).toThrow(/blank label/);
  expect(database.select().from(helpfulLink).all()).toEqual([]);
});

test("a dependency naming a Task that is not in the file is a hard error", () => {
  const database = freshDatabase();
  const path = csvFile(
    `${HEADER}\n` +
      "Foundation & Planning,Register Legal Business Name,File it.,No,Business Structure Decision,\n",
  );

  expect(() => seed(database, path)).toThrow(
    /depends on "Business Structure Decision", which is not a Task in this file/,
  );
  expect(database.select().from(globalTask).all()).toEqual([]);
});

test("a cycle is a hard error, and the loop is spelled out in titles", () => {
  const database = freshDatabase();
  const path = csvFile(
    `${HEADER}\n` +
      "Foundation & Planning,Lease,Sign it.,No,Buildout,\n" +
      "Foundation & Planning,Buildout,Build it.,No,Design,\n" +
      "Foundation & Planning,Design,Draw it.,No,Lease,\n",
  );

  expect(() => seed(database, path)).toThrow(
    /Lease → Buildout → Design → Lease/,
  );
  expect(database.select().from(taskDependency).all()).toEqual([]);
});
