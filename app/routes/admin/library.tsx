import { data, Form, Link, redirect } from "react-router";

import { requireAdmin } from "~/admin/admin-access";
import {
  addPhase,
  deletePhase,
  movePhase,
  renamePhase,
} from "~/admin/library-phases";
import {
  taskLibrary,
  writeDraft,
  type LibraryPhase,
  type GlobalTaskSummary,
} from "~/admin/task-library";
import { getServices } from "~/services/services";
import type { Route } from "./+types/library";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Library — Launch Tasks admin" }];
}

/**
 * The Task Library: every Phase, every Task, and the state each Task is in.
 *
 * All ninety-eight on one page, which is the opposite of the physician's
 * screen and right for the opposite reason. A physician reads one Phase
 * because ninety-eight is a wall; the Admin opens this page holding a
 * Feedback that names one Task, and a Phase at a time would mean guessing
 * which Phase it was in.
 *
 * Drafts sit in their Phase rather than in a pile of their own, marked
 * Draft. A Draft is a Task that is not finished, not a different kind of
 * thing, and the Phase it will be published into is part of writing it.
 *
 * The Phase rail is edited here too — added, renamed, reordered, deleted —
 * because a Phase has no screen of its own and never should: it is a name
 * and a position, and eleven of them fit beside the Tasks they hold.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);
  await requireAdmin(services, request);

  const phases = taskLibrary(services.database);

  // The delete question is a URL, like every other confirmation in this app:
  // it survives a reload, it needs no client JS, and the reassignment picker
  // is in the same dialog because the delete cannot happen without it.
  const deleting = new URL(request.url).searchParams.get("delete-phase");
  const deletingPhaseId = deleting ? Number(deleting) : null;

  return {
    phases,
    deletingPhase:
      deletingPhaseId === null
        ? null
        : (phases.find((row) => row.id === deletingPhaseId) ?? null),
  };
}

/**
 * Five presses, all of them plain forms: write a Draft, and the four acts on
 * the Phase rail.
 *
 * Writing a Draft answers with the Task's edit screen rather than this page,
 * because a Task with a title and no Body is not finished and the next thing
 * the Admin does is type the Body. Everything else answers with this page.
 */
export async function action({ context, request }: Route.ActionArgs) {
  const services = getServices(context);
  await requireAdmin(services, request);

  const submitted = await request.formData();
  const intent = submitted.get("intent");
  const phaseId = Number(submitted.get("phaseId") ?? 0);

  if (intent === "new-task") {
    const written = writeDraft(services.database, {
      title: String(submitted.get("title") ?? ""),
      phaseId,
    });

    if (written.outcome === "no-title") {
      return { error: "A task needs a title." };
    }
    if (written.outcome === "no-phase") {
      throw data("No such phase", { status: 404 });
    }
    if (written.outcome === "slug-taken") {
      return {
        error:
          `Another task already has the address "${written.slug}". ` +
          "Two tasks cannot share one, so this one needs a different title.",
      };
    }

    throw redirect(`/admin/library/tasks/${written.taskId}`);
  }

  if (intent === "add-phase") {
    const added = addPhase(services.database, String(submitted.get("name") ?? ""));
    if (added.outcome === "no-name") return { error: "A phase needs a name." };
    if (added.outcome === "name-taken") {
      return { error: "There is already a phase with that name." };
    }
    throw redirect("/admin/library");
  }

  if (intent === "rename-phase") {
    const renamed = renamePhase(
      services.database,
      phaseId,
      String(submitted.get("name") ?? ""),
    );
    if (renamed.outcome === "no-name") return { error: "A phase needs a name." };
    if (renamed.outcome === "name-taken") {
      return { error: "There is already a phase with that name." };
    }
    if (renamed.outcome === "no-phase") {
      throw data("No such phase", { status: 404 });
    }
    throw redirect("/admin/library");
  }

  if (intent === "move-phase") {
    movePhase(services.database, {
      phaseId,
      direction: submitted.get("direction") === "up" ? "up" : "down",
    });
    throw redirect("/admin/library");
  }

  if (intent === "delete-phase") {
    const reassignTo = Number(submitted.get("reassignTo") ?? 0);
    const deleted = deletePhase(services.database, {
      phaseId,
      reassignTo: reassignTo > 0 ? reassignTo : null,
    });

    if (deleted.outcome === "no-phase") {
      throw data("No such phase", { status: 404 });
    }
    if (deleted.outcome === "reassign-first") {
      return {
        error:
          `This phase still holds ${deleted.tasks} ` +
          `${deleted.tasks === 1 ? "task" : "tasks"}. ` +
          "Choose the phase to reassign them to, and they move as it is deleted.",
      };
    }
    if (deleted.outcome === "no-destination") {
      return { error: "Choose a phase to reassign these tasks to." };
    }
    if (deleted.outcome === "last-phase") {
      return { error: "The library needs at least one phase." };
    }

    throw redirect("/admin/library");
  }

  throw data("No such action", { status: 400 });
}

