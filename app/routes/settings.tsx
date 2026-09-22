import { data, Form, Link, redirect } from "react-router";

import { setDisplayName, signOut } from "~/auth/server";
import { AppBar } from "~/components/app-bar";
import { EMAIL_CONSENT_WORDING } from "~/consent/consent-wording";
import {
  emailConsentGrantedAt,
  kitSuppressedAt,
  subscribeByHand,
} from "~/consent/email-consent";
import { PRACTICE_PEOPLE_CAP, PRACTICE_STATES } from "~/database/schema";
import { asPlainDate } from "~/lib/plain-date";
import { deletePractice } from "~/practice/deletion";
import {
  inviteToPractice,
  pendingInvites,
  revokeInvite,
  type PendingInvite,
} from "~/practice/invite";
import {
  leavePractice,
  peopleIn,
  placesTaken,
  removeMember,
  type PersonInPractice,
} from "~/practice/people";
import { describePractice } from "~/practice/practice";
import { requireCurrentPerson } from "~/practice/signed-in-practice";
import { asPracticeState } from "~/practice/tailoring";
import { KIT_RESUBSCRIBE_FORM_URL } from "~/services/kit-client";
import { getServices } from "~/services/services";
import type { Route } from "./+types/settings";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Settings — Launch Tasks" }];
}

