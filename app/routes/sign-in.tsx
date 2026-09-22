import { Form, Link, redirect } from "react-router";

import { requestSignInLink } from "~/auth/server";
import { EMAIL_CONSENT_WORDING } from "~/consent/consent-wording";
import { recordEmailConsentChoice } from "~/consent/email-consent";
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
export function loader({ request }: Route.LoaderArgs) {
  // Nothing is looked up here, not even whether the visitor is already signed
  // in. This page is the front of the only door in the product, and every
  // branch in front of it is a branch that could one day be about an address.
  const url = new URL(request.url);
  return { afterFailedLink: url.searchParams.get("link") === "failed" };
}

export async function action({ context, request }: Route.ActionArgs) {
  const services = getServices(context);
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  // An unticked checkbox is simply absent from what a browser submits, which
  // is the whole of how a physician declines.
  const emailConsent = formData.get("emailConsent") !== null;

  const outcome = await requestSignInLink(services, request, email);

  // Nothing here branches on whether the address is known — there is no
  // lookup to branch on, and adding one is how this page would become the
  // oracle it exists to avoid. Over the per-address limit looks like this too,
  // because the limit lives inside the sender.
  if (outcome === "invalid-address") {
    return { unreadableAddress: true };
  }

  // This form is also the registration form, so the answer to its checkbox has
  // to survive until there is a User to write it onto — which happens on the
  // Continue press, possibly on another device. It is recorded for every
  // submission, ticked or not and known address or not: the answer this page
  // gives back is the one place an address could ever leak, so nothing in
  // front of it may behave differently for one.
  recordEmailConsentChoice(services.database, email, emailConsent);

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

        {/*
          Ticked by default, and never a gate. Launch Tasks is free and stays
          usable whether or not this is left ticked; declining costs a
          physician nothing at all, here or afterwards.
        */}
        <label
          htmlFor="emailConsent"
          className="mt-6 flex items-start gap-3 text-sm text-gray-700"
        >
          <input
            id="emailConsent"
            name="emailConsent"
            type="checkbox"
            defaultChecked
            className="mt-1 size-4 shrink-0 rounded border-gray-300"
          />
          <span>{EMAIL_CONSENT_WORDING}</span>
        </label>

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
