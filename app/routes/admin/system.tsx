import { requireAdmin } from "~/admin/admin-access";
import { kitQueueHealth } from "~/consent/kit-sync-queue";
import { toTheSecond } from "~/lib/plain-date";
import { getServices } from "~/services/services";
import type { Route } from "./+types/system";

export function meta(_: Route.MetaArgs) {
  return [{ title: "System — Launch Tasks admin" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);
  await requireAdmin(services, request);

  return {
    queue: kitQueueHealth(services.database),
    // Read once on the server, so every number on the page is measured
    // against the same instant.
    now: Date.now(),
  };
}

/**
 * System: the health of the Kit sync queue, and nothing else.
 *
 * Four numbers and one date, because there are only two questions an operator
 * ever has about this queue. *Is it moving?* — which is the oldest queued job,
 * not the count, since a hundred jobs drained every minute is fine and one job
 * stuck since Tuesday is not. And *is anything dead?* — which is the failed
 * count, the only number here that asks somebody to go and look.
 *
 * Suppressed sits beside them and is deliberately not styled as a problem:
 * those are Cancelled addresses and people who never consented, and every one
 * of them is the queue working. A panel that coloured them red would be
 * teaching the operator to try to fix a physician's decision.
 *
 * There is no *drain now* button. The worker is a command a scheduler runs
 * (`npm run kit:drain`), and a button here would be the one place in the
 * product where a request calls Kit.
 */
export default function AdminSystem({ loaderData }: Route.ComponentProps) {
  const { queue, now } = loaderData;

  return (
    <section>
      <h2 className="text-2xl font-bold text-gray-900">System</h2>
      <p className="mt-2 text-gray-700">
        Kit sync jobs. Nothing here is on a physician's path — a stalled queue
        delays a newsletter and never the product.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Count label="Waiting" value={queue.queued} />
        <Count label="Synced" value={queue.synced} />
        <Count label="Suppressed" value={queue.suppressed} />
        <Count label="Failed" value={queue.failed} />
      </dl>

      <p className="mt-6 text-gray-700">
        {queue.oldestQueuedAt
          ? `The oldest job has been waiting ${howLong(queue.oldestQueuedAt, now)}.`
          : "Nothing is waiting."}
      </p>

      {queue.failed > 0 && (
        <p className="mt-2 text-gray-700">
          Failed jobs are never retried on their own. Each one is either a
          warning Kit answered a write with — most often a custom field that
          does not exist — or a job that ran out of attempts. The reason is on
          the row, in <code>kit_sync_job.detail</code>.
        </p>
      )}
    </section>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd className="text-2xl font-bold text-gray-900">{value}</dd>
    </div>
  );
}

/**
 * Rounded to the unit an operator would say out loud. *4 days* is the
 * sentence that makes somebody open a terminal; *4 days, 2 hours and 9
 * minutes* is the same sentence with work in front of it.
 */
function howLong(since: Date, now: number): string {
  const minutes = Math.floor((now - toTheSecond(since).getTime()) / 60000);

  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return plural(minutes, "minute");

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");

  return plural(Math.floor(hours / 24), "day");
}

function plural(howMany: number, unit: string): string {
  return `${howMany} ${unit}${howMany === 1 ? "" : "s"}`;
}
