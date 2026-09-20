import { Link } from "react-router";

import { LegalPage, LegalSection } from "~/components/legal-page";
import { MAIL_REPLY_TO } from "~/services/email-sender";
import type { Route } from "./+types/privacy";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Privacy — Launch Tasks" }];
}

/**
 * The date this document last changed. See `TERMS_LAST_UPDATED`: two
 * independent dates, because the two documents move for their own reasons,
 * and neither of them is `EMAIL_CONSENT_VERSION`.
 */
export const PRIVACY_LAST_UPDATED = "20 September 2026";

/**
 * The privacy policy, which states **purposes, not current practice**
 * (ADR-0006).
 *
 * The load-bearing case is measurement. v1 measures nothing at all, and the
 * policy still describes measuring usage of the task list in the present
 * tense, because *we do not currently collect analytics* is accurate on
 * launch day, becomes a broken promise the first time a number is wanted,
 * and makes a policy revision the gate on ever measuring anything. The gap
 * between what this permits and what the product does is intentional, and
 * the sentence is narrow on purpose: usage of the task list, to improve the
 * guidance. A feature that exceeds it needs a new sentence here rather than
 * a generous reading of that one.
 *
 * The same principle keeps backups generic, and it is why the two
 * subprocessors a physician has a real question about are named while the
 * places an encrypted blob sits are only described — so swapping one is an
 * operational act rather than a policy edit.
 *
 * The Support View disclosure is the counterpart and works the other way
 * round: it is a capability that exists today, written in exactly the terms
 * the product means, and it names the operator rather than hiding behind
 * *our staff*. It must not imply a gate — Support View is not something a
 * physician grants, and *only with your permission* would re-promise what
 * ADR-0001 rejected. It lands a second time as the quiet line under the Note
 * field, which is the placement that does the most work.
 */
export default function Privacy() {
  return (
    <LegalPage title="Privacy" lastUpdated={PRIVACY_LAST_UPDATED}>
      <LegalSection heading="Who runs this">
        <p>
          Launch Tasks is run by one person. This policy covers this app and
          nothing else, and it says plainly what that one person can see. The{" "}
          <Link to="/terms" className="underline">
            terms
          </Link>{" "}
          are the other half.
        </p>
      </LegalSection>

      <LegalSection heading="What we hold">
        <p>
          Your email address, and a display name if you give one. What your
          practice told the three setup questions: your state, whether you see
          patients somewhere fixed, and whether you expect employees.
        </p>
        <p>
          Everything your practice writes on the list: statuses, notes, target
          dates and any tasks you add yourselves. Anything you send through the
          feedback box, along with the page you sent it from.
        </p>
        <p>
          We take no payment, so there are no card details here. Launch Tasks
          is not built to hold patient information, and you should not put any
          in it.
        </p>
      </LegalSection>

      <LegalSection heading="When we can see your practice">
        <p>
          Launch Tasks is run by one person. To help you when something goes
          wrong, that person can sign in to your practice and see it exactly as
          you do — including your Notes. Every time this happens it is
          recorded.
        </p>
      </LegalSection>

      <LegalSection heading="What we use it for">
        <p>
          To run the product: to sign you in, to show your practice its list,
          to send the email the product has to send, and to answer you when you
          write to us.
        </p>
        <p>
          We look at how practices use the task list — for example, which tasks
          tend to stall — to improve the guidance we write. We do not sell your
          data, and we do not share it with advertisers.
        </p>
      </LegalSection>

      <LegalSection heading="Email">
        <p>
          Some email the product has to send: your sign-in link, and an
          invitation when someone in your practice invites you. There is no way
          to switch those off while you have an account, because they are how
          the account works.
        </p>
        <p>
          Occasional other email — news, and things we have learned that may
          help you — goes only to people who asked for it, by ticking the box
          on the sign-in screen or from their settings page. Every one of those
          carries an unsubscribe link, and using it is the way to stop them.
        </p>
      </LegalSection>

      <LegalSection heading="Who else handles your data">
        <p>
          <strong>Resend</strong> sends our email, so it handles your email
          address and the contents of the messages we send you.
        </p>
        <p>
          <strong>Kit</strong> runs our newsletter. If you asked for that
          email, your address and your state are held there. Unsubscribing
          happens in Kit, and it is separate from your account here: deleting
          your practice does not unsubscribe you, and unsubscribing does not
          delete your practice.
        </p>
        <p>
          The app runs on rented servers, and its data is backed up off those
          servers. Backups are encrypted and retained for a limited period, and
          are accessible only to the operator.
        </p>
      </LegalSection>

      <LegalSection heading="Cookies">
        <p>
          One cookie, which is what keeps you signed in. There are no
          advertising cookies, and nothing here follows you to other sites.
        </p>
      </LegalSection>

      <LegalSection heading="Deleting things">
        <p>
          If you were invited into a practice, removing yourself deletes your
          account with it. What you wrote on the list stays, because it belongs
          to the practice.
        </p>
        <p>
          If the practice owner deletes the practice, everyone&apos;s access and
          data goes with it. Access ends immediately; the data is permanently
          deleted after thirty days, and within those thirty days we can still
          bring it back if you ask. After that the practice, its list, its
          notes, its feedback and the accounts of everyone who was in it are
          gone, and we cannot recover them.
        </p>
        <p>
          You can ask us what we hold about you, or ask us to delete it, by
          writing to the address below.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <p>
          When this policy changes, the date at the top changes with it, and
          the previous wording stays in the project history.
        </p>
      </LegalSection>

      <LegalSection heading="Getting in touch">
        <p>
          Write to{" "}
          <a href={`mailto:${MAIL_REPLY_TO}`} className="underline">
            {MAIL_REPLY_TO}
          </a>
          . A person reads it.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
