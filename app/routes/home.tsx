import { Link, redirect } from "react-router";

import { getSignedInUser } from "~/auth/server";
import { hasDeletedPractice } from "~/practice/practice";
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
 * The landing page, which a signed-out visitor sees — and so does one other
 * person: somebody whose Practice is in its Grace Period.
 *
 * A physician who is signed in has a list waiting, and a page telling them so
 * would be one press between them and it. They land on the journey map.
 *
 * The exception is the thirty days after an Owner deletes. Their Practice is
 * unreachable and their Membership still stands, so without a word here they
 * would land on a page inviting them to sign in while already signed in,
 * which reads as the product having lost them. It says what happened and
 * that it can still be undone, which is the only surface the restore promise
 * has in v1.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);

  // Not `requireCurrentPractice`: this page is the one thing a visitor with
  // no session is allowed to read, so a missing Practice is an outcome here
  // rather than a redirect.
  if (await currentPractice(services, request)) throw redirect("/tasks");

  const signedInUser = await getSignedInUser(services, request);
  const deleted =
    signedInUser !== null &&
    hasDeletedPractice(services.database, signedInUser.id);

  // The press that did it lands here with its own session already ended, so
  // the query string is the only thing left to say it with. It carries no
  // authority and reveals nothing: anyone may type it, and all it does is
  // choose a paragraph.
  const justDeleted =
    new URL(request.url).searchParams.get("deleted") !== null;

  return { deleted: deleted || justDeleted };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-bold text-gray-900">Launch Tasks</h1>
      <p className="mt-4 text-gray-600">
        A task list for physicians opening a Direct Primary Care practice.
      </p>

      {loaderData.deleted && (
        <p className="mt-8 rounded-md bg-gray-100 p-4 text-gray-700">
          Your practice has been deleted. It is permanently deleted after
          thirty days — until then, reply to any email from us and we can
          bring it back.
        </p>
      )}

      <p className="mt-8 text-gray-700">
        <Link to="/sign-in" className="underline">
          Sign in
        </Link>{" "}
        to open your task list.
      </p>
    </main>
  );
}
