import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * The row `/health` reads.
 *
 * The health check has to prove that the SQLite file is present, readable and
 * migrated, and it has to keep proving the same thing once the Task Library
 * and every Practice table arrive. Pointing it at a domain table would tie an
 * uptime monitor to the data model and make the check's meaning move whenever
 * the model did. This table exists for the monitor and for nothing else: one
 * row, written by the initial migration, never written again.
 */
export const healthCheck = sqliteTable("health_check", {
  id: integer("id").primaryKey(),
  /** The string the uptime monitor greps the response for. */
  keyword: text("keyword").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** The single row's primary key, and the only one the check ever asks for. */
export const HEALTH_CHECK_ROW_ID = 1;

/**
 * A Phase: an ordered grouping of Tasks.
 *
 * Its number is derived from `position` and is never part of `name` — the
 * cleaned CSV strips the `Phase N: ` prefix for exactly this reason, so that
 * reordering the rail is a `position` edit and not eleven renames.
 */
export const phase = sqliteTable("phase", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  position: integer("position").notNull(),
});

/**
 * A Global Task: a Task belonging to the Task Library.
 *
 * Separate from `custom_task` (ADR-0003), so a query against this table cannot
 * leak a Practice's work — there is none in it.
 */
export const globalTask = sqliteTable("global_task", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Derived from the title at Seed and frozen forever. Never edited. */
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  phaseId: integer("phase_id")
    .notNull()
    .references(() => phase.id),
  /** Markdown. Since no other descriptive field survives, the Body is the Task. */
  body: text("body").notNull(),
  stateSpecific: integer("state_specific", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Order within the Phase. */
  position: integer("position").notNull(),
  /** Null means Draft: no Practice has a Task Entry for it. A Seed always sets it. */
  publishedAt: integer("published_at", { mode: "timestamp" }),
});

/**
 * A Helpful Link: a curated, labelled link on a Global Task.
 *
 * `label` is `notNull` because a bare URL is a bug, and the Seed refuses a
 * blank one rather than deriving anything.
 */
export const helpfulLink = sqliteTable("helpful_link", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  globalTaskId: integer("global_task_id")
    .notNull()
    .references(() => globalTask.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  /** Render order, which is editorial and so is stored rather than derived. */
  position: integer("position").notNull(),
});

/**
 * A Dependency: one Task usually comes after another. Advice, never
 * enforcement — nothing in the product is ever locked, so nothing reads this
 * to decide what a physician may do.
 */
export const taskDependency = sqliteTable(
  "task_dependency",
  {
    globalTaskId: integer("global_task_id")
      .notNull()
      .references(() => globalTask.id, { onDelete: "cascade" }),
    dependsOnTaskId: integer("depends_on_task_id")
      .notNull()
      .references(() => globalTask.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.globalTaskId, table.dependsOnTaskId] })],
);
