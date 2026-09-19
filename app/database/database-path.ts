/**
 * Where the SQLite file lives, in one place.
 *
 * The app, `drizzle-kit` and the Docker image all need to agree on this, and
 * the app is the only one of the three that can be asked in TypeScript.
 */
export const DEFAULT_DATABASE_PATH = "./data/launch-tasks.sqlite";

/** The configured path, or the default. */
export function databasePath(): string {
  return process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
}
