import type { Route } from "./+types/terms";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Terms — Launch Tasks" }];
}

/**
 * A stub, and deliberately reachable before it has content.
 *
 * The sign-in screen states that signing in is acceptance of these terms, and
 * a link under that sentence that 404s would make the sentence a lie. The
 * wording — including the guidance disclaimer that requirements vary by state
 * — is ticket 20's.
 */
export default function Terms() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-2xl font-bold text-gray-900">Terms</h1>
      <p className="mt-4 text-gray-700">
        These terms are still being written. Launch Tasks is free, and its
        content is general guidance: requirements vary by state, and nothing
        here is legal, tax or medical advice.
      </p>
    </main>
  );
}
