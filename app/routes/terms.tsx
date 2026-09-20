import { Link } from "react-router";

import { LegalPage, LegalSection } from "~/components/legal-page";
import { MAIL_REPLY_TO } from "~/services/email-sender";
import type { Route } from "./+types/terms";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Terms — Launch Tasks" }];
}

/**
 * The date this document last changed, which together with git is the whole
 * of its versioning.
 *
 * A reworded Terms gets a new date here and a commit, and nothing else moves
 * — in particular not `EMAIL_CONSENT_VERSION`, which names the sentence a
 * physician agreed to about email and has to keep meaning what it meant.
 */
export const TERMS_LAST_UPDATED = "20 September 2026";

/**
 * The Terms, and the one paragraph in them that is about this product rather
 * than about contracts.
 *
 * The guidance disclaimer is the load-bearing part. The `Varies by state`
 * pill on a Task and the deliberate dead end on per-state content are the
 * product already admitting its content can be wrong for the person reading
 * it, and with the Body being the whole of a Task, the disclaimer is
 * guarding the entire product surface rather than a corner of it.
 *
 * Acceptance is implicit and stated under the sign-in button. There is no
 * checkbox here and none on registration: the product is free, takes no
 * payment and holds no patient data, so a second tickbox would buy friction
 * and nothing else.
 */
export default function Terms() {
  return (
    <LegalPage title="Terms" lastUpdated={TERMS_LAST_UPDATED}>
      <LegalSection heading="What Launch Tasks is">
        <p>
          Launch Tasks is a free web app that walks you through opening a
          direct primary care practice as a task list. It is run by one
          person. Signing in means you accept these terms and the{" "}
          <Link to="/privacy" className="underline">
            privacy policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="This is guidance, not advice">
        <p>
          Launch Tasks is a checklist, not professional advice. The tasks and
          their guidance are general information about starting a practice —
          not legal, tax, accounting, or medical-practice compliance advice.
          Requirements vary by state and change over time. Confirm anything
          that matters with your own attorney, accountant, or state medical
          board before acting on it.
        </p>
        <p>
          Some tasks are marked as varying by state. That marking is a
          reminder, not a substitute for checking: an unmarked task can still
          be different where you are.
        </p>
      </LegalSection>

      <LegalSection heading="Your practice and the people in it">
        <p>
          An account is a practice. Whoever creates it is its owner, and the
          owner can invite up to two other people to work on the same list.
          Everyone in a practice sees the same tasks, the same statuses and
          the same notes; there is nothing in the product that is private to
          one person within a practice.
        </p>
        <p>
          You are responsible for what you write here and for who you invite.
          Launch Tasks is not built to hold patient information, so please do
          not put any in it.
        </p>
        <p>
          There are no passwords. Signing in means asking for a link by email
          and pressing Continue, so keeping your email account secure is what
          keeps your practice secure.
        </p>
      </LegalSection>

      <LegalSection heading="What we may do">
        <p>
          We write and edit the task library, and those edits reach practices
          already working through it. A task can be added, reworded or
          withdrawn at any time. A task you have already worked on is never
          taken off your list; a withdrawn one stays, marked as no longer
          required.
        </p>
        <p>
          We can suspend or remove an account that is being used to attack the
          service or to harm someone else. We will tell you if we do.
        </p>
      </LegalSection>

      <LegalSection heading="Leaving, and deleting">
        <p>
          If you were invited into a practice, you can remove yourself from it
          at any time, and your account goes with you. What you wrote stays
          with the practice — notes belong to the practice, not to whoever
          typed them.
        </p>
        <p>
          The owner can delete the practice. Everyone loses access straight
          away, and it is permanently deleted after thirty days. Inside those
          thirty days we can still bring it back if you ask.
        </p>
      </LegalSection>

      <LegalSection heading="No warranty, and what we are liable for">
        <p>
          Launch Tasks is free and is provided as it is, without any warranty.
          We do not promise it will be available, correct, complete or current
          — including the task content, which is written by a human who is not
          your attorney.
        </p>
        <p>
          To the extent the law allows, we are not liable for any loss arising
          from your use of Launch Tasks or from anything you did or did not do
          because of what it told you. Nothing here limits liability that
          cannot lawfully be limited.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to these terms">
        <p>
          When these terms change, the date at the top changes with them, and
          the previous wording stays in the project history. Continuing to use
          Launch Tasks after that date means you accept the new wording.
        </p>
      </LegalSection>

      <LegalSection heading="Getting in touch">
        <p>
          Write to <a href={`mailto:${MAIL_REPLY_TO}`} className="underline">{MAIL_REPLY_TO}</a>
          . A person reads it.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
