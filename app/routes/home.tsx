import { Link, redirect } from "react-router";

import { currentPractice } from "~/practice/signed-in-practice";
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

/**
 * The landing page, which only a signed-out visitor ever sees.
 *
 * A physician who is signed in has a list waiting, and a page telling them so
 * would be one press between them and it. They land on the journey map.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);

  // Not `requireCurrentPractice`: this page is the one thing a visitor with
  // no session is allowed to read, so a missing Practice is an outcome here
  // rather than a redirect.
  if (!(await currentPractice(services, request))) return null;

  throw redirect("/tasks");
}

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-bold text-gray-900">Launch Tasks</h1>
      <p className="mt-4 text-gray-600">
        A task list for physicians opening a Direct Primary Care practice.
      </p>

      <p className="mt-8 text-gray-700">
        <Link to="/sign-in" className="underline">
          Sign in
        </Link>{" "}
        to open your task list.
      </p>
    </main>
  );
}
