import {
  data,
  Form,
  Link,
  redirect,
  type RouterContextProvider,
} from "react-router";

import { AppBar } from "~/components/app-bar";
import { FEEDBACK_CHARACTER_CAP } from "~/database/schema";
import {
  asPagePath,
  sendFeedback,
  taskInView,
  type RefusedFeedback,
} from "~/practice/feedback";
import { requireCurrentPerson } from "~/practice/signed-in-practice";
import { supportViewContext } from "~/root";
import { getServices } from "~/services/services";
import type { Route } from "./+types/feedback";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Send feedback — Launch Tasks" }];
}

/**
 * The one free-text box in the product.
 *
 * A page rather than a dialog, because a dialog is client JS and this has
 * to work from the appbar on every page including the ones a physician
 * reaches on a bad connection in a corridor. What they were looking at
 * comes with them in the address — `from` and `task`, put there by the
 * appbar item and not by them — so the box asks for nothing but the words.
 *
 * There is no category, because picking one is friction at exactly the
 * moment someone has decided to tell you something. There is no thread,
 * because a thread is the support request the vocabulary was chosen to
 * avoid: the Admin has the address on the row and writes back by hand if it
 * is worth it. What the physician gets is a line saying it arrived.
 *
 * The one page in the product that a **Support View** cannot reach. The
 * appbar hides its item for the duration, and this is the other half of the
 * same promise: `sendFeedback` takes its author from the session, so an
 * Admin who typed the address by hand would write a Feedback in a
 * physician's name. Hiding a link is not *never*.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);
  refuseInSupportView(context);
  const { practice } = await requireCurrentPerson(services, request);

  const parameters = new URL(request.url).searchParams;
  const from = asPagePath(parameters.get("from"));
  const task = taskInView(
    services.database,
    practice,
    parameters.get("task"),
  );

  return {
    practiceName: practice.name,
    from,
    taskRef: parameters.get("task") ?? "",
    taskTitle: task.taskTitle,
    // The confirmation is a state of this page, reached by redirect, so a
    // reload cannot send the same words twice.
    sent: parameters.get("sent") === "1",
  };
}

/**
 * Take the words, or say why not.
 *
 * A refusal renders here with what was typed still in the box, rather than
 * redirecting or throwing a status page: the physician has already written
 * the thing, and losing it to a limit they did not know about would be the
 * product punishing them for telling it something.
 */
export async function action({ context, request }: Route.ActionArgs) {
  const services = getServices(context);
  refuseInSupportView(context);
  const { user, practice } = await requireCurrentPerson(services, request);

  const submitted = await request.formData();
  const text = String(submitted.get("text") ?? "");
  const from = asPagePath(submitted.get("from"));
  const taskRef = String(submitted.get("task") ?? "") || null;

  const sending = sendFeedback(services.database, practice, user, {
    text,
    pagePath: from,
    taskRef,
  });

  if (sending.outcome !== "sent") return { refused: sending, text };

  const carried = new URLSearchParams({ sent: "1", from });
  if (taskRef) carried.set("task", taskRef);

  throw redirect(`/feedback?${carried}`);
}

export default function Feedback({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { practiceName, from, taskRef, taskTitle, sent } = loaderData;

  return (
    <div className="min-h-dvh bg-gray-50">
      <AppBar title={practiceName ?? "Your practice"} width="max-w-2xl">
        <Link to="/tasks" className="text-sm text-gray-600 underline">
          Back to your list
        </Link>
      </AppBar>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h2 className="text-2xl font-bold text-gray-900">Send feedback</h2>

        {sent ? (
          <Confirmation from={from} />
        ) : (
          <FeedbackForm
            from={from}
            taskRef={taskRef}
            taskTitle={taskTitle}
            refused={actionData?.refused}
            typed={actionData?.text}
          />
        )}
      </main>
    </div>
  );
}

/**
 * The box, and what it is carrying.
 *
 * The page and the Task are shown rather than merely sent. *Silently* means
 * the physician does not have to describe where they were, not that they
 * are told nothing about what they are about to hand over — and seeing the
 * Task named is also how someone who meant to report a different one finds
 * out before pressing Send.
 */
function FeedbackForm({
  from,
  taskRef,
  taskTitle,
  refused,
  typed,
}: {
  from: string;
  taskRef: string;
  taskTitle: string | null;
  refused: RefusedFeedback | undefined;
  typed: string | undefined;
}) {
  return (
    <>
      <p className="mt-2 text-gray-700">
        Something wrong, missing or misleading? Tell us in your own words.
        One person reads every one of these.
      </p>

      <Form method="post" className="mt-6">
        <input type="hidden" name="from" value={from} />
        <input type="hidden" name="task" value={taskRef} />

        <p className="text-sm text-gray-500">
          {taskTitle ? (
            <>
              About <span className="font-medium">{taskTitle}</span>, from{" "}
              {from}
            </>
          ) : (
            <>Sent from {from}</>
          )}
        </p>

        <label htmlFor="text" className="sr-only">
          Your feedback
        </label>
        <textarea
          id="text"
          name="text"
          rows={8}
          required
          maxLength={FEEDBACK_CHARACTER_CAP}
          defaultValue={typed ?? ""}
          placeholder="The link on this task goes to the wrong form."
          className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
        />

        {refused && <Refusal refused={refused} />}

        <button
          type="submit"
          className="mt-4 rounded-md bg-primary px-4 py-3 text-base font-medium text-white"
        >
          Send
        </button>
      </Form>
    </>
  );
}

/**
 * Why it was not taken, said plainly.
 *
 * Both ceilings name their own number. A limit a physician cannot see the
 * edge of is one they hit again on the next press.
 */
function Refusal({ refused }: { refused: RefusedFeedback }) {
  const wording = {
    empty: "There is nothing in the box yet.",
    "too-long": `That is longer than the ${FEEDBACK_CHARACTER_CAP.toLocaleString("en-GB")} characters this box takes. Nothing has been sent, and nothing has been cut — shorten it and press Send again.`,
    "too-many":
      "That is as much as we can take from one person in an hour. Nothing has been sent; try again a little later.",
  }[refused.outcome];

  return (
    <p role="alert" className="mt-2 text-sm text-red-700">
      {wording}
    </p>
  );
}

/**
 * The inline confirmation, and the whole of what happens next.
 *
 * It says a person reads it and stops there. No case number, no *we will
 * get back to you within*, no thread to come back to — the product does not
 * run any of those, and promising one would make this box a lie the first
 * time nobody replied.
 */
function Confirmation({ from }: { from: string }) {
  return (
    <>
      <p className="mt-4 text-gray-700">
        Thank you — that has arrived. One person reads every one of these,
        and a fix to a task's wording reaches your list as soon as it is
        made. There is no case number and nothing to follow up here: this
        was a message, not a support case.
      </p>

      <Link
        to={from}
        className="mt-6 inline-block rounded-md border border-gray-300 px-4 py-3 text-base font-medium text-gray-700"
      >
        Back to where you were
      </Link>
    </>
  );
}

/**
 * The same 404 the admin panel gives, and for the same reason: there is
 * nothing here to explain to the one person who could have reached it.
 */
function refuseInSupportView(context: Readonly<RouterContextProvider>): void {
  if (context.get(supportViewContext)) throw data(null, { status: 404 });
}
