import { data, Form, Link, redirect } from "react-router";

import { PRACTICE_PEOPLE_CAP } from "~/database/schema";
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
import { requireCurrentPerson } from "~/practice/signed-in-practice";
import { getServices } from "~/services/services";
import type { Route } from "./+types/settings";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Settings — Launch Tasks" }];
}

/**
 * Settings, which is one page of plain sections and nothing to navigate.
 *
 * Only **People** is here so far: the Practice, Email from us, Your account
 * and Danger Zone sections arrive with the settings ticket, which is where
 * deleting a Practice and its thirty-day Grace Period live. This ticket owes
 * the three acts that change who is in a Practice, and they need a screen to
 * happen on.
 *
 * There is no *Seats*, no role column and no role editor. A Member can do
 * anything on the list the Owner can, and the three things only an Owner can
 * do — invite, remove, delete — are simply absent for everyone else rather
 * than shown disabled.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);
  const { user, practice } = await requireCurrentPerson(services, request);

  return {
    you: { userId: user.id, email: user.email, name: user.name },
    practiceName: practice.name,
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
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const services = getServices(context);
  const { user, practice } = await requireCurrentPerson(services, request);

  const submitted = await request.formData();
  const intent = submitted.get("intent");

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

  throw data("No such action", { status: 400 });
}

export default function Settings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { you, practiceName, isOwner, people, invites, placesLeft } = loaderData;
  const attempt = actionData?.attempt;

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-baseline justify-between px-6 py-4">
          <h1 className="text-lg font-semibold text-gray-900">
            {practiceName ?? "Your practice"}
          </h1>
          <Link to="/tasks" className="text-sm text-gray-600 underline">
            Back to your list
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h2 className="text-2xl font-bold text-gray-900">People</h2>
        <p className="mt-2 text-gray-700">
          A practice holds {PRACTICE_PEOPLE_CAP} people. Everyone here can do
          the same things on the list; only the owner can invite or remove.
        </p>

        <ul className="mt-6 divide-y divide-gray-200 border-y border-gray-200">
          {people.map((person) => (
            <li key={person.userId} className="flex items-center justify-between gap-4 py-4">
              <Person person={person} isYou={person.userId === you.userId} />
              {isOwner && person.role === "member" && (
                <RemoveButton person={person} />
              )}
            </li>
          ))}

          {invites.map((invitation) => (
            <li key={invitation.id} className="flex items-center justify-between gap-4 py-4">
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

        {isOwner ? (
          <InviteSection
            attempt={attempt}
            placesLeft={placesLeft}
            you={you}
            practiceName={practiceName}
          />
        ) : (
          <LeaveSection />
        )}
      </main>
    </div>
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

/**
 * A Member's way out, which for a Member is the same act as closing their
 * account: there is no account without a Practice.
 *
 * What they wrote stays. Saying so here is not reassurance for its own sake
 * — it is the one thing a Member hesitating over this button would want to
 * know about the Owner they are leaving behind.
 */
function LeaveSection() {
  return (
    <section className="mt-10">
      <h3 className="text-lg font-semibold text-gray-900">Leave this practice</h3>
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
    </section>
  );
}
