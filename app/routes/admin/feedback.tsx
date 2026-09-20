import { data, Link, redirect } from "react-router";

import { requireAdmin } from "~/admin/admin-access";
import {
  feedbackByTask,
  feedbackInbox,
  FINISH_FEEDBACK,
  groupingIn,
  newFeedbackCount,
  pressDone,
  showingIn,
  type FeedbackGroup,
  type FeedbackGrouping,
  type FeedbackInInbox,
  type FeedbackShowing,
} from "~/admin/feedback-inbox";
import { FeedbackRow } from "~/components/feedback-row";
import { getServices } from "~/services/services";
import type { Route } from "./+types/feedback";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Feedback — Launch Tasks admin" }];
}

/**
 * The Feedback inbox: a queue, and not an archive.
 *
 * It opens on New and newest first, and that default is the whole design.
 * Everything else on the page is a link that changes the default back
 * afterwards, so the Admin who opens this section by habit always lands on
 * the same question: *what has nobody dealt with*.
 *
 * Grouping by Task is the other reading of the same rows and lives on the
 * same page rather than on a second one, because the Admin switching between
 * them is asking one question two ways round — *what came in* and *which
 * Body is the problem*.
 *
 * What is deliberately not here: a delete button, a Dismissed state, a
 * category filter, and anything that looks like writing back. Only a Purge
 * destroys a Feedback (ADR-0007); *I disagreed and changed nothing* is Done
 * with a note; there is no `kind` column to filter on; and the address on
 * the row is how the Admin answers, in their own mail client, by hand.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);
  await requireAdmin(services, request);

  const parameters = new URL(request.url).searchParams;
  const showing = showingIn(parameters.get("show"));
  const grouping = groupingIn(parameters.get("group"));

  return {
    showing,
    grouping,
    waiting: newFeedbackCount(services.database),
    feedback: grouping === "task" ? null : feedbackInbox(services.database, showing),
    groups: grouping === "task" ? feedbackByTask(services.database, showing) : null,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const services = getServices(context);
  await requireAdmin(services, request);

  const submitted = await request.formData();
  // One act on this page, and every form on it says which. An unknown
  // intent is a hand-written post, and gets the answer a hand-written post
  // to any other admin action gets.
  if (submitted.get("intent") !== FINISH_FEEDBACK) {
    throw data("No such action", { status: 400 });
  }

  const wrong = pressDone(services.database, submitted);
  if (wrong) return { error: wrong };

  // Back to the view it was pressed from, so finishing one row does not
  // silently move the Admin out of the filter they were reading.
  const url = new URL(request.url);
  throw redirect(`/admin/feedback${url.search}`);
}

export default function AdminFeedback({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { showing, grouping, waiting, feedback, groups } = loaderData;

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">
          Feedback{" "}
          <span className="font-normal text-gray-500">({waiting} new)</span>
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Nothing here is ever removed. A piece of feedback lasts until its
          practice is purged, which takes it with everything else that practice
          wrote.
        </p>
      </div>

      <Views showing={showing} grouping={grouping} />

      {actionData?.error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionData.error}
        </p>
      )}

      {feedback && <FlatList feedback={feedback} showing={showing} />}
      {groups && <GroupedByTask groups={groups} showing={showing} />}
    </section>
  );
}

/**
 * The two axes: which half of the queue, and how it is gathered.
 *
 * Links and not a form, so that every view of this page is an address the
 * Admin can keep, and so that there is no control on the page that could be
 * mistaken for the category picker the product does not have.
 */
function Views({
  showing,
  grouping,
}: {
  showing: FeedbackShowing;
  grouping: FeedbackGrouping;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-y border-gray-200 py-3">
      <div className="flex flex-wrap gap-x-4">
        <ViewLink to={viewAddress("new", grouping)} current={showing === "new"}>
          New
        </ViewLink>
        <ViewLink to={viewAddress("done", grouping)} current={showing === "done"}>
          Done
        </ViewLink>
        <ViewLink to={viewAddress("all", grouping)} current={showing === "all"}>
          Everything
        </ViewLink>
      </div>

      <ViewLink
        to={viewAddress(showing, grouping === "task" ? "none" : "task")}
        current={false}
      >
        {grouping === "task" ? "As a list" : "Group by task"}
      </ViewLink>
    </div>
  );
}

/** One address per view, so a view is a place rather than a state. */
function viewAddress(showing: FeedbackShowing, grouping: FeedbackGrouping): string {
  const parameters = new URLSearchParams();
  if (showing !== "new") parameters.set("show", showing);
  if (grouping === "task") parameters.set("group", "task");

  const query = parameters.toString();
  return query === "" ? "/admin/feedback" : `/admin/feedback?${query}`;
}

function ViewLink({
  to,
  current,
  children,
}: {
  to: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={
        current
          ? "text-sm font-semibold text-gray-900 underline"
          : "text-sm text-gray-600 underline"
      }
    >
      {children}
    </Link>
  );
}

function FlatList({
  feedback,
  showing,
}: {
  feedback: FeedbackInInbox[];
  showing: FeedbackShowing;
}) {
  if (feedback.length === 0) {
    return <p className="text-gray-600">{nothingHere(showing)}</p>;
  }

  return (
    <ul className="divide-y divide-gray-200 border-b border-gray-200">
      {feedback.map((one) => (
        <li key={one.id} className="py-4">
          <FeedbackRow feedback={one} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The same rows, gathered under the Task they are about.
 *
 * Each heading is a link to the edit screen, because the only reason to read
 * three complaints about one Body together is to go and rewrite that Body.
 */
function GroupedByTask({
  groups,
  showing,
}: {
  groups: FeedbackGroup[];
  showing: FeedbackShowing;
}) {
  if (groups.length === 0) {
    return <p className="text-gray-600">{nothingHere(showing)}</p>;
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.taskId ?? "none"}>
          <h3 className="text-base font-semibold text-gray-900">
            {group.taskId === null ? (
              group.heading
            ) : (
              <Link to={`/admin/library/tasks/${group.taskId}`} className="underline">
                {group.heading}
              </Link>
            )}
          </h3>
          <p className="text-sm text-gray-600">{howMany(group)}</p>

          <ul className="mt-3 divide-y divide-gray-200 border-y border-gray-200">
            {group.feedback.map((one) => (
              <li key={one.id} className="py-4">
                {/* No task line inside a group: the heading above it is the
                    Task, and the snapshot title would only read as a second,
                    staler answer to the same question. */}
                <FeedbackRow feedback={one} namesTheTask={false} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * How much has been said about this Task, and how much of it is in view.
 *
 * The total is always the whole of it, because that is the number grouping
 * exists to show: a Body complained about five times is a Body to rewrite
 * even once four of those are finished. The count in view is said alongside
 * it only when the two differ, so the ungrouped reading never gains an
 * arithmetic problem it did not have.
 */
function howMany(group: FeedbackGroup): string {
  const pieces =
    group.total === 1 ? "1 piece of feedback" : `${group.total} pieces of feedback`;

  return group.feedback.length === group.total
    ? pieces
    : `${group.feedback.length} of ${pieces} in view`;
}

function nothingHere(showing: FeedbackShowing): string {
  if (showing === "new") return "Nothing is waiting.";
  if (showing === "done") return "Nothing has been finished yet.";
  return "No feedback has ever been sent.";
}
