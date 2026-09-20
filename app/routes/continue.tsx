import { data, Form, Link, redirect } from "react-router";

import { isSameOrigin } from "~/auth/origin";
import { continueFromSignInLink, setDisplayName } from "~/auth/server";
import { registerPractice } from "~/practice/registration";
import { getServices } from "~/services/services";
import type { Route } from "./+types/continue";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Continue — Launch Tasks" }];
}

/**
 * The Continue Screen.
 *
 * Corporate mail systems open links before their owner does, so a link that
 * signed you in merely by being fetched would already be spent by the time the
 * physician clicked it. This `GET` therefore does nothing at all: it does not
 * validate the token, it does not look anything up, and it renders the same
 * page for a good link, an expired one and one somebody invented. That
 * uniformity is the point — a screen that could tell them apart would be a way
 * to test tokens.
 */
export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return { token: url.searchParams.get("token") ?? "" };
}

export async function action({ context, request }: Route.ActionArgs) {
  // Our own origin check, replacing the router-level one lost by never
  // mounting `auth.handler`. This `POST` mints a session, so a form on someone
  // else's page must not be able to reach it.
  if (!isSameOrigin(request)) {
    return data({ refused: "origin" } as const, { status: 403 });
  }

  const services = getServices(context);
  const formData = await request.formData();
  const token = String(formData.get("token") ?? "");

  const outcome = await continueFromSignInLink(services, request, token);

  if (outcome.status === "too-many-attempts") {
    // Visible, unlike the per-address limit on the send leg: whoever is
    // pressing holds a link already, so a refusal tells them nothing they did
    // not know, and a silent one would read as a broken link.
    return data({ refused: "too-many-attempts" } as const, { status: 429 });
  }

  if (outcome.status === "failed") {
    // No cause is named, because the library gives none that is safe to name:
    // used, expired, forged and never-existed are one outcome, not four.
    throw redirect("/sign-in?link=failed");
  }

  // The first Continue an address ever presses is also its registration: this
  // is where the Practice, the Owner Membership and ninety-eight Task Entries
  // come into being. Run on every successful sign-in, because what it reads is
  // whether a Membership exists, and for everyone after the first it does.
  const registered = registerPractice(services.database, outcome.user);

  // A Member's name is set on the acceptance screen and lands here, on the
  // sign-in that turns their Invite into a Membership. It goes through the
  // auth module because `user.name` is Better Auth's own column.
  if (registered.displayName) {
    await setDisplayName(services, outcome.user.id, registered.displayName);
  }

  // Better Auth set the session cookie on its own response headers; this is
  // where it is carried onto ours.
  const headers = new Headers();
  for (const cookie of outcome.headers.getSetCookie()) {
    headers.append("Set-Cookie", cookie);
  }
  throw redirect("/tasks", { headers });
}

export default function Continue({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  if (actionData?.refused === "too-many-attempts") {
    return (
      <main className="mx-auto max-w-md px-6 py-24">
        <h1 className="text-2xl font-bold text-gray-900">Too many attempts</h1>
        <p className="mt-4 text-gray-700">
          There have been too many sign-in attempts from this connection. Wait
          ten minutes and open your link again.
        </p>
      </main>
    );
  }

  if (actionData?.refused === "origin") {
    return (
      <main className="mx-auto max-w-md px-6 py-24">
        <h1 className="text-2xl font-bold text-gray-900">
          That did not come from here
        </h1>
        <p className="mt-4 text-gray-700">
          Open the link in your email again, or{" "}
          <Link to="/sign-in" className="underline">
            ask for a new one
          </Link>
          .
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold text-gray-900">
        Sign in to Launch Tasks
      </h1>
      <p className="mt-4 text-gray-700">Press Continue to finish signing in.</p>

      <Form method="post" className="mt-6">
        <input type="hidden" name="token" value={loaderData.token} />
        <button
          type="submit"
          className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-white"
        >
          Continue
        </button>
      </Form>
    </main>
  );
}