/**
 * Settings: one page, five plain sections, nothing to navigate and nothing
 * to discover.
 *
 * Practice, People, Email from us, Your account, Danger Zone, in that order
 * and on one scroll. No tabs, no sub-navigation, no table — a table pulls
 * the language towards *Seats* and a role column, both of which
 * `CONTEXT.md` avoids, and the shape is what exerts that pull rather than
 * anyone deciding to write them.
 *
 * There is no role editor. A Member can do anything on the list the Owner
 * can, and the three acts that are the Owner's alone — invite, remove,
 * delete — are simply absent for everyone else rather than shown disabled.
 *
 * The one thing on this page that cannot be undone by pressing something
 * else is in the Danger Zone, and even that is recoverable for thirty days.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);
  const { user, practice } = await requireCurrentPerson(services, request);

  const consentGrantedAt = emailConsentGrantedAt(services.database, user.id);
  const suppressedAt = kitSuppressedAt(services.database, user.id);

  return {
    you: { userId: user.id, email: user.email, name: user.name },
    practiceName: practice.name,
    practiceState: practice.state,
    isOwner: practice.role === "owner",
    people: peopleIn(services.database, practice),
    // A Member is never shown who has been invited and not yet arrived: it
    // is the Owner's outstanding offer, and the Owner's to withdraw.
    invites:
      practice.role === "owner"
        ? pendingInvites(services.database, practice)
        : [],
    placesLeft:
      PRACTICE_PEOPLE_CAP - placesTaken(services.database, practice.id),
    // Formatted here rather than in the component, because the sentence it
    // lands in is a statement about a day and the server is the only place
    // that renders it twice the same way.
    consentGrantedOn: consentGrantedAt ? asPlainDate(consentGrantedAt) : null,
    // Suppressed: what Kit told a Sync Job about this address, which is the
    // one thing on this page that is about Kit's state rather than about an
    // act. It is read from a column, never from Kit.
    suppressed: suppressedAt !== null,
    // The delete question is a URL, so it survives a reload and a back
    // button and costs no client JS — the same shape the drawer's Delete
    // this task uses.
    confirmingDelete: new URL(request.url).searchParams.get("confirm") === "delete",
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const services = getServices(context);
  const { user, practice } = await requireCurrentPerson(services, request);

  const submitted = await request.formData();
  const intent = submitted.get("intent");

  if (intent === "practice") {
    describePractice(services.database, practice, {
      name: String(submitted.get("practiceName") ?? ""),
      state: asPracticeState(submitted.get("state")),
    });

    // The Display Name is the person's and not the Practice's, and it goes
    // through the auth module because `name` is Better Auth's own column
    // (ADR-0004). It shares this form because the two names are what a
    // physician came here to fix, and two Save buttons would be a puzzle.
    await setDisplayName(
      services,
      user.id,
      String(submitted.get("displayName") ?? "").trim(),
    );

    throw redirect("/settings");
  }

  if (intent === "subscribe") {
    // Grants and enqueues, and never calls Kit: this page cannot, and the
    // job is what re-reads Kit on a physician's behalf.
    subscribeByHand(services.database, user.id);

    throw redirect("/settings");
  }

  if (intent === "sign-out") {
    // The cookie deletion is in these headers, so the redirect has to carry
    // them or the physician stays signed in on a page telling them they are
    // not.
    const headers = await signOut(services, request);
    throw redirect("/", { headers });
  }

  if (intent === "invite") {
    const attempt = await inviteToPractice(services, practice, user, {
      email: String(submitted.get("email") ?? ""),
      yourName: String(submitted.get("yourName") ?? ""),
      practiceName: String(submitted.get("practiceName") ?? ""),
    });

    // Only the Owner can invite, and a Member posting this form by hand gets
    // the answer that says so rather than one that says nothing.
    if (attempt.outcome === "not-owner") {
      throw data("Only the owner can invite", { status: 403 });
    }

    return { attempt };
  }

  if (intent === "revoke-invite") {
    const inviteId = Number(submitted.get("inviteId"));
    if (!revokeInvite(services.database, practice, inviteId)) {
      throw data("No such invitation", { status: 404 });
    }

    throw redirect("/settings");
  }

  if (intent === "remove-member") {
    const removal = await removeMember(
      services,
      practice,
      String(submitted.get("userId") ?? ""),
    );

    if (removal === "not-owner") {
      throw data("Only the owner can remove", { status: 403 });
    }
    if (removal === "no-such-member") {
      throw data("No such member", { status: 404 });
    }

    throw redirect("/settings");
  }

  if (intent === "leave") {
    const leaving = await leavePractice(services, practice, user.id);

    // An Owner cannot Leave: with no co-owners it would orphan the list, and
    // deleting the Practice is the act they actually mean.
    if (leaving === "owner-cannot-leave") {
      throw data("An owner cannot leave", { status: 403 });
    }

    // Their session went with their account, so this lands on the door.
    throw redirect("/sign-in");
  }

  if (intent === "delete-practice") {
    const deletion = await deletePractice(services, practice);

    if (deletion === "not-owner") {
      throw data("Only the owner can delete this practice", { status: 403 });
    }

    // Their own session went with everyone else's, so this lands on the
    // landing page — with the one thing they need to know still on it.
    throw redirect("/?deleted=1");
  }

  throw data("No such action", { status: 400 });
}

export default function Settings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    you,
    practiceName,
    practiceState,
    isOwner,
    people,
    invites,
    placesLeft,
    consentGrantedOn,
    suppressed,
    confirmingDelete,
  } = loaderData;
  const attempt = actionData?.attempt;

  return (
    <div className="min-h-dvh bg-gray-50">
      <AppBar title={practiceName ?? "Your practice"} width="max-w-2xl">
        <Link to="/tasks" className="text-sm text-gray-600 underline">
          Back to your list
        </Link>
      </AppBar>

      <main className="mx-auto max-w-2xl space-y-12 px-6 py-10">
        <PracticeSection
          practiceName={practiceName}
          practiceState={practiceState}
          you={you}
        />

        <PeopleSection
          you={you}
          practiceName={practiceName}
          isOwner={isOwner}
          people={people}
          invites={invites}
          placesLeft={placesLeft}
          attempt={attempt}
        />

        <EmailSection
          consentGrantedOn={consentGrantedOn}
          suppressed={suppressed}
        />

        <AccountSection email={you.email} />

        <DangerZone
          isOwner={isOwner}
          practiceName={practiceName}
          asking={confirmingDelete}
        />
      </main>
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return <h2 className="text-2xl font-bold text-gray-900">{children}</h2>;
}

/**
 * The Practice: the two names, and the state.
 *
 * The other two things the Tailoring Wizard was told — a fixed location,
 * and employees inside six months — are stored and are deliberately not
 * here. Nothing ever re-reads them (ADR-0002), so showing them would
 * promise a re-tailoring that does not exist, and an editor for them would
 * promise one twice over.
 *
 * State is here because it is the one part of the Practice Profile with a
 * live reader: it turns the list's quiet `Varies by state` pill into a
 * pointer at a particular state's rules. Changing it never re-runs the
 * Wizard — that screen is once per Practice and is gone.
 */
