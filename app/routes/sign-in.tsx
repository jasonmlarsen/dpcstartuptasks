import { Form, Link, redirect } from "react-router";

import { getSignedInUser, requestSignInLink } from "~/auth/server";
import { getServices } from "~/services/services";
import type { Route } from "./+types/sign-in";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sign in — Launch Tasks" }];
}

/**
 * The sign-in screen, which is also the invalid-link screen.
 *
 * A Sign-in Link that fails has nowhere better to land: the app cannot tell a
 * used link from an expired or forged one, and a failed token says nothing
 * about the address, so there is nobody to send a fresh link to automatically.
 * The one line above the field is everything that can honestly be said.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);

  if (await getSignedInUser(services, request)) {
    throw redirect("/");
  }

  const url = new URL(request.url);
  return { afterFailedLink: url.searchParams.get("link") === "failed" };
}

export async function action({ context, request }: Route.ActionArgs) {
  const services = getServices(context);
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();

  const outcome = await requestSignInLink(services, request, email);

  // Nothing here branches on whether the address is known — there is no
  // lookup to branch on, and adding one is how this page would become the
  // oracle it exists to avoid. Over the per-address limit looks like this too,
  // because the limit lives inside the sender.
  if (outcome === "invalid-address") {
    return { unreadableAddress: true };
  }

  return redirect("/check-your-email");
}

export default function SignIn({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold text-gray-900">Sign in</h1>

      {loaderData.afterFailedLink && (
        <p className="mt-4 rounded-md bg-gray-100 p-4 text-sm text-gray-700">
          Sign-in links last ten minutes and work once. Enter your email
          address below and we will send you a new one.
        </p>
      )}

      <Form method="post" className="mt-6">
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-2 w-full rounded-md border border-gray-300 px-4 py-3 text-base"
        />

        {actionData?.unreadableAddress && (
          <p className="mt-2 text-sm text-error">
            That does not look like an email address. Check it and try again.
          </p>
        )}

        <button
          type="submit"
          className="mt-6 w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-white"
        >
          Email me a sign-in link
        </button>
      </Form>

      <p className="mt-4 text-sm text-gray-500">
        Signing in means you accept our{" "}
        <Link to="/terms" className="underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link to="/privacy" className="underline">
          Privacy policy
        </Link>
        .
      </p>
    </main>
  );
}