export default function AdminLibrary({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { phases, deletingPhase } = loaderData;

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-2xl font-bold text-gray-900">Library</h2>
        <p className="mt-2 text-gray-700">
          {countOf(phases)} across {phases.length}{" "}
          {phases.length === 1 ? "phase" : "phases"}. An edit to a published
          task reaches every practice the moment it is saved.
        </p>
      </section>

      {actionData?.error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionData.error}
        </p>
      )}

      <NewTaskForm phases={phases} />

      {deletingPhase && <DeletePhaseDialog phase={deletingPhase} phases={phases} />}

      <div className="space-y-8">
        {phases.map((phase, index) => (
          <PhaseSection
            key={phase.id}
            phase={phase}
            first={index === 0}
            last={index === phases.length - 1}
          />
        ))}
      </div>

      <AddPhaseForm />
    </div>
  );
}

function countOf(phases: LibraryPhase[]): string {
  const tasks = phases.reduce((total, phase) => total + phase.tasks.length, 0);
  return `${tasks} ${tasks === 1 ? "task" : "tasks"}`;
}

/**
 * Writing a new Task: a title and a Phase, and nothing else.
 *
 * The Body is not here, because the Body is the Task and it is typed and
 * re-typed on the edit screen for the rest of the Task's life. What this
 * form does is bring a Draft into being, which is deliberately a small act:
 * a Draft exists for nobody.
 */
