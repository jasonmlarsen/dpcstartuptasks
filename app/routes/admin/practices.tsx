import { data, Form, redirect } from "react-router";

import { requireAdmin } from "~/admin/admin-access";
import {
  practicesDashboard,
  type PracticeOnTheDashboard,
} from "~/admin/practices-dashboard";
import { enterSupportView, type SupportViewEnding } from "~/admin/support-view";
import { SUPPORT_VIEW_END_REASONS } from "~/database/schema";
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
 * Period cannot be entered at all (ADR-0001), so Support View's button is
 * drawn on Active rows and on no others. Being thrown out mid-view and being
 * unable to get back in are the same rule.
 *
 * This is also where every Support View ends: the four reasons all land
 * here, never on the Practice page, because after a deletion that page is
 * gone.
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
  return {
    ...practicesDashboard(services.database),
    now: Date.now(),
    ended: endingInTheAddress(request),
  };
}

/**
 * Enter a Practice as its Owner.
 *
 * The guard is `requireAdmin` and then the Practice being live, checked
 * again here rather than trusted from the page that drew the button: a
 * Practice can be deleted between the render and the press.
 *
 * Every refusal is the same 404 the rest of the panel gives, for the same
 * reason — there is nothing to tell apart, and an Admin who presses a button
 * on a Practice that has just been deleted is looking at a stale page rather
 * than at a bug.
 */
export async function action({ context, request }: Route.ActionArgs) {
  const services = getServices(context);
  const admin = await requireAdmin(services, request);

  const submitted = await request.formData();
  const practiceId = Number(submitted.get("practiceId"));
  if (!Number.isInteger(practiceId)) throw data(null, { status: 404 });

  const entering = await enterSupportView(services, request, admin, practiceId);
  if (entering.outcome !== "entered") throw data(null, { status: 404 });

  // Into the Practice, at the list, which is where the Owner's own day
  // starts and so is where a support session should.
  return redirect("/tasks", { headers: entering.headers });
}

/**
 * Which of the four things ended a Support View, as the rescue left it in
 * the address, or null when nothing did.
 *
 * Read from the query rather than from a flash cookie because there is
 * nothing secret in it and a query survives the redirect that carries the
 * Admin's restored session. A forged one buys a stranger nothing: this page
 * is the Admin's alone, and the value picks a sentence and touches nothing.
 *
 * Anything that is not one of the four reads as `unknown` — *something
 * ended it and nothing could say what* — which is the vague message the
 * rescue deliberately falls back to rather than guessing.
 */
function endingInTheAddress(request: Request): SupportViewEnding | null {
  const ended = new URL(request.url).searchParams.get("ended");
  if (ended === null) return null;

  const known = SUPPORT_VIEW_END_REASONS.find((reason) => reason === ended);
  return known ?? "unknown";
}

export default function AdminPractices({ loaderData }: Route.ComponentProps) {
  const { active, deletedInGrace, now, ended } = loaderData;

  return (
    <div className="space-y-12">
      {ended !== null && (
        <p className="border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
          {endingSentence(ended)}
        </p>
      )}

      <Section
        heading="Active"
        empty="No practices yet."
        practices={active}
        now={now}
        enterable
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
  enterable = false,
}: {
  heading: string;
  empty: string;
  practices: PracticeOnTheDashboard[];
  now: number;
  note?: string;
  /** Only the Active section. A Practice in its Grace Period is not enterable. */
  enterable?: boolean;
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
              <PracticeRow
                practice={practice}
                now={now}
                enterable={enterable}
              />
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
  enterable,
}: {
  practice: PracticeOnTheDashboard;
  now: number;
  enterable: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <div>
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
      </div>

      {enterable && (
        <Form method="post">
          <input type="hidden" name="practiceId" value={practice.id} />
          <button type="submit" className="text-sm text-gray-600 underline">
            View as owner
          </button>
        </Form>
      )}
    </div>
  );
}

/**
 * The one sentence the Admin reads on the way out of a Support View.
 *
 * `stopped` falls to the default and says almost nothing, which is right:
 * the deliberate exit does not come through here at all, because it lands
 * on this page with no `ended` in the address — the Admin pressed the
 * button and knows what they did. `unknown` lands on the same sentence and
 * for the same reason in reverse: it is all that can honestly be said.
 */
function endingSentence(ending: SupportViewEnding): string {
  switch (ending) {
    case "timed_out":
      return "Support view timed out after an hour.";
    case "practice_deleted":
      return (
        "Support view ended — the owner deleted this practice " +
        "while you were viewing it."
      );
    case "purged":
      return "Support view ended — this practice was permanently deleted.";
    default:
      return "Support view ended.";
  }
}

function people(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

/**
 * When the Grace Period runs out, and whether it already has.
 *
 * A Practice deleted forty days ago should not be in this list at all, but
 * it is here if the Purge has not run since its day 30. The honest thing is
 * to say so: a section headed *Deleted — in the grace period* would be wrong
 * about exactly the row the Admin most needs to see.
 */
function purgeSentence(purgeDueOn: Date, now: number): string {
  return purgeDueOn.getTime() <= now
    ? `purge was due ${asPlainDate(purgeDueOn)}`
    : `purge due ${asPlainDate(purgeDueOn)}`;
}
