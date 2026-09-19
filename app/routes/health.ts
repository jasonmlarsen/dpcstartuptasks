import { eq } from "drizzle-orm";

import { HEALTH_CHECK_ROW_ID, healthCheck } from "~/database/schema";
import { getServices } from "~/services/services";
import type { Route } from "./+types/health";

/**
 * The uptime monitor's endpoint.
 *
 * UptimeRobot watches this for a keyword, and the keyword is the value stored
 * in the `health_check` row — so the response cannot contain it unless a read
 * against a real SQLite file really returned it. A process that is up but
 * cannot read its only datastore is down, and this is what says so.
 *
 * What it catches: a file that cannot be opened, a schema that never migrated,
 * a corrupt or locked database, and a read that errors.
 *
 * What it does not catch: a file unlinked or swapped underneath an already-open
 * handle, which keeps answering. The server holds one connection for its whole
 * life — reopening per request would be the wrong trade for a monitor — so that
 * failure belongs to the other three backup layers, not to this one.
 */
export async function loader({ context }: Route.LoaderArgs) {
  try {
    // Opening the database is inside the try on purpose: a file that cannot be
    // opened at all is the failure this endpoint most needs to report, and it
    // throws here rather than at the query.
    const { database } = getServices(context);

    const row = database
      .select({ keyword: healthCheck.keyword })
      .from(healthCheck)
      .where(eq(healthCheck.id, HEALTH_CHECK_ROW_ID))
      .get();

    if (!row) {
      return plainText("UNHEALTHY: health check row is missing", 503);
    }

    return plainText(row.keyword, 200);
  } catch (error) {
    console.error("Health check failed to read the database", error);
    return plainText("UNHEALTHY: database read failed", 503);
  }
}

function plainText(body: string, status: number) {
  return new Response(`${body}\n`, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Never let a proxy or a monitor answer this from a cache: a cached
      // health check reports the past.
      "Cache-Control": "no-store",
    },
  });
}
