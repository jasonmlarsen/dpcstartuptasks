import { data, Form, Link, redirect } from "react-router";

import { TASK_STATUSES, type TaskStatus } from "~/database/schema";
import { addCustomTask, deleteCustomTask } from "~/practice/custom-task";
import {
  journeyMap,
  type DependencyAdvice,
  type HelpfulLinkView,
  type JourneyCard,
  type OpenTaskView,
  type Progress,
  type RailPhase,
} from "~/practice/journey-map";
import { requireCurrentPractice } from "~/practice/signed-in-practice";
import { asTargetDate, setTaskNote } from "~/practice/task-note";
import { asTaskStatus, setTaskStatus } from "~/practice/task-status";
import { getServices } from "~/services/services";
import type { Route } from "./+types/phase";

export function meta({ loaderData }: Route.MetaArgs) {
  const phaseName = loaderData?.map.phaseName;
  return [{ title: phaseName ? `${phaseName} — Launch Tasks` : "Launch Tasks" }];
}

/**
 * The journey map: one Phase of the list, and the Task that is open.
 *
 * Nothing here is ever locked — a physician who already holds an EIN can be
 * anywhere in the list on day one, because no Task knows or cares what the
 * ones above it say.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const services = getServices(context);
  const practice = await requireCurrentPractice(services, request);

  const parameters = new URL(request.url).searchParams;
  const map = journeyMap(services.database, practice, {
    phaseSlug: params.phaseSlug,
    taskRef: parameters.get("task"),
    movedRef: parameters.get("moved"),
  });
  if (!map) throw data("No such phase", { status: 404 });

  // The delete question is a URL like everything else on this screen, so it
  // survives a reload and a back button and costs no client JS.
  const confirmingDelete = parameters.get("confirm") === "delete";

  return { practiceName: practice.name, map, confirmingDelete };
}

/**
 * The four writes this screen makes: a Status change, a Practice's own
 * writing on a Task, and adding or deleting a Task of the Practice's own.
 *
 * The answer to the press is the list itself. The physician is redirected
 * back to the Phase with the drawer closed and `?moved=` naming the card
 * they touched, so what they see next is the card in its new place, flashing
 * — which is the whole point of live auto-sort, and impossible to see from
 * behind an open drawer on a phone.
 *
 * Saving a Note is the quieter act and gets the quieter answer: the drawer
 * stays open at the Task the physician was reading, because nothing moved
 * and they were in the middle of something. Both are redirects for the
 * ordinary reason too — a reload should not re-post either one.
 *
 * Adding and deleting a Task of the Practice's own are the third and fourth.
 * Adding answers like a Status change, with the new card flashing where it
 * landed, because a Task written into a list of ninety-eight is worth being
 * shown. Deleting answers with the list and no drawer: the Task the drawer
 * was open on no longer exists, so there is nothing to return to.
 *
 * Which write it is comes from `intent`. A Status press carries none, which
 * keeps the control that was here first posting exactly what it always
 * posted: the ref and the Status, and nothing a browser had to be told to
 * add.
 *
 * `?moved=` outlives the moment it describes: reloading that address plays
 * the flash again on a card that has not moved since. Accepted — the
 * alternative is a flash message in a cookie or a timestamp in the URL, and
 * neither is worth a round trip through the session for 900ms of colour on
 * a card the physician is already looking at.
 */