function NewTaskForm({ phases }: { phases: LibraryPhase[] }) {
  return (
    <section className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-4">
      <h3 className="text-sm font-semibold text-gray-900">Write a new task</h3>
      <p className="mt-1 text-sm text-gray-600">
        It starts as a draft, on nobody&rsquo;s list, until you publish it.
      </p>

      <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="new-task" />

        <div className="grow">
          <label
            htmlFor="new-task-title"
            className="block text-xs font-medium text-gray-700"
          >
            Title
          </label>
          <input
            id="new-task-title"
            name="title"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
        </div>

        <div>
          <label
            htmlFor="new-task-phase"
            className="block text-xs font-medium text-gray-700"
          >
            Phase
          </label>
          <select
            id="new-task-phase"
            name="phaseId"
            className="mt-1 block rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
          >
            {phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
        >
          Write draft
        </button>
      </Form>
    </section>
  );
}

/** One Phase: its name, where it sits, and the Tasks it holds. */
function PhaseSection({
  phase,
  first,
  last,
}: {
  phase: LibraryPhase;
  first: boolean;
  last: boolean;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 pb-2">
        <Form method="post" className="flex items-center gap-2">
          <input type="hidden" name="intent" value="rename-phase" />
          <input type="hidden" name="phaseId" value={phase.id} />
          <label htmlFor={`phase-${phase.id}`} className="sr-only">
            Phase name
          </label>
          <input
            id={`phase-${phase.id}`}
            name="name"
            defaultValue={phase.name}
            className="rounded-md border border-transparent px-2 py-1 text-lg font-semibold text-gray-900 hover:border-gray-300"
          />
          <button type="submit" className="text-xs text-gray-600 underline">
            Rename
          </button>
        </Form>

        {/* Up and down, never drag-and-drop: eleven rows and one reader. */}
        <MovePhaseButton phaseId={phase.id} direction="up" disabled={first} />
        <MovePhaseButton phaseId={phase.id} direction="down" disabled={last} />

        <Link
          to={`/admin/library?delete-phase=${phase.id}`}
          className="text-xs text-gray-500 underline"
        >
          Delete phase
        </Link>
      </div>

      {phase.tasks.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600">No tasks in this phase.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {phase.tasks.map((task) => (
            <li key={task.id} className="py-2">
              <TaskRow task={task} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MovePhaseButton({
  phaseId,
  direction,
  disabled,
}: {
  phaseId: number;
  direction: "up" | "down";
  disabled: boolean;
}) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="move-phase" />
      <input type="hidden" name="phaseId" value={phaseId} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled}
        aria-label={`Move ${direction}`}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-40"
      >
        {direction === "up" ? "Up" : "Down"}
      </button>
    </Form>
  );
}

/** One Task, and which of the three states it is in. */
function TaskRow({ task }: { task: GlobalTaskSummary }) {
  return (
    <Link
      to={`/admin/library/tasks/${task.id}`}
      className="flex items-baseline justify-between gap-3"
    >
      <span className="text-sm text-gray-900 underline">{task.title}</span>
      <TaskStateLabel state={task.state} />
    </Link>
  );
}

function TaskStateLabel({ state }: { state: GlobalTaskSummary["state"] }) {
  if (state === "published") return null;

  return (
    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
      {state === "draft" ? "Draft" : "Retired"}
    </span>
  );
}

/**
 * Deleting a Phase, with the reassignment in the same dialog.
 *
 * Not a warning and not a cascade: the Tasks move first or nothing happens
 * at all. A Global Task is only ever Retired, so a Phase delete that took
 * Tasks with it would be the one act in the panel able to destroy work a
 * Practice holds an Entry against. Retired Tasks are in the count, because a
 * Retired Task occupies a Phase exactly as a live one does.
 */
function DeletePhaseDialog({
  phase,
  phases,
}: {
  phase: LibraryPhase;
  phases: LibraryPhase[];
}) {
  const elsewhere = phases.filter((row) => row.id !== phase.id);

  return (
    <section className="rounded-lg border border-red-300 bg-red-50 px-4 py-4">
      <h3 className="text-sm font-semibold text-red-900">
        Delete {phase.name}?
      </h3>

      {phase.tasks.length === 0 ? (
        <p className="mt-1 text-sm text-red-800">
          It holds no tasks, so nothing moves.
        </p>
      ) : (
        <p className="mt-1 text-sm text-red-800">
          It holds {phase.tasks.length}{" "}
          {phase.tasks.length === 1 ? "task" : "tasks"}, retired ones included.
          Reassign them and they move as the phase is deleted.
        </p>
      )}

      <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="delete-phase" />
        <input type="hidden" name="phaseId" value={phase.id} />

        {phase.tasks.length > 0 && (
          <div>
            <label
              htmlFor="reassign-to"
              className="block text-xs font-medium text-red-900"
            >
              Reassign its tasks to
            </label>
            <select
              id="reassign-to"
              name="reassignTo"
              className="mt-1 block rounded-md border border-red-300 px-3 py-2 text-sm text-gray-900"
            >
              {elsewhere.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="submit"
          className="rounded-md border border-red-400 bg-white px-4 py-2 text-sm font-medium text-red-700"
        >
          Delete phase
        </button>

        <Link to="/admin/library" className="text-sm text-red-800 underline">
          Keep it
        </Link>
      </Form>
    </section>
  );
}

function AddPhaseForm() {
  return (
    <section className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-4">
      <h3 className="text-sm font-semibold text-gray-900">Add a phase</h3>

      <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="add-phase" />

        <div className="grow">
          <label htmlFor="new-phase-name" className="sr-only">
            Phase name
          </label>
          <input
            id="new-phase-name"
            name="name"
            required
            placeholder="Credentialing &amp; Compliance"
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
        </div>

        <button
          type="submit"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
        >
          Add phase
        </button>
      </Form>
    </section>
  );
}
