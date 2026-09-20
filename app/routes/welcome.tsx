import { Form, Link, redirect } from "react-router";

import { AppBar } from "~/components/app-bar";
import {
  emailConsentGrantedAt,
  EMAIL_CONSENT_WORDING,
  kitSuppressedAt,
  subscribeByHand,
} from "~/consent/email-consent";
import { PRACTICE_STATES } from "~/database/schema";
import {
  answerTailoring,
  asPracticeState,
  asYesNo,
  skipTailoring,
  tailoringOwed,
} from "~/practice/tailoring";
import { requireCurrentPerson } from "~/practice/signed-in-practice";
import { getServices } from "~/services/services";
import type { Route } from "./+types/welcome";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Before you start — Launch Tasks" }];
}

/**
 * The Tailoring Wizard.
 *
 * One screen, three questions, one Continue and a Skip of equal weight. Not
 * three steps: progress dots imply a step four, and a screen a physician can
 * see the end of is the one they answer in fifteen seconds.
 *
 * Everything it does is set a Status to Not Applicable on the list behind it
 * (ADR-0002) — and Not Applicable sinks and dims rather than disappearing, so
 * a physician who answers wrongly loses nothing: the fourteen Tasks are on
 * the next screen, readable, one press from coming back. That is why there is
 * no confirmation step, no summary of what was set aside, and no way to
 * re-answer this screen later.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);
  const { user, practice } = await requireCurrentPerson(services, request);

  // Answered, skipped, in flight, or read by a Member: all four are the same
  // answer, which is that this screen is not owed and the list is.
  if (!tailoringOwed(services.database, practice)) throw redirect("/tasks");

  const asked = new URL(request.url).searchParams.get("email");

  return {
    // Only for the appbar, which is on this screen for the same reason it is
    // on every other one: the physician who spots a wrong question here is
    // the physician who should be able to say so here.
    practiceName: practice.name,
    // The second ask, and the last one: offered only to somebody who
    // declined at registration, never to a Suppressed address — Kit has
    // told us that person unsubscribed, and asking them again here would be
    // the product arguing with them.
    offerEmail:
      asked === null &&
      emailConsentGrantedAt(services.database, user.id) === null &&
      kitSuppressedAt(services.database, user.id) === null,
    thanked: asked === "thanks",
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const services = getServices(context);
  const { user, practice } = await requireCurrentPerson(services, request);

  // Checked again on the way in, so a second post of this form — a reload, a
  // back button, a Member with the URL — cannot run a bulk Not Applicable
  // pass over a list that has been worked on since.
  if (!tailoringOwed(services.database, practice)) throw redirect("/tasks");

  const formData = await request.formData();

  // The card at the end of the screen, which is a form of its own and not a
  // field on the Wizard's: answering the three questions and saying yes to
  // email are two separate acts, and posting them together would make one
  // Continue press mean both.
  if (formData.get("intent") === "subscribe") {
    subscribeByHand(services.database, user.id);

    // Back to the same screen, still owed, with the card replaced by a line
    // of thanks. Their three questions are still in front of them.
    throw redirect("/welcome?email=thanks");
  }

  if (formData.get("intent") === "skip") {
    skipTailoring(services.database, practice);
  } else {
    answerTailoring(services.database, practice, {
      state: asPracticeState(formData.get("state")),
      fixedLocation: asYesNo(formData.get("fixedLocation")),
      expectsEmployees: asYesNo(formData.get("expectsEmployees")),
    });
  }

  // Both roads end on the list, because the list is what this screen was
  // delaying and there is nothing to report about a screen that leaves no
  // trace.
  throw redirect("/tasks");
}

export default function Welcome({ loaderData }: Route.ComponentProps) {
  const { offerEmail, thanked } = loaderData;

  return (
    <>
      <AppBar
        title={loaderData.practiceName ?? "Your practice"}
        width="max-w-2xl"
      />

      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">
          Three questions before we start
        </h1>
        <p className="mt-4 text-gray-700">
          Your answers set aside the tasks your practice will never need. Nothing
          is hidden or deleted — every task stays on your list, and you can bring
          any of them back at any time. Skip these and you will see all of them.
        </p>

        <Form method="post" className="mt-10 space-y-10">
          <YesNoQuestion
            name="fixedLocation"
            question="Will you see patients at a fixed office location?"
            hint="House-call or mobile-only practices can skip the buildout tasks."
          />

          {/*
            Deliberately not phrased as W-2 employees. The risk being managed
            runs the other way from the jargon: a physician whose spouse joins
            the practice as a Member must not read "staff" as covering them and
            keep six tasks about payroll and benefits they do not need.
          */}
          <YesNoQuestion
            name="expectsEmployees"
            question="Do you expect to hire any employees within your first 6 months?"
          />

          {/*
            Sets nothing aside, and is asked anyway: state law is what makes
            eleven of these tasks different for every physician, and knowing
            which state turns a warning into a pointer. It is not a promise of
            per-state instructions — stale state law is worse than none.
          */}
          <fieldset>
            <legend className="text-base font-medium text-gray-900">
              Which state will you practise in?
            </legend>
            <p className="mt-1 text-sm text-gray-600">
              Some tasks work differently in every state. We will say which ones.
            </p>
            <select
              name="state"
              defaultValue=""
              aria-label="Which state will you practise in?"
              className="mt-3 w-full rounded-md border border-gray-300 px-4 py-3 text-base"
            >
              <option value="">Prefer not to say</option>
              {PRACTICE_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </fieldset>

          <div className="flex flex-col items-center gap-4 sm:flex-row-reverse sm:justify-start">
            <button
              type="submit"
              className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-white sm:w-auto"
            >
              Continue
            </button>
            {/*
              A button rather than a link, and of equal visual weight: skipping
              is a real answer and is final, so it goes through the same post
              that settles the Wizard for good.
            */}
            <button
              type="submit"
              name="intent"
              value="skip"
              className="w-full rounded-md border border-gray-400 px-4 py-3 text-base font-medium text-gray-900 sm:w-auto"
            >
              Skip — just show me all available tasks
            </button>
          </div>
        </Form>

        {offerEmail && <EmailOffer />}
        {thanked && (
          <p className="mt-10 rounded-md bg-gray-100 p-6 text-gray-700">
            Thank you — you are on the list. Now, those three questions.
          </p>
        )}
      </main>
    </>
  );
}

