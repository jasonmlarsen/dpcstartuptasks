import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

/**
 * Where the generated migrations live, relative to the working directory.
 * The Docker image copies `drizzle/` next to the build for this reason.
 */
const MIGRATIONS_FOLDER = process.env.MIGRATIONS_FOLDER ?? "drizzle";

export type AppDatabase = ReturnType<typeof createDatabase>;

/**
 * Open a SQLite file and bring it up to date.
 *
 * SQLite is a file (ADR-0005), so this is the whole persistence layer: the app
 * calls it once at boot against the volume, and a test calls it per test
 * against a temp path. Migrations run on open, so neither caller has a
 * separate setup step to forget.
 */
export function createDatabase(filePath: string) {
  // better-sqlite3 creates the file but not the directory holding it, and on a
  // fresh volume the directory is what is missing.
  mkdirSync(dirname(filePath), { recursive: true });

  const sqlite = new Database(filePath);

  // WAL for concurrent reads, and foreign keys on, which SQLite leaves off by
  // default and Drizzle does not turn on for us.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });

  return database;
}
