import { createContext, RouterContextProvider } from "react-router";

import { createDatabase, type AppDatabase } from "~/database/database";
import { databasePath } from "~/database/database-path";
import type { EmailSender } from "./email-sender";
import type { KitClient } from "./kit-client";

/**
 * Everything a route is allowed to reach the outside world through.
 *
 * Loaders and actions never import a database handle or a mail client; they
 * ask for these. That is what makes seam 1 possible — a test builds its own
 * `AppServices` over a temp SQLite file and two fakes, and the routes under
 * test cannot tell the difference or route around it.
 */
export interface AppServices {
  database: AppDatabase;
  emailSender: EmailSender;
  kitClient: KitClient;
}

/**
 * Null by default, because in production nobody injects anything: the server
 * runs the request handler with no load context and `getServices` falls
 * through to the process-wide services below.
 */
const servicesContext = createContext<AppServices | null>(null);

/** Build a load context carrying the given services. Used by the test harness. */
export function createServicesContext(
  services: AppServices,
): RouterContextProvider {
  const context = new RouterContextProvider();
  context.set(servicesContext, services);
  return context;
}

/** Read the services a loader or action should use. */
export function getServices(
  context: Readonly<RouterContextProvider>,
): AppServices {
  return context.get(servicesContext) ?? getProductionServices();
}

let productionServices: AppServices | undefined;

/**
 * The real services, built once per process from the environment.
 *
 * Built lazily rather than at import time so that importing a route module —
 * which a test does constantly — never opens a database file.
 */
function getProductionServices(): AppServices {
  // A test reaching this has dispatched a request without going through
  // `createTestApp`, and would otherwise open and migrate the real database
  // while appearing to pass. Seam 1's isolation fails loudly instead.
  if (process.env.VITEST) {
    throw new Error(
      "No services were injected. Dispatch through createTestApp() in test/harness.ts.",
    );
  }

  productionServices ??= {
    database: createDatabase(databasePath()),

    // Resend and Kit are later tickets. This one owes them the interfaces, not
    // the implementations, and a route that reaches for one before it exists
    // should say so here rather than fail somewhere downstream. Getters, so
    // that a route needing only the database still gets it.
    get emailSender(): EmailSender {
      throw new Error("EmailSender has no production implementation yet.");
    },
    get kitClient(): KitClient {
      throw new Error("KitClient has no production implementation yet.");
    },
  };
  return productionServices;
}