/**
 * The one second ask: a card at the end of the Wizard, for the physician who
 * left the box unticked at registration.
 *
 * Here and **nowhere else**. This screen is seen once per Practice and is
 * gone, which is what makes a second ask fair — a card on the task list would
 * be a thing a physician who already said no meets every morning, and that is
 * not a card, it is a nag. Declining twice is declining, and the Subscribe
 * button in settings is where a change of mind goes afterwards.
 *
 * Below the Wizard's own form rather than inside it: the answers and the
 * consent are two acts, and one Continue press must never quietly mean both.
 * Dismissing is a link and not a button for the same reason the delete
 * confirmation is a URL — it survives a reload and costs no client JS, and
 * this screen has no memory to write it into anyway.
 */
function EmailOffer() {
  return (
    <section className="mt-12 rounded-md border border-gray-300 p-6">
      <h2 className="text-lg font-semibold text-gray-900">
        One more thing — email from us
      </h2>
      {/* The Consent Wording itself, under the same version the registration
          form stamps: a version has to name a sentence somebody read. */}
      <p className="mt-2 text-gray-700">{EMAIL_CONSENT_WORDING}</p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Form method="post">
          <input type="hidden" name="intent" value="subscribe" />
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-3 text-base font-medium text-white"
          >
            Yes, email me
          </button>
        </Form>

        <Link
          to="/welcome?email=no"
          className="rounded-md border border-gray-400 px-4 py-3 text-base font-medium text-gray-900"
        >
          No thanks
        </Link>
      </div>
    </section>
  );
}

/**
 * One question, two radios and no default.
 *
 * Nothing is pre-selected, because a default here is the product answering on
 * the physician's behalf and then setting eight tasks aside on the strength
 * of it. An unanswered question sets nothing aside.
 */
function YesNoQuestion({
  name,
  question,
  hint,
}: {
  name: string;
  question: string;
  hint?: string;
}) {
  return (
    <fieldset>
      <legend className="text-base font-medium text-gray-900">
        {question}
      </legend>
      {hint && <p className="mt-1 text-sm text-gray-600">{hint}</p>}

      <div className="mt-3 flex gap-6">
        {(["yes", "no"] as const).map((answer) => (
          <label
            key={answer}
            htmlFor={`${name}-${answer}`}
            className="flex items-center gap-2 text-base text-gray-700"
          >
            <input
              id={`${name}-${answer}`}
              type="radio"
              name={name}
              value={answer}
              className="size-4"
            />
            <span>{answer === "yes" ? "Yes" : "No"}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