function PracticeSection({
  practiceName,
  practiceState,
  you,
}: {
  practiceName: string | null;
  practiceState: string | null;
  you: { name: string };
}) {
  return (
    <section>
      <SectionHeading>Practice</SectionHeading>
      <p className="mt-2 text-gray-700">
        Nothing here was required when you signed up, and none of it is
        required now. It is used to address you and to point out the tasks
        that work differently where you are.
      </p>

      <Form method="post" className="mt-6 space-y-6">
        <input type="hidden" name="intent" value="practice" />

        <div>
          <label
            htmlFor="displayName"
            className="block text-sm font-medium text-gray-700"
          >
            Your name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            autoComplete="name"
            placeholder="Dr. Sarah Reyes"
            defaultValue={you.name}
            className="mt-2 w-full rounded-md border border-gray-300 px-4 py-3 text-base"
          />
        </div>

        <div>
          <label
            htmlFor="settingsPracticeName"
            className="block text-sm font-medium text-gray-700"
          >
            Practice name
          </label>
          <input
            id="settingsPracticeName"
            name="practiceName"
            type="text"
            defaultValue={practiceName ?? ""}
            className="mt-2 w-full rounded-md border border-gray-300 px-4 py-3 text-base"
          />
        </div>

        <div>
          <label
            htmlFor="state"
            className="block text-sm font-medium text-gray-700"
          >
            The state you practise in
          </label>
          <select
            id="state"
            name="state"
            defaultValue={practiceState ?? ""}
            className="mt-2 w-full rounded-md border border-gray-300 px-4 py-3 text-base"
          >
            <option value="">Prefer not to say</option>
            {PRACTICE_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-3 text-base font-medium text-white sm:w-auto"
        >
          Save
        </button>
      </Form>
    </section>
  );
}

function PeopleSection({
  you,
  practiceName,
  isOwner,
  people,
  invites,
  placesLeft,
  attempt,
}: {
  you: { userId: string; name: string; email: string };
  practiceName: string | null;
  isOwner: boolean;
  people: PersonInPractice[];
  invites: PendingInvite[];
  placesLeft: number;
  attempt: Awaited<ReturnType<typeof inviteToPractice>> | undefined;
}) {
  return (
    <section>
      <SectionHeading>People</SectionHeading>
      <p className="mt-2 text-gray-700">
        A practice holds {PRACTICE_PEOPLE_CAP} people. Everyone here can do
        the same things on the list; only the owner can invite or remove.
      </p>

      <ul className="mt-6 divide-y divide-gray-200 border-y border-gray-200">
        {people.map((person) => (
          <li
            key={person.userId}
            className="flex items-center justify-between gap-4 py-4"
          >
            <Person person={person} isYou={person.userId === you.userId} />
            {isOwner && person.role === "member" && (
              <RemoveButton person={person} />
            )}
          </li>
        ))}

        {invites.map((invitation) => (
          <li
            key={invitation.id}
            className="flex items-center justify-between gap-4 py-4"
          >
            <div>
              <p className="text-base text-gray-900">{invitation.email}</p>
              <p className="text-sm text-gray-600">
                Invited — waiting for them to sign in
              </p>
            </div>
            <RevokeButton invitation={invitation} />
          </li>
        ))}
      </ul>

      {isOwner && (
        <InviteSection
          attempt={attempt}
          placesLeft={placesLeft}
          you={you}
          practiceName={practiceName}
        />
      )}
    </section>
  );
}

/**
 * Email from us: the act, its date, and nothing about a subscription.
 *
 * The app never calls Kit from a loader, so it cannot say whether anybody
 * is on the list today — and this section must not sound as though it can.
 * What it can say is what happened: *you said yes, on this day*. The
 * accepted cost is that someone who unsubscribed a year ago may read the
 * sentence as *you are subscribed*; the alternative is the page inventing a
 * state it does not hold.
 *
 * Withdrawal is not here, because it is not ours: the unsubscribe link in
 * the footer of the email is where it happens and where it works, whatever
 * this page does.
 *
 * A Suppressed address — one a Kit Sync Job found Cancelled — **loses the
 * Subscribe button entirely**. Not disabled, not shown with an error: a
 * button that cannot work is a promise the app cannot keep, because `state`
 * is create-only on Kit's API and there is no write that resurrects anyone.
 * What replaces it is the plain truth and the one link that does work.
 */
function EmailSection({
  consentGrantedOn,
  suppressed,
}: {
  consentGrantedOn: string | null;
  suppressed: boolean;
}) {
  return (
    <section>
      <SectionHeading>Email from us</SectionHeading>

      {consentGrantedOn && (
        <p className="mt-2 text-gray-700">
          You said yes to our email on {consentGrantedOn}.
        </p>
      )}

      {suppressed ? (
        <Suppressed />
      ) : consentGrantedOn ? null : (
        <>
          <p className="mt-2 text-gray-700">
            You have not said yes to email from us. Launch Tasks is free and
            stays free either way.
          </p>
          {/*
            The Consent Wording itself, and not a paraphrase of it: the
            version stamped on the act names a sentence, so the sentence has
            to be the one the physician actually read. It is the same
            wording the registration form shows, under the same version.
          */}
          <p className="mt-4 text-gray-700">{EMAIL_CONSENT_WORDING}</p>
          <Form method="post" className="mt-4">
            <input type="hidden" name="intent" value="subscribe" />
            {/* A button and never a checkbox: consent is append-only, and a
                checkbox implies it toggles back. */}
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-3 text-base font-medium text-white sm:w-auto"
            >
              Subscribe
            </button>
          </Form>
        </>
      )}

      {/* Pointless to somebody who has already used it, and the Suppressed
          paragraph above says the same thing from the other end. */}
      {!suppressed && (
        <p className="mt-4 text-sm text-gray-600">
          The unsubscribe link at the bottom of any email we send always works,
          whatever this page says — leaving the email list has nothing to do
          with leaving Launch Tasks.
        </p>
      )}
    </section>
  );
}

/**
 * What a Suppressed address is told: that they unsubscribed, that we cannot
 * undo it, and where the form that can is.
 *
 * Every sentence here is the app declining to do something, and it says so
 * plainly rather than apologising or hedging — nothing punitive happened and
 * nothing is broken; the physician asked to be taken off a list and Kit
 * honoured it. The link is the Resubscribe Form, which Launch Tasks links to
 * and never operates: its double opt-in is the explicit permission Kit
 * requires, and the confirmation email is where it is given.
 *
 * It does not say *press Subscribe again afterwards*, because there is no
 * button here to press. The next Kit Sync Job this User's Practice produces
 * reads Kit again, finds them active, and clears the suppression on its own.
 */
function Suppressed() {
  return (
    <>
      <p className="mt-2 text-gray-700">
        You unsubscribed from our email, so we have stopped sending it. We
        cannot add you back ourselves — that has to come from you, which is
        the rule that makes an unsubscribe worth anything.
      </p>
      <p className="mt-4 text-gray-700">
        If you would like it again, sign up on{" "}
        <a
          href={KIT_RESUBSCRIBE_FORM_URL}
          className="text-primary underline"
          rel="noreferrer"
        >
          this form
        </a>
        . It sends a confirmation email, and the list starts again when you
        click the link in it.
      </p>
    </>
  );
}

/**
 * Your account, which is one address and a way out of the browser.
 *
 * The email is shown and is never editable: it is what a Sign-in Link is
 * bound to, so changing it is an account migration and not a settings
 * field. There is no input for it at all — a disabled box would be a
 * control that looks like it might one day work.
 */
function AccountSection({ email }: { email: string }) {
  return (
    <section>
      <SectionHeading>Your account</SectionHeading>
      <p className="mt-2 text-gray-700">{email}</p>
      <p className="mt-1 text-sm text-gray-600">
        This is the address your sign-in links go to, and it cannot be
        changed here. Your name is in the Practice section above.
      </p>

      <Form method="post" className="mt-4">
        <input type="hidden" name="intent" value="sign-out" />
        <button
          type="submit"
          className="rounded-md border border-gray-400 px-4 py-3 text-base font-medium text-gray-900"
        >
          Sign out
        </button>
      </Form>
    </section>
  );
}

/**
 * The Danger Zone, which keeps that name deliberately: it reads outside
 * developer circles, and the point of the section is that it is loud.
 *
 * For the Owner it is *Delete this practice*, behind two buttons and **no
 * typing test**. The act is recoverable for thirty days, and a typing test
 * on a recoverable act teaches a physician to fear the app without making
 * anything safer.
 *
 * For a Member it is Leave, which for a Member is the same act as closing
 * their account: there is no account without a Practice. An Owner is
 * offered neither Leave nor a transfer — with no co-owners, Leaving would
 * orphan the list, and inventing an ownership handover is a bigger decision
 * than this screen should make.
 */
function DangerZone({
  isOwner,
  practiceName,
  asking,
}: {
  isOwner: boolean;
  practiceName: string | null;
  asking: boolean;
}) {
  return (
    <section className="rounded-md border border-error p-6">
      <SectionHeading>Danger Zone</SectionHeading>

      {isOwner ? (
        <DeletePractice practiceName={practiceName} asking={asking} />
      ) : (
        <Leave />
      )}
    </section>
  );
}

function DeletePractice({
  practiceName,
  asking,
}: {
  practiceName: string | null;
  asking: boolean;
}) {
  if (!asking) {
    return (
      <>
        <p className="mt-2 text-gray-700">
          Deleting {practiceName ?? "your practice"} closes it for everyone in
          it — the list, the notes, and the tasks you added.
        </p>
        <Link
          to="/settings?confirm=delete"
          className="mt-4 inline-block rounded-md border border-error px-4 py-3 text-base font-medium text-error"
        >
          Delete this practice
        </Link>
      </>
    );
  }

  return (
    <>
      {/*
        The sentence that has to be here, and has to say thirty. Nothing is
        destroyed when this button is pressed — the practice is held for a
        month and then purged — so telling a physician their data is gone
        today would be the one false promise available on this screen.
      */}
      <p className="mt-2 text-gray-700">
        Delete {practiceName ?? "your practice"}? Everyone in it is signed out
        straight away, and it is permanently deleted after thirty days. Inside
        those thirty days we can still bring it back if you ask us — reply to
        any email from us and say so.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Form method="post">
          <input type="hidden" name="intent" value="delete-practice" />
          <button
            type="submit"
            className="rounded-md bg-error px-4 py-3 text-base font-medium text-white"
          >
            Delete this practice
          </button>
        </Form>

        {/* The second of the two buttons, and deliberately as easy to
            press as the first: the confirmation is there to be escaped
            from, so the way out is not a small grey link under it. */}
        <Link
          to="/settings"
          className="rounded-md border border-gray-400 px-4 py-3 text-base font-medium text-gray-900"
        >
          Nope — take me back
        </Link>
      </div>
    </>
  );
}

/**
 * A Member's way out, which for a Member is the same act as closing their
 * account: there is no account without a Practice.
 *
 * What they wrote stays. Saying so here is not reassurance for its own sake
 * — it is the one thing a Member hesitating over this button would want to
 * know about the Owner they are leaving behind.
 */
function Leave() {
  return (
    <>
      <p className="mt-2 text-gray-700">
        Leaving removes you from this practice and from Launch Tasks — there
        is nothing here without a practice. Anything you wrote on the list
        stays with the practice.
      </p>

      <Form method="post" className="mt-4">
        <input type="hidden" name="intent" value="leave" />
        <button
          type="submit"
          className="rounded-md border border-error px-4 py-3 text-base font-medium text-error"
        >
          Leave this practice
        </button>
      </Form>
    </>
  );
}

/**
 * The invite box, whose answer is the same for every address.
 *
 * *Invitation sent* is what a known address, an unknown one, one already
 * invited and one already in this practice all get, because the Owner typing
 * an address never asked to be told anything about whoever holds it.
 */
function InviteSection({
  attempt,
  placesLeft,
  you,
  practiceName,
}: {
  attempt: Awaited<ReturnType<typeof inviteToPractice>> | undefined;
  placesLeft: number;
  you: { name: string; email: string };
  practiceName: string | null;
}) {
  const full = placesLeft <= 0 || attempt?.outcome === "practice-full";
  const needs = attempt?.outcome === "needs-details" ? attempt : undefined;

  // Asked at the moment they are first needed, so the invitation reads as
  // being from a person and a clinic rather than from an app.
  const askForYourName = you.name.trim() === "" || needs?.yourName;
  const askForPracticeName = practiceName === null || needs?.practiceName;

  return (
    <section className="mt-10">
      <h3 className="text-lg font-semibold text-gray-900">
        Invite someone to this practice
      </h3>

      {full ? (
        <p className="mt-2 text-gray-700">
          This practice is full. Withdraw an invitation or remove someone to
          make room.
        </p>
      ) : (
        <Form method="post" className="mt-4">
          <input type="hidden" name="intent" value="invite" />

          {askForYourName && (
            <>
              <label
                htmlFor="yourName"
                className="block text-sm font-medium text-gray-700"
              >
                Your name
              </label>
              <p className="mt-1 text-sm text-gray-600">
                So the invitation comes from a person.
              </p>
              <input
                id="yourName"
                name="yourName"
                type="text"
                autoComplete="name"
                required
                defaultValue={you.name}
                className="mt-2 mb-4 w-full rounded-md border border-gray-300 px-4 py-3 text-base"
              />
            </>
          )}

          {askForPracticeName && (
            <>
              <label
                htmlFor="practiceName"
                className="block text-sm font-medium text-gray-700"
              >
                Your practice's name
              </label>
              <input
                id="practiceName"
                name="practiceName"
                type="text"
                required
                defaultValue={practiceName ?? ""}
                className="mt-2 mb-4 w-full rounded-md border border-gray-300 px-4 py-3 text-base"
              />
            </>
          )}

          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700"
          >
            Their email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="off"
            required
            className="mt-2 w-full rounded-md border border-gray-300 px-4 py-3 text-base"
          />

          {attempt?.outcome === "unreadable-address" && (
            <p className="mt-2 text-sm text-error">
              That does not look like an email address. Check it and try again.
            </p>
          )}

          {needs && (
            <p className="mt-2 text-sm text-error">
              Please fill in{" "}
              {needs.yourName && needs.practiceName
                ? "your name and your practice's name"
                : needs.yourName
                  ? "your name"
                  : "your practice's name"}{" "}
              first.
            </p>
          )}

          <button
            type="submit"
            className="mt-6 w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-white sm:w-auto"
          >
            Send invitation
          </button>
        </Form>
      )}

      {/*
        The answer, and the whole of it. It does not name the address back,
        which is what lets it be byte-identical for every one of them: an
        address already in this practice, one already invited, one belonging
        to a physician who has used the product for a year, and one nobody
        has ever typed all produce this exact sentence.
      */}
      {attempt?.outcome === "invited" && (
        <p className="mt-4 rounded-md bg-gray-100 p-4 text-sm text-gray-700">
          Invitation sent. They will get an email with a link to join.
        </p>
      )}
    </section>
  );
}

function Person({
  person,
  isYou,
}: {
  person: PersonInPractice;
  isYou: boolean;
}) {
  return (
    <div>
      {/* The name if there is one, and the address if there is not. */}
      <p className="text-base text-gray-900">
        {person.name ?? person.email}
        {isYou && <span className="text-gray-500"> (you)</span>}
      </p>
      <p className="text-sm text-gray-600">
        {person.name ? `${person.email} — ` : ""}
        {person.role === "owner" ? "Owner" : "Member"}
      </p>
    </div>
  );
}

function RemoveButton({ person }: { person: PersonInPractice }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="remove-member" />
      <input type="hidden" name="userId" value={person.userId} />
      <button
        type="submit"
        className="rounded-md border border-gray-400 px-3 py-2 text-sm font-medium text-gray-900"
      >
        Remove
      </button>
    </Form>
  );
}

function RevokeButton({ invitation }: { invitation: PendingInvite }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="revoke-invite" />
      <input type="hidden" name="inviteId" value={invitation.id} />
      <button
        type="submit"
        className="rounded-md border border-gray-400 px-3 py-2 text-sm font-medium text-gray-900"
      >
        Withdraw
      </button>
    </Form>
  );
}
