import { Link } from "react-router";

import type { Route } from "./+types/check-your-email";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Check your email — Launch Tasks" }];
}

/**
 * The only answer the sign-in form ever gives.
 *
 * It carries no loader and no data — not even the address that was typed —
 * because this page is what an unknown address, a known one, one over the
 * per-address limit and one belonging to a deleted Practice all get. The
 * moment it says anything about who asked, the sign-in form becomes a way to
 * find out which physicians have accounts.
 */
export default function CheckYourEmail() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold text-gray-900">Check your email</h1>
      <p className="mt-4 text-gray-700">
        If we can send you a sign-in link, it is on its way. Open the email and
        press Continue to sign in.
      </p>
      <p className="mt-4 text-sm text-gray-500">
        Links last ten minutes and work once. Nothing arrived?{" "}
        <Link to="/sign-in" className="underline">
          Try again
        </Link>
        .
      </p>
    </main>
  );
}
