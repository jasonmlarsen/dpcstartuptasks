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
 * A placeholder, and deliberately nothing more. It exists so the scaffold has
 * something to render and so the design tokens have somewhere to prove they
 * reached the page; the real task list screen is a later ticket.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-bold text-gray-900">Launch Tasks</h1>
      <p className="mt-4 text-gray-600">
        A task list for physicians opening a Direct Primary Care practice.
      </p>
      <p className="mt-8 text-sm text-gray-500">
        Nothing is built here yet. This page exists so the next ticket can be
        written as a test.
      </p>
      <span className="mt-8 inline-block rounded-md bg-primary px-4 py-2 text-white">
        Design tokens are live
      </span>
    </main>
  );
}
