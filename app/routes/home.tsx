import { Link } from "react-router";

import { getSignedInUser } from "~/auth/server";
import { practiceFor, taskListSize } from "~/practice/practice";
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
  const services = getServices(context);
  const signedInUser = await getSignedInUser(services, request);
  if (!signedInUser) return { email: null, practice: null };

  // The Practice comes from the Membership of whoever is signed in, and from
  // nothing the request carries. There is no id to tamper with here, which is
  // not a check that passed — it is a shape in which the check is unnecessary.
  const practice = practiceFor(services.database, signedInUser.id);
  if (!practice) return { email: signedInUser.email, practice: null };

  return {
    email: signedInUser.email,
    practice: {
      name: practice.name,
      ...taskListSize(services.database, practice),
    },
  };
}

/**
 * A placeholder, and deliberately little more. The journey map is a later
 * ticket; what this carries today is proof that registration did what it says
 * — the physician's own Practice, and a list that already exists rather than
 * one they have to start.
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  const { email, practice } = loaderData;

  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-bold text-gray-900">Launch Tasks</h1>
      <p className="mt-4 text-gray-600">
        A task list for physicians opening a Direct Primary Care practice.
      </p>

      {email ? (
        <p className="mt-8 text-gray-700">Signed in as {email}.</p>
      ) : (
        <p className="mt-8 text-gray-700">
          <Link to="/sign-in" className="underline">
            Sign in
          </Link>{" "}
          to open your task list.
        </p>
      )}

      {practice && (
        <>
          <h2 className="mt-8 text-xl font-semibold text-gray-900">
            {practice.name ?? "Your practice"}
          </h2>
          <p className="mt-2 text-gray-700">
            {practice.tasks} tasks across {practice.phases} phases are waiting
            on your list.
          </p>
        </>
      )}

      <p className="mt-8 text-sm text-gray-500">
        The task list itself is not built here yet. This page exists so the next
        ticket can be written as a test.
      </p>
    </main>
  );
}
