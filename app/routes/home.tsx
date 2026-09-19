import { Link } from "react-router";

import { getSignedInUser } from "~/auth/server";
import { getServices } from "~/services/services";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Launch Tasks" },
    {
      name: "description",
      content:
        "A task list for physicians opening a Direct Primary Care practice.",
    },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const signedInUser = await getSignedInUser(getServices(context), request);
  return { email: signedInUser?.email ?? null };
}

/**
 * A placeholder, and deliberately little more. The real task list screen is a
 * later ticket; what it carries today is the one thing signing in is for —
 * saying who is signed in — so that the session a Sign-in Link mints is
 * visible from outside the auth module.
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-bold text-gray-900">Launch Tasks</h1>
      <p className="mt-4 text-gray-600">
        A task list for physicians opening a Direct Primary Care practice.
      </p>

      {loaderData.email ? (
        <p className="mt-8 text-gray-700">Signed in as {loaderData.email}.</p>
      ) : (
        <p className="mt-8 text-gray-700">
          <Link to="/sign-in" className="underline">
            Sign in
          </Link>{" "}
          to open your task list.
        </p>
      )}

      <p className="mt-8 text-sm text-gray-500">
        The task list itself is not built here yet. This page exists so the next
        ticket can be written as a test.
      </p>
    </main>
  );
}