export async function action({ context, params, request }: Route.ActionArgs) {
  const services = getServices(context);
  const practice = await requireCurrentPractice(services, request);

  const submitted = await request.formData();
  const taskRef = String(submitted.get("taskRef") ?? "");

  if (submitted.get("intent") === "add-task") {
    const added = addCustomTask(services.database, practice, {
      phaseSlug: params.phaseSlug,
      title: String(submitted.get("title") ?? ""),
      body: String(submitted.get("body") ?? ""),
    });

    if (added.outcome === "no-title") {
      throw data("A task needs a title", { status: 400 });
    }
    if (added.outcome === "no-phase") {
      throw data("No such phase", { status: 404 });
    }

    throw redirect(
      `/tasks/${params.phaseSlug}?moved=${encodeURIComponent(added.ref)}`,
    );
  }

  if (submitted.get("intent") === "delete-task") {
    // False covers a Global Task's slug as well as another Practice's Task:
    // a Global Task is never deleted by anyone, it is Retired by the Admin.
    if (!deleteCustomTask(services.database, practice, taskRef)) {
      throw data("No such task", { status: 404 });
    }

    throw redirect(`/tasks/${params.phaseSlug}`);
  }

  if (submitted.get("intent") === "note") {
    const targetDate = asTargetDate(submitted.get("targetDate"));
    // Nothing is written when the date cannot be read, the Note included:
    // half a save is worse than a refused one, because the physician would
    // have to work out which half landed.
    if (targetDate.kind === "unreadable") {
      throw data("No such date", { status: 400 });
    }

    const written = {
      taskRef,
      note: String(submitted.get("note") ?? ""),
      targetDate: targetDate.kind === "set" ? targetDate.on : null,
    };
    if (!setTaskNote(services.database, practice, written)) {
      throw data("No such task", { status: 404 });
    }

    throw redirect(
      `/tasks/${params.phaseSlug}?task=${encodeURIComponent(taskRef)}`,
    );
  }

  const status = asTaskStatus(submitted.get("status"));
  if (!status) throw data("No such status", { status: 400 });

  // False covers every way a ref can name nothing this Practice may set —
  // another Practice's Custom Task, a Draft, a Retired Task, a typo — and
  // they get the one answer, because they are the one answer.
  if (!setTaskStatus(services.database, practice, { taskRef, status })) {
    throw data("No such task", { status: 404 });
  }

  throw redirect(
    `/tasks/${params.phaseSlug}?moved=${encodeURIComponent(taskRef)}`,
  );
}

export default function Phase({ loaderData }: Route.ComponentProps) {
  const { practiceName, map, confirmingDelete } = loaderData;

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between px-6 py-4">
          <h1 className="text-lg font-semibold text-gray-900">
            {practiceName ?? "Your practice"}
          </h1>
          <ProgressLine
            progress={map.listProgress}
            wording="done overall"
          />
        </div>
      </header>

      <PhaseRail rail={map.rail} />

      <main className="mx-auto max-w-3xl px-6 pb-24">
        <h2 className="pt-6 text-2xl font-bold text-gray-900">
          {map.phaseName}
        </h2>
        <ProgressLine
          progress={map.phaseProgress}
          wording="done in this phase"
        />

        <ul className="mt-4 space-y-3">
          {map.cards.map((card) => (
            <li key={card.ref}>
              <TaskCard card={card} phaseSlug={map.phaseSlug} />
            </li>
          ))}
        </ul>

        <AddTaskForm phaseSlug={map.phaseSlug} />
      </main>

      {map.openTask && (
        <TaskDrawer
          task={map.openTask}
          phaseSlug={map.phaseSlug}
          confirmingDelete={confirmingDelete}
        />
      )}
    </div>
  );
}

/**
 * How far this Practice has got, counted twice: over the Phase in view, and
 * over the whole list.
 *
 * A number and a bar, and no percentage — *3 of 8* is the sentence a
 * physician would say out loud, and it is the one that makes a short Phase
 * feel short. Not Applicable and `No longer required` are in neither half of
 * it, which is what lets a list that has been honestly tailored read as
 * finished when it is finished.
 */
