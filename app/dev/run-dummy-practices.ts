import { count } from "drizzle-orm";
import { createRequestHandler, type ServerBuild } from "react-router";

import { createDatabase } from "~/database/database";
import { globalTask } from "~/database/schema";
import type { KitClient } from "~/services/kit-client";
import type { AppServices } from "~/services/services";
import { DevMailbox } from "./dev-mailbox";
import {
  buildDummyPractices,
  DummyPracticeError,
  type DummyPractice,
} from "./dummy-practices";
import { createDummySite } from "./dummy-site";
import { assertDevelopment } from "./not-production";

/**
 * One run of the dev tool: a database, a mailbox, and the real routes.
 *
 * This is where the CLI's work actually happens, and it is app-side rather
 * than in `scripts/` for a reason that is easy to be bitten by: the routes
 * reach the database through a **module-level context** (`getServices`), so
 * a second copy of `app/services/services.ts` — which is what importing it
 * outside the server build's own module graph gets you — is a second,
 * unrelated context. The routes would then quietly fall through to the
 * production services and the injected mailbox would never be read. So the
 * CLI loads this module the same way it loads the server build, and nothing
 * app-side is imported twice.
 */
export interface DummyRun {
  /** The server build the CLI loaded, which is the real routes. */
  build: ServerBuild;
  /** The development SQLite file to build into. */
  databaseFile: string;
  practices?: number;
  label?: string;
  /** Where the run narrates itself. */
  log?: (line: string) => void;
  /** What is read for signs of production. Defaulted to this process's own. */
  environment?: NodeJS.ProcessEnv;
}

export async function runDummyPractices({
  build,
  databaseFile,
  practices,
  label,
  log = () => {},
  environment = process.env,
}: DummyRun): Promise<DummyPractice[]> {
  // Here rather than in the CLI, and before the file is so much as opened:
  // the refusal is a property of the tool, not of one wrapper around it, and
  // a second caller that forgot to ask would be the whole guard gone.
  assertDevelopment({ environment, databaseFile });

  const database = createDatabase(databaseFile);

  // A Practice is created with a Task Entry for every Published Task, so
  // registering against an unseeded database would build Practices with
  // empty lists — not a dummy Practice but a misleading one.
  const library = database.select({ tasks: count() }).from(globalTask).get();
  if (!library || library.tasks === 0) {
    throw new DummyPracticeError(
      `${databaseFile} holds no Task Library. Seed it first: npm run db:seed`,
    );
  }

  const mailbox = new DevMailbox(log);

  const services: AppServices = {
    database,
    emailSender: mailbox,

    // Registration with Email Consent writes a Kit Sync Job and never calls
    // Kit, which is the single most load-bearing thing about that
    // integration. A dummy Owner reaching the real newsletter would put a
    // fictional address in production's audience, so this finds out here
    // rather than there.
    get kitClient(): KitClient {
      throw new Error(
        "A dummy Practice never reaches Kit. Nothing should have read this.",
      );
    },
  };

  const site = createDummySite(
    createRequestHandler(build, "development"),
    services,
    mailbox,
  );

  return buildDummyPractices(site, { practices, label });
}
