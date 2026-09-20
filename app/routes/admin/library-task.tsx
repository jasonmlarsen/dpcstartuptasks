import { data, Form, Link, redirect } from "react-router";

import { requireAdmin } from "~/admin/admin-access";
import {
  addDependency,
  addHelpfulLink,
  moveHelpfulLink,
  publishTask,
  removeDependency,
  removeHelpfulLink,
  retireTask,
  saveTask,
  taskForEditing,
  unretireTask,
  type DependencyCandidate,
  type EditableLink,
  type EditableTask,
} from "~/admin/task-library";
import { getServices } from "~/services/services";
import type { Route } from "./+types/library-task";

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.task.title;
  return [{ title: title ? `${title} — Launch Tasks admin` : "Launch Tasks admin" }];
}

/**
 * One Task, and everything the Admin can do to it.
 *
 * The screen where the fix is actually typed, which is why the Body has the
 * most room on it: the Body *is* the value of a Task, and every other field
 * here is metadata about where it sits.
 *
 * There is one Save button and no autosave, and that is the whole publishing
 * story for a live Task — pressing Save reaches every Practice already in
 * flight, with no deploy and no re-download. The Admin proof-reads first,
 * exactly as they would before pressing Publish, and a half-typed sentence is
 * never broadcast.
 *
 * Everything on this page that is not the Save form is a press of its own —
 * Publish, Retire, a link added or moved, a Dependency added or removed —
 * because none of them is text being typed and none should wait behind the
 * Body's Save.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const services = getServices(context);
  await requireAdmin(services, request);

  const task = taskForEditing(services.database, Number(params.taskId));
  if (!task) throw data("No such task", { status: 404 });

  return { task };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const services = getServices(context);
  await requireAdmin(services, request);

  const taskId = Number(params.taskId);
  const submitted = await request.formData();
  const intent = submitted.get("intent");
  const here = `/admin/library/tasks/${taskId}`;

  if (intent === "save") {
    const saved = saveTask(services.database, taskId, {
      title: String(submitted.get("title") ?? ""),
      body: String(submitted.get("body") ?? ""),
      phaseId: Number(submitted.get("phaseId") ?? 0),
      // An unticked checkbox is absent from the submission, which is how a
      // browser posts one.
      stateSpecific: submitted.get("stateSpecific") === "on",
    });

    if (saved.outcome === "no-task") throw data("No such task", { status: 404 });
    if (saved.outcome === "no-phase") throw data("No such phase", { status: 404 });
    if (saved.outcome === "no-title") return { error: "A task needs a title." };

    return { saved: true as const };
  }

  if (intent === "publish") {
    const published = publishTask(services.database, taskId);
    if (published.outcome === "no-task") {
      throw data("No such task", { status: 404 });
    }
    if (published.outcome === "already") {
      return { error: "This task is already published." };
    }
    throw redirect(here);
  }

  if (intent === "retire") {
    const retired = retireTask(services.database, taskId);
    if (retired.outcome === "no-task") throw data("No such task", { status: 404 });
    if (retired.outcome === "not-published") {
      return { error: "Only a published task can be retired." };
    }
    throw redirect(here);
  }

  if (intent === "unretire") {
    const back = unretireTask(services.database, taskId);
    if (back.outcome === "no-task") throw data("No such task", { status: 404 });
    if (back.outcome === "not-retired") {
      return { error: "This task is not retired." };
    }
    throw redirect(here);
  }

  if (intent === "add-link") {
    const added = addHelpfulLink(services.database, taskId, {
      label: String(submitted.get("label") ?? ""),
      url: String(submitted.get("url") ?? ""),
    });

    if (added.outcome === "no-task") throw data("No such task", { status: 404 });
    if (added.outcome === "no-label") {
      return {
        error:
          "A helpful link needs a label. It is what a physician reads, and a bare URL is a bug.",
      };
    }
    if (added.outcome === "no-url") {
      return { error: "A helpful link needs a URL." };
    }
    throw redirect(here);
  }

  if (intent === "remove-link") {
    removeHelpfulLink(services.database, taskId, Number(submitted.get("linkId")));
    throw redirect(here);
  }

  if (intent === "move-link") {
    moveHelpfulLink(services.database, taskId, {
      linkId: Number(submitted.get("linkId")),
      direction: submitted.get("direction") === "up" ? "up" : "down",
    });
    throw redirect(here);
  }

  if (intent === "add-dependency") {
    const added = addDependency(
      services.database,
      taskId,
      Number(submitted.get("dependsOnTaskId")),
    );

    if (added.outcome === "no-task") throw data("No such task", { status: 404 });
    if (added.outcome === "itself") {
      return { error: "A task cannot come after itself." };
    }
    if (added.outcome === "cycle") {
      // The loop, in titles. *Cycle detected* would be true and useless: the
      // Admin is holding a picker with ninety-eight names in it, and the
      // refusal has to name the rows that are the problem.
      return {
        error: `These tasks would depend on each other in a loop: ${added.loop.join(
          " → ",
        )}`,
      };
    }
    throw redirect(here);
  }

  if (intent === "remove-dependency") {
    removeDependency(
      services.database,
      taskId,
      Number(submitted.get("dependsOnTaskId")),
    );
    throw redirect(here);
  }

  throw data("No such action", { status: 400 });
}

export default function AdminLibraryTask({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { task } = loaderData;

  return (
    <div className="space-y-8">
      <div>
        <Link to="/admin/library" className="text-sm text-gray-600 underline">
          Back to the library
        </Link>
        <h2 className="mt-2 text-2xl font-bold text-gray-900">{task.title}</h2>
        <p className="mt-1 text-sm text-gray-600">
          <StateSentence task={task} /> Its address is{" "}
          <code className="text-gray-700">{task.slug}</code>, which never
          changes.
        </p>
      </div>

      {actionData && "error" in actionData && actionData.error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionData.error}
        </p>
      )}

      {actionData && "saved" in actionData && (
        <p className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
          Saved.{" "}
          {task.state === "published"
            ? "Every practice is reading it now."
            : "It is still a draft, so nobody has it yet."}
        </p>
      )}

      <EditForm task={task} />
      <PublishingSection task={task} />
      <LinksSection task={task} />
      <DependenciesSection task={task} />
    </div>
  );
}

/** What this Task is, and to whom. */
function StateSentence({ task }: { task: EditableTask }) {
  if (task.state === "draft") {
    return <>A draft: no practice has it, and publishing is what gives it to them.</>;
  }
  if (task.state === "retired") {
    return (
      <>
        Retired. It is on {task.practicesHolding}{" "}
        {task.practicesHolding === 1 ? "practice" : "practices"} that had
        already worked on it, marked <em>No longer required</em>.
      </>
    );
  }
  return (
    <>
      Published, and on {task.practicesHolding}{" "}
      {task.practicesHolding === 1 ? "practice" : "practices"}.
    </>
  );
}

