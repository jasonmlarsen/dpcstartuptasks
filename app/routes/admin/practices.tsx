import { requireAdmin } from "~/admin/admin-access";
import {
  practicesDashboard,
  type PracticeOnTheDashboard,
} from "~/admin/practices-dashboard";
import { asPlainDate } from "~/lib/plain-date";
import { GRACE_PERIOD_DAYS } from "~/practice/deletion";
import { getServices } from "~/services/services";
import type { Route } from "./+types/practices";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Practices — Launch Tasks admin" }];
}

/**
 * The Practices list, which doubles as the dashboard.
 *
 * It is the index of the panel because it is the one page the Admin has a
 * reason to open without being sent there: *who is using this, and is
 * anything about to become irreversible*. Those are the two lists, and
 * there is deliberately nothing else on the page — no chart, no totals
 * beyond the counts that are just the lengths of the lists, and no search,
 * which at fifty Practices is furniture.
 *
 * A deleted Practice shows its metadata and never its contents. The
 * reader is where that is actually enforced; the page could not render a
 * Note if it wanted to, which is the point of it being enforced there.
 *
 * There is no *Restore* button and no *View as Owner* on a deleted row.
 * Restoring is the operator clearing a column by hand
 * (`docs/runbooks/restore.md`), a named v1 gap; and a Practice in its Grace
 * Period cannot be entered at all (ADR-0001), so the control that will
 * appear on an Active row with Support View (#40) will never appear here.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);

  // On the child loader as well as on the layout: React Router runs them in
  // parallel, so the layout's guard stops the page from rendering but would
  // not stop these rows from being read.
  await requireAdmin(services, request);

  // The clock is read once, on the server, so that every row on the page is
  // measured against the same instant and nothing depends on when a browser
  // got round to rendering it.
  return { ...practicesDashboard(services.database), now: Date.now() };
}

export default function AdminPractices({ loaderData }: Route.ComponentProps) {
  const { active, deletedInGrace, now } = loaderData;

  return (
    <div className="space-y-12">
      <Section
        heading="Active"
        empty="No practices yet."
        practices={active}
        now={now}
      />

      <Section
        heading="Deleted"
        empty="Nothing is waiting to be purged."
        practices={deletedInGrace}
        now={now}
        note={`Deleted by their owner and held for ${GRACE_PERIOD_DAYS} days. Nothing has been destroyed, and nothing here shows what is inside them.`}
      />
    </div>
  );
}

function Section({
  heading,
  empty,
  practices,
  now,
  note,
}: {
  heading: string;
  empty: string;
  practices: PracticeOnTheDashboard[];
  now: number;
  note?: string;
}) {
  return (
    <section>
      <h2 className="text-2xl font-bold text-gray-900">
        {heading}{" "}
        <span className="font-normal text-gray-500">({practices.length})</span>
      </h2>

      {note && <p className="mt-2 text-gray-700">{note}</p>}

      {practices.length === 0 ? (
        <p className="mt-6 text-gray-600">{empty}</p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 border-y border-gray-200">
          {practices.map((practice) => (
            <li key={practice.id} className="py-4">
              <PracticeRow practice={practice} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One Practice, and the whole of what this page knows about it: a name, a
 * state, how many people are in it, and the two dates that matter.
 */
function PracticeRow({
  practice,
  now,
}: {
  practice: PracticeOnTheDashboard;
  now: number;
}) {
  return (
    <>
      {/* The name if it has one, and never a blank line if it does not: a
          Practice is named by its Owner and plenty never are. */}
      <p className="text-base text-gray-900">
        {practice.name ?? "Unnamed practice"}
        <span className="text-gray-500"> #{practice.id}</span>
      </p>

      <p className="text-sm text-gray-600">
        {practice.state ?? "No state given"} — {people(practice.people)} —
        registered {asPlainDate(practice.createdAt)}
      </p>

      {practice.deletedAt && practice.purgeDueOn && (
        <p className="text-sm text-gray-600">
          Deleted {asPlainDate(practice.deletedAt)} —{" "}
          {purgeSentence(practice.purgeDueOn, now)}
        </p>
      )}
    </>
  );
}

function people(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

/**
 * When the Grace Period runs out, and whether it already has.
 *
 * Purge is #42 and does not exist yet, so a Practice deleted forty days ago
 * is still sitting in this list. The honest thing is to say so: a section
 * headed *Deleted — in the grace period* would be wrong about exactly the
 * row the Admin most needs to see.
 */
function purgeSentence(purgeDueOn: Date, now: number): string {
  return purgeDueOn.getTime() <= now
    ? `purge was due ${asPlainDate(purgeDueOn)}`
    : `purge due ${asPlainDate(purgeDueOn)}`;
}
