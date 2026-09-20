import { Form } from "react-router";

import {
  DONE_NOTE_CAP,
  FINISH_FEEDBACK,
  type FeedbackInInbox,
} from "~/admin/feedback-inbox";
import { asPlainDate } from "~/lib/plain-date";

/**
 * One Feedback as the Admin reads it, on either of its two doors.
 *
 * It is a component rather than markup written twice because the two doors
 * are two readings of one row: the queue in the Feedback section, and the
 * Task edit screen where the fix is typed. A row that grew a Done note in
 * one place and not the other would be the same feature behaving two ways.
 *
 * It lives here and not in the route it is mostly used by, so that importing
 * it never drags a loader and an action across route boundaries.
 *
 * The words come first and at full size. Everything else on the row is
 * context for them, including the address — which is the whole of the reply
 * story, since writing back happens in the Admin's mail client and not here.
 * The Done form posts to whatever screen the row is on and comes back to
 * it, so finishing a Feedback never moves the Admin off the page they were
 * reading — which is the whole point of the row appearing on two of them.
 */
export function FeedbackRow({
  feedback,
  namesTheTask = true,
}: {
  feedback: FeedbackInInbox;
  /** Whether to name the Task it was sent from. False where that is the heading. */
  namesTheTask?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap text-base text-gray-900">{feedback.text}</p>

      <p className="text-sm text-gray-600">
        {feedback.authorEmail ?? "The account is gone, so there is no address"} —{" "}
        {asPlainDate(feedback.createdAt)} —{" "}
        {/* A plain anchor and never a `Link`: this is a physician's page,
            stored from what their browser was showing, and the Admin has no
            Practice to open it against. It is here to be read and pasted,
            not to be navigated into. */}
        <a href={feedback.pagePath} className="underline">
          {feedback.pagePath}
        </a>
        {namesTheTask && feedback.taskTitle && <> — reading {feedback.taskTitle}</>}
      </p>

      {feedback.doneAt ? (
        <p className="text-sm text-gray-600">
          Done {asPlainDate(feedback.doneAt)}
          {feedback.doneNote ? ` — ${feedback.doneNote}` : ""}
        </p>
      ) : (
        <Form method="post" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="intent" value={FINISH_FEEDBACK} />
          <input type="hidden" name="feedbackId" value={feedback.id} />
          <input
            name="doneNote"
            maxLength={DONE_NOTE_CAP}
            aria-label="What changed, or why nothing did"
            placeholder="What changed, or why nothing did (optional)"
            className="w-80 max-w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900"
          />
          <button
            type="submit"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700"
          >
            Done
          </button>
        </Form>
      )}
    </div>
  );
}