/**
 * The Body, and the four fields around it.
 *
 * One Save for all five, because they are one act of editing: a Task moved
 * to another Phase usually has a Body that says so. The Save button is the
 * publish gate for a live Task, so there is deliberately nothing here that
 * writes without it.
 */
function EditForm({ task }: { task: EditableTask }) {
  return (
    <Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="save" />

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-900">
          Title
        </label>
        <input
          id="title"
          name="title"
          defaultValue={task.title}
          required
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
        />
      </div>

      <div>
        <label htmlFor="body" className="block text-sm font-medium text-gray-900">
          Body
        </label>
        <p className="text-xs text-gray-600">
          Markdown. Since no other descriptive field survives, this is the
          whole value of the task.
        </p>
        <textarea
          id="body"
          name="body"
          rows={14}
          defaultValue={task.body}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900"
        />
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div>
          <label
            htmlFor="phaseId"
            className="block text-sm font-medium text-gray-900"
          >
            Phase
          </label>
          <select
            id="phaseId"
            name="phaseId"
            defaultValue={task.phaseId}
            className="mt-1 block rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
          >
            {task.phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.name}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm text-gray-900">
          <input
            type="checkbox"
            name="stateSpecific"
            defaultChecked={task.stateSpecific}
            className="size-4"
          />
          Varies by state
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
        >
          Save
        </button>
        <p className="text-sm text-gray-600">
          {task.state === "published"
            ? "Saving reaches every practice immediately. Nothing is saved until you press it."
            : "Nothing is saved until you press it."}
        </p>
      </div>
    </Form>
  );
}

/**
 * Publish, Retire and un-Retire: the three acts that change who has the Task.
 *
 * Each is its own small form with its own button, and each says what it will
 * do to other people's lists before it is pressed — Retire in particular,
 * which is the only act in the panel whose cost is measured in work
 * physicians already did.
 */
