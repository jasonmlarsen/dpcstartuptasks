import { data, Form, Link, redirect } from "react-router";

import { isSameOrigin } from "~/auth/origin";
import { requestSignInLink } from "~/auth/server";
import { readInvite, rememberInviteeName, type InviteLink } from "~/practice/invite";
import { getServices } from "~/services/services";
import type { Route } from "./+types/invite";

export function meta(_: Route.MetaArgs) {
  return [{ title: "You have been invited — Launch Tasks" }];
}

/**
 * The acceptance screen, which is the whole of what an invite link does.
 *
 * The link **carries no authority**: opening it signs nobody in, and the one
 * button on the screen emails a Sign-in Link to the address the Invite was
 * sent to. That kills two things at once — a forwarded invitation cannot hand
 * someone else your place, and a mail scanner that opens the link burns
 * nothing, because there is nothing here to burn. The cost is one inbox trip.
 *
 * Unlike the Continue Screen, this `GET` reads the Invite and names its
 * failure. The asymmetry is deliberate and runs the other way from the invite
 * box: the box is byte-identical for every address because whoever is typing
 * never asked about the person they typed, while whoever is holding this link
 * was sent it, so *used*, *expired*, *revoked* and *practice full* are things
 * they are owed. Only a token that matches no row gets the generic message.
 */
export function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);
  const token = new URL(request.url).searchParams.get("token") ?? "";

  return { token, invite: readInvite(services.database, token) };
}

export async function action({ context, request }: Route.ActionArgs) {
  // Our own origin check, as on the Continue Screen and for a smaller
  // version of the same reason: this `POST` mints no session, but it does
  // send mail, and a form on someone else's page must not be able to make
  // this app write to an inbox.
  if (!isSameOrigin(request)) {
    throw data("That did not come from here", { status: 403 });
  }

  const services = getServices(context);
  const formData = await request.formData();
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "");

  // Read again on the way in: an invitation can be revoked, or a Practice can
  // fill up, between the page being opened and the button being pressed.
  const invite = readInvite(services.database, token);
  if (invite.status !== "open") return { token, invite, blankName: false };

  if (name.trim() === "") {
    return { token, invite: { ...invite, name }, blankName: true };
  }

  // Kept against the Invite, waiting for the User the first sign-in creates —
  // the same gap the registration form's consent checkbox crosses.
  rememberInviteeName(services.database, token, name);

  // The address comes from the Invite and never from the form, which is what
  // makes this button safe to put on a page anyone could open.
  await requestSignInLink(services, request, invite.email);

  // The same page an address typed into the sign-in form lands on, because
  // it is the same act with the same answer.
  return redirect("/check-your-email");
}

export default function Invite({ loaderData, actionData }: Route.ComponentProps) {
  const { invite, token } = actionData ?? loaderData;

  if (invite.status !== "open") return <InviteRefused invite={invite} />;

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      {/* Heading only, no explainer: the email said who invited them. */}
      <h1 className="text-2xl font-bold text-gray-900">
        Join {invite.practiceName ?? "this practice"} on Launch Tasks
      </h1>

      <Form method="post" className="mt-8">
        <input type="hidden" name="token" value={token} />

        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          You were invited at
        </label>
        {/*
          Shown and not editable, and not posted either: the address this
          screen mails is read back off the Invite. A form field that could
          change it would be the handover the no-authority link exists to
          prevent.
        */}
        <input
          id="email"
          type="email"
          value={invite.email}
          readOnly
          disabled
          className="mt-2 w-full rounded-md border border-gray-300 bg-gray-100 px-4 py-3 text-base text-gray-700"
        />

        <label
          htmlFor="name"
          className="mt-6 block text-sm font-medium text-gray-700"
        >
          Your name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          defaultValue={invite.name}
          className="mt-2 w-full rounded-md border border-gray-300 px-4 py-3 text-base"
        />

        {actionData?.blankName && (
          <p className="mt-2 text-sm text-error">
            Please tell us your name so the practice knows who joined.
          </p>
        )}

        <button
          type="submit"
          className="mt-8 w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-white"
        >
          Email me a sign-in link
        </button>
      </Form>
    </main>
  );
}

/**
 * The four named failures, and the one generic one.
 *
 * Each of the four tells the reader whether it is worth asking for another
 * invitation, which is the only question they have. The generic message is
 * reserved for a token that matches nothing, because a token nobody was ever
 * sent has no story of its own to tell.
 */
function InviteRefused({ invite }: { invite: InviteLink }) {
  const { heading, detail } = refusal(invite.status);

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold text-gray-900">{heading}</h1>
      <p className="mt-4 text-gray-700">{detail}</p>
      <p className="mt-6 text-sm text-gray-500">
        Already have an account?{" "}
        <Link to="/sign-in" className="underline">
          Sign in
        </Link>
        .
      </p>
    </main>
  );
}

function refusal(status: InviteLink["status"]) {
  switch (status) {
    case "used":
      return {
        heading: "This invitation has been used",
        detail:
          "Somebody has already joined with it. If that was you, sign in with your email address.",
      };
    case "revoked":
      return {
        heading: "This invitation was withdrawn",
        detail:
          "The practice took it back. Ask them to send you another one if you still need it.",
      };
    case "expired":
      return {
        heading: "This invitation has expired",
        detail:
          "Invitations last a week. Ask the practice to send you another one.",
      };
    case "practice-full":
      return {
        heading: "That practice is full",
        detail:
          "A practice holds three people, and all three places are taken. Ask them to make room and invite you again.",
      };
    case "own-practice-in-use":
      return {
        heading: "You already have a practice of your own",
        detail:
          "A person belongs to one practice at a time, and yours has work in it. Sign in and leave or delete your own practice first, then open this invitation again.",
      };
    default:
      return {
        heading: "This link does not work",
        detail: "Check the link in your email, or ask the practice to send you another one.",
      };
  }
}
