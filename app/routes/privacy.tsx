import type { Route } from "./+types/privacy";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Privacy — Launch Tasks" }];
}

/**
 * A stub, for the same reason as the Terms page: the sign-in screen links to
 * it before anyone has an account, so it has to answer. The policy itself —
 * including the plain statement that one person runs this and can enter a
 * Practice through Support View — is ticket 20's.
 */
export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-2xl font-bold text-gray-900">Privacy</h1>
      <p className="mt-4 text-gray-700">
        This policy is still being written. Launch Tasks is run by one person,
        who can sign in to a practice to help with it, and every time that
        happens it is recorded.
      </p>
    </main>
  );
}