function PublishingSection({ task }: { task: EditableTask }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white px-4 py-4">
      <h3 className="text-sm font-semibold text-gray-900">
        Who has this task
      </h3>

      {task.state === "draft" && (
        <>
          <p className="mt-1 text-sm text-gray-600">
            Publishing gives every practice an entry for it, flagged as newly
            added until someone there opens it.
          </p>
          <Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="publish" />
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
            >
              Publish
            </button>
          </Form>
        </>
      )}

      {task.state === "published" && (
        <>
          <p className="mt-1 text-sm text-gray-600">
            Retiring withdraws it. It disappears for the{" "}
            {task.practicesHolding - task.practicesThatDidSomething} that never
            touched it, and stays marked <em>No longer required</em> — counting
            neither way — for the {task.practicesThatDidSomething} that did.
            Nothing is deleted from a practice that did the work, and nobody is
            emailed.
          </p>
          <Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="retire" />
            <button
              type="submit"
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
            >
              Retire
            </button>
          </Form>
        </>
      )}

      {task.state === "retired" && (
        <>
          <p className="mt-1 text-sm text-gray-600">
            Un-retiring puts it back the way publishing does: every practice
            without an entry gets one, flagged as newly added, and the
            practices that kept theirs keep everything they wrote.
          </p>
          <Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="unretire" />
            <button
              type="submit"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
            >
              Un-retire
            </button>
          </Form>
        </>
      )}
    </section>
  );
}

/**
 * Helpful Links: a label, a URL, and up and down.
 *
 * No drag-and-drop. Ten links at most, one reader, and a drag needs a
 * library and the client JS to run it; two buttons need neither. The derived
 * domain sits under each label as it will under the physician's, so the
 * Admin proof-reads against the same derivation the drawer prints —
 * including the blank that means a URL a browser should not follow.
 */
function LinksSection({ task }: { task: EditableTask }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white px-4 py-4">
      <h3 className="text-sm font-semibold text-gray-900">Helpful links</h3>

      {task.links.length === 0 ? (
        <p className="mt-1 text-sm text-gray-600">None yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {task.links.map((link) => (
            <li key={link.id} className="py-2">
              <LinkRow link={link} />
            </li>
          ))}
        </ul>
      )}

      <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="add-link" />

        <div className="grow">
          <label htmlFor="link-label" className="block text-xs font-medium text-gray-700">
            Label
          </label>
          <input
            id="link-label"
            name="label"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
        </div>

        <div className="grow">
          <label htmlFor="link-url" className="block text-xs font-medium text-gray-700">
            URL
          </label>
          <input
            id="link-url"
            name="url"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
        </div>

        <button
          type="submit"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
        >
          Add link
        </button>
      </Form>
    </section>
  );
}

function LinkRow({ link }: { link: EditableLink }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-gray-900">{link.label}</p>
        <p className="text-xs text-gray-500">
          {link.domain ?? "no link set"} — {link.url}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <MoveLinkButton link={link} direction="up" />
        <MoveLinkButton link={link} direction="down" />

        <Form method="post">
          <input type="hidden" name="intent" value="remove-link" />
          <input type="hidden" name="linkId" value={link.id} />
          <button type="submit" className="text-xs text-gray-500 underline">
            Remove
          </button>
        </Form>
      </div>
    </div>
  );
}

function MoveLinkButton({
  link,
  direction,
}: {
  link: EditableLink;
  direction: "up" | "down";
}) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="move-link" />
      <input type="hidden" name="linkId" value={link.id} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={direction === "up" ? link.first : link.last}
        aria-label={`Move ${link.label} ${direction}`}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-40"
      >
        {direction === "up" ? "Up" : "Down"}
      </button>
    </Form>
  );
}

/**
 * Dependencies: advice, and the one refusal.
 *
 * The picker always names each candidate's Phase, because most of the value
 * of an edge is telling a physician that the thing they should do first is
 * somewhere else in the list. A cycle is refused with the loop spelled out
 * in titles; a cross-Phase edge is accepted without comment, because nothing
 * reads these to decide what anyone may do.
 */
function DependenciesSection({ task }: { task: EditableTask }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white px-4 py-4">
      <h3 className="text-sm font-semibold text-gray-900">
        Usually after
      </h3>

      {task.dependsOn.length === 0 ? (
        <p className="mt-1 text-sm text-gray-600">Nothing comes before it.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {task.dependsOn.map((dependency) => (
            <li
              key={dependency.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="text-sm text-gray-900">
                usually after {dependency.title} — {dependency.phaseName}
              </span>

              <Form method="post">
                <input type="hidden" name="intent" value="remove-dependency" />
                <input
                  type="hidden"
                  name="dependsOnTaskId"
                  value={dependency.id}
                />
                <button type="submit" className="text-xs text-gray-500 underline">
                  Remove
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}

      <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="add-dependency" />

        <div className="grow">
          <label
            htmlFor="depends-on"
            className="block text-xs font-medium text-gray-700"
          >
            This task usually comes after
          </label>
          <select
            id="depends-on"
            name="dependsOnTaskId"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
          >
            {task.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidateLabel(candidate)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
        >
          Add dependency
        </button>
      </Form>
    </section>
  );
}

/** Always the Phase as well as the title, so advice across the list is followable. */
function candidateLabel(candidate: DependencyCandidate): string {
  return `${candidate.title} — ${candidate.phaseName}`;
}
