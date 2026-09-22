import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { expect, onTestFinished, test } from "vitest";

import { createDatabase, type AppDatabase } from "~/database/database";
import { globalTask, phase, taskDependency } from "~/database/schema";
import { exportTaskLibrary, ExportError } from "~/seed/export";
import { seed, TASK_LIBRARY_CSV_PATH } from "~/seed/seed";

/**
 * Seam 4 again, from the other direction.
 *
 * The contract is one sentence — exporting a freshly seeded database
 * reproduces the committed CSV byte for byte — and the first test is that
 * sentence. Everything after it is a case where the database holds something
 * the CSV cannot, which is where an exporter is tempted to quietly drop a row.
 */

function freshDatabase(): AppDatabase {
  const directory = mkdtempSync(join(tmpdir(), "launch-tasks-export-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return createDatabase(join(directory, "test.sqlite"));
}

/** A seeded database, which is the starting point for nearly every case here. */
function seededDatabase(): AppDatabase {
  const database = freshDatabase();
  seed(database, TASK_LIBRARY_CSV_PATH);
  return database;
}

function idOf(database: AppDatabase, title: string): number {
  return database
    .select({ id: globalTask.id })
    .from(globalTask)
    .where(eq(globalTask.title, title))
    .get()!.id;
}

test("exporting a freshly seeded database reproduces the committed CSV", () => {
  const database = seededDatabase();

  const result = exportTaskLibrary(database);

  expect(result.csv).toBe(readFileSync(TASK_LIBRARY_CSV_PATH, "utf8"));
  expect(result).toMatchObject({ tasks: 98, phases: 11, skipped: [] });
});

test("the exported CSV seeds a second database identically", () => {
  const first = seededDatabase();
  const csv = exportTaskLibrary(first).csv;

  const directory = mkdtempSync(join(tmpdir(), "launch-tasks-roundtrip-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "exported.csv");
  writeFileSync(path, csv);

  const second = freshDatabase();
  const result = seed(second, path);

  expect(result).toMatchObject({ tasks: 98, phases: 11, dependencies: 60 });
  expect(exportTaskLibrary(second).csv).toBe(csv);
});

test("an edited Body comes back out in the CSV", () => {
  const database = seededDatabase();
  database
    .update(globalTask)
    .set({ body: 'A rewritten Body, with a comma and a "quote" in it.' })
    .where(eq(globalTask.title, "Domain Name"))
    .run();

  const csv = exportTaskLibrary(database).csv;

  expect(csv).toContain(
    '"A rewritten Body, with a comma and a ""quote"" in it."',
  );
});

test("a Draft is left out, and named on the way out", () => {
  const database = seededDatabase();
  database
    .update(globalTask)
    .set({ publishedAt: null })
    .where(eq(globalTask.title, "Domain Name"))
    .run();

  const result = exportTaskLibrary(database);

  expect(result.tasks).toBe(97);
  expect(result.skipped).toEqual([{ title: "Domain Name", state: "draft" }]);
  expect(result.csv).not.toContain("Domain Name");
});

test("a Retired Task is left out, which is how a content pass deletes one", () => {
  const database = seededDatabase();
  database
    .update(globalTask)
    .set({ retiredAt: new Date() })
    .where(eq(globalTask.title, "Domain Name"))
    .run();

  const result = exportTaskLibrary(database);

  expect(result.tasks).toBe(97);
  expect(result.skipped).toEqual([{ title: "Domain Name", state: "retired" }]);
});

test("a Phase whose every Task went away does not appear in the CSV", () => {
  const database = seededDatabase();
  const launch = database
    .select()
    .from(phase)
    .where(eq(phase.name, "Launch"))
    .get()!;
  database
    .update(globalTask)
    .set({ retiredAt: new Date() })
    .where(eq(globalTask.phaseId, launch.id))
    .run();

  const result = exportTaskLibrary(database);

  expect(result.phases).toBe(10);
  expect(result.csv).not.toContain("Launch,");
});

test("a second Dependency is refused, naming both", () => {
  // *Register Legal Business Name* already depends on *Business Structure
  // Decision* in the committed file, so this is the Admin adding a second
  // predecessor in the picker — which the panel allows and the CSV cannot
  // hold.
  const database = seededDatabase();
  database
    .insert(taskDependency)
    .values({
      globalTaskId: idOf(database, "Register Legal Business Name"),
      dependsOnTaskId: idOf(database, "Business Name Brainstorm & Research"),
    })
    .run();

  expect(() => exportTaskLibrary(database)).toThrow(ExportError);

  // Both predecessors are named, in whichever order the rows came back: the
  // Admin chose them and is the only one who can say which survives, so the
  // message has to carry both. The order is a join artifact and not a promise.
  const message = (() => {
    try {
      exportTaskLibrary(database);
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  })();
  expect(message).toContain("Register Legal Business Name");
  expect(message).toContain("Business Structure Decision");
  expect(message).toContain("Business Name Brainstorm & Research");
});

test("a Dependency on an unpublished Task is refused", () => {
  const database = seededDatabase();
  const edge = database.select().from(taskDependency).get()!;
  database
    .update(globalTask)
    .set({ publishedAt: null })
    .where(eq(globalTask.id, edge.dependsOnTaskId))
    .run();

  expect(() => exportTaskLibrary(database)).toThrow(
    /depends on a Task that is not Published/,
  );
});

test("a database with nothing Published is refused rather than emptied", () => {
  const database = seededDatabase();
  database.update(globalTask).set({ publishedAt: null }).run();

  expect(() => exportTaskLibrary(database)).toThrow(ExportError);
  expect(() => exportTaskLibrary(database)).toThrow(/no Published Tasks/);
});