function ProgressLine({
  progress,
  wording,
}: {
  progress: Progress;
  wording: string;
}) {
  const { done, total } = progress;
  const portion = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="flex items-center gap-3">
      <p className="text-sm text-gray-500">
        {done} of {total} {wording}
      </p>
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={wording}
        className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${portion}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The rail: eleven Phases, one of them in view.
 *
 * Every Phase is one press away and only one Phase's Tasks are on the page,
 * which is the whole argument of the screen — 3 to 13 Tasks is a morning's
 * work, and 98 is a wall.
 */
function PhaseRail({ rail }: { rail: RailPhase[] }) {
  return (
    <nav
      aria-label="Phases"
      className="border-b border-gray-200 bg-white overflow-x-auto"
    >
      <ol className="mx-auto flex max-w-3xl gap-2 px-6 py-3">
        {rail.map((phase) => (
          <li key={phase.slug} className="shrink-0">
            <Link
              to={`/tasks/${phase.slug}`}
              aria-current={phase.inView ? "page" : undefined}
              className={
                phase.inView
                  ? "block rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white"
                  : "block rounded-full px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              }
            >
              {phase.name}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A collapsed Task: its title, and two lines of its Body.
 *
 * Not Applicable dims to its title alone and sinks to the bottom of the
 * Phase, and it never disappears — ADR-0002 rests on that. A Practice must
 * always be able to see what it set aside, whether it was the Tailoring
 * Wizard that set it aside or the Practice itself.
 */
function TaskCard({ card, phaseSlug }: { card: JourneyCard; phaseSlug: string }) {
  const setAside = card.status === "not_applicable" || card.retired;

  return (
    <Link
      to={`/tasks/${phaseSlug}?task=${encodeURIComponent(card.ref)}`}
      preventScrollReset
      // The landing flash, which is 900ms of CSS and no JavaScript: the card
      // the physician just touched says where it went, so a list that
      // re-sorted itself underneath them never loses it.
      className={`block rounded-lg border bg-white px-4 py-3 ${
        card.open ? "border-primary" : "border-gray-200"
      } ${setAside ? "opacity-60" : ""} ${card.landed ? "task-landed" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`font-medium ${setAside ? "text-gray-500" : "text-gray-900"}`}
        >
          {card.title}
        </span>
        <StatusLabel status={card.status} retired={card.retired} />
      </div>

      {card.snippet !== null && (
        <>
          <p className="mt-1 line-clamp-2 text-sm text-gray-600">
            {card.snippet}
          </p>
          <div className="mt-2 flex items-baseline gap-3">
            {card.variesByState && (
              <p className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                Varies by state
              </p>
            )}
            {/* The date the Practice is aiming at, said and not enforced:
                nothing in the product chases it, and a date that has been
                and gone is still just a date the physician wrote down. */}
            {card.targetDate && (
              <p className="text-xs text-gray-500">By {card.targetDate}</p>
            )}
          </div>
        </>
      )}
    </Link>
  );
}

/**
 * Where the Practice has got to, said quietly.
 *
 * `No longer required` outranks the Status: once the Admin has Retired a
 * Task, what the Practice last said about it is no longer the thing worth
 * reading on the row.
 */
function StatusLabel({
  status,
  retired,
}: {
  status: TaskStatus;
  retired: boolean;
}) {
  if (retired) {
    return (
      <span className="shrink-0 text-xs text-gray-500">No longer required</span>
    );
  }
  if (status === "not_started") return null;

  return (
    <span className="shrink-0 text-xs text-gray-500">
      {STATUS_WORDING[status]}
    </span>
  );
}

/**
 * The drawer: the full Body, the Helpful Links, and the Dependencies.
 *
 * It is a URL, not a widget. `?task=` on the Phase's own address means the
 * physician never navigates away from their place in the list, the drawer is
 * linkable and back-buttonable, and the whole screen still works with no
 * client JS at all.
 *
 * On a phone it is a 90dvh bottom sheet whose footer clears the home
 * indicator; from 800px up it is a panel down the right-hand side.
 */
function TaskDrawer({
  task,
  phaseSlug,
  confirmingDelete,
}: {
  task: OpenTaskView;
  phaseSlug: string;
  confirmingDelete: boolean;
}) {
  const closed = `/tasks/${phaseSlug}`;

  return (
    <>
      <Link
        to={closed}
        preventScrollReset
        aria-hidden
        tabIndex={-1}
        className="fixed inset-0 z-10 bg-gray-900/20"
      />

      <aside
        role="dialog"
        aria-labelledby="open-task-title"
        className="fixed inset-x-0 bottom-0 z-20 flex h-[90dvh] flex-col rounded-t-2xl bg-white shadow-2xl animate-in duration-200 slide-in-from-bottom min-[800px]:inset-y-0 min-[800px]:right-0 min-[800px]:left-auto min-[800px]:h-dvh min-[800px]:w-[28rem] min-[800px]:rounded-none min-[800px]:slide-in-from-bottom-0 min-[800px]:slide-in-from-right motion-reduce:animate-none"
      >
        {/* No `Varies by state` pill here: the pill belongs to the list row,
            where a physician scanning a Phase meets it. Repeating it over the
            Body would be a second place to keep in step for no second
            reader. */}
        <div className="border-b border-gray-200 px-6 py-4">
          <h2
            id="open-task-title"
            className="text-lg font-semibold text-gray-900"
          >
            {task.title}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {task.dependencies.length > 0 && (
            <ul className="mb-4 space-y-1">
              {task.dependencies.map((dependency) => (
                <li
                  key={dependency.title}
                  className="text-sm italic text-gray-500"
                >
                  <DependencySentence dependency={dependency} />
                </li>
              ))}
            </ul>
          )}

          {/* The Body carries everything a Task has to say, a recurrence note
              included — *renews annually* is prose the Admin wrote, and the
              product neither schedules it nor promises a reminder about it. */}
          <div
            className="body-prose text-gray-700"
            dangerouslySetInnerHTML={{ __html: task.bodyHtml }}
          />

          {task.helpfulLinks.length > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-semibold text-gray-900">
                Helpful links
              </h3>
              <ul className="mt-2 space-y-3">
                {task.helpfulLinks.map((link) => (
                  <li key={link.label}>
                    <HelpfulLinkRow link={link} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <NoteSection task={task} phaseSlug={phaseSlug} />

          {task.custom && (
            <DeleteSection
              task={task}
              phaseSlug={phaseSlug}
              asking={confirmingDelete}
            />
          )}
        </div>

        {/* The Status control lives here, in the footer, whose padding clears
            the home indicator — so the one thing a physician came to press is
            never half under it on a phone. */}
        <div className="border-t border-gray-200 px-6 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {task.retired ? (
            <p className="mb-3 text-sm text-gray-500">
              No longer required. This task has been withdrawn from the list,
              and counts neither way towards your progress.
            </p>
          ) : (
            <StatusControl task={task} phaseSlug={phaseSlug} />
          )}

          <Link
            to={closed}
            preventScrollReset
            className="block rounded-md border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-700"
          >
            Close
          </Link>
        </div>
      </aside>
    </>
  );
}

/**
 * The Note, and the target date: the only part of a Task a Practice writes.
 *
 * One form and one Save for both, because writing down the licence number
 * and the day it expires is one act. It posts to the Phase's own action at
 * zero client JS like everything else here, and the answer leaves the drawer
 * open on the Task that was being read.
 *
 * The saved Note is shown above the box it is edited in, rather than the box
 * being the only view of it: a Note is Markdown, so the line breaks and the
 * emphasis a physician typed should read back as they meant them. Raw HTML
 * never survives that trip — `renderPracticeBody` turns the parser's HTML
 * off rather than cleaning up after it.
 *
 * A Retired Task keeps this section, unlike the Status control. Un-retiring
 * is the Admin's act; writing down what the Practice already did is not.
 */
function NoteSection({
  task,
  phaseSlug,
}: {
  task: OpenTaskView;
  phaseSlug: string;
}) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-gray-900">Your note</h3>

      {task.noteHtml && (
        <div
          className="body-prose mt-2 rounded-md bg-gray-50 px-3 py-2 text-gray-700"
          dangerouslySetInnerHTML={{ __html: task.noteHtml }}
        />
      )}

      <Form method="post" action={`/tasks/${phaseSlug}`} className="mt-2">
        <input type="hidden" name="intent" value="note" />
        <input type="hidden" name="taskRef" value={task.ref} />

        <label htmlFor="note" className="sr-only">
          {task.noteHtml ? "Edit your note" : "Write a note"}
        </label>
        <textarea
          id="note"
          name="note"
          rows={4}
          defaultValue={task.note}
          placeholder="The licence number, the phone number, the thing the accountant said."
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
        />

        {/* The Support View disclosure, in the place it does the most work:
            the policy is read once at registration, and this is where
            someone is about to type the thing they would regret. ADR-0001's
            own sentence, narrowed from *including your Notes* to the one
            being written — a sentence and not an obligation, since Support
            View is deliberately not consent-gated and nothing here may
            imply a gate. */}
        <p className="mt-1 text-xs text-gray-500">
          Launch Tasks is run by one person. To help you when something goes
          wrong, that person can sign in to your practice and see it exactly
          as you do — including this note.
        </p>

        <label
          htmlFor="target-date"
          className="mt-4 block text-sm font-semibold text-gray-900"
        >
          Target date
        </label>
        <input
          id="target-date"
          type="date"
          name="targetDate"
          defaultValue={task.targetDateValue ?? ""}
          className="mt-1 block rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
        />
        {/* Clearing it is emptying it, which is what a date field already
            offers — a second control saying Clear would be a second way to
            do the one thing. */}

        <button
          type="submit"
          className="mt-3 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
        >
          Save
        </button>
      </Form>
    </section>
  );
}

/**
 * The Status control: four buttons, one press each.
 *
 * A form posting to the Phase's own action at zero client JS, which is what
 * makes the whole path testable by dispatching a `Request` — and what makes
 * it work at all in a clinic corridor on a bad connection.
 *
 * Four buttons rather than a select and a Save, because a Status change is
 * one decision and should cost one press. The current one is marked with
 * `aria-pressed` and stays pressable: re-pressing it writes the same value,
 * which is a cheaper answer than reasoning about a disabled control.
 *
 * A Retired Task never renders this — un-retiring is the Admin's act — and
 * `setTaskStatus` refuses one as well, so the absent control is a courtesy
 * rather than the enforcement.
 */
function StatusControl({
  task,
  phaseSlug,
}: {
  task: OpenTaskView;
  phaseSlug: string;
}) {
  return (
    <Form method="post" action={`/tasks/${phaseSlug}`} className="mb-4">
      <input type="hidden" name="taskRef" value={task.ref} />

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-gray-900">
          Status
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {TASK_STATUSES.map((status) => (
            <button
              key={status}
              type="submit"
              name="status"
              value={status}
              aria-pressed={status === task.status}
              className={
                status === task.status
                  ? "rounded-md bg-primary px-3 py-2 text-sm font-medium text-white"
                  : "rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
              }
            >
              {STATUS_WORDING[status]}
            </button>
          ))}
        </div>
      </fieldset>
    </Form>
  );
}

/** One spelling of the four Statuses, for the control and the row alike. */
const STATUS_WORDING: Record<TaskStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  not_applicable: "Not applicable",
};

/** Advice, in the one sentence it is allowed to be. */
function DependencySentence({ dependency }: { dependency: DependencyAdvice }) {
  if (dependency.otherPhaseName) {
    return (
      <>
        usually after {dependency.title}, in {dependency.otherPhaseName}
      </>
    );
  }
  return <>usually after {dependency.title}</>;
}

/**
 * A Helpful Link: the label a physician reads, and the domain beneath it so
 * they know where they are about to go. A list, never pills — there is room
 * for the destination and no reason to hide it.
 */
function HelpfulLinkRow({ link }: { link: HelpfulLinkView }) {
  if (!link.href) {
    return (
      <>
        <span className="block text-sm font-medium text-gray-500">
          {link.label}
        </span>
        <span className="block text-xs text-gray-400">no link set</span>
      </>
    );
  }

  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="block"
    >
      <span className="block text-sm font-medium text-primary underline">
        {link.label}
      </span>
      <span className="block text-xs text-gray-500">{link.domain}</span>
    </a>
  );
}

/**
 * The form a physician adds their own Task with.
 *
 * At the bottom of the Phase's list rather than behind a button somewhere
 * else, because the four things specific to this building belong in the same
 * list as everything else — and because the Phase is the one in view, so
 * there is no Phase field to choose and get wrong.
 *
 * A title and a body, and nothing else. There is no Helpful Links field and
 * no Dependencies picker, and there could not be one: the row has nowhere to
 * put them (ADR-0003). Adding a Task should not be an editorial exercise,
 * and a physician is not an editor.
 */
function AddTaskForm({ phaseSlug }: { phaseSlug: string }) {
  return (
    <section className="mt-8 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-4">
      <h3 className="text-sm font-semibold text-gray-900">
        Add a task of your own
      </h3>
      <p className="mt-1 text-sm text-gray-500">
        Something this phase needs that only your practice knows about.
      </p>

      <Form method="post" action={`/tasks/${phaseSlug}`} className="mt-3">
        <input type="hidden" name="intent" value="add-task" />

        <label htmlFor="new-task-title" className="sr-only">
          Task title
        </label>
        <input
          id="new-task-title"
          name="title"
          required
          placeholder="Call the landlord back"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
        />

        <label htmlFor="new-task-body" className="sr-only">
          What this task involves
        </label>
        <textarea
          id="new-task-body"
          name="body"
          rows={3}
          placeholder="What it involves, if it needs saying."
          className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
        />

        <button
          type="submit"
          className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
        >
          Add task
        </button>
      </Form>
    </section>
  );
}

/**
 * Deleting a Task the Practice wrote: the one thing on the list a Practice
 * can destroy outright.
 *
 * Two presses, and the question is a URL — `&confirm=delete` on the drawer's
 * own address — so it needs no client JS and survives a reload. Asking is
 * worth a press here in a way it would not be for a Status change, because
 * nothing brings this row back: there is no Grace Period on it and nothing
 * for the Admin to restore, so the press is the whole of the decision.
 *
 * It sits at the bottom of the drawer, under the Note, where a physician
 * reaches it deliberately rather than on the way to something else.
 */
function DeleteSection({
  task,
  phaseSlug,
  asking,
}: {
  task: OpenTaskView;
  phaseSlug: string;
  asking: boolean;
}) {
  const drawer = `/tasks/${phaseSlug}?task=${encodeURIComponent(task.ref)}`;

  if (!asking) {
    return (
      <section className="mt-8 border-t border-gray-200 pt-4">
        <Link
          to={`${drawer}&confirm=delete`}
          preventScrollReset
          className="text-sm text-gray-500 underline"
        >
          Delete this task
        </Link>
      </section>
    );
  }

  return (
    <section className="mt-8 border-t border-gray-200 pt-4">
      <p className="text-sm text-gray-700">
        Delete this task, and the note on it? This cannot be undone.
      </p>

      <div className="mt-3 flex items-center gap-3">
        <Form method="post" action={`/tasks/${phaseSlug}`}>
          <input type="hidden" name="intent" value="delete-task" />
          <input type="hidden" name="taskRef" value={task.ref} />
          <button
            type="submit"
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
          >
            Delete task
          </button>
        </Form>

        <Link
          to={drawer}
          preventScrollReset
          className="text-sm text-gray-600 underline"
        >
          Keep it
        </Link>
      </div>
    </section>
  );
}
